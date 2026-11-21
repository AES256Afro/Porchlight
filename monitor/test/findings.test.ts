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

const ALL_HEADERS = [
	"strict-transport-security",
	"content-security-policy",
	"x-content-type-options",
	"x-frame-options",
	"referrer-policy",
	"permissions-policy",
];

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
		// A snapshot from before it was kept: nothing is claimed.
		expect(withHttp({})).toEqual([]);
	});

	it("counts HSTS without a max-age browsers can read as missing (MON-B2)", () => {
		// Browsers ignore such a header (RFC 6797), so the site has no HSTS.
		const found = deriveFindings(
			snapshot({
				"example.com": host({
					http: page(ALL, { hsts: { maxAge: null, includeSubDomains: true } }),
				}),
			}),
			[],
			SETTINGS,
			NOW,
		);
		expect(found.map((finding) => `${finding.severity} ${finding.id}`)).toEqual([
			"medium missing-header:example.com:strict-transport-security",
		]);
		expect(found[0]!.title).toContain("no max-age");
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

	it("reports a certificate authority the log had not listed before, and nothing it could not compare", () => {
		const seen = (issuer: string, names = ["example.com"]) => ({
			issuer,
			plain: true,
			wildcard: false,
			names,
		});
		const before = { ...snapshot({}), issuers: [seen("Let's Encrypt")] };
		const after = {
			...snapshot({}),
			issuers: [seen("Let's Encrypt"), seen("Other CA", ["shop.example.com"])],
		};
		expect(diffSnapshots(before, after)).toEqual([
			{
				kind: "issuer_added",
				host: "example.com",
				issuer: "Other CA",
				names: ["shop.example.com"],
			},
		]);
		// An authority whose certificates expired is not a change worth telling.
		expect(diffSnapshots(after, before)).toEqual([]);
		// The log not read for the bare domain either time (invariant 5), or an older snapshot.
		expect(diffSnapshots(snapshot({}), after)).toEqual([]);
		expect(diffSnapshots(before, snapshot({}))).toEqual([]);
		// An earlier list cut at its limit may have left the authority out.
		const full = {
			...snapshot({}),
			issuers: Array.from({ length: 20 }, (_, index) => seen(`CA ${index}`)),
		};
		expect(diffSnapshots(full, after)).toEqual([]);
	});

	it("reports HTTPS becoming unreachable", () => {
		const before = snapshot({ "example.com": host({ http: page() }) });
		const after = snapshot({ "example.com": host({ http: { ok: false, error: "timeout" } }) });
		expect(diffSnapshots(before, after)).toEqual([
			{ kind: "https_changed", host: "example.com", before: "HTTP 200", after: "unreachable" },
		]);
	});
});

describe("fewer false findings", () => {
	it("says a parent's CAA record may apply when the monitored name may be a subdomain (MON-B3)", () => {
		const caa = (domain: string) =>
			deriveFindings({ ...snapshot({}, { CAA: [] }), domain }, [], SETTINGS, NOW)[0]!;
		expect(caa("example.com").title).toBe(
			"No CAA record: any certificate authority may issue for this domain",
		);
		const sub = caa("shop.example.com");
		expect(sub).toMatchObject({ id: "no-caa:shop.example.com", severity: "low" });
		expect(sub.title).toContain("a CAA record on a parent domain, which is not checked, may still");
	});

	it("does not call anti-forgery cookies sign-in cookies (MON-B4)", () => {
		const probe = (cookies: { name: string; secure: boolean; httpOnly: boolean }[]) =>
			ids(snapshot({ "example.com": host({ http: page(ALL_HEADERS, { cookies }) }) }));
		expect(
			probe([
				{ name: "csrftoken", secure: true, httpOnly: false },
				{ name: "XSRF-TOKEN", secure: true, httpOnly: false },
			]),
		).toEqual([]);
		expect(probe([{ name: "auth_token", secure: true, httpOnly: false }])).toEqual([
			"script-readable-cookies:example.com",
		]);
		// Still a cookie without Secure, whatever it is for.
		expect(probe([{ name: "csrftoken", secure: false, httpOnly: false }])).toEqual([
			"insecure-cookies:example.com",
		]);
	});

	it("flags an SPF record that never says all, unless it hands over with redirect= (MON-B5)", () => {
		const spf = (txt: string) =>
			deriveFindings(snapshot({}, { CAA, TXT: [txt] }), [], SETTINGS, NOW);
		expect(spf("v=spf1 mx")).toMatchObject([{ id: "weak-spf:example.com", severity: "low" }]);
		expect(spf("v=spf1 redirect=_spf.example.net")).toEqual([]);
	});

	it("keeps cookie findings through a response that set no cookie, and clears them on one that did (MON-B6)", () => {
		const withCookies = (cookies?: { name: string; secure: boolean; httpOnly: boolean }[]) =>
			snapshot({
				"example.com": host({ http: page(ALL_HEADERS, cookies ? { cookies } : {}) }),
			});
		const first = deriveFindings(
			withCookies([{ name: "theme", secure: false, httpOnly: false }]),
			[],
			SETTINGS,
			NOW,
		);
		expect(first.map((finding) => finding.id)).toEqual(["insecure-cookies:example.com"]);

		const none = deriveFindings(withCookies(), first, SETTINGS, NOW);
		expect(diffFindings(first, none)).toEqual({ added: [], resolved: [] });

		const fixed = deriveFindings(
			withCookies([{ name: "theme", secure: true, httpOnly: false }]),
			none,
			SETTINGS,
			NOW,
		);
		expect(diffFindings(none, fixed).resolved.map((finding) => finding.id)).toEqual([
			"insecure-cookies:example.com",
		]);
	});
});

describe("findings that get worse under the same id", () => {
	it("reports a rise in severity as new, and a fall as nothing (B34)", () => {
		const finding = (severity: "low" | "medium") => ({
			id: "weak-hsts:example.com",
			severity,
			host: "example.com",
			basis: "http" as const,
			title: severity,
		});
		expect(diffFindings([finding("low")], [finding("medium")])).toEqual({
			added: [finding("medium")],
			resolved: [],
		});
		expect(diffFindings([finding("medium")], [finding("low")])).toEqual({
			added: [],
			resolved: [],
		});
	});
});

describe("certificates the log did not show this time", () => {
	const expired = host({
		cert: { notBefore: "2026-08-01T00:00:00Z", notAfter: "2026-11-01T00:00:00Z" },
	});

	it("derives nothing from a carried certificate, and keeps the findings it had (B52, R2B-6)", () => {
		expect(ids({ ...snapshot({ "example.com": expired }), ctOk: false })).toEqual([]);
		expect(ids({ ...snapshot({ "example.com": expired }), ctApexOk: false })).toEqual([]);
		// Only the bare domain's own query failed: other hosts' certificates were read.
		expect(ids({ ...snapshot({ "www.example.com": expired }), ctApexOk: false })).toEqual([
			"cert-expired:www.example.com",
		]);

		const before = deriveFindings(
			snapshot({
				"example.com": host({
					cert: { notBefore: "2026-09-01T00:00:00Z", notAfter: "2026-11-25T00:00:00Z" },
				}),
			}),
			[],
			SETTINGS,
			NOW,
		);
		expect(before.map((finding) => finding.id)).toEqual(["cert-expiring:example.com"]);
		const down = deriveFindings(
			{ ...snapshot({ "example.com": expired }), ctOk: false },
			before,
			SETTINGS,
			NOW,
		);
		expect(down).toEqual(before);
	});
});
