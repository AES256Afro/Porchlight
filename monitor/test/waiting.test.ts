// Hosts waiting their turn: probed on idle ticks (OP-11), and kept small (OP-12, MON-B8).
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { settingsFrom } from "../src/env.ts";
import { runDueScan } from "../src/scan.ts";
import { collectSnapshot, MAX_KNOWN_HOSTS } from "../src/snapshot.ts";
import { decodeSnapshot, encodeSnapshot } from "../src/store.ts";
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
const DAY_MS = 24 * 3_600_000;
const TICK_MS = 600_000;

/** A domain whose certificate log lists `count` live subdomains besides the apex and www. */
function bigNet(count: number): { net: FakeNet; extras: string[] } {
	const extras = Array.from(
		{ length: count },
		(_, i) => `host-${String(i).padStart(3, "0")}.${DOMAIN}`,
	);
	const net: FakeNet = {
		hosts: { [DOMAIN]: { a: ["203.0.113.10"] }, [`www.${DOMAIN}`]: { a: ["203.0.113.10"] } },
		txt: { [DOMAIN]: ["v=spf1 -all"] },
		apex: {
			CAA: ['0 issue "letsencrypt.org"'],
			NS: ["ns1.dns.example."],
			MX: ["10 mail.example.test."],
		},
		ct: [{ names: [DOMAIN, `www.${DOMAIN}`, ...extras], ...VALID_CERT }],
		https: {
			[DOMAIN]: { headers: HARDENED_HEADERS },
			[`www.${DOMAIN}`]: { headers: HARDENED_HEADERS },
		},
	};
	for (const host of extras) {
		net.hosts![host] = { a: ["203.0.113.20"] };
		net.https![host] = { headers: HARDENED_HEADERS };
	}
	return { net, extras };
}

beforeEach(resetDb);

describe("idle ticks probe hosts waiting their turn (OP-11)", () => {
	it("probes every one of 200 names within a day of each scan, one GET each, after checking ownership each time", async () => {
		const { net, extras } = bigNet(198);
		const deps = fakeDeps(net, "2026-11-17T12:00:00.000Z");
		await registerVerified(deps, DOMAIN);

		// When each host's page was asked for, over two days of ticks.
		const fetched = new Map<string, number[]>();
		const outcomes: string[] = [];
		const start = deps.clock.getTime();
		for (let at = start; at < start + 2 * DAY_MS; at += TICK_MS) {
			deps.clock = new Date(at);
			deps.requests.length = 0;
			const outcome = await runDueScan(appEnv(), deps);
			if (outcome) outcomes.push(outcome.status);
			const asked = deps.requests.filter((url) => !url.includes("hooks."));
			if (asked.length > 0) {
				// The ownership gate: every tick that asks anything about the domain asks for its record first.
				expect(asked[0]).toContain(`_porchlight-challenge.${DOMAIN}`);
				// The request budget of a scan holds for a pass too.
				expect(asked.length).toBeLessThanOrEqual(47);
			}
			for (const url of asked) {
				const { hostname, pathname } = new URL(url);
				if (hostname !== "cloudflare-dns.com" && hostname !== "crt.sh") {
					expect(pathname).toBe("/");
					fetched.set(hostname, [...(fetched.get(hostname) ?? []), at]);
				}
			}
		}

		expect(outcomes.filter((status) => status === "ok")).toHaveLength(2);
		// 200 names, 12 a scan and 12 a pass: 16 passes after each scan.
		expect(outcomes.filter((status) => status === "continued")).toHaveLength(2 * 16);
		for (const host of [DOMAIN, `www.${DOMAIN}`, ...extras]) {
			const times = fetched.get(host) ?? [];
			// Once in each day: never more than one GET a day, and never more than a day waiting.
			expect(times, host).toHaveLength(2);
			expect(times[1]! - times[0]!, host).toBeLessThanOrEqual(DAY_MS + 4 * 3_600_000);
		}
		// Nothing about these healthy hosts was reported as a change.
		const latest = (await call(deps, "GET", `/domains/${DOMAIN}`)).body;
		expect(latest.report.changes).toEqual([]);
		expect(latest.report.notes).toEqual([]);
	});

	it("probes nothing when the ownership record has gone, and the domain is recorded as unverified", async () => {
		const { net } = bigNet(30);
		const deps = fakeDeps(net, "2026-11-17T12:00:00.000Z");
		await registerVerified(deps, DOMAIN);
		expect((await runDueScan(appEnv(), deps))?.status).toBe("ok");

		deps.net.txt = { [DOMAIN]: ["v=spf1 -all"] };
		deps.requests.length = 0;
		deps.alerts.length = 0;
		deps.clock = new Date(deps.clock.getTime() + TICK_MS);
		await runDueScan(appEnv(), deps);

		const beyondTheGate = deps.requests.filter(
			(url) => !/_(porchlight|securityx)-challenge\./.test(url) && !url.includes("hooks."),
		);
		expect(beyondTheGate).toEqual([]);
		expect(deps.alerts.map((alert) => alert.text).join("\n")).toContain("ownership check failed");
		expect((await call(deps, "GET", `/domains/${DOMAIN}`)).body.domain.verified).toBe(false);
		// And no idle tick asks again until it is verified.
		deps.requests.length = 0;
		deps.clock = new Date(deps.clock.getTime() + TICK_MS);
		expect(await runDueScan(appEnv(), deps)).toBeNull();
		expect(deps.requests).toEqual([]);
	});

	it("alerts what a pass finds, and keeps the scan's own changes beside it", async () => {
		const { net, extras } = bigNet(20);
		const deps = fakeDeps(net, "2026-11-17T12:00:00.000Z");
		await registerVerified(deps, DOMAIN);
		expect((await runDueScan(appEnv(), deps))?.status).toBe("ok");
		const waiting = extras.at(-1)!;
		// A name waiting its turn has an alias that leads nowhere: a takeover risk.
		deps.net.hosts![waiting] = { cname: ["gone.cloud.example"] };
		deps.alerts.length = 0;
		for (let i = 0; i < 2; i++) {
			deps.clock = new Date(deps.clock.getTime() + TICK_MS);
			await runDueScan(appEnv(), deps);
		}
		expect(
			deps.alerts.some((alert) => alert.text.includes(`dangling`) || alert.text.includes(waiting)),
		).toBe(true);
		const latest = (await call(deps, "GET", `/domains/${DOMAIN}`)).body;
		expect(latest.report.findings.map((finding: { id: string }) => finding.id)).toContain(
			`dangling-cname:${waiting}`,
		);
	});
});

describe("the snapshot's row stays inside D1's limit (OP-12, MON-B8)", () => {
	it("keeps an inventory from 15,000 names in the certificate log under 1.9 MB, and says how many were left out", async () => {
		const { net } = bigNet(0);
		const names = Array.from(
			{ length: 15_000 },
			(_, i) => `service-${i}.region-${i % 50}.${DOMAIN}`,
		);
		net.ct = [{ names: [DOMAIN, `www.${DOMAIN}`, ...names], ...VALID_CERT }];
		for (const name of names) net.hosts![name] = { a: ["203.0.113.30"] };
		const deps = fakeDeps(net);

		const snapshot = await collectSnapshot(DOMAIN, null, settingsFrom(appEnv()), deps);
		const stored = encodeSnapshot(snapshot);

		const kept = Object.keys(snapshot.hosts).length;
		expect(kept).toBeLessThanOrEqual(MAX_KNOWN_HOSTS);
		expect(kept).toBeGreaterThan(10_000);
		expect(snapshot.leftOut).toBe(15_002 - kept);
		expect(stored.length).toBeLessThan(1_900_000);
		expect(decodeSnapshot(stored)).toEqual(snapshot);

		// Saved through a scan, with its report, the row is under D1's limit too.
		await registerVerified(deps, DOMAIN);
		const scanned = await call(deps, "POST", `/domains/${DOMAIN}/scan`);
		expect(scanned.status).toBe(200);
		expect(scanned.body.report.notes.join(" ")).toContain(
			`${(15_002 - kept).toLocaleString("en")} more names`,
		);
		const row = await env.DB.prepare(
			"SELECT length(data) + length(report) AS size FROM snapshots",
		).first<{ size: number }>();
		expect(row!.size).toBeLessThan(1_900_000);

		// The names kept are the same each scan, so none comes and goes as a change.
		deps.clock = new Date(deps.clock.getTime() + DAY_MS);
		const again = await call(deps, "POST", `/domains/${DOMAIN}/scan`);
		expect(again.body.report.changes).toEqual([]);
	});

	it("reads a snapshot stored before waiting hosts were kept short", () => {
		const old = {
			version: 1,
			domain: DOMAIN,
			takenAt: "2026-11-01T00:00:00.000Z",
			ctOk: true,
			apex: {},
			hosts: {
				[`a.${DOMAIN}`]: {
					probed: false,
					dns: null,
					cert: VALID_CERT,
					http: null,
					checkedAt: "2026-10-31T00:00:00.000Z",
				},
			},
		};
		expect(decodeSnapshot(JSON.stringify(old))).toEqual(old);
		expect(decodeSnapshot(encodeSnapshot(old as never))).toEqual(old);
	});
});

describe("a pass's own hosts are kept short too", () => {
	it("stores what passes probed as waiting hosts with their check time, so the row does not grow as names are reached", async () => {
		const { net } = bigNet(400);
		const deps = fakeDeps(net, "2026-11-17T12:00:00.000Z");
		await registerVerified(deps, DOMAIN);
		const sizes: number[] = [];
		for (let i = 0; i < 40; i++) {
			await runDueScan(appEnv(), deps);
			const row = await env.DB.prepare(
				"SELECT length(data) AS size FROM snapshots ORDER BY id DESC LIMIT 1",
			).first<{ size: number }>();
			sizes.push(row!.size);
			deps.clock = new Date(deps.clock.getTime() + TICK_MS);
		}
		// A name a pass reached gains its check time (about 26 bytes) and nothing of what was seen.
		expect(Math.max(...sizes) - sizes[0]!).toBeLessThan(400 * 32);
	});
});
