import { alertTarget } from "./alert.ts";
import { normalizeDomain } from "./domain.ts";
import { errorMessage, type AppEnv, type Deps } from "./env.ts";
import { challengeName, challengeValue, checkOwnership, newChallengeToken } from "./ownership.ts";
import { formatReport } from "./report.ts";
import type {
	DomainView,
	HistoryEntry,
	HostsPage,
	HostView,
	MonitorStatus,
	ScanReport,
	Severity,
} from "./types.ts";
import type { Snapshot } from "./snapshot.ts";
import { runScan } from "./scan.ts";
import {
	addDomain,
	deleteDomain,
	getDomain,
	latestScan,
	listDomainsWithReports,
	markVerified,
	readMonitorStatus,
	scanHistory,
	type DomainRow,
} from "./store.ts";

const MIN_TOKEN_LENGTH = 32;
const MAX_BODY_BYTES = 1024;

/** What a request may leave running after its answer: a manual scan must reach its alert. */
export interface RequestContext {
	waitUntil(promise: Promise<unknown>): void;
}

export async function handleRequest(
	request: Request,
	env: AppEnv,
	deps: Deps,
	ctx?: RequestContext,
): Promise<Response> {
	try {
		return await route(request, env, deps, ctx);
	} catch (err) {
		// Details go to the log, never to the caller.
		console.error(`Unhandled error: ${errorMessage(err)}`);
		const message = errorMessage(err);
		let error = "Internal error";
		if (/no such table/i.test(message)) {
			error = "The database has no tables yet. Apply the migrations; see the README.";
		} else if (/no such column/i.test(message)) {
			error = "The database is missing a migration. Apply the migrations; see the README.";
		}
		return json({ error }, 500);
	}
}

async function route(
	request: Request,
	env: AppEnv,
	deps: Deps,
	ctx: RequestContext | undefined,
): Promise<Response> {
	const url = new URL(request.url);
	const segments = url.pathname.split("/").filter(Boolean);

	if (segments.length === 0) return new Response("porchlight-monitor\n");
	if (segments[0] !== "domains" || segments.length > 3) return json({ error: "Not found" }, 404);

	const denied = await authorize(request, env);
	if (denied) return denied;

	if (segments.length === 1) {
		if (request.method === "GET") {
			const listed = await listDomainsWithReports(env.DB);
			return json({
				domains: listed.map(({ domain, report }) => describeDomain(domain, report)),
				status: await monitorStatus(env),
			});
		}
		if (request.method === "POST") return createDomain(request, env, deps);
		return methodNotAllowed("GET, POST");
	}

	const name = normalizeDomain(safeDecode(segments[1]!));
	const domain = name ? await getDomain(env.DB, name) : null;
	if (!domain) return json({ error: "Domain is not registered" }, 404);

	if (segments.length === 2) {
		if (request.method === "GET") {
			const latest = await latestScan(env.DB, domain.id);
			const report = latest?.report ?? null;
			return json({
				domain: describeDomain(domain, report),
				report,
				text: report && formatReport(report),
			});
		}
		if (request.method === "DELETE") {
			await deleteDomain(env.DB, domain.name);
			return json({ deleted: domain.name });
		}
		return methodNotAllowed("GET, DELETE");
	}

	if (segments[2] === "history") {
		if (request.method !== "GET") return methodNotAllowed("GET");
		const history: HistoryEntry[] = (await scanHistory(env.DB, domain.id)).map((report) => ({
			takenAt: report.takenAt,
			baseline: report.baseline,
			changes: report.changes,
			newFindings: report.newFindings,
			resolvedFindings: report.resolvedFindings,
			openFindings: countOpen(report),
			hostCount: report.hostCount,
			notes: report.notes,
		}));
		return json({ domain: domain.name, history });
	}

	if (segments[2] === "hosts") {
		if (request.method !== "GET") return methodNotAllowed("GET");
		const page = pageNumber(url.searchParams.get("page"));
		if (page === null) return json({ error: "page must be a whole number from 1" }, 400);
		const latest = await latestScan(env.DB, domain.id);
		if (!latest) return json({ error: `${domain.name} has not been scanned yet` }, 404);
		return json(hostsPage(latest.snapshot, latest.report, page));
	}

	if (request.method !== "POST") return methodNotAllowed("POST");
	if (segments[2] === "verify") return verifyDomain(domain, env, deps);
	if (segments[2] === "scan") return scanDomain(domain, env, deps, ctx);
	return json({ error: "Not found" }, 404);
}

async function createDomain(request: Request, env: AppEnv, deps: Deps): Promise<Response> {
	const text = await request.text();
	if (text.length > MAX_BODY_BYTES) return json({ error: "Request body too large" }, 413);
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		return json({ error: "Body must be JSON" }, 400);
	}
	const input = (body as { domain?: unknown } | null)?.domain;
	const name = typeof input === "string" ? normalizeDomain(input) : null;
	if (!name)
		return json({ error: 'Body must be {"domain": "example.com"} with a valid domain name' }, 400);

	const domain = await addDomain(env.DB, name, newChallengeToken(), deps.now().toISOString());
	const report = (await latestScan(env.DB, domain.id))?.report ?? null;
	return json({ domain: describeDomain(domain, report) }, 201);
}

async function verifyDomain(domain: DomainRow, env: AppEnv, deps: Deps): Promise<Response> {
	let passed: boolean;
	try {
		passed = await checkOwnership(domain.name, domain.challenge_token, deps.fetch);
	} catch (err) {
		return json({ error: `Could not query DNS: ${errorMessage(err)}` }, 502);
	}
	if (!passed) {
		return json(
			{
				error: "Verification TXT record not found. DNS changes can take a few minutes to appear.",
				challenge: challengeOf(domain),
			},
			409,
		);
	}
	// Matches the name and token too: the domain may have been removed while DNS was asked.
	const updated = await markVerified(env.DB, domain, deps.now().toISOString());
	if (!updated) return removedMeanwhile();
	const report = (await latestScan(env.DB, domain.id))?.report ?? null;
	return json({ domain: describeDomain(updated, report) });
}

async function scanDomain(
	domain: DomainRow,
	env: AppEnv,
	deps: Deps,
	ctx: RequestContext | undefined,
): Promise<Response> {
	if (!domain.verified_at) {
		return json(
			{
				error: "Domain is not verified. Publish the TXT record, then call verify.",
				challenge: challengeOf(domain),
			},
			403,
		);
	}
	// The scan is saved before its alert is sent. Should the caller give up waiting (the CLI stops
	// after two minutes), the Worker keeps running it to the end, so a saved change is never left unalerted.
	const running = runScan(env, domain, deps);
	ctx?.waitUntil(running);
	const outcome = await running;
	switch (outcome.status) {
		case "ok":
			return json({ report: outcome.report, text: formatReport(outcome.report) });
		case "unverified":
			return json(
				{
					error: "Ownership check failed: the verification TXT record is missing.",
					challenge: challengeOf(domain),
				},
				403,
			);
		case "error":
			return json({ error: `Scan failed: ${outcome.error}` }, 502);
		case "busy":
			return json(
				{ error: "A scan of this domain is already running. Try again in a minute." },
				409,
			);
		case "gone":
			return removedMeanwhile();
	}
}

/** The domain was removed (perhaps added again) while the request waited on the network; nothing was recorded. */
function removedMeanwhile(): Response {
	return json(
		{
			error:
				"Domain is not registered: it was removed while this request ran, so nothing was recorded.",
		},
		404,
	);
}

/** A path segment that is not valid percent-encoding names no domain, rather than failing the request. */
function safeDecode(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return "";
	}
}

/**
 * Bearer-token check for every /domains route. Fails closed: with no token
 * configured, or one too short to be a real secret, the API refuses to work.
 */
async function authorize(request: Request, env: AppEnv): Promise<Response | null> {
	const expected = env.ADMIN_TOKEN ?? "";
	if (expected.length < MIN_TOKEN_LENGTH) {
		return json(
			{ error: `ADMIN_TOKEN is not set, or is shorter than ${MIN_TOKEN_LENGTH} characters` },
			503,
		);
	}
	const header = request.headers.get("authorization") ?? "";
	const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
	if (presented && (await timingSafeEqual(presented, expected))) return null;
	return json({ error: "Unauthorized" }, 401, { "www-authenticate": "Bearer" });
}

/** Compares digests so the comparison takes the same time whatever the inputs' lengths or contents. */
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const [digestA, digestB] = await Promise.all([
		crypto.subtle.digest("SHA-256", encoder.encode(a)),
		crypto.subtle.digest("SHA-256", encoder.encode(b)),
	]);
	return crypto.subtle.timingSafeEqual(digestA, digestB);
}

function challengeOf(domain: DomainRow): DomainView["challenge"] {
	return {
		type: "TXT",
		name: challengeName(domain.name),
		value: challengeValue(domain.challenge_token),
	};
}

function countOpen(report: ScanReport): Record<Severity, number> {
	const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0 };
	for (const finding of report.findings) counts[finding.severity]++;
	return counts;
}

function describeDomain(domain: DomainRow, latest: ScanReport | null): DomainView {
	return {
		name: domain.name,
		verified: domain.verified_at !== null && domain.last_scan_status !== "unverified",
		verifiedAt: domain.verified_at,
		lastScanAt: domain.last_scan_at,
		lastScanStatus: domain.last_scan_status,
		/** Scans that have failed in a row; 0 unless the last scan failed. */
		errorStreak: domain.error_streak,
		lastError: domain.last_error ?? null,
		openFindings: latest ? countOpen(latest) : null,
		challenge: challengeOf(domain),
	};
}

/** Where alerts go and what last went wrong; see `MonitorStatus`. */
async function monitorStatus(env: AppEnv): Promise<MonitorStatus> {
	const target = alertTarget(env);
	const alerts: MonitorStatus["alerts"] =
		"url" in target
			? { to: "webhook", host: target.url.host, format: target.format, delivery: null }
			: { to: "log", ...(target.problem ? { problem: target.problem } : {}), delivery: null };
	try {
		const stored = await readMonitorStatus(env.DB);
		alerts.delivery = { lastDeliveredAt: stored.alertSentAt, lastError: stored.alertError };
		return { alerts, schedule: { lastError: stored.scheduleError } };
	} catch (err) {
		console.error(`Could not read the monitor's status: ${errorMessage(err)}`);
		return { alerts, schedule: null };
	}
}

/** Names in one page of an inventory: a page stays well under a megabyte however long the names. */
export const HOSTS_PAGE_SIZE = 200;

function pageNumber(value: string | null): number | null {
	if (value === null) return 1;
	if (!/^\d{1,6}$/.test(value)) return null;
	const page = Number(value);
	return page >= 1 ? page : null;
}

/**
 * A page of the inventory the latest scan holds (R6F-5): every name, in order, as the snapshot keeps
 * it. Read from the database alone: answering makes no request about the domain.
 */
function hostsPage(snapshot: Snapshot, report: ScanReport, page: number): HostsPage {
	const names = Object.keys(snapshot.hosts).sort();
	const open = new Map<string, number>();
	for (const finding of report.findings) open.set(finding.host, (open.get(finding.host) ?? 0) + 1);
	const hosts = names
		.slice((page - 1) * HOSTS_PAGE_SIZE, page * HOSTS_PAGE_SIZE)
		.map((name): HostView => {
			const state = snapshot.hosts[name]!;
			return {
				name,
				probed: state.probed,
				checkedAt: state.checkedAt ?? null,
				dns: state.dns,
				cert: state.cert
					? { notBefore: state.cert.notBefore, notAfter: state.cert.notAfter }
					: null,
				https:
					state.http === null
						? null
						: state.http.ok
							? { ok: true, status: state.http.status }
							: { ok: false, error: state.http.error },
				findings: open.get(name) ?? 0,
			};
		});
	return {
		domain: snapshot.domain,
		takenAt: snapshot.takenAt,
		total: names.length,
		page,
		pageSize: HOSTS_PAGE_SIZE,
		hosts,
		gone:
			page === 1
				? Object.entries(snapshot.gone ?? {})
						.sort(([a], [b]) => a.localeCompare(b))
						.map(([name, since]) => ({ name, since }))
				: [],
	};
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

function methodNotAllowed(allow: string): Response {
	return json({ error: "Method not allowed" }, 405, { allow });
}
