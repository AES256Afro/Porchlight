// M18's monitor coverage: certificate issuers against CAA (FT-3), the subdomain inventory (R6F-5),
// redirects and version headers from the GET / already made (R6F-6), and HTTPS that fails at TLS
// (R6F-7). Each adds no request: the request lists asserted here are those of a scan before M18.

import { beforeEach, describe, expect, it } from "vite-plus/test";
import { identifiersOf, issuersSeen, parseCaa, unlistedIssuers } from "../src/caa.ts";
import { issuerOrganisation } from "../src/collect/ct.ts";
import { probeHttps, redirectTarget, revealingValue, tlsFailure } from "../src/collect/http.ts";
import { deriveFindings } from "../src/findings.ts";
import type { HostState, Snapshot } from "../src/snapshot.ts";
import { fakeDeps, WEBHOOK, type FakeNet } from "./fake-net.ts";
import { call, HARDENED_HEADERS, registerVerified, resetDb, VALID_CERT } from "./helpers.ts";

const DOMAIN = "example.test";
const NOW = new Date("2026-11-17T12:00:00Z");
const SETTINGS = {
	scanIntervalHours: 24,
	maxHosts: 12,
	certExpiryWarnDays: 14,
	snapshotsToKeep: 30,
};
const LETS_ENCRYPT = "C=US, O=Let's Encrypt, CN=R11";
const GOOGLE = "C=US, O=Google Trust Services, CN=WE1";

function net(overrides: Partial<FakeNet> = {}): FakeNet {
	return {
		hosts: { [DOMAIN]: { a: ["203.0.113.10"] }, [`www.${DOMAIN}`]: { a: ["203.0.113.10"] } },
		txt: { [DOMAIN]: ["v=spf1 -all"] },
		apex: { CAA: ['0 issue "letsencrypt.org"'], NS: ["ns1.dns.example."] },
		ct: [{ names: [DOMAIN, `www.${DOMAIN}`], ...VALID_CERT, issuer: LETS_ENCRYPT }],
		https: {
			[DOMAIN]: { headers: HARDENED_HEADERS },
			[`www.${DOMAIN}`]: { headers: HARDENED_HEADERS },
		},
		...overrides,
	};
}

const scan = (deps: ReturnType<typeof fakeDeps>) => call(deps, "POST", `/domains/${DOMAIN}/scan`);
const ids = (body: { report: { findings: { id: string }[] } }) =>
	body.report.findings.map((finding) => finding.id);

/** The requests of one scan of a verified domain with two hosts, as before M18. */
const SCAN_REQUESTS = [
	`https://cloudflare-dns.com/dns-query?name=_porchlight-challenge.${DOMAIN}&type=TXT`,
	`https://crt.sh/?q=%25.${DOMAIN}&output=json&exclude=expired&deduplicate=Y`,
	`https://crt.sh/?q=${DOMAIN}&output=json&exclude=expired&deduplicate=Y`,
	...["AAAA", "NS", "MX", "TXT", "CAA"].map(
		(type) => `https://cloudflare-dns.com/dns-query?name=${DOMAIN}&type=${type}`,
	),
	`https://cloudflare-dns.com/dns-query?name=${DOMAIN}&type=A`,
	`https://${DOMAIN}/`,
	`https://cloudflare-dns.com/dns-query?name=www.${DOMAIN}&type=A`,
	`https://www.${DOMAIN}/`,
];

/** What a scan asked of the network, in a fixed order (hosts are probed side by side), without the alert. */
const scanRequests = (deps: ReturnType<typeof fakeDeps>) =>
	deps.requests.filter((url) => url !== WEBHOOK).sort();

beforeEach(resetDb);

describe("certificate issuers against CAA (FT-3)", () => {
	it("reads the issuing organisation from the log's issuer name", () => {
		expect(issuerOrganisation(LETS_ENCRYPT)).toBe("Let's Encrypt");
		expect(issuerOrganisation('C=GB, O="Sectigo Limited, Inc", CN=x')).toBe("Sectigo Limited, Inc");
		expect(issuerOrganisation("CN=Only A Name")).toBe("Only A Name");
		expect(issuerOrganisation("O=\u001b[31mEvil\u0007")).toBe("[31mEvil");
		expect(issuerOrganisation(42)).toBeNull();
		expect(issuerOrganisation("C=US")).toBeNull();
	});

	it("parses CAA in both forms, and an issue record of ';' allows no one", () => {
		expect(parseCaa(['0 issue "letsencrypt.org; validationmethods=dns-01"'])).toEqual({
			issue: ["letsencrypt.org"],
			issuewild: null,
		});
		expect(parseCaa(['0 issue ";"', '0 issuewild "pki.goog"'])).toEqual({
			issue: [],
			issuewild: ["pki.goog"],
		});
		// RFC 3597: flags 0, tag length 5, "issue", "pki.goog".
		const bytes = [0, 5, ...Array.from("issuepki.goog", (char) => char.charCodeAt(0))];
		const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0"));
		expect(parseCaa([`\\# ${hex.length} ${hex.join(" ")}`])).toEqual({
			issue: ["pki.goog"],
			issuewild: null,
		});
		// Only iodef: nothing says who may issue, so nothing is judged.
		expect(parseCaa(['0 iodef "mailto:security@example.test"'])).toBeNull();
	});

	it("judges plain certificates by issue and wildcards by issuewild, and leaves unknown authorities alone", () => {
		const seen = issuersSeen([
			{ names: [DOMAIN], ...VALID_CERT, issuer: "Let's Encrypt" },
			{ names: [`*.${DOMAIN}`], ...VALID_CERT, issuer: "Google Trust Services" },
			{ names: [DOMAIN], ...VALID_CERT, issuer: "Some Private CA" },
			{ names: [DOMAIN], ...VALID_CERT },
		]);
		expect(seen.map((issuer) => issuer.issuer)).toEqual([
			"Google Trust Services",
			"Let's Encrypt",
			"Some Private CA",
		]);
		expect(identifiersOf("Some Private CA")).toBeNull();
		const unlisted = (records: string[]) =>
			unlistedIssuers(parseCaa(records)!, seen).map((entry) => entry.identifier);
		expect(unlisted(['0 issue "letsencrypt.org"'])).toEqual(["pki.goog"]);
		expect(unlisted(['0 issue "letsencrypt.org"', '0 issuewild "pki.goog"'])).toEqual([]);
		expect(unlisted(['0 issuewild "pki.goog"'])).toEqual([]);
		expect(unlisted(['0 issue ";"'])).toEqual(["pki.goog", "letsencrypt.org"]);
	});

	it("reports an authority the CAA record does not allow, with no request added", async () => {
		const deps = fakeDeps(
			net({
				ct: [
					{ names: [DOMAIN, `www.${DOMAIN}`], ...VALID_CERT, issuer: LETS_ENCRYPT },
					{ names: [`www.${DOMAIN}`], ...VALID_CERT, issuer: GOOGLE },
				],
			}),
		);
		await registerVerified(deps, DOMAIN);
		const { status, body } = await scan(deps);
		expect(status).toBe(200);
		expect(ids(body)).toEqual([`caa-unlisted-issuer:${DOMAIN}:pki.goog`]);
		expect(body.report.findings[0].title).toContain(
			`from Google Trust Services (for www.${DOMAIN})`,
		);
		expect(scanRequests(deps)).toEqual([...SCAN_REQUESTS].sort());
	});

	it("carries the finding while the log cannot be read, and clears it once the certificate is gone", async () => {
		const deps = fakeDeps(
			net({ ct: [{ names: [`www.${DOMAIN}`], ...VALID_CERT, issuer: GOOGLE }] }),
		);
		await registerVerified(deps, DOMAIN);
		expect(ids((await scan(deps)).body)).toEqual([`caa-unlisted-issuer:${DOMAIN}:pki.goog`]);

		deps.clock = new Date("2026-11-18T12:00:00Z");
		deps.net.ct = "down";
		expect(ids((await scan(deps)).body)).toEqual([`caa-unlisted-issuer:${DOMAIN}:pki.goog`]);

		deps.clock = new Date("2026-11-19T12:00:00Z");
		deps.net.ct = [{ names: [`www.${DOMAIN}`], ...VALID_CERT, issuer: LETS_ENCRYPT }];
		deps.net.ctBareDown = true;
		// Without the bare-domain query the reading is not whole: still carried (invariant 5).
		expect(ids((await scan(deps)).body)).toEqual([`caa-unlisted-issuer:${DOMAIN}:pki.goog`]);

		deps.clock = new Date("2026-11-20T12:00:00Z");
		deps.net.ctBareDown = false;
		const { body } = await scan(deps);
		expect(ids(body)).toEqual([]);
		expect(body.report.resolvedFindings.map((finding: { id: string }) => finding.id)).toEqual([
			`caa-unlisted-issuer:${DOMAIN}:pki.goog`,
		]);
	});
});

describe("the front page's redirect and version headers (R6F-6)", () => {
	it("keeps a redirect's scheme and host only, and a header only when it names a version", () => {
		expect(redirectTarget("http://example.test/login?token=abc", DOMAIN)).toEqual({
			scheme: "http",
			host: "example.test",
		});
		expect(redirectTarget("/en/", DOMAIN)).toEqual({ scheme: "https", host: DOMAIN });
		expect(revealingValue("nginx")).toBeNull();
		expect(revealingValue("cloudflare")).toBeNull();
		expect(revealingValue("Apache/2.4.41 (Ubuntu)")).toBe("Apache/2.4.41 (Ubuntu)");
		expect(revealingValue(`PHP/8.1.2\u001b[0m${"x".repeat(200)}`)).toHaveLength(80);
	});

	it("reads them from the one GET / it makes, following nothing", async () => {
		const deps = fakeDeps({
			https: {
				[DOMAIN]: {
					status: 301,
					headers: {
						location: "http://www.example.test/?session=secret",
						server: "nginx/1.18.0",
						"x-powered-by": "Express",
					},
				},
			},
		});
		const probe = await probeHttps(DOMAIN, deps.fetch);
		expect(probe).toMatchObject({
			ok: true,
			status: 301,
			redirect: { scheme: "http", host: "www.example.test" },
			revealing: [{ header: "server", value: "nginx/1.18.0" }],
		});
		expect(JSON.stringify(probe)).not.toContain("secret");
		expect(deps.requests).toEqual([`https://${DOMAIN}/`]);
	});

	it("reports a redirect to plain HTTP or off the domain, and server versions, with no request added", async () => {
		const deps = fakeDeps(
			net({
				https: {
					[DOMAIN]: {
						status: 301,
						headers: {
							"strict-transport-security": "max-age=63072000",
							location: "https://login.elsewhere.example/",
						},
					},
					[`www.${DOMAIN}`]: {
						status: 302,
						headers: {
							"strict-transport-security": "max-age=63072000",
							location: `http://www.${DOMAIN}/`,
							"x-powered-by": "PHP/7.4.3",
						},
					},
				},
			}),
		);
		await registerVerified(deps, DOMAIN);
		const { body } = await scan(deps);
		expect(ids(body)).toEqual([
			`redirect-insecure:www.${DOMAIN}`,
			`redirect-offsite:${DOMAIN}`,
			`version-header:www.${DOMAIN}`,
		]);
		expect(scanRequests(deps)).toEqual([...SCAN_REQUESTS].sort());
		// A redirect to a host of the domain itself is no finding.
		deps.clock = new Date("2026-11-18T12:00:00Z");
		deps.net.https![DOMAIN]!.headers!.location = `https://www.${DOMAIN}/`;
		expect(ids((await scan(deps)).body)).not.toContain(`redirect-offsite:${DOMAIN}`);
	});
});

describe("HTTPS that fails at TLS (R6F-7)", () => {
	const host = (http: HostState["http"]): HostState => ({
		probed: true,
		dns: { a: ["203.0.113.1"], aaaa: [], cname: [] },
		cert: null,
		http,
	});
	const snapshot = (http: HostState["http"]): Snapshot => ({
		version: 1,
		domain: DOMAIN,
		takenAt: NOW.toISOString(),
		ctOk: true,
		apex: {},
		hosts: { [DOMAIN]: host(http) },
	});
	const found = (http: HostState["http"], previous = [] as ReturnType<typeof deriveFindings>) =>
		deriveFindings(snapshot(http), previous, SETTINGS, NOW).map((finding) => finding.id);

	it("tells a certificate or handshake error from a timeout", () => {
		expect(tlsFailure("TLS peer's certificate has expired")).toBe(true);
		expect(tlsFailure("SSL handshake failed")).toBe(true);
		expect(tlsFailure("The operation was aborted due to timeout")).toBe(false);
		expect(tlsFailure("connection refused")).toBe(false);
	});

	it("reports a definite failure from the first scan, and carries it through a timeout", () => {
		expect(found({ ok: false, error: "certificate has expired" })).toEqual([
			`https-failed:${DOMAIN}`,
		]);
		// Cloudflare's 526 is a failure; header findings are neither raised nor cleared by it.
		expect(
			found({ ok: true, status: 526, html: false, present: [], frameAncestors: false }),
		).toEqual([`https-failed:${DOMAIN}`]);
		expect(found({ ok: false, error: "connection refused" })).toEqual([]);
		const previous = deriveFindings(
			snapshot({ ok: false, error: "certificate has expired" }),
			[],
			SETTINGS,
			NOW,
		);
		expect(
			found({ ok: false, error: "The operation was aborted due to timeout" }, previous),
		).toEqual([`https-failed:${DOMAIN}`]);
		// A working answer clears it.
		expect(
			found(
				{
					ok: true,
					status: 200,
					html: false,
					present: ["strict-transport-security", "x-content-type-options"],
					frameAncestors: false,
					hsts: { maxAge: 63072000, includeSubDomains: false },
				},
				previous,
			),
		).toEqual([]);
	});

	it("is reported by a scan of a live host whose certificate fails", async () => {
		const deps = fakeDeps(
			net({
				https: {
					[DOMAIN]: { fails: "TLS peer's certificate is not trusted" },
					[`www.${DOMAIN}`]: { headers: HARDENED_HEADERS },
				},
			}),
		);
		await registerVerified(deps, DOMAIN);
		const { body } = await scan(deps);
		expect(ids(body)).toEqual([`https-failed:${DOMAIN}`]);
		expect(body.report.newFindings[0].title).not.toContain("not trusted");
		expect(scanRequests(deps)).toEqual([...SCAN_REQUESTS].sort());
	});
});

describe("the subdomain inventory (R6F-5)", () => {
	it("returns what the latest scan holds, behind the token, asking nothing of the network", async () => {
		const deps = fakeDeps(
			net({
				hosts: {
					[DOMAIN]: { a: ["203.0.113.10"] },
					[`www.${DOMAIN}`]: { a: ["203.0.113.10"] },
					[`shop.${DOMAIN}`]: { cname: ["closed-store.vendor.example"] },
				},
				ct: [
					{ names: [DOMAIN, `www.${DOMAIN}`, `shop.${DOMAIN}`, `old.${DOMAIN}`], ...VALID_CERT },
				],
			}),
		);
		await registerVerified(deps, DOMAIN);
		expect((await call(deps, "GET", `/domains/${DOMAIN}/hosts`)).status).toBe(404);
		await scan(deps);
		deps.requests.length = 0;

		expect((await call(deps, "GET", `/domains/${DOMAIN}/hosts`, { token: null })).status).toBe(401);
		const { status, body } = await call(deps, "GET", `/domains/${DOMAIN}/hosts`);
		expect(status).toBe(200);
		expect(deps.requests).toEqual([]);
		expect(body).toMatchObject({ domain: DOMAIN, total: 3, page: 1, pageSize: 200 });
		expect(body.hosts.map((entry: { name: string }) => entry.name)).toEqual([
			DOMAIN,
			`shop.${DOMAIN}`,
			`www.${DOMAIN}`,
		]);
		expect(body.hosts[0]).toMatchObject({
			probed: true,
			dns: { a: ["203.0.113.10"], aaaa: [], cname: [] },
			cert: VALID_CERT_ISO,
			https: { ok: true, status: 200 },
			findings: 0,
		});
		expect(body.hosts[1]).toMatchObject({ https: null, findings: 1 });
		expect(body.gone.map((entry: { name: string }) => entry.name)).toEqual([`old.${DOMAIN}`]);

		expect((await call(deps, "GET", `/domains/${DOMAIN}/hosts?page=2`)).body).toMatchObject({
			hosts: [],
			gone: [],
		});
		expect((await call(deps, "GET", `/domains/${DOMAIN}/hosts?page=0`)).status).toBe(400);
		expect((await call(deps, "GET", `/domains/${DOMAIN}/hosts?page=x`)).status).toBe(400);
		expect((await call(deps, "POST", `/domains/${DOMAIN}/hosts`)).status).toBe(405);
		expect(deps.requests).toEqual([]);
	});
});

const VALID_CERT_ISO = {
	notBefore: new Date(VALID_CERT.notBefore).toISOString(),
	notAfter: new Date(VALID_CERT.notAfter).toISOString(),
};
