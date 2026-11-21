import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { isWithin } from "../src/domain.ts";
import { settingsFrom } from "../src/env.ts";
import { challengeName } from "../src/ownership.ts";
import { runDueScan } from "../src/scan.ts";
import { collectSnapshot } from "../src/snapshot.ts";
import { getDomain } from "../src/store.ts";
import { fakeDeps, type FakeDeps, type FakeNet } from "./fake-net.ts";
import {
	appEnv,
	call,
	HARDENED_HEADERS,
	registerVerified,
	resetDb,
	VALID_CERT,
} from "./helpers.ts";

// Work on a domain waits on the network, and the owner can remove or verify it meanwhile. Every
// write made after such a wait must land on the domain it was about, or on nothing.

const ALPHA = "alpha.test";
const BRAVO = "bravo.test";

/** Each domain's apex, www and one more name, all answering. */
function siteNet(...domains: string[]): FakeNet {
	const names = (domain: string) => [domain, `www.${domain}`, `secret.${domain}`];
	const all = domains.flatMap(names);
	return {
		hosts: Object.fromEntries(all.map((name) => [name, { a: ["203.0.113.10"] }])),
		txt: Object.fromEntries(domains.map((domain) => [domain, ["v=spf1 -all"]])),
		apex: { CAA: ['0 issue "letsencrypt.org"'], NS: ["ns1.dns.example."] },
		ct: domains.map((domain) => ({ names: names(domain), ...VALID_CERT })),
		https: Object.fromEntries(all.map((name) => [name, { headers: HARDENED_HEADERS }])),
	};
}

/** Both sites on one network, so a request about either would be answered. */
const bothNet = () => siteNet(ALPHA, BRAVO);

/**
 * Runs `meanwhile` once, at the first request that `when` matches: before it is answered, or
 * (`after`) once it has been, as if the owner acted while the request was in flight.
 */
function during(
	deps: FakeDeps,
	when: (url: URL) => boolean,
	meanwhile: () => Promise<void>,
	{ after = false } = {},
): void {
	const inner = deps.fetch;
	let fired = false;
	deps.fetch = async (input, init) => {
		if (fired || !when(new URL(input))) return inner(input, init);
		fired = true;
		if (!after) await meanwhile();
		const response = await inner(input, init);
		if (after) await meanwhile();
		return response;
	};
}

const isLookupOf = (name: string) => (url: URL) =>
	url.hostname === "cloudflare-dns.com" && url.searchParams.get("name") === name;

async function idOf(name: string): Promise<number> {
	return (await getDomain(env.DB, name))!.id;
}

async function snapshotCount(): Promise<number> {
	const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM snapshots").first<{ n: number }>();
	return row!.n;
}

/** Puts `name` back in the table under `id`, with a new token, as SQLite could before AUTOINCREMENT. */
async function addWithId(id: number, name: string): Promise<void> {
	await env.DB.prepare(
		"INSERT INTO domains (id, name, challenge_token, created_at) VALUES (?, ?, ?, ?)",
	)
		.bind(id, name, "0f".repeat(24), "2026-11-17T12:00:00.000Z")
		.run();
}

/** Publishes the domain's own challenge record on the fake network. */
async function publishChallenge(deps: FakeDeps, name: string): Promise<void> {
	const shown = await call(deps, "GET", `/domains/${name}`);
	const { name: record, value } = shown.body.domain.challenge;
	deps.net.txt = { ...deps.net.txt, [record]: [value] };
}

const requestsAbout = (deps: FakeDeps, domain: string) =>
	deps.requests.filter((url) => url.includes(domain));

beforeEach(resetDb);

describe("a domain removed while it is scanned", () => {
	it("passes neither its scan nor a verified mark to the domain added next, nor its hosts", async () => {
		const deps = fakeDeps(siteNet(ALPHA));
		await registerVerified(deps, ALPHA);
		const alphaId = await idOf(ALPHA);
		during(
			deps,
			(url) => url.hostname === "crt.sh",
			async () => {
				expect((await call(deps, "DELETE", `/domains/${ALPHA}`)).status).toBe(200);
				expect((await call(deps, "POST", "/domains", { body: { domain: BRAVO } })).status).toBe(
					201,
				);
			},
		);

		expect((await call(deps, "POST", `/domains/${ALPHA}/scan`)).status).toBe(404);

		// The removed domain's id is not handed on.
		expect(await idOf(BRAVO)).toBeGreaterThan(alphaId);
		const bravo = await call(deps, "GET", `/domains/${BRAVO}`);
		expect(bravo.body.domain).toMatchObject({
			verified: false,
			verifiedAt: null,
			lastScanAt: null,
			lastScanStatus: null,
			openFindings: null,
		});
		expect(bravo.body.report).toBeNull();
		expect(await snapshotCount()).toBe(0);
		expect(deps.alerts).toEqual([]);

		// Once bravo is proven, its scans ask about bravo's names alone.
		deps.net = bothNet();
		await publishChallenge(deps, BRAVO);
		expect((await call(deps, "POST", `/domains/${BRAVO}/verify`)).status).toBe(200);
		deps.requests.length = 0;
		expect((await call(deps, "POST", `/domains/${BRAVO}/scan`)).status).toBe(200);
		expect(requestsAbout(deps, ALPHA)).toEqual([]);
	});

	it("writes nothing to a domain that holds its id again, even under the same name", async () => {
		const deps = fakeDeps(siteNet(ALPHA));
		await registerVerified(deps, ALPHA);
		const alphaId = await idOf(ALPHA);
		// The same name added again under the same id, as SQLite could before AUTOINCREMENT, with a
		// token that has never been published.
		during(
			deps,
			(url) => url.hostname === "crt.sh",
			async () => {
				await call(deps, "DELETE", `/domains/${ALPHA}`);
				await addWithId(alphaId, ALPHA);
			},
		);

		expect((await call(deps, "POST", `/domains/${ALPHA}/scan`)).status).toBe(404);

		const row = (await getDomain(env.DB, ALPHA))!;
		expect(row).toMatchObject({
			id: alphaId,
			verified_at: null,
			last_scan_at: null,
			last_scan_status: null,
			error_streak: 0,
			scan_claimed_at: null,
		});
		expect(await snapshotCount()).toBe(0);
		expect(deps.alerts).toEqual([]);
	});

	it("never carries a host from another domain's snapshot, or a name outside the domain", async () => {
		const deps = fakeDeps(bothNet());
		const settings = settingsFrom(appEnv());
		const alphaSnapshot = await collectSnapshot(ALPHA, null, settings, deps);
		expect(Object.keys(alphaSnapshot.hosts)).toContain(`secret.${ALPHA}`);
		// While the certificate log is down, the inventory is what the previous scan carried.
		deps.net.ct = "down";

		deps.requests.length = 0;
		const fromOther = await collectSnapshot(BRAVO, alphaSnapshot, settings, deps);
		expect(requestsAbout(deps, ALPHA)).toEqual([]);
		expect(Object.keys(fromOther.hosts)).toEqual([BRAVO]);

		// A snapshot of bravo that lists alpha's names, as one saved before this fix could.
		const mixed = {
			...alphaSnapshot,
			domain: BRAVO,
			gone: { [`old.${ALPHA}`]: "2026-11-16T12:00:00.000Z" },
		};
		deps.requests.length = 0;
		const fromMixed = await collectSnapshot(BRAVO, mixed, settings, deps);
		expect(requestsAbout(deps, ALPHA)).toEqual([]);
		const kept = [...Object.keys(fromMixed.hosts), ...Object.keys(fromMixed.gone ?? {})];
		expect(kept.every((host) => isWithin(host, BRAVO))).toBe(true);
	});

	it("scans afresh a domain whose stored scan is of another domain", async () => {
		const deps = fakeDeps(bothNet());
		await registerVerified(deps, BRAVO);
		const settings = settingsFrom(appEnv());
		const alphaSnapshot = await collectSnapshot(ALPHA, null, settings, deps);
		// What a scan saved under a reused id before this fix left behind.
		await env.DB.prepare(
			"INSERT INTO snapshots (domain_id, taken_at, data, report) VALUES (?, ?, ?, ?)",
		)
			.bind(
				await idOf(BRAVO),
				alphaSnapshot.takenAt,
				JSON.stringify(alphaSnapshot),
				JSON.stringify({ domain: ALPHA, findings: [] }),
			)
			.run();
		deps.net.ct = "down";
		deps.clock = new Date("2026-11-18T12:00:00Z");
		deps.requests.length = 0;

		const scanned = await call(deps, "POST", `/domains/${BRAVO}/scan`);

		expect(scanned.status).toBe(200);
		expect(scanned.body.report).toMatchObject({ domain: BRAVO, baseline: true });
		expect(requestsAbout(deps, ALPHA)).toEqual([]);
	});
});

describe("a domain removed while it is verified", () => {
	it("answers 404, and marks neither it nor the domain added next as verified", async () => {
		const deps = fakeDeps(siteNet(ALPHA));
		await call(deps, "POST", "/domains", { body: { domain: ALPHA } });
		await publishChallenge(deps, ALPHA);
		during(deps, isLookupOf(challengeName(ALPHA)), async () => {
			await call(deps, "DELETE", `/domains/${ALPHA}`);
			await call(deps, "POST", "/domains", { body: { domain: BRAVO } });
		});

		const verified = await call(deps, "POST", `/domains/${ALPHA}/verify`);

		expect(verified.status).toBe(404);
		expect((await call(deps, "GET", `/domains/${BRAVO}`)).body.domain).toMatchObject({
			verified: false,
			verifiedAt: null,
		});
	});

	it("answers 404 rather than failing when nothing was added", async () => {
		const deps = fakeDeps(siteNet(ALPHA));
		await call(deps, "POST", "/domains", { body: { domain: ALPHA } });
		await publishChallenge(deps, ALPHA);
		during(deps, isLookupOf(challengeName(ALPHA)), async () => {
			await call(deps, "DELETE", `/domains/${ALPHA}`);
		});

		const verified = await call(deps, "POST", `/domains/${ALPHA}/verify`);

		expect(verified.status).toBe(404);
		expect(verified.body.error).toContain("not registered");
	});

	it("does not verify the same name added again under the same id with a new token", async () => {
		const deps = fakeDeps(siteNet(ALPHA));
		await call(deps, "POST", "/domains", { body: { domain: ALPHA } });
		await publishChallenge(deps, ALPHA);
		const alphaId = await idOf(ALPHA);
		during(deps, isLookupOf(challengeName(ALPHA)), async () => {
			await call(deps, "DELETE", `/domains/${ALPHA}`);
			await addWithId(alphaId, ALPHA);
		});

		expect((await call(deps, "POST", `/domains/${ALPHA}/verify`)).status).toBe(404);
		expect((await getDomain(env.DB, ALPHA))!.verified_at).toBeNull();
	});
});

describe("ownership changes only on an observed answer", () => {
	it("keeps a verify that passes while a scan finds the record missing, without an alert", async () => {
		const deps = fakeDeps(siteNet(ALPHA));
		await registerVerified(deps, ALPHA);
		expect((await runDueScan(appEnv(), deps))?.status).toBe("ok");
		deps.alerts.length = 0;
		const record = challengeName(ALPHA);
		const published = deps.net.txt![record]!;
		delete deps.net.txt![record];
		deps.clock = new Date(deps.clock.getTime() + 25 * 3_600_000);
		// The scan has just found no record under either label when the owner publishes it again
		// and verifies, a minute later.
		during(
			deps,
			isLookupOf(`_securityx-challenge.${ALPHA}`),
			async () => {
				deps.net.txt![record] = published;
				deps.clock = new Date(deps.clock.getTime() + 60_000);
				expect((await call(deps, "POST", `/domains/${ALPHA}/verify`)).status).toBe(200);
			},
			{ after: true },
		);

		expect((await runDueScan(appEnv(), deps))?.status).toBe("unverified");

		expect((await call(deps, "GET", `/domains/${ALPHA}`)).body.domain).toMatchObject({
			verified: true,
			lastScanStatus: "ok",
		});
		expect(deps.alerts).toEqual([]);
		// Not paused for a day: the record is there, so the next tick scans it.
		deps.clock = new Date(deps.clock.getTime() + 10 * 60_000);
		expect((await runDueScan(appEnv(), deps))?.status).toBe("ok");
	});

	it("keeps a lapsed domain unverified through DNS failures, and alerts once for the lapse", async () => {
		const deps = fakeDeps(siteNet(ALPHA));
		await registerVerified(deps, ALPHA);
		expect((await runDueScan(appEnv(), deps))?.status).toBe("ok");
		deps.alerts.length = 0;
		const record = challengeName(ALPHA);
		delete deps.net.txt![record];
		const tick = async (hours: number) => {
			deps.clock = new Date(deps.clock.getTime() + hours * 3_600_000);
			return (await runDueScan(appEnv(), deps))?.status ?? "nothing due";
		};
		const shown = async () => (await call(deps, "GET", `/domains/${ALPHA}`)).body.domain;

		expect(await tick(25)).toBe("unverified");
		expect(await shown()).toMatchObject({ verified: false, lastScanStatus: "unverified" });

		for (let outage = 0; outage < 2; outage++) {
			deps.net.dnsDown = [record, `_securityx-challenge.${ALPHA}`];
			expect(await tick(25)).toBe("error");
			// Nothing was observed, so nothing changes but when it is next tried.
			expect(await shown()).toMatchObject({
				verified: false,
				lastScanStatus: "unverified",
				lastScanAt: deps.clock.toISOString(),
				errorStreak: 0,
			});
			deps.net.dnsDown = [];
			expect(await tick(1.1)).toBe("nothing due");
			// DNS answers again, and the record is still missing: the same lapse.
			expect(await tick(25)).toBe("unverified");
		}

		expect(deps.alerts).toHaveLength(1);
		expect(deps.alerts[0]!.text).toContain("ownership check failed");
	});
});
