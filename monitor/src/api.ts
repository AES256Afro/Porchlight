import { normalizeDomain } from "./domain.ts";
import { errorMessage, type AppEnv, type Deps } from "./env.ts";
import { challengeName, challengeValue, checkOwnership, newChallengeToken } from "./ownership.ts";
import { formatReport } from "./report.ts";
import { runScan } from "./scan.ts";
import {
	addDomain,
	deleteDomain,
	getDomain,
	latestScan,
	listDomains,
	markVerified,
	type DomainRow,
} from "./store.ts";

const MIN_TOKEN_LENGTH = 32;
const MAX_BODY_BYTES = 1024;

export async function handleRequest(request: Request, env: AppEnv, deps: Deps): Promise<Response> {
	try {
		return await route(request, env, deps);
	} catch (err) {
		// Details go to the log, never to the caller.
		console.error(`Unhandled error: ${errorMessage(err)}`);
		const unmigrated = /no such table/i.test(errorMessage(err));
		return json(
			{
				error: unmigrated
					? "The database has no tables yet. Apply the migrations; see the README."
					: "Internal error",
			},
			500,
		);
	}
}

async function route(request: Request, env: AppEnv, deps: Deps): Promise<Response> {
	const url = new URL(request.url);
	const segments = url.pathname.split("/").filter(Boolean);

	if (segments.length === 0) return new Response("securityx-monitor\n");
	if (segments[0] !== "domains" || segments.length > 3) return json({ error: "Not found" }, 404);

	const denied = await authorize(request, env);
	if (denied) return denied;

	if (segments.length === 1) {
		if (request.method === "GET")
			return json({ domains: (await listDomains(env.DB)).map(describeDomain) });
		if (request.method === "POST") return createDomain(request, env, deps);
		return methodNotAllowed("GET, POST");
	}

	const name = normalizeDomain(decodeURIComponent(segments[1]!));
	const domain = name ? await getDomain(env.DB, name) : null;
	if (!domain) return json({ error: "Domain is not registered" }, 404);

	if (segments.length === 2) {
		if (request.method === "GET") {
			const latest = await latestScan(env.DB, domain.id);
			const report = latest?.report ?? null;
			return json({ domain: describeDomain(domain), report, text: report && formatReport(report) });
		}
		if (request.method === "DELETE") {
			await deleteDomain(env.DB, domain.name);
			return json({ deleted: domain.name });
		}
		return methodNotAllowed("GET, DELETE");
	}

	if (request.method !== "POST") return methodNotAllowed("POST");
	if (segments[2] === "verify") return verifyDomain(domain, env, deps);
	if (segments[2] === "scan") return scanDomain(domain, env, deps);
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
	return json({ domain: describeDomain(domain) }, 201);
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
	const now = deps.now().toISOString();
	await markVerified(env.DB, domain.id, now);
	return json({ domain: describeDomain({ ...domain, verified_at: now }) });
}

async function scanDomain(domain: DomainRow, env: AppEnv, deps: Deps): Promise<Response> {
	if (!domain.verified_at) {
		return json(
			{
				error: "Domain is not verified. Publish the TXT record, then call verify.",
				challenge: challengeOf(domain),
			},
			403,
		);
	}
	const outcome = await runScan(env, domain, deps);
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

function challengeOf(domain: DomainRow) {
	return {
		type: "TXT",
		name: challengeName(domain.name),
		value: challengeValue(domain.challenge_token),
	};
}

function describeDomain(domain: DomainRow) {
	return {
		name: domain.name,
		verified: domain.verified_at !== null && domain.last_scan_status !== "unverified",
		verifiedAt: domain.verified_at,
		lastScanAt: domain.last_scan_at,
		lastScanStatus: domain.last_scan_status,
		challenge: challengeOf(domain),
	};
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });
}

function methodNotAllowed(allow: string): Response {
	return json({ error: "Method not allowed" }, 405, { allow });
}
