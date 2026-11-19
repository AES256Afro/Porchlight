import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { runDueScan } from "../src/scan.ts";
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
		expect(body.report.notes).toEqual(["3 known hosts were not probed because MAX_HOSTS is 3."]);
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
});
