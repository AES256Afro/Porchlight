// The page-side leftovers of M11 to M18: the domain inventory route and view (R6F-5), the age of OSV's
// databases, exporting notes that match nothing, "Check it now" (FT-11) and the doctor's line about
// moving computers. Tests never touch the network: the monitor is a fake `fetch`.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, test, type TestContext } from "node:test";
import { runDoctor } from "../src/doctor.ts";
import { monitorConfig } from "../src/monitor/client.ts";
import { orphanNotesCsv } from "../src/ui/routes/orphan-notes.ts";
import { hostsFromMonitor } from "../src/ui/routes/hosts.ts";
import { startUiServer, type UiOptions, type UiServer } from "../src/ui/server.ts";
import { osvAgeWords } from "../ui/hints.js";
import { checkWords } from "../ui/tracking.js";
import { fakeFetch, fakeRunner, tempDir } from "./helpers.ts";

const ADMIN_TOKEN = "admin-token-that-must-never-reach-the-browser";

async function start(t: TestContext, overrides: Partial<UiOptions> = {}): Promise<UiServer & { dir: string }> {
	const dir = await tempDir();
	const server = await startUiServer({ port: 0, reportPath: join(dir, "state", "repo-scan.json"), defaultRoot: dir, monitor: null, monitorError: "Set PORCHLIGHT_MONITOR_URL", ...overrides });
	t.after(() => server.close());
	return Object.assign(server, { dir });
}

async function get(server: UiServer, path: string): Promise<{ status: number; headers: Headers; text: string; json: any }> {
	const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { headers: { "x-porchlight-session": server.sessionKey } });
	const text = await response.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = undefined;
	}
	return { status: response.status, headers: response.headers, text, json };
}

const monitor = monitorConfig({ PORCHLIGHT_MONITOR_URL: "https://monitor.example", PORCHLIGHT_ADMIN_TOKEN: ADMIN_TOKEN });

const inventory = {
	domain: "example.test",
	takenAt: "2026-11-20T09:00:00Z",
	total: 2,
	page: 2,
	pageSize: 200,
	hosts: [
		{ name: "www.example.test", probed: true, checkedAt: "2026-11-20T09:00:00Z", dns: { a: ["203.0.113.10"], aaaa: [], cname: [] }, cert: { notBefore: "2026-10-01", notAfter: "2026-12-30" }, https: { ok: true, status: 200 }, findings: 1, extra: "dropped" },
		{ name: "old.example.test", probed: false, checkedAt: null, dns: null, cert: null, https: null, findings: 0 },
	],
	gone: [{ name: "gone.example.test", since: "2026-11-01T00:00:00Z" }],
	secret: "not for the page",
};

describe("a domain's inventory on the page (R6F-5)", () => {
	test("asks the monitor for the page named, with the token as a header only, and passes on only what the page shows", async (t) => {
		const fetchFn = fakeFetch(() => Response.json(inventory));
		const server = await start(t, { monitor, fetchFn });
		const reply = await get(server, "/api/domains/Example.TEST/hosts?page=2");
		assert.equal(reply.status, 200);
		assert.deepEqual(
			fetchFn.calls.map((call) => call.url),
			["https://monitor.example/domains/example.test/hosts?page=2"],
		);
		assert.equal((fetchFn.calls[0]!.init.headers as Record<string, string>).authorization, `Bearer ${ADMIN_TOKEN}`);
		assert.ok(!reply.text.includes(ADMIN_TOKEN), "the token never reaches the page");
		assert.ok(!reply.text.includes("not for the page") && !reply.text.includes("dropped"), "fields the page does not show are left out");
		assert.equal(reply.json.hosts.hosts[0].https.status, 200);
		// Not observed stays not observed (invariant 5).
		assert.deepEqual(reply.json.hosts.hosts[1], { name: "old.example.test", probed: false, checkedAt: null, dns: null, cert: null, https: null, findings: 0 });
	});

	test("refuses a page or a name it was not meant to take, and says what the monitor said", async (t) => {
		const fetchFn = fakeFetch(() => Response.json({ error: "example.test has not been scanned yet" }, { status: 404 }));
		const server = await start(t, { monitor, fetchFn });
		for (const page of ["0", "abc", "1e3", "61", "-1"]) assert.equal((await get(server, `/api/domains/example.test/hosts?page=${page}`)).status, 400, page);
		assert.equal((await get(server, "/api/domains/bad_name!/hosts")).status, 400);
		assert.equal(fetchFn.calls.length, 0, "nothing refused reached the monitor");
		const missing = await get(server, "/api/domains/example.test/hosts");
		assert.deepEqual([missing.status, missing.json.error], [404, "example.test has not been scanned yet"]);
		assert.equal(fetchFn.calls[0]!.url, "https://monitor.example/domains/example.test/hosts");
	});

	test("without a monitor it answers 503, and an answer that is not an inventory is not one", async (t) => {
		const server = await start(t);
		assert.equal((await get(server, "/api/domains/example.test/hosts")).status, 503);
		assert.equal(hostsFromMonitor({ domain: "example.test", hosts: "no" }), null);
		assert.deepEqual(hostsFromMonitor({ ...inventory, hosts: [{ name: 5 }, { name: "a.example.test", https: { ok: true } }] })?.hosts, [
			{ name: "a.example.test", probed: false, checkedAt: null, dns: null, cert: null, https: { ok: false, error: "failed" }, findings: 0 },
		]);
	});

	test("the view's words never say none for what was not looked at", async () => {
		// By address, so the type check of the tests does not take in the page's DOM code.
		type HostView = import("../../monitor/src/types.ts").HostView;
		const { dnsWords, httpsWords, hostsWindow } = (await import(new URL("../ui/domain-hosts.js", import.meta.url).href)) as {
			dnsWords: (host: HostView) => string[];
			httpsWords: (host: HostView) => string;
			hostsWindow: (page: number, size: number) => { monitorPage: number; offset: number; rows: number };
		};
		const [seen, waiting] = inventory.hosts as HostView[];
		assert.deepEqual(dnsWords(seen!), ["203.0.113.10"]);
		assert.deepEqual(dnsWords(waiting!), ["Not checked this time"]);
		assert.deepEqual(dnsWords({ ...waiting!, probed: true }), ["Lookup failed"]);
		assert.deepEqual(dnsWords({ ...seen!, dns: { a: [], aaaa: [], cname: [] } }), ["No records"]);
		assert.equal(httpsWords(seen!), "HTTP 200");
		assert.equal(httpsWords(waiting!), "Not checked this time");
		// Rows 201 to 225 are the second of the monitor's pages of 200.
		assert.deepEqual(hostsWindow(9, 200), { monitorPage: 2, offset: 0, rows: 25 });
		assert.deepEqual(hostsWindow(1, 200), { monitorPage: 1, offset: 0, rows: 25 });
	});
});

describe("the age of OSV's databases where the scan form shows the scanners", () => {
	test("is said only where they are kept here, and an old or missing copy is said as such", async (t) => {
		const server = await start(t);
		assert.deepEqual((await get(server, "/api/repos/osv-database")).json, { offline: false, refreshedAt: null });
		const kept = await start(t, { osvOffline: true });
		assert.deepEqual((await get(kept, "/api/repos/osv-database")).json, { offline: true, refreshedAt: null });

		const when = (iso: string) => iso.slice(0, 10);
		const now = new Date("2026-11-21T12:00:00Z");
		assert.equal(osvAgeWords({ offline: false, refreshedAt: null }, when, now), null);
		assert.equal(osvAgeWords({ offline: true, refreshedAt: null }, when, now)?.old, true);
		assert.deepEqual(osvAgeWords({ offline: true, refreshedAt: "2026-11-21T08:00:00Z" }, when, now), { old: false, words: "OSV's databases were brought up to date 2026-11-21." });
		assert.match(osvAgeWords({ offline: true, refreshedAt: "2026-11-18T08:00:00Z" }, when, now)?.words ?? "", /are 3 days old/);
		assert.equal(osvAgeWords({ offline: true, refreshedAt: "2027-01-01T00:00:00Z" }, when, now)?.old, true);
	});
});

describe("exporting notes that match no finding", () => {
	test("is a CSV under a fixed name, every cell escaped against formulas (invariant 11)", async (t) => {
		const server = await start(t);
		const state = join(server.dir, "state");
		await mkdir(state, { recursive: true });
		const key = ["gone-repo", "aws-access-token", "config.js:3", "abc123"].join("\n");
		await writeFile(join(state, "finding-notes.json"), JSON.stringify({ [key]: { status: "accepted", note: '=HYPERLINK("http://x")', updatedAt: "2026-11-01T00:00:00Z", until: "2027-01-31" } }), { mode: 0o600 });
		const reply = await get(server, "/api/findings/orphans/export");
		assert.equal(reply.status, 200);
		assert.match(reply.headers.get("content-disposition") ?? "", /^attachment; filename="porchlight-unmatched-notes-\d{4}-\d{2}-\d{2}\.csv"$/);
		assert.equal(reply.text.split("\n")[1], `gone-repo,aws-access-token,config.js:3,abc123,Accepted risk,2027-01-31,"'=HYPERLINK(""http://x"")",2026-11-01T00:00:00Z`);
		assert.equal(orphanNotesCsv([]), "Repository,Rule or advisory,Location,Detail,Status,Accepted until,Note,Updated");
	});
});

describe('"Check it now" (FT-11)', () => {
	const keys = ["shop\na\nx\n1", "shop\nb\ny\n2"];
	test("gone is fixed, and still listed after a scan that could not look is never called found or fixed", () => {
		assert.deepEqual(checkWords(keys.slice(0, 1), new Set(), { repo: "shop", uncheckedCount: 0 }), { fixed: true, words: "Fixed: scanning shop again no longer finds it." });
		assert.equal(checkWords(keys, new Set(), { repo: "shop", uncheckedCount: 3 }).fixed, true);
		assert.deepEqual(checkWords(keys.slice(0, 1), new Set(keys), { repo: "shop", uncheckedCount: 0 }), { fixed: false, words: "Still found in shop: the repair has not cleared it yet." });
		assert.deepEqual(checkWords(keys, new Set(keys.slice(1)), { repo: "shop", uncheckedCount: 0 }), { fixed: false, words: "1 of these 2 findings still found in shop: the repair has not cleared them yet." });
		assert.deepEqual(checkWords(keys.slice(0, 1), new Set(keys), { repo: "shop", uncheckedCount: 2 }), { fixed: false, words: "Still listed in shop: 2 could not be checked again, so they stay as before." });
	});
});

describe("the doctor's line about moving computers (US-10, M15)", () => {
	test("names what the folder holds that a new computer needs, by looking at which files are there", async () => {
		const dir = await tempDir();
		await writeFile(join(dir, "finding-notes.json"), "{}");
		await mkdir(join(dir, "history"));
		const checks = await runDoctor({ run: fakeRunner({}), env: {}, dataDir: dir, nodeVersion: "24.0.0" });
		const moving = checks.find((check) => check.name === "Moving computers");
		assert.ok(moving);
		assert.match(moving.detail, /copy .* whole: it holds your statuses and notes, the scan history\./);
		assert.doesNotMatch(moving.detail, /Cloudflare token|model/);
		const empty = await runDoctor({ run: fakeRunner({}), env: {}, dataDir: await tempDir(), nodeVersion: "24.0.0" });
		assert.match(empty.find((check) => check.name === "Moving computers")?.detail ?? "", /Nothing kept yet/);
	});
});
