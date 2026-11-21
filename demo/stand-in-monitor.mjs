// A stand-in for the monitor's API (and for Ollama's two endpoints), with made-up domains and
// findings. Two uses:
//   - imported, `standInFetch` answers like `fetch` does, so the demo recorder can give it to
//     Porchlight's own server in place of the network;
//   - run with `node demo/stand-in-monitor.mjs [port]`, it listens on 127.0.0.1 for a local
//     Porchlight to point PORCHLIGHT_MONITOR_URL at (with PORCHLIGHT_ADMIN_TOKEN=STAND_IN_TOKEN).
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

/** Not a secret: the stand-in answers anyone who sends it. */
export const STAND_IN_TOKEN = "stand-in-admin-token-0123456789abcdef0123";

const challenge = (name) => ({
	type: "TXT",
	name: `_porchlight-challenge.${name}`,
	value: "porchlight-verify=0123456789abcdef0123456789abcdef0123456789abcdef",
});
const initialDomains = () =>
	new Map([
		[
			"example.test",
			{
				name: "example.test",
				verified: true,
				verifiedAt: "2026-11-01T10:00:00Z",
				lastScanAt: "2026-11-20T09:00:00Z",
				lastScanStatus: "ok",
				errorStreak: 0,
			},
		],
		[
			"shop-with-a-rather-long-name.example",
			{
				name: "shop-with-a-rather-long-name.example",
				verified: true,
				verifiedAt: "2026-11-02T10:00:00Z",
				lastScanAt: "2026-11-20T08:00:00Z",
				lastScanStatus: "error",
				errorStreak: 3,
			},
		],
		[
			"new.example",
			{
				name: "new.example",
				verified: false,
				verifiedAt: null,
				lastScanAt: null,
				lastScanStatus: null,
				errorStreak: 0,
			},
		],
	]);
let domains = initialDomains();

const host = (i) => `service-${i}.internal-cluster-name.example.test`;
export const DOMAIN_REPORT = {
	domain: "example.test",
	takenAt: "2026-11-20T09:00:00Z",
	baseline: false,
	hostCount: 18,
	changes: [
		{ kind: "host_added", host: host(1) },
		{
			kind: "dns_changed",
			host: "example.test",
			record: "TXT",
			before: [
				"v=spf1 include:_spf.example-mail-provider.example include:servers.mcsv.example ~all",
			],
			after: [
				"v=spf1 include:_spf.example-mail-provider.example include:servers.mcsv.example include:another.example -all",
				"google-site-verification=abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG",
			],
		},
		{ kind: "https_changed", host: host(2), before: "HTTP 200", after: "unreachable" },
	],
	newFindings: [],
	resolvedFindings: [],
	findings: [
		{
			id: `dangling-cname:${host(3)}`,
			severity: "high",
			host: host(3),
			basis: "dns",
			title:
				"CNAME target abandoned-bucket-name-that-is-long.s3-website.example does not resolve; check for subdomain takeover",
		},
		{
			id: "cert-expiring:example.test",
			severity: "medium",
			host: "example.test",
			basis: "cert",
			title: "Latest certificate in CT logs expires 2026-11-30; no renewal logged yet",
		},
		{
			id: "weak-hsts:example.test",
			severity: "low",
			host: "example.test",
			basis: "http",
			title:
				"Strict-Transport-Security lasts 1 hour; use at least 180 days so browsers keep insisting on HTTPS",
		},
		{
			id: "insecure-cookies:example.test",
			severity: "low",
			host: "example.test",
			basis: "http",
			title:
				"Cookies set without the Secure flag, so a browser would also send them over plain HTTP: lang, theme",
		},
		{
			id: "no-dnssec:example.test",
			severity: "low",
			host: "example.test",
			basis: "apex",
			title:
				"DNSSEC is not enabled: DNS answers for this domain are not signed, so a forged one cannot be told apart",
		},
		{
			id: "weak-spf:example.test",
			severity: "medium",
			host: "example.test",
			basis: "apex",
			title: "The SPF record ends in +all, which lets any server send mail as this domain",
		},
		...["strict-transport-security", "content-security-policy", "permissions-policy"].map(
			(header, i) => ({
				id: `missing-header:${host(4 + i)}:${header}`,
				severity: i < 2 ? "medium" : "low",
				host: host(4 + i),
				basis: "http",
				title: `Missing ${header} header`,
			}),
		),
	],
	notes: [
		"6 of 18 known hosts were not checked this time: each scan checks 12, and the rest take turns in later scans.",
	],
};
const open = (r) => ({
	high: r.findings.filter((f) => f.severity === "high").length,
	medium: r.findings.filter((f) => f.severity === "medium").length,
	low: r.findings.filter((f) => f.severity === "low").length,
});
const HISTORY = [
	{
		takenAt: DOMAIN_REPORT.takenAt,
		baseline: false,
		changes: DOMAIN_REPORT.changes,
		newFindings: DOMAIN_REPORT.findings.slice(1, 3),
		resolvedFindings: [],
		openFindings: open(DOMAIN_REPORT),
		hostCount: 18,
		notes: DOMAIN_REPORT.notes,
	},
	{
		takenAt: "2026-11-19T09:00:00Z",
		baseline: false,
		changes: [],
		newFindings: [],
		resolvedFindings: [],
		openFindings: { high: 1, medium: 2, low: 2 },
		hostCount: 17,
		notes: [],
	},
	{
		takenAt: "2026-11-18T09:00:00Z",
		baseline: false,
		changes: [{ kind: "host_removed", host: "old.example.test" }],
		newFindings: [],
		resolvedFindings: [
			{
				id: "cert-expired:old.example.test",
				severity: "high",
				host: "old.example.test",
				basis: "cert",
				title: "Latest certificate in CT logs expired 2026-11-01; no replacement logged",
			},
		],
		openFindings: { high: 1, medium: 2, low: 2 },
		hostCount: 17,
		notes: [],
	},
	{
		takenAt: "2026-11-17T09:00:00Z",
		baseline: true,
		changes: [],
		newFindings: [],
		resolvedFindings: [],
		openFindings: { high: 2, medium: 2, low: 2 },
		hostCount: 18,
		notes: [],
	},
];
const view = (d) => ({
	...d,
	openFindings:
		d.name === "example.test"
			? open(DOMAIN_REPORT)
			: d.lastScanAt
				? { high: 0, medium: 0, low: 0 }
				: null,
	challenge: challenge(d.name),
});

/** Puts the domains back as they started; the recorder calls it so a run does not depend on an earlier one. */
export function resetStandIn() {
	domains = initialDomains();
}

/**
 * Answers one request the way the monitor would. `path` is the URL's path, `body` the parsed JSON
 * body of a POST, `authorization` the header as sent.
 *
 * @returns {{ status: number, body: unknown }}
 */
export function standIn(method, path, body, authorization) {
	if (path === "/api/tags") return { status: 200, body: { models: [{ name: "demo:latest" }] } };
	if (authorization !== `Bearer ${STAND_IN_TOKEN}`)
		return { status: 401, body: { error: "Unauthorized" } };
	const parts = path.split("/").filter(Boolean);
	if (parts[0] !== "domains") return { status: 404, body: { error: "Not found" } };
	if (parts.length === 1 && method === "GET")
		return { status: 200, body: { domains: [...domains.values()].map(view) } };
	if (parts.length === 1 && method === "POST") {
		const name = body?.domain;
		if (typeof name !== "string" || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name))
			return {
				status: 400,
				body: { error: 'Body must be {"domain": "example.com"} with a valid domain name' },
			};
		domains.set(name, {
			name,
			verified: false,
			verifiedAt: null,
			lastScanAt: null,
			lastScanStatus: null,
			errorStreak: 0,
		});
		return { status: 201, body: { domain: view(domains.get(name)) } };
	}
	const d = domains.get(decodeURIComponent(parts[1] ?? ""));
	if (!d) return { status: 404, body: { error: "Domain is not registered" } };
	if (parts.length === 2 && method === "GET")
		return {
			status: 200,
			body: {
				domain: view(d),
				report: d.name === "example.test" ? DOMAIN_REPORT : null,
				text: null,
			},
		};
	if (parts.length === 2 && method === "DELETE") {
		domains.delete(d.name);
		return { status: 200, body: { deleted: d.name } };
	}
	if (parts[2] === "history" && method === "GET")
		return {
			status: 200,
			body: { domain: d.name, history: d.name === "example.test" ? HISTORY : [] },
		};
	if (parts[2] === "verify")
		return {
			status: 409,
			body: {
				error: "Verification TXT record not found. DNS changes can take a few minutes to appear.",
				challenge: challenge(d.name),
			},
		};
	if (parts[2] === "scan") return { status: 200, body: { report: DOMAIN_REPORT, text: "" } };
	return { status: 404, body: { error: "Not found" } };
}

/** `standIn` with fetch's signature, for code that takes a fetch function. */
export async function standInFetch(input, init = {}) {
	const url = new URL(String(input));
	const headers = new Headers(init.headers);
	const body = typeof init.body === "string" && init.body ? JSON.parse(init.body) : undefined;
	const answer = standIn(
		init.method ?? "GET",
		url.pathname,
		body,
		headers.get("authorization") ?? undefined,
	);
	return Response.json(answer.body, { status: answer.status });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const port = Number(process.argv[2] ?? 4796);
	createServer((req, res) => {
		let text = "";
		req.on("data", (chunk) => (text += chunk));
		req.on("end", () => {
			const answer = standIn(
				req.method ?? "GET",
				new URL(req.url ?? "/", "http://x").pathname,
				text ? JSON.parse(text) : undefined,
				req.headers.authorization,
			);
			res.writeHead(answer.status, { "content-type": "application/json" });
			res.end(JSON.stringify(answer.body));
		});
	}).listen(port, "127.0.0.1", () =>
		console.log(`Stand-in monitor on http://127.0.0.1:${port} (token: ${STAND_IN_TOKEN})`),
	);
}
