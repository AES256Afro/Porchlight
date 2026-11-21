// A domain's subdomain inventory on the Domains page (R6F-5): GET /api/domains/<name>/hosts?page=N, one
// page of what the monitor's latest scan holds. The monitor answers from its database, so asking makes
// no request about the domain (invariants 1, 2). The admin token is added here and never sent to the
// page (invariant 7). Only the fields the page shows are passed on, each checked for its type: names,
// addresses and errors come from DNS and other people's servers, and the page sets them as text (invariant 8).
import type { HostsPage, HostView } from "../../../../monitor/src/types.ts";
import { asciiDomain } from "../../investigate/scope.ts";
import { callMonitor } from "../../monitor/client.ts";
import type { ServerContext } from "../context.ts";
import type { Call } from "../gate.ts";
import { DOMAIN_PATTERN, HttpError, safeDecode, sendJson } from "../http.ts";

const HOSTS_PATH = /^\/api\/domains\/([^/]+)\/hosts$/;
/** The monitor keeps at most 12,000 names, 200 a page. */
const MAX_PAGE = 60;
/** Longer text from the monitor is cut: an error or a name is never this long. */
const MAX_TEXT = 300;
/** Addresses and aliases kept per host and record type. */
const MAX_VALUES = 20;

/** Whether a request is for a domain's inventory. */
export function claimsHosts(call: Call): boolean {
	return HOSTS_PATH.test(call.url.pathname);
}

/** Answers one page of a domain's inventory from the connected monitor. */
export async function hostsRoute(ctx: ServerContext, call: Call): Promise<void> {
	if (call.req.method !== "GET") throw new HttpError(405, "Method not allowed");
	const monitor = ctx.monitor();
	if (!monitor) throw new HttpError(503, ctx.options.monitorError ?? "The monitor is not configured");
	const name = HOSTS_PATH.exec(call.url.pathname)?.[1] ?? "";
	// A name in its own script is sent in the ASCII form DNS uses, as for every other domains call (B58).
	const domain = asciiDomain(safeDecode(name).toLowerCase());
	if (!DOMAIN_PATTERN.test(domain)) throw new HttpError(400, "Invalid domain name");
	const page = pageNumber(call.url.searchParams.get("page"));
	let answer: { status: number; body: Record<string, unknown> };
	try {
		answer = await callMonitor(monitor, "GET", `/domains/${encodeURIComponent(domain)}/hosts${page > 1 ? `?page=${page}` : ""}`, undefined, ctx.options.fetchFn);
	} catch (err) {
		throw new HttpError(502, `Could not reach the monitor: ${err instanceof Error ? err.message : String(err)}`);
	}
	const error = typeof answer.body.error === "string" ? answer.body.error.slice(0, MAX_TEXT) : `The monitor answered HTTP ${answer.status}`;
	// A monitor deployed before the inventory answers 404 for the path as well as for a domain not scanned yet.
	if (answer.status === 404) throw new HttpError(404, error);
	if (answer.status >= 400) throw new HttpError(502, `The monitor refused the request: ${error}`);
	const inventory = hostsFromMonitor(answer.body);
	if (!inventory) throw new HttpError(502, "The monitor's answer is not an inventory; it may need updating");
	return sendJson(call.res, 200, { hosts: inventory });
}

/** The page asked for: a whole number from 1, at most MAX_PAGE; anything else is refused, never repaired. */
function pageNumber(value: string | null): number {
	if (value === null || value === "") return 1;
	if (!/^\d{1,3}$/.test(value)) throw new HttpError(400, "page must be a whole number from 1");
	const page = Number(value);
	if (page < 1 || page > MAX_PAGE) throw new HttpError(400, `page must be from 1 to ${MAX_PAGE}`);
	return page;
}

const text = (value: unknown): string | null => (typeof value === "string" ? value.slice(0, MAX_TEXT) : null);
const texts = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, MAX_VALUES).map((item) => item.slice(0, MAX_TEXT)) : []);
const count = (value: unknown): number => (typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0);
const record = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);

/**
 * The monitor's answer, rebuilt from the fields the page shows and nothing else; null when it is not
 * an inventory. A value of the wrong type is left out as "not observed" (invariant 5), never made up.
 */
export function hostsFromMonitor(body: Record<string, unknown>): HostsPage | null {
	const domain = text(body.domain);
	const takenAt = text(body.takenAt);
	if (domain === null || takenAt === null || !Array.isArray(body.hosts) || typeof body.total !== "number") return null;
	const hosts: HostView[] = [];
	for (const item of body.hosts.slice(0, 1000)) {
		const host = record(item);
		const name = text(host?.name);
		if (!host || name === null) continue;
		const dns = record(host.dns);
		const cert = record(host.cert);
		const https = record(host.https);
		const notBefore = text(cert?.notBefore);
		const notAfter = text(cert?.notAfter);
		hosts.push({
			name,
			probed: host.probed === true,
			checkedAt: text(host.checkedAt),
			dns: dns ? { a: texts(dns.a), aaaa: texts(dns.aaaa), cname: texts(dns.cname) } : null,
			cert: notBefore !== null && notAfter !== null ? { notBefore, notAfter } : null,
			https: !https ? null : https.ok === true && typeof https.status === "number" ? { ok: true, status: https.status } : { ok: false, error: text(https.error) ?? "failed" },
			findings: count(host.findings),
		});
	}
	const gone = (Array.isArray(body.gone) ? body.gone : [])
		.slice(0, 1000)
		.map((item) => {
			const entry = record(item);
			const name = text(entry?.name);
			const since = text(entry?.since);
			return name !== null && since !== null ? { name, since } : null;
		})
		.filter((entry): entry is { name: string; since: string } => entry !== null);
	return { domain, takenAt, total: count(body.total), page: Math.max(1, count(body.page)), pageSize: Math.max(1, count(body.pageSize)), hosts, gone };
}
