import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { runDueScan, runScan } from "../src/scan.ts";
import { getDomain } from "../src/store.ts";
import { fakeDeps, type FakeNet } from "./fake-net.ts";
import {
	appEnv,
	call,
	HARDENED_HEADERS,
	registerVerified,
	resetDb,
	VALID_CERT,
} from "./helpers.ts";

const DOMAIN = "example.test";

/** A small, well-configured site: apex and www, both hardened. */
function healthyNet(): FakeNet {
	return {
		hosts: {
			[DOMAIN]: { a: ["203.0.113.10"] },
			[`www.${DOMAIN}`]: { a: ["203.0.113.10"] },
		},
		// A domain that sends no mail says so; without it, the missing SPF record is a finding.
		txt: { [DOMAIN]: ["v=spf1 -all"] },
		apex: {
			CAA: ['0 issue "letsencrypt.org"'],
			NS: ["ns1.dns.example."],
			MX: ["10 mail.example.test."],
		},
		ct: [{ names: [DOMAIN, `www.${DOMAIN}`], ...VALID_CERT }],
		https: {
			[DOMAIN]: { headers: HARDENED_HEADERS },
			[`www.${DOMAIN}`]: { headers: HARDENED_HEADERS },
		},
	};
}

const scan = (deps: ReturnType<typeof fakeDeps>, domain = DOMAIN) =>
	call(deps, "POST", `/domains/${domain}/scan`);

beforeEach(resetDb);

describe("ownership gate", () => {
	it("makes no request about a domain that has not been verified", async () => {
		const deps = fakeDeps(healthyNet());
		await call(deps, "POST", "/domains", { body: { domain: DOMAIN } });

		const response = await scan(deps);

		expect(response.status).toBe(403);
		expect(response.body.challenge.name).toBe(`_porchlight-challenge.${DOMAIN}`);
		expect(deps.requests).toEqual([]);
	});

	it("rejects verification until the exact challenge value is published", async () => {
		const deps = fakeDeps(healthyNet());
		const created = await call(deps, "POST", "/domains", { body: { domain: DOMAIN } });
		const { name, value } = created.body.domain.challenge;

		deps.net.txt = { [name]: ["porchlight-verify=someone-elses-token"] };
		expect((await call(deps, "POST", `/domains/${DOMAIN}/verify`)).status).toBe(409);
		expect((await scan(deps)).status).toBe(403);

		deps.net.txt = { [name]: [value] };
		const verified = await call(deps, "POST", `/domains/${DOMAIN}/verify`);
		expect(verified.status).toBe(200);
		expect(verified.body.domain.verified).toBe(true);
		// Verification itself only ever asked DNS for the challenge record (the current one, or the
		// one published before the rename).
		expect(deps.requests.every((url) => /_(porchlight|securityx)-challenge\./.test(url))).toBe(
			true,
		);
	});

	it("still accepts a record published before the rename", async () => {
		const deps = fakeDeps(healthyNet());
		const created = await call(deps, "POST", "/domains", { body: { domain: DOMAIN } });
		const token = String(created.body.domain.challenge.value).replace("porchlight-verify=", "");

		deps.net.txt = { [`_securityx-challenge.${DOMAIN}`]: [`securityx-verify=${token}`] };
		expect((await call(deps, "POST", `/domains/${DOMAIN}/verify`)).status).toBe(200);
		expect((await scan(deps)).status).toBe(200);

		// Someone else's token under the old label proves nothing.
		deps.net.txt = { [`_securityx-challenge.${DOMAIN}`]: ["securityx-verify=someone-elses-token"] };
		expect((await scan(deps)).status).toBe(403);
	});

	it("stops scanning, and alerts once, when the challenge record is removed", async () => {
		const deps = fakeDeps(healthyNet());
		await registerVerified(deps, DOMAIN);
		expect((await scan(deps)).status).toBe(200);
		deps.requests.length = 0;
		deps.alerts.length = 0;

		deps.net.txt = {};
		expect((await scan(deps)).status).toBe(403);
		expect((await scan(deps)).status).toBe(403);

		expect(deps.alerts).toHaveLength(1);
		expect(deps.alerts[0]!.text).toContain("ownership check failed");
		const beyondTheGate = deps.requests.filter(
			(url) => !/_(porchlight|securityx)-challenge\./.test(url) && !url.includes("hooks."),
		);
		expect(beyondTheGate).toEqual([]);
		expect((await call(deps, "GET", `/domains/${DOMAIN}`)).body.domain.verified).toBe(false);
	});

	it("reports a DNS outage as an error, not as lost ownership", async () => {
		const deps = fakeDeps(healthyNet());
		await registerVerified(deps, DOMAIN);
		deps.net.dnsDown = [`_porchlight-challenge.${DOMAIN}`];

		expect((await scan(deps)).status).toBe(502);
		expect(deps.alerts).toEqual([]);
		expect((await call(deps, "GET", `/domains/${DOMAIN}`)).body.domain).toMatchObject({
			verified: true,
			lastScanStatus: "error",
		});
	});

	it("shows a lapsed domain as verified again once its record is back, and scans it on the next tick", async () => {
		const deps = fakeDeps(healthyNet());
		await registerVerified(deps, DOMAIN);
		expect((await scan(deps)).status).toBe(200);
		const record = deps.net.txt!;

		deps.net.txt = {};
		deps.clock = new Date("2026-11-17T13:00:00Z");
		expect((await scan(deps)).status).toBe(403);
		expect((await call(deps, "GET", `/domains/${DOMAIN}`)).body.domain.verified).toBe(false);

		deps.net.txt = record;
		deps.clock = new Date("2026-11-17T13:20:00Z");
		const verified = await call(deps, "POST", `/domains/${DOMAIN}/verify`);
		expect(verified.body.domain).toMatchObject({ verified: true, lastScanStatus: null });
		expect((await call(deps, "GET", `/domains/${DOMAIN}`)).body.domain).toMatchObject({
			verified: true,
			lastScanStatus: null,
		});

		// Not a day later: the next tick.
		deps.clock = new Date("2026-11-17T13:30:00Z");
		expect((await runDueScan(appEnv(), deps))?.status).toBe("ok");
	});
});

describe("scanning", () => {
	it("records a baseline on the first scan and alerts with it", async () => {
		const deps = fakeDeps(healthyNet());
		await registerVerified(deps, DOMAIN);

		const { status, body } = await scan(deps);

		expect(status).toBe(200);
		expect(body.report).toMatchObject({
			baseline: true,
			hostCount: 2,
			changes: [],
			findings: [],
			notes: [],
		});
		expect(deps.alerts).toHaveLength(1);
		expect(deps.alerts[0]!.text).toContain(`first scan of ${DOMAIN}: 2 hosts, 0 findings`);
		expect((await call(deps, "GET", `/domains/${DOMAIN}`)).body.report.takenAt).toBe(
			body.report.takenAt,
		);
	});

	it("reports only what changed since the previous scan, then goes quiet", async () => {
		const deps = fakeDeps(healthyNet());
		await registerVerified(deps, DOMAIN);
		await scan(deps);

		// A new host appears in the certificate log without security headers,
		// and an old alias is left pointing at a target that no longer exists.
		const staging = `staging.${DOMAIN}`;
		const shop = `shop.${DOMAIN}`;
		deps.net.ct = [...(deps.net.ct as []), { names: [staging, shop], ...VALID_CERT }];
		deps.net.hosts![staging] = { a: ["198.51.100.20"] };
		deps.net.hosts![shop] = { cname: ["closed-store.vendor.example"] };
		deps.net.https![staging] = { headers: { "content-type": "text/html" } };
		deps.clock = new Date("2026-11-18T12:00:00Z");

		const second = (await scan(deps)).body.report;

		expect(second.baseline).toBe(false);
		expect(second.changes).toEqual([
			{ kind: "host_added", host: shop },
			{ kind: "host_added", host: staging },
		]);
		expect(second.newFindings.map((finding: { id: string }) => finding.id)).toEqual([
			`dangling-cname:${shop}`,
			`missing-header:${staging}:content-security-policy`,
			`missing-header:${staging}:strict-transport-security`,
			`missing-header:${staging}:permissions-policy`,
			`missing-header:${staging}:referrer-policy`,
			`missing-header:${staging}:x-content-type-options`,
			`missing-header:${staging}:x-frame-options`,
		]);
		expect(deps.alerts).toHaveLength(2);
		expect(deps.alerts[1]!.text).toContain(
			`[high] ${shop}: CNAME target closed-store.vendor.example does not resolve`,
		);

		deps.clock = new Date("2026-11-19T12:00:00Z");
		const third = (await scan(deps)).body.report;

		expect(third.changes).toEqual([]);
		expect(third.newFindings).toEqual([]);
		expect(third.findings).toHaveLength(7);
		expect(deps.alerts).toHaveLength(2);
	});

	it("keeps the host list when the certificate log is down, and says so", async () => {
		const deps = fakeDeps(healthyNet());
		await registerVerified(deps, DOMAIN);
		await scan(deps);
		deps.net.ct = "down";

		const report = (await scan(deps)).body.report;

		expect(report.hostCount).toBe(2);
		expect(report.changes).toEqual([]);
		expect(report.notes).toEqual([expect.stringContaining("certificate log could not be read")]);
	});

	it("drops a host from the inventory once it has no DNS records", async () => {
		const deps = fakeDeps(healthyNet());
		await registerVerified(deps, DOMAIN);
		await scan(deps);
		delete deps.net.hosts![`www.${DOMAIN}`];
		deps.net.ct = [];

		const report = (await scan(deps)).body.report;

		expect(report.changes).toEqual([{ kind: "host_removed", host: `www.${DOMAIN}` }]);
		expect(report.hostCount).toBe(1);
	});

	it("treats a lookup the resolver could not answer as not observed, not as no records", async () => {
		const deps = fakeDeps(healthyNet());
		await registerVerified(deps, DOMAIN);
		const shop = `shop.${DOMAIN}`;
		deps.net.ct = [...(deps.net.ct as []), { names: [shop], ...VALID_CERT }];
		deps.net.hosts![shop] = { cname: ["closed-store.vendor.example"] };
		await scan(deps);

		// SERVFAIL arrives as HTTP 200 with no records, for the apex and the alias alike.
		deps.net.dnsServfail = [DOMAIN, shop];
		deps.clock = new Date("2026-11-18T12:00:00Z");
		const report = (await scan(deps)).body.report;

		expect(report.changes).toEqual([]);
		expect(report.resolvedFindings).toEqual([]);
		expect(report.newFindings).toEqual([]);
		expect(report.findings.map((finding: { id: string }) => finding.id)).toContain(
			`dangling-cname:${shop}`,
		);
		expect(report.hostCount).toBe(3);
	});

	it("probes at most MAX_HOSTS hosts, lists the rest, and stays within its request budget", async () => {
		const net = healthyNet();
		const extras = ["a", "b", "c", "d"].map((label) => `${label}.${DOMAIN}`);
		net.ct = [{ names: [DOMAIN, `www.${DOMAIN}`, ...extras], ...VALID_CERT }];
		for (const host of extras) net.hosts![host] = { a: ["203.0.113.30"] };
		const deps = fakeDeps(net);
		await registerVerified(deps, DOMAIN);

		const { body } = await call(deps, "POST", `/domains/${DOMAIN}/scan`, {
			env: { MAX_HOSTS: "3" },
		});

		expect(body.report.hostCount).toBe(6);
		expect(body.report.notes).toEqual([
			"3 of 6 known hosts were not checked this time: each scan checks 3, and the rest take turns in later scans.",
		]);
		const probedSites = deps.requests.filter(
			(url) =>
				(url.startsWith(`https://`) && url.endsWith(`.${DOMAIN}/`)) || url === `https://${DOMAIN}/`,
		);
		expect(probedSites).toEqual([
			`https://${DOMAIN}/`,
			`https://www.${DOMAIN}/`,
			`https://a.${DOMAIN}/`,
		]);
		// 1 challenge + 2 certificate log + 5 apex + 3 hosts x (DNS + HTTPS) + 1 alert.
		expect(deps.requests).toHaveLength(15);
	});
});

describe("findings that hold across scans", () => {
	it("keeps header findings through a server error, without alerting", async () => {
		const deps = fakeDeps(healthyNet());
		deps.net.https![DOMAIN] = { headers: { "content-type": "text/html" } };
		await registerVerified(deps, DOMAIN);
		const first = (await scan(deps)).body.report;
		expect(first.findings.length).toBeGreaterThan(0);
		deps.alerts.length = 0;

		// The site has an outage: a bare 503 with none of its usual headers.
		deps.net.https![DOMAIN] = { status: 503 };
		deps.clock = new Date("2026-11-18T12:00:00Z");
		const during = (await scan(deps)).body.report;
		expect(during.resolvedFindings).toEqual([]);
		expect(during.newFindings).toEqual([]);
		expect(during.findings).toEqual(first.findings);

		deps.net.https![DOMAIN] = { headers: { "content-type": "text/html" } };
		deps.clock = new Date("2026-11-19T12:00:00Z");
		const after = (await scan(deps)).body.report;
		expect(after.resolvedFindings).toEqual([]);
		expect(after.newFindings).toEqual([]);
		expect(deps.alerts).toEqual([]);
	});

	it("names the last hop of an alias chain that leads nowhere", async () => {
		const deps = fakeDeps(healthyNet());
		const shop = `shop.${DOMAIN}`;
		deps.net.ct = [...(deps.net.ct as []), { names: [shop], ...VALID_CERT }];
		// shop -> z-edge (the vendor's front) -> a-store (the deleted store).
		deps.net.hosts![shop] = { cname: ["z-edge.vendor.example", "a-store.vendor.example"] };
		await registerVerified(deps, DOMAIN);

		const report = (await scan(deps)).body.report;

		const dangling = report.findings.find(
			(finding: { id: string }) => finding.id === `dangling-cname:${shop}`,
		);
		expect(dangling.title).toBe(
			"CNAME target a-store.vendor.example does not resolve; check for subdomain takeover",
		);
	});

	it("reports an expiring certificate that then expires as worse, not as resolved", async () => {
		const deps = fakeDeps(healthyNet(), "2026-12-20T12:00:00.000Z");
		await registerVerified(deps, DOMAIN);
		const first = (await scan(deps)).body.report;
		expect(first.findings.map((finding: { id: string }) => finding.id)).toContain(
			`cert-expiring:${DOMAIN}`,
		);

		deps.clock = new Date("2026-12-31T12:00:00Z");
		const second = (await scan(deps)).body.report;

		expect(second.newFindings.map((finding: { id: string }) => finding.id)).toContain(
			`cert-expired:${DOMAIN}`,
		);
		expect(second.resolvedFindings).toEqual([]);
		expect(deps.alerts.at(-1)!.text).not.toContain("Resolved");
	});

	it("gives every known host a turn under MAX_HOSTS, so names that are gone cannot hold the slots", async () => {
		const net = healthyNet();
		const gone = ["a", "b"].map((label) => `${label}.${DOMAIN}`); // on a certificate, not in DNS
		const live = ["c", "d"].map((label) => `${label}.${DOMAIN}`);
		net.ct = [{ names: [DOMAIN, `www.${DOMAIN}`, ...gone, ...live], ...VALID_CERT }];
		for (const host of live) {
			net.hosts![host] = { a: ["203.0.113.30"] };
			net.https![host] = { headers: HARDENED_HEADERS };
		}
		const deps = fakeDeps(net);
		await registerVerified(deps, DOMAIN);

		const looked = new Set<string>();
		let report;
		for (let day = 0; day < 4; day++) {
			deps.clock = new Date(Date.UTC(2026, 10, 18 + day, 12));
			deps.requests.length = 0;
			report = (await call(deps, "POST", `/domains/${DOMAIN}/scan`, { env: { MAX_HOSTS: "3" } }))
				.body.report;
			for (const url of deps.requests) {
				const name = new URL(url).searchParams.get("name");
				if (url.startsWith("https://cloudflare-dns.com/") && name) looked.add(name);
			}
		}

		for (const host of [...gone, ...live]) expect(looked).toContain(host);
		// The names that are gone stay out of the inventory; the live ones are in it.
		expect(report.hostCount).toBe(4);
		expect(report.changes).toEqual([]);
	});
});

describe("checks read from what a scan already fetches", () => {
	it("finds weak HSTS, cookie flags, unsigned DNS and a missing SPF record without one more request", async () => {
		const plain = fakeDeps(healthyNet());
		await registerVerified(plain, DOMAIN);
		await scan(plain);
		const before = [...plain.requests];

		const net = healthyNet();
		net.dnssec = false;
		net.txt = {};
		net.https![DOMAIN] = {
			headers: { ...HARDENED_HEADERS, "strict-transport-security": "max-age=3600" },
			// Values that look like secrets are assembled here, and must never be kept.
			cookies: [
				`session=${"s".repeat(24)}; Path=/; HttpOnly`,
				`auth_token=${"t".repeat(24)}; Secure`,
				"theme=dark; Secure",
			],
		};
		const deps = fakeDeps(net);
		await registerVerified(deps, DOMAIN);
		const { body } = await scan(deps);

		expect(deps.requests).toEqual(before);
		expect(body.report.findings.map((finding: { id: string }) => finding.id).sort()).toEqual([
			`insecure-cookies:${DOMAIN}`,
			`no-dnssec:${DOMAIN}`,
			`no-spf:${DOMAIN}`,
			`script-readable-cookies:${DOMAIN}`,
			`weak-hsts:${DOMAIN}`,
		]);
		const title = (id: string) =>
			body.report.findings.find((finding: { id: string }) => finding.id === `${id}:${DOMAIN}`)
				.title;
		expect(title("insecure-cookies")).toContain(": session");
		expect(title("script-readable-cookies")).toContain(": auth_token");
		expect(title("weak-hsts")).toContain("lasts 1 hour;");
		const stored = await env.DB.prepare("SELECT data, report FROM snapshots").first<{
			data: string;
			report: string;
		}>();
		expect(`${stored!.data}${stored!.report}`).not.toMatch(/s{24}|t{24}/);
	});

	it("keeps these findings when the lookup behind them fails, and clears them when the fix is seen", async () => {
		const net = healthyNet();
		net.dnssec = false;
		net.txt = {};
		const deps = fakeDeps(net);
		await registerVerified(deps, DOMAIN);
		const record = deps.net.txt!;
		const ids = (report: { findings: { id: string }[] }) =>
			report.findings.map((finding) => finding.id).sort();
		expect(ids((await scan(deps)).body.report)).toEqual([
			`no-dnssec:${DOMAIN}`,
			`no-spf:${DOMAIN}`,
		]);

		// The resolver cannot answer for the apex: neither finding is cleared by not looking.
		deps.net.dnsServfail = [DOMAIN];
		deps.clock = new Date("2026-11-18T12:00:00Z");
		const during = (await scan(deps)).body.report;
		expect(during.resolvedFindings).toEqual([]);
		expect(ids(during)).toEqual([`no-dnssec:${DOMAIN}`, `no-spf:${DOMAIN}`]);

		deps.net.dnsServfail = [];
		deps.net.dnssec = true;
		deps.net.txt = { ...record, [DOMAIN]: ["v=spf1 include:_spf.mail.example ~all"] };
		deps.clock = new Date("2026-11-19T12:00:00Z");
		const after = (await scan(deps)).body.report;
		expect(after.resolvedFindings.map((finding: { id: string }) => finding.id).sort()).toEqual([
			`no-dnssec:${DOMAIN}`,
			`no-spf:${DOMAIN}`,
		]);
		expect(after.findings).toEqual([]);
	});
});

describe("alert formats", () => {
	it("sends Slack's format when asked, with what the DNS says kept as text", async () => {
		const net = healthyNet();
		const shop = `shop.${DOMAIN}`;
		net.ct = [...(net.ct as []), { names: [shop], ...VALID_CERT }];
		net.hosts![shop] = { cname: ["<!channel>.vendor.example"] };
		const deps = fakeDeps(net);
		await registerVerified(deps, DOMAIN);

		await call(deps, "POST", `/domains/${DOMAIN}/scan`, { env: { ALERT_FORMAT: "slack" } });

		expect(deps.alerts).toHaveLength(1);
		const text = String(deps.alerts[0]!.text);
		expect(Object.keys(deps.alerts[0]!)).toEqual(["text"]);
		expect(text).toMatch(/^\*Porchlight: first scan of example\.test/);
		expect(text).toContain("&lt;!channel&gt;");
		expect(text).not.toContain("<!channel>");
	});

	it("sends nothing in an unknown format, and says so in the log", async () => {
		const deps = fakeDeps(healthyNet());
		await registerVerified(deps, DOMAIN);
		await call(deps, "POST", `/domains/${DOMAIN}/scan`, { env: { ALERT_FORMAT: "pager" } });
		expect(deps.alerts).toEqual([]);
	});
});

describe("history", () => {
	it("lists each kept scan newest first, and counts open findings in the domain list", async () => {
		const deps = fakeDeps(healthyNet());
		await registerVerified(deps, DOMAIN);
		await call(deps, "POST", "/domains", { body: { domain: "unscanned.test" } });
		expect((await call(deps, "GET", `/domains/${DOMAIN}/history`)).body).toEqual({
			domain: DOMAIN,
			history: [],
		});

		await scan(deps);
		// A host appears without its security headers, then gets them.
		const staging = `staging.${DOMAIN}`;
		deps.net.ct = [...(deps.net.ct as []), { names: [staging], ...VALID_CERT }];
		deps.net.hosts![staging] = { a: ["198.51.100.20"] };
		deps.net.https![staging] = { headers: { "content-type": "text/html" } };
		deps.clock = new Date("2026-11-18T12:00:00Z");
		await scan(deps);

		const listed = (await call(deps, "GET", "/domains")).body.domains;
		expect(
			listed.map((domain: { name: string; openFindings: unknown }) => [
				domain.name,
				domain.openFindings,
			]),
		).toEqual([
			[DOMAIN, { high: 0, medium: 2, low: 4 }],
			["unscanned.test", null],
		]);
		expect((await call(deps, "GET", `/domains/${DOMAIN}`)).body.domain.openFindings).toEqual({
			high: 0,
			medium: 2,
			low: 4,
		});

		deps.net.https![staging] = { headers: HARDENED_HEADERS };
		deps.clock = new Date("2026-11-19T12:00:00Z");
		await scan(deps);

		const { status, body } = await call(deps, "GET", `/domains/${DOMAIN}/history`);
		expect(status).toBe(200);
		expect(
			body.history.map(
				(entry: {
					takenAt: string;
					baseline: boolean;
					changes: unknown[];
					newFindings: unknown[];
					resolvedFindings: unknown[];
					openFindings: object;
				}) => [
					entry.takenAt.slice(0, 10),
					entry.baseline,
					entry.changes.length,
					entry.newFindings.length,
					entry.resolvedFindings.length,
					entry.openFindings,
				],
			),
		).toEqual([
			["2026-11-19", false, 0, 0, 6, { high: 0, medium: 0, low: 0 }],
			["2026-11-18", false, 1, 6, 0, { high: 0, medium: 2, low: 4 }],
			["2026-11-17", true, 0, 0, 0, { high: 0, medium: 0, low: 0 }],
		]);
		// The list of every open finding is not repeated per scan.
		expect(body.history[1].findings).toBeUndefined();

		expect((await call(deps, "POST", `/domains/${DOMAIN}/history`)).status).toBe(405);
		expect((await call(deps, "GET", "/domains/unknown.test/history")).status).toBe(404);
		expect((await call(deps, "GET", `/domains/${DOMAIN}/history`, { token: "wrong" })).status).toBe(
			401,
		);
	});
});

describe("schedule", () => {
	it("scans one overdue domain per tick, oldest first, and nothing that is not due", async () => {
		const deps = fakeDeps(healthyNet());
		const other = "other.test";
		deps.net.hosts![other] = { a: ["203.0.113.40"] };
		deps.net.https![other] = { headers: HARDENED_HEADERS };
		await registerVerified(deps, DOMAIN);
		await registerVerified(deps, other);
		await call(deps, "POST", "/domains", { body: { domain: "unverified.test" } });

		const scanned = async () => {
			const outcome = await runDueScan(appEnv(), deps);
			return outcome?.status === "ok" ? outcome.report.domain : outcome;
		};

		// Never-scanned domains go first, in the order they were added.
		expect(await scanned()).toBe(DOMAIN);
		expect(await scanned()).toBe(other);
		expect(await scanned()).toBeNull();

		deps.clock = new Date(deps.clock.getTime() + 25 * 3_600_000);
		expect(await scanned()).toBe(DOMAIN);
		expect(await scanned()).toBe(other);
		expect(await scanned()).toBeNull();
	});

	it("keeps only the newest snapshots", async () => {
		const deps = fakeDeps(healthyNet());
		await registerVerified(deps, DOMAIN);
		for (let day = 0; day < 4; day++) {
			deps.clock = new Date(Date.UTC(2026, 10, 18 + day));
			await call(deps, "POST", `/domains/${DOMAIN}/scan`, { env: { SNAPSHOTS_TO_KEEP: "2" } });
		}

		const { results } = await env.DB.prepare(
			"SELECT taken_at FROM snapshots ORDER BY taken_at",
		).all();
		expect(results.map((row) => row.taken_at)).toEqual([
			"2026-11-20T00:00:00.000Z",
			"2026-11-21T00:00:00.000Z",
		]);
	});

	it("keeps each domain on a steady step, however long its scan takes", async () => {
		const deps = fakeDeps(healthyNet(), "2026-11-17T11:55:00.000Z");
		await registerVerified(deps, DOMAIN);
		// Each request takes two seconds on the fake clock, so a scan ends well after its tick.
		deps.latencyMs = 2_000;

		const scannedAt: string[] = [];
		for (
			let tick = Date.parse("2026-11-17T12:00:00Z");
			tick <= Date.parse("2026-11-19T12:00:00Z");
			tick += 600_000
		) {
			deps.clock = new Date(tick);
			if (await runDueScan(appEnv(), deps)) scannedAt.push(new Date(tick).toISOString());
		}

		expect(scannedAt).toEqual([
			"2026-11-17T12:00:00.000Z",
			"2026-11-18T12:00:00.000Z",
			"2026-11-19T12:00:00.000Z",
		]);
	});

	it("retries a failed scan within hours, alerts once it keeps failing, and says when it recovers", async () => {
		const deps = fakeDeps(healthyNet(), "2026-11-17T12:00:00.000Z");
		await registerVerified(deps, DOMAIN);
		expect((await runDueScan(appEnv(), deps))?.status).toBe("ok");
		deps.alerts.length = 0;

		// From the next day DNS cannot be reached, so the ownership check cannot run.
		deps.net.dnsDown = [`_porchlight-challenge.${DOMAIN}`];
		const attempts: string[] = [];
		const tick = async (at: number) => {
			deps.clock = new Date(at);
			const outcome = await runDueScan(appEnv(), deps);
			if (outcome) attempts.push(`${new Date(at).toISOString().slice(11, 16)} ${outcome.status}`);
		};
		const start = Date.parse("2026-11-18T12:00:00Z");
		for (let at = start; at < start + 5.5 * 3_600_000; at += 600_000) await tick(at);

		expect(attempts).toEqual(["12:00 error", "13:00 error", "15:00 error", "17:00 error"]);
		expect(deps.alerts).toHaveLength(1);
		expect(deps.alerts[0]!.text).toContain(`3 scans of ${DOMAIN} in a row have failed`);
		const listed = (await call(deps, "GET", "/domains")).body.domains[0];
		expect(listed).toMatchObject({ lastScanStatus: "error", errorStreak: 4 });

		deps.net.dnsDown = [];
		for (let at = start + 5.5 * 3_600_000; at < start + 8 * 3_600_000; at += 600_000)
			await tick(at);

		expect(attempts.at(-1)).toBe("19:00 ok");
		expect(deps.alerts).toHaveLength(2);
		expect(deps.alerts[1]!.text).toContain(`scans of ${DOMAIN} are working again`);
		expect((await call(deps, "GET", "/domains")).body.domains[0]).toMatchObject({
			lastScanStatus: "ok",
			errorStreak: 0,
		});
	});

	it("runs one scan of a domain at a time, so a change is alerted once", async () => {
		const deps = fakeDeps(healthyNet());
		await registerVerified(deps, DOMAIN);
		const domain = (await getDomain(env.DB, DOMAIN))!;

		const outcomes = await Promise.all([
			runScan(appEnv(), domain, deps),
			runScan(appEnv(), domain, deps),
		]);

		expect(outcomes.map((outcome) => outcome.status).sort()).toEqual(["busy", "ok"]);
		expect(deps.alerts).toHaveLength(1);
		// The claim is released afterwards, so the next scan runs.
		deps.clock = new Date("2026-11-18T12:00:00Z");
		expect((await runScan(appEnv(), domain, deps)).status).toBe("ok");
	});

	it("asks the certificate log for each certificate once", async () => {
		const deps = fakeDeps(healthyNet());
		await registerVerified(deps, DOMAIN);
		await scan(deps);
		const ctQueries = deps.requests.filter((url) => url.startsWith("https://crt.sh/"));
		expect(ctQueries).toHaveLength(2);
		for (const url of ctQueries) expect(new URL(url).searchParams.get("deduplicate")).toBe("Y");
	});
});
