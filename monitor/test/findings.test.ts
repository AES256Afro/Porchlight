import { describe, expect, it } from "vite-plus/test";
import type { HttpProbe } from "../src/collect/http.ts";
import { diffSnapshots } from "../src/diff.ts";
import { deriveFindings, diffFindings } from "../src/findings.ts";
import type { HostState, Snapshot } from "../src/snapshot.ts";

const NOW = new Date("2026-11-17T12:00:00Z");
const SETTINGS = {
	scanIntervalHours: 24,
	maxHosts: 12,
	certExpiryWarnDays: 14,
	snapshotsToKeep: 30,
};
const CAA = ['0 issue "letsencrypt.org"'];

function host(overrides: Partial<HostState> = {}): HostState {
	return {
		probed: true,
		dns: { a: ["203.0.113.1"], aaaa: [], cname: [] },
		cert: null,
		http: null,
		...overrides,
	};
}

function snapshot(hosts: Record<string, HostState>, apex: Snapshot["apex"] = { CAA }): Snapshot {
	return { version: 1, domain: "example.com", takenAt: NOW.toISOString(), ctOk: true, apex, hosts };
}

function page(
	present: string[] = [],
	extra: Partial<Extract<HttpProbe, { ok: true }>> = {},
): HttpProbe {
	return {
		ok: true,
		status: 200,
		html: true,
		present: present as never,
		frameAncestors: false,
		...extra,
	};
}

const ids = (s: Snapshot, previous = [] as ReturnType<typeof deriveFindings>) =>
	deriveFindings(s, previous, SETTINGS, NOW).map((finding) => finding.id);

describe("header findings", () => {
	it("expects the full set on an HTML page, ranked by severity", () => {
		const findings = deriveFindings(
			snapshot({ "example.com": host({ http: page() }) }),
			[],
			SETTINGS,
			NOW,
		);
		expect(findings.map((finding) => `${finding.severity} ${finding.id}`)).toEqual([
			"medium missing-header:example.com:content-security-policy",
			"medium missing-header:example.com:strict-transport-security",
			"low missing-header:example.com:permissions-policy",
			"low missing-header:example.com:referrer-policy",
			"low missing-header:example.com:x-content-type-options",
			"low missing-header:example.com:x-frame-options",
		]);
	});

	it("expects only transport security on redirects and error pages", () => {
		expect(ids(snapshot({ "example.com": host({ http: page([], { status: 301 }) }) }))).toEqual([
			"missing-header:example.com:strict-transport-security",
		]);
		expect(
			ids(
				snapshot({
					"example.com": host({ http: page(["strict-transport-security"], { status: 404 }) }),
				}),
			),
		).toEqual([]);
	});

	it("does not expect page headers on a non-HTML response", () => {
		expect(ids(snapshot({ "api.example.com": host({ http: page([], { html: false }) }) }))).toEqual(
			[
				"missing-header:api.example.com:strict-transport-security",
				"missing-header:api.example.com:x-content-type-options",
			],
		);
	});

	it("accepts CSP frame-ancestors in place of X-Frame-Options", () => {
		const present = [
			"strict-transport-security",
			"content-security-policy",
			"x-content-type-options",
			"referrer-policy",
			"permissions-policy",
		];
		expect(
			ids(snapshot({ "example.com": host({ http: page(present, { frameAncestors: true }) }) })),
		).toEqual([]);
	});
});

describe("certificate findings", () => {
	const withCert = (notBefore: string, notAfter: string) =>
		snapshot({ "example.com": host({ cert: { notBefore, notAfter } }) });

	it("warns when a 90-day certificate is inside the warning window", () => {
		expect(ids(withCert("2026-08-29T00:00:00Z", "2026-11-27T00:00:00Z"))).toEqual([
			"cert-expiring:example.com",
		]);
		expect(ids(withCert("2026-10-01T00:00:00Z", "2026-12-30T00:00:00Z"))).toEqual([]);
	});

	it("scales the window down for short-lived certificates", () => {
		// Six-day certificate with two days left: normal, not a warning.
		expect(ids(withCert("2026-11-13T12:00:00Z", "2026-11-19T12:00:00Z"))).toEqual([]);
		// The same certificate with under a fifth of its life left.
		expect(ids(withCert("2026-11-12T08:00:00Z", "2026-11-18T08:00:00Z"))).toEqual([
			"cert-expiring:example.com",
		]);
	});

	it("reports an expired certificate as high severity", () => {
		const [finding] = deriveFindings(
			withCert("2026-08-01T00:00:00Z", "2026-11-01T00:00:00Z"),
			[],
			SETTINGS,
			NOW,
		);
		expect(finding).toMatchObject({ id: "cert-expired:example.com", severity: "high" });
	});

	it("ignores certificates for names that no longer have an address", () => {
		const gone = host({
			dns: { a: [], aaaa: [], cname: [] },
			cert: { notBefore: "2026-08-01T00:00:00Z", notAfter: "2026-11-01T00:00:00Z" },
		});
		expect(ids(snapshot({ "example.com": gone }))).toEqual([]);
	});
});

describe("DNS findings", () => {
	it("flags an alias whose target has no address", () => {
		const dangling = host({ dns: { a: [], aaaa: [], cname: ["old-app.vendor.example"] } });
		const [finding] = deriveFindings(snapshot({ "shop.example.com": dangling }), [], SETTINGS, NOW);
		expect(finding).toMatchObject({ id: "dangling-cname:shop.example.com", severity: "high" });
		expect(finding!.title).toContain("old-app.vendor.example");
	});

	it("does not flag an alias that reaches an IPv6-only target", () => {
		const v6 = host({ dns: { a: [], aaaa: ["2001:db8::1"], cname: ["v6.vendor.example"] } });
		expect(ids(snapshot({ "v6.example.com": v6 }))).toEqual([]);
	});

	it("flags a missing CAA record only when the lookup succeeded", () => {
		expect(ids(snapshot({}, { CAA: [] }))).toEqual(["no-caa:example.com"]);
		expect(ids(snapshot({}, {}))).toEqual([]);
	});
});

describe("mail and DNS signing", () => {
	const spf = (...txt: string[]) => ids(snapshot({}, { CAA, TXT: txt }));

	it("reads the SPF record for who may send mail", () => {
		expect(spf()).toEqual(["no-spf:example.com"]);
		expect(spf("google-site-verification=abc", "v=spf1 include:_spf.example.net ~all")).toEqual([]);
		expect(spf("v=spf1 -all")).toEqual([]);
		expect(spf("v=spf1 +all")).toEqual(["weak-spf:example.com"]);
		expect(spf("v=spf1 a mx ?all")).toEqual(["weak-spf:example.com"]);
		expect(spf("v=spf1 -all", "v=spf1 mx -all")).toEqual(["weak-spf:example.com"]);
		// "v=spf10" is not an SPF record; the lookup failing says nothing.
		expect(spf("v=spf10 -all")).toEqual(["no-spf:example.com"]);
		expect(ids(snapshot({}, { CAA }))).toEqual([]);
	});

	it("ranks an SPF record that lets anyone send above one that only says nothing", () => {
		const severity = (txt: string) =>
			deriveFindings(snapshot({}, { CAA, TXT: [txt] }), [], SETTINGS, NOW)[0]?.severity;
		expect([severity("v=spf1 +all"), severity("v=spf1 all"), severity("v=spf1 ?all")]).toEqual([
			"medium",
			"medium",
			"low",
		]);
	});

	it("flags unsigned DNS only when the resolver said so", () => {
		expect(ids({ ...snapshot({}), dnssec: false })).toEqual(["no-dnssec:example.com"]);
		expect(ids({ ...snapshot({}), dnssec: true })).toEqual([]);
		expect(ids(snapshot({}))).toEqual([]);
	});
});

describe("HSTS and cookies", () => {
	const ALL = [
		"strict-transport-security",
		"content-security-policy",
		"x-content-type-options",
		"x-frame-options",
		"referrer-policy",
		"permissions-policy",
	];
	const withHttp = (extra: Partial<Extract<HttpProbe, { ok: true }>>) =>
		deriveFindings(
			snapshot({ "example.com": host({ http: page(ALL, extra) }) }),
			[],
			SETTINGS,
			NOW,
		).map((finding) => `${finding.severity} ${finding.id}`);

	it("flags HSTS that is sent but short, or switched off", () => {
		expect(withHttp({ hsts: { maxAge: 63072000, includeSubDomains: false } })).toEqual([]);
		expect(withHttp({ hsts: { maxAge: 86400, includeSubDomains: true } })).toEqual([
			"low weak-hsts:example.com",
		]);
		expect(withHttp({ hsts: { maxAge: 0, includeSubDomains: false } })).toEqual([
			"medium weak-hsts:example.com",
		]);
		// Unreadable, or a snapshot from before it was kept: nothing is claimed.
		expect(withHttp({ hsts: { maxAge: null, includeSubDomains: false } })).toEqual([]);
		expect(withHttp({})).toEqual([]);
	});

	it("flags cookies without Secure, and sign-in cookies a script can read, once per host", () => {
		const cookie = (name: string, secure: boolean, httpOnly: boolean) => ({
			name,
			secure,
			httpOnly,
		});
		expect(
			withHttp({ cookies: [cookie("sid", true, true), cookie("theme", true, false)] }),
		).toEqual([]);
		expect(
			withHttp({
				cookies: [
					cookie("theme", false, false),
					cookie("lang", false, false),
					cookie("session_id", true, false),
				],
			}),
		).toEqual(["low insecure-cookies:example.com", "low script-readable-cookies:example.com"]);
		const many = deriveFindings(
			snapshot({
				"example.com": host({
					http: page(ALL, {
						cookies: ["f", "e", "d", "c", "b", "a"].map((name) => cookie(name, false, true)),
					}),
				}),
			}),
			[],
			SETTINGS,
			NOW,
		);
		expect(many[0]!.title).toMatch(/: a, b, c, d and 2 more$/);
	});

	it("says nothing about either from a response that only reports an outage", () => {
		expect(
			withHttp({
				status: 503,
				hsts: { maxAge: 0, includeSubDomains: false },
				cookies: [{ name: "x", secure: false, httpOnly: false }],
			}),
		).toEqual([]);
	});
});

describe("findings across scans", () => {
	const first = deriveFindings(
		snapshot({ "example.com": host({ http: page([], { status: 301 }) }) }, { CAA: [] }),
		[],
		SETTINGS,
		NOW,
	);

	it("carries findings forward when the evidence could not be re-observed", () => {
		const outage = snapshot({ "example.com": host({ http: { ok: false, error: "timeout" } }) }, {});
		const second = deriveFindings(outage, first, SETTINGS, NOW);
		expect(diffFindings(first, second)).toEqual({ added: [], resolved: [] });
	});

	it("resolves findings once the fix is observed", () => {
		const fixed = snapshot({
			"example.com": host({ http: page(["strict-transport-security"], { status: 301 }) }),
		});
		const second = deriveFindings(fixed, first, SETTINGS, NOW);
		expect(diffFindings(first, second).resolved.map((finding) => finding.id)).toEqual([
			"missing-header:example.com:strict-transport-security",
			"no-caa:example.com",
		]);
	});

	it("resolves a host's findings when the host leaves the inventory", () => {
		expect(
			deriveFindings(
				snapshot({}),
				first.filter((finding) => finding.basis === "http"),
				SETTINGS,
				NOW,
			),
		).toEqual([]);
	});
});

describe("diffSnapshots", () => {
	const base = snapshot(
		{
			"example.com": host(),
			"www.example.com": host({
				dns: { a: ["198.51.100.7"], aaaa: [], cname: ["edge.cdn.example"] },
			}),
			"old.example.com": host(),
		},
		{ CAA, MX: ["10 mail.example.com"], TXT: ["v=spf1 -all"] },
	);

	it("reports nothing for a first scan", () => {
		expect(diffSnapshots(null, base)).toEqual([]);
	});

	it("reports added and removed hosts and changed records", () => {
		const next = snapshot(
			{
				"example.com": host({ dns: { a: ["203.0.113.50"], aaaa: [], cname: [] } }),
				"www.example.com": host({
					dns: { a: ["198.51.100.99"], aaaa: [], cname: ["edge.cdn.example"] },
				}),
				"staging.example.com": host(),
			},
			{ CAA, MX: ["10 mail.example.com"], TXT: ["v=spf1 include:mailer.example -all"] },
		);
		expect(diffSnapshots(base, next)).toEqual([
			{
				kind: "dns_changed",
				host: "example.com",
				record: "A",
				before: ["203.0.113.1"],
				after: ["203.0.113.50"],
			},
			{ kind: "host_added", host: "staging.example.com" },
			// www's address moved, but it sits behind an unchanged alias: not reported.
			{ kind: "host_removed", host: "old.example.com" },
			{
				kind: "dns_changed",
				host: "example.com",
				record: "TXT",
				before: ["v=spf1 -all"],
				after: ["v=spf1 include:mailer.example -all"],
			},
		]);
	});

	it("reports a repointed alias", () => {
		const next = structuredClone(base);
		next.hosts["www.example.com"]!.dns!.cname = ["someone-else.example"];
		expect(diffSnapshots(base, next)).toEqual([
			{
				kind: "dns_changed",
				host: "www.example.com",
				record: "CNAME",
				before: ["edge.cdn.example"],
				after: ["someone-else.example"],
			},
		]);
	});

	it("stays silent about anything a failed lookup could not observe", () => {
		const next = structuredClone(base);
		next.apex = { CAA };
		next.hosts["example.com"]!.dns = null;
		expect(diffSnapshots(base, next)).toEqual([]);
	});

	it("reports HTTPS becoming unreachable", () => {
		const before = snapshot({ "example.com": host({ http: page() }) });
		const after = snapshot({ "example.com": host({ http: { ok: false, error: "timeout" } }) });
		expect(diffSnapshots(before, after)).toEqual([
			{ kind: "https_changed", host: "example.com", before: "HTTP 200", after: "unreachable" },
		]);
	});
});
