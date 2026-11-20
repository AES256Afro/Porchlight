import type { Deps } from "../src/env.ts";

/** A scripted internet: what DNS, the certificate log and each host answer. */
export interface FakeNet {
	/** TXT records by name. */
	txt?: Record<string, string[]>;
	/** Host records; `cname` is the alias chain in order. A host absent from here has no records at all. */
	hosts?: Record<string, { a?: string[]; aaaa?: string[]; cname?: string[] }>;
	/** Other apex records by type, e.g. `{ CAA: ['0 issue "letsencrypt.org"'] }`. */
	apex?: Partial<Record<"NS" | "MX" | "CAA", string[]>>;
	/** Certificate log rows, or "down" to make crt.sh fail. */
	ct?: { names: string[]; notBefore: string; notAfter: string }[] | "down";
	/** HTTPS responses by host. A host absent from here refuses the connection. */
	https?: Record<string, { status?: number; headers?: Record<string, string> }>;
	/** Names whose DNS lookups fail at the transport level. */
	dnsDown?: string[];
	/** Names the resolver cannot answer for: HTTP 200 with DNS status 2 (SERVFAIL) and no records. */
	dnsServfail?: string[];
}

export interface FakeDeps extends Deps {
	net: FakeNet;
	/** Every URL requested, in order. */
	requests: string[];
	/** Bodies POSTed to the alert webhook. */
	alerts: { text: string; [key: string]: unknown }[];
	clock: Date;
	/** How far the clock moves during each request, so a scan ends later than it starts. */
	latencyMs: number;
}

export const WEBHOOK = "https://hooks.example.test/alert";

const TYPE_CODE = { A: 1, NS: 2, CNAME: 5, MX: 15, TXT: 16, AAAA: 28, CAA: 257 } as const;

export function fakeDeps(net: FakeNet = {}, start = "2026-11-17T12:00:00.000Z"): FakeDeps {
	const deps: FakeDeps = {
		net,
		requests: [],
		alerts: [],
		clock: new Date(start),
		latencyMs: 0,
		now: () => new Date(deps.clock),
		fetch: async (input, init) => {
			const url = new URL(input);
			deps.requests.push(url.toString());
			deps.clock = new Date(deps.clock.getTime() + deps.latencyMs);
			if (url.toString() === WEBHOOK) {
				deps.alerts.push(JSON.parse(init?.body as string));
				return new Response("ok");
			}
			if (url.hostname === "cloudflare-dns.com") return dns(deps.net, url);
			if (url.hostname === "crt.sh") return ct(deps.net, url);
			const site = deps.net.https?.[url.hostname];
			if (!site) throw new Error("connection refused");
			return new Response("<!doctype html>", { status: site.status ?? 200, headers: site.headers });
		},
	};
	return deps;
}

function dns(net: FakeNet, url: URL): Response {
	const name = url.searchParams.get("name")!;
	const type = url.searchParams.get("type") as keyof typeof TYPE_CODE;
	if (net.dnsDown?.includes(name)) return new Response("upstream error", { status: 502 });
	if (net.dnsServfail?.includes(name)) return Response.json({ Status: 2 });

	const answers: { name: string; type: number; data: string }[] = [];
	const push = (kind: keyof typeof TYPE_CODE, values: string[] = []) => {
		for (const data of values) answers.push({ name, type: TYPE_CODE[kind], data });
	};
	const host = net.hosts?.[name];
	if (type === "TXT")
		push(
			"TXT",
			(net.txt?.[name] ?? []).map((value) => `"${value}"`),
		);
	if (type === "A" || type === "AAAA") {
		// An alias chain arrives as one record per hop, each owned by the previous name.
		let owner = name;
		for (const target of host?.cname ?? []) {
			answers.push({ name: `${owner}.`, type: TYPE_CODE.CNAME, data: `${target}.` });
			owner = target;
		}
		push(type, type === "A" ? host?.a : host?.aaaa);
	}
	if (type === "NS" || type === "MX" || type === "CAA") push(type, net.apex?.[type]);
	return Response.json({ Status: 0, Answer: answers.length > 0 ? answers : undefined });
}

function ct(net: FakeNet, url: URL): Response {
	if (net.ct === "down") return new Response("bad gateway", { status: 502 });
	// The real service answers the "%.domain" and bare-domain queries
	// separately; returning every row for both is equivalent after dedup.
	void url;
	return Response.json(
		(net.ct ?? []).map((cert) => ({
			name_value: cert.names.join("\n"),
			not_before: cert.notBefore.replace(/\.\d+Z$|Z$/, ""),
			not_after: cert.notAfter.replace(/\.\d+Z$|Z$/, ""),
		})),
	);
}
