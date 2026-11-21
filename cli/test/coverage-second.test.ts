// M18, second part: first-seen dates (R6Q-9), due dates (FT-14), the weekly digest (FT-13), the egress
// log (R6F-3), a model per task (R6F-10) and the menu-bar status (FT-15). No test touches the network.
import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { assistantConfig } from "../src/assist/ollama.ts";
import { EgressLog, loggedFetch, purposeOf } from "../src/egress.ts";
import { digestDue, digestNotice } from "../src/notify/digest.ts";
import { noticeRequest } from "../src/notify/format.ts";
import { datesFor, updateFirstSeen } from "../src/repos/first-seen.ts";
import { History } from "../src/repos/history.ts";
import type { Finding, ScanReport } from "../src/repos/types.ts";
import { startUiServer, type UiOptions, type UiServer } from "../src/ui/server.ts";
import { DEFAULT_DUE, duePolicyOf, dueState, dueWords } from "../ui/due.js";
import { findingKey } from "../ui/tracking.js";
import { tempDir } from "./helpers.ts";

const finding = (severity: Finding["severity"], ruleId: string, title = `A ${severity} problem`): Finding => ({
	tool: "osv-scanner",
	kind: "vulnerability",
	severity,
	ruleId,
	title,
	location: "package-lock.json",
	detail: "pkg@1.0.0",
});

function report(scannedAt: string, findings: Finding[], root = "/work"): ScanReport {
	return {
		root,
		scannedAt,
		tools: [
			{ tool: "gitleaks", status: "ok", installHint: "" },
			{ tool: "osv-scanner", status: "ok", installHint: "" },
		],
		repos: [{ path: `${root}/shop`, findings, errors: [] }],
	};
}

test("first seen is the earliest kept scan that held a finding, said as 'on or before' for the earliest scan, and kept across a gap (R6Q-9)", async () => {
	const dir = await tempDir();
	const history = new History(dir);
	const path = join(dir, "first-seen.json");
	const old = finding("high", "OLD");
	const later = finding("critical", "LATER");
	await history.add(report("2026-10-01T00:00:00.000Z", [old]));
	await history.add(report("2026-10-08T00:00:00.000Z", [old, later]));
	// A scan in which the finding is missing (a scanner failed, say) does not reset its date.
	await history.add(report("2026-10-15T00:00:00.000Z", [later]));
	const latest = report("2026-10-22T00:00:00.000Z", [old, later]);
	await history.add(latest);

	const file = await updateFirstSeen(path, history, latest);
	const dates = datesFor(file, latest);
	assert.deepEqual(dates[findingKey("shop", old)], { first: "2026-10-01T00:00:00.000Z", onOrBefore: true });
	assert.deepEqual(dates[findingKey("shop", later)], { first: "2026-10-08T00:00:00.000Z" });
	assert.equal((await stat(path)).mode & 0o777, 0o600);

	// A repository scanned again on its own: a finding new there is dated then, not at the report's time.
	const rescanned = report("2026-10-22T00:00:00.000Z", [old, later, finding("low", "NEWER")]);
	rescanned.repos[0]!.rescannedAt = "2026-10-25T00:00:00.000Z";
	const again = datesFor(await updateFirstSeen(path, history, rescanned), rescanned);
	assert.equal(again[findingKey("shop", finding("low", "NEWER"))]?.first, "2026-10-25T00:00:00.000Z");
	assert.equal(again[findingKey("shop", old)]?.first, "2026-10-01T00:00:00.000Z");

	// A file that cannot be read is never written over.
	await writeFile(path, "{ not json");
	await assert.rejects(updateFirstSeen(path, history, latest), /could not be read/);
	assert.equal(await readFile(path, "utf8"), "{ not json");
});

test("a due date counts from the first-seen day by severity, and only shows (FT-14)", () => {
	const now = new Date("2026-11-21T12:00:00Z");
	const overdue = dueState("2026-11-01T00:00:00Z", "critical", DEFAULT_DUE, now);
	assert.deepEqual(overdue, { due: "2026-11-08", daysLeft: -13, overdue: true });
	assert.equal(dueWords(overdue!), "Overdue by 13 days (due 2026-11-08)");
	assert.equal(dueWords(dueState("2026-11-20T00:00:00Z", "high", DEFAULT_DUE, now)!), "Due 2026-12-20, in 29 days");
	// No due date for low by default, and none without a first-seen date: nothing is guessed.
	assert.equal(dueState("2026-11-01T00:00:00Z", "low", DEFAULT_DUE, now), null);
	assert.equal(dueState(undefined, "critical", DEFAULT_DUE, now), null);
	assert.deepEqual(duePolicyOf({ critical: 3, high: null, medium: 60, low: 365 }), { critical: 3, high: null, medium: 60, low: 365 });
	assert.equal(duePolicyOf({ critical: 0 }), null);
	assert.equal(duePolicyOf({ critical: 2.5 }), null);
	assert.equal(duePolicyOf({ critical: "7" }), null);
});

test("the weekly digest holds counts, titles and places; overdue and ending risks are named, and its text stays text (FT-13)", () => {
	const now = new Date("2026-11-21T12:00:00Z");
	const hostile = finding("critical", "CVE-1", "<!channel> `` ``` @everyone [x](https://evil.example)");
	const latest = report("2026-11-20T00:00:00.000Z", [hostile, finding("medium", "M-1")]);
	const notes = { [findingKey("shop", finding("medium", "M-1"))]: { status: "accepted" as const, note: "", updatedAt: "", until: "2026-11-25" } };
	const notice = digestNotice({
		now,
		report: latest,
		history: [
			{ file: "a", scannedAt: "2026-11-10T00:00:00.000Z", root: "/work", repositories: 1, findings: 1, counts: { critical: 1, high: 0, medium: 0, low: 0 }, newCount: 5, fixedCount: 5 },
			{ file: "b", scannedAt: "2026-11-16T00:00:00.000Z", root: "/work", repositories: 1, findings: 2, counts: { critical: 1, high: 0, medium: 1, low: 0 }, newCount: 1, fixedCount: 0 },
			{ file: "c", scannedAt: "2026-11-20T00:00:00.000Z", root: "/work", repositories: 1, findings: 2, counts: { critical: 1, high: 0, medium: 1, low: 0 }, newCount: 0, fixedCount: 2 },
		],
		notes,
		seen: { [findingKey("shop", hostile)]: { first: "2026-11-01T00:00:00.000Z" } },
		policy: DEFAULT_DUE,
		host: { checkedAt: "2026-11-19T00:00:00.000Z", failed: 2, unknown: 1 },
	});
	assert.equal(notice.title, "Porchlight weekly digest: 1 new, 2 fixed, 2 findings in the latest scan");
	const text = notice.lines.join("\n");
	assert.match(text, /2 scans in the last 7 days: 1 new and 2 fixed\./);
	assert.match(text, /Overdue by your due dates: 1\n {2}\[critical\] shop: .*, 13 days overdue/);
	assert.match(text, /Accepted risks ending within 7 days: 1\n {2}shop: A medium problem \(package-lock\.json\), until 2026-11-25/);
	assert.match(text, /This computer, checked 2026-11-19: 2 problems, 1 could not be checked\./);
	assert.equal(notice.urgent, true);
	// Formatted by format.ts like every notice: Slack's markup and Discord's mentions are disarmed.
	const slack = JSON.parse(noticeRequest("slack", notice).body).text as string;
	assert.ok(!slack.includes("<!channel>"));
	const discord = JSON.parse(noticeRequest("discord", notice).body);
	assert.deepEqual(discord.allowed_mentions, { parse: [] });

	assert.equal(digestDue(null, now), true);
	assert.equal(digestDue("2026-11-18T00:00:00.000Z", now), false);
	assert.equal(digestDue("2026-11-14T12:00:00.000Z", now), true);
});

test("the egress log keeps the host and a purpose, never a path, a query or a body (R6F-3)", async () => {
	const log = new EgressLog(() => new Date("2026-11-21T00:00:00Z"));
	const token = ["xoxb", "secret", "path"].join("-");
	const fetchFn = loggedFetch((async (input: string | URL) => (String(input).includes("fail") ? Promise.reject(new Error("down")) : new Response("ok", { status: 201 }))) as unknown as typeof fetch, log, {
		monitor: () => "monitor.example.com",
	});
	await fetchFn(`https://hooks.slack.com/services/${token}?key=${token}`, { method: "POST", body: token });
	await fetchFn("https://monitor.example.com/domains", { headers: { authorization: `Bearer ${token}` } });
	await assert.rejects(fetchFn("https://fail.example.org/x"));
	const records = log.list();
	assert.deepEqual(
		records.map((record) => [record.method, record.host, record.purpose, record.status ?? "none"]),
		[
			["POST", "hooks.slack.com", "Notice", 201],
			["GET", "monitor.example.com", "Your monitor", 201],
			["GET", "fail.example.org", "Other", "none"],
		],
	);
	assert.ok(!JSON.stringify(records).includes(token));
	assert.ok(!JSON.stringify(records).includes("/services"));
	assert.equal(purposeOf(new URL("https://api.github.com/user/repos")), "GitHub: listing repositories");
	assert.equal(log.list(2).length, 1);
	assert.deepEqual(log.byHost()[0]?.requests, 1);
});

// ---------------------------------------------------------------- through the server

async function start(t: TestContext, overrides: Partial<UiOptions> = {}, before?: (dir: string) => Promise<void>): Promise<UiServer & { dir: string }> {
	const dir = await tempDir();
	await before?.(dir);
	const server = await startUiServer({ port: 0, reportPath: join(dir, "state", "repo-scan.json"), defaultRoot: dir, monitor: null, ...overrides });
	t.after(() => server.close());
	return Object.assign(server, { dir });
}

// oxlint-disable-next-line typescript/no-explicit-any -- assertions read arbitrary response shapes
function send(server: UiServer, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
	const payload = body === undefined ? undefined : JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = request(
			{ host: "127.0.0.1", port: server.port, method, path, headers: { "x-porchlight-session": server.sessionKey, ...(payload ? { "content-type": "application/json" } : {}), ...headers } },
			(res) => {
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => (text += chunk));
				res.on("end", () => resolve({ status: res.statusCode ?? 0, json: text ? JSON.parse(text) : undefined }));
			},
		);
		req.on("error", reject);
		req.end(payload);
	});
}

test("the page gets first-seen dates and the due-date policy, and the menu bar gets counts only", async (t) => {
	const server = await start(t, {}, async (dir) => {
		await mkdir(join(dir, "state"), { recursive: true });
		await writeFile(join(dir, "state", "repo-scan.json"), JSON.stringify(report("2026-11-01T00:00:00.000Z", [finding("critical", "CVE-9")])));
	});
	const seen = await send(server, "GET", "/api/findings/seen");
	assert.equal(seen.status, 200);
	assert.deepEqual(seen.json.seen[findingKey("shop", finding("critical", "CVE-9"))], { first: "2026-11-01T00:00:00.000Z", onOrBefore: true });
	assert.deepEqual(seen.json.policy, DEFAULT_DUE);

	const saved = await send(server, "POST", "/api/findings/due-policy", { policy: { critical: 3, high: 14, medium: null, low: null } });
	assert.equal(saved.status, 200);
	assert.equal((await send(server, "GET", "/api/findings/due-policy")).json.policy.critical, 3);
	assert.equal((await stat(join(server.dir, "state", "due-dates.json"))).mode & 0o777, 0o600);
	assert.equal((await send(server, "POST", "/api/findings/due-policy", { policy: { critical: -1 } })).status, 400);
	assert.deepEqual((await send(server, "POST", "/api/findings/due-policy", { reset: true })).json.policy, DEFAULT_DUE);

	// The menu-bar status: counts and times, nothing about a finding.
	const status = await send(server, "GET", "/api/menu-status");
	assert.equal(status.json.repos.findings, 1);
	assert.equal(status.json.repos.bySeverity.critical, 1);
	assert.ok(!JSON.stringify(status.json).includes("CVE-9"));
	assert.ok(!JSON.stringify(status.json).includes(server.dir));
});

test("every request the server sends out is in the egress log, and a task's model is the one Settings chose for it (R6F-3, R6F-10)", async (t) => {
	const calls: string[] = [];
	const fetchFn = (async (input: URL | string) => {
		calls.push(String(input));
		return Response.json({ models: [{ name: "small" }, { name: "big" }] });
	}) as unknown as typeof fetch;
	const server = await start(
		t,
		{ fetchFn, assistant: assistantConfig({ PORCHLIGHT_LLM_URL: "http://127.0.0.1:11434", PORCHLIGHT_LLM_MODEL: "small" }) },
		async (dir) => {
			await mkdir(join(dir, "state"), { recursive: true });
			await writeFile(join(dir, "state", "model-settings.json"), JSON.stringify({ choice: "ollama-server", url: "http://gpu.lan:11434", model: "big" }));
		},
	);
	// The page's own state does not change: Explain, Summarise and Ask use the model in use.
	assert.equal((await send(server, "GET", "/api/state")).json.assistant.model, "big");
	const tasks = await send(server, "GET", "/api/model-tasks");
	assert.deepEqual(tasks.json.tasks.map((entry: { task: string }) => entry.task), ["analysis", "mural", "investigate"]);
	assert.deepEqual(tasks.json.targets.map((target: { id: string }) => target.id).sort(), ["ollama-server", "startup"]);
	assert.ok(!JSON.stringify(tasks.json).includes("11434/"), "only hosts and labels, as the page shows them");

	// Only an id Porchlight offered is taken, never an address.
	assert.equal((await send(server, "POST", "/api/model-tasks", { task: "analysis", target: "http://evil.example" })).status, 400);
	assert.equal((await send(server, "POST", "/api/model-tasks", { task: "explain", target: "startup" })).status, 400);
	const chosen = await send(server, "POST", "/api/model-tasks", { task: "analysis", target: "startup" });
	assert.equal(chosen.status, 200);
	assert.equal(chosen.json.tasks[0].using.model, "small");
	assert.equal((await stat(join(server.dir, "state", "model-tasks.json"))).mode & 0o777, 0o600);
	assert.equal((await send(server, "GET", "/api/investigate")).json.assistant.model, "big");

	// A request that names the model in use, not the analysis's, is refused (S22).
	await writeFile(join(server.dir, "state", "repo-scan.json"), JSON.stringify(report("2026-11-01T00:00:00.000Z", [finding("critical", "CVE-9")])));
	const refused = await send(server, "POST", "/api/analysis", { limit: 1, shown: { model: "big", host: "gpu.lan:11434" } });
	assert.equal(refused.status, 409);
	assert.match(refused.json.error, /small/);

	// Each request the server sent is in the log, by host and purpose.
	await send(server, "GET", "/api/connections");
	const egress = await send(server, "GET", "/api/egress");
	assert.ok(calls.length > 0);
	assert.equal(egress.json.records.length, calls.length);
	assert.ok(egress.json.records.every((record: { host: string; purpose: string }) => ["gpu.lan:11434", "127.0.0.1:11434"].includes(record.host) && record.purpose === "Model"));
	assert.ok(!JSON.stringify(egress.json).includes("/api/tags"));
});

test("the weekly digest goes only after a scheduled scan, only when asked for, and once a week (FT-13)", async (t) => {
	const sent: string[] = [];
	const fetchFn = (async (_url: URL | string, init?: RequestInit) => {
		sent.push(String(init?.body));
		return new Response("ok");
	}) as unknown as typeof fetch;
	const notify = { url: new URL("https://ntfy.sh/porchlight-test"), format: "ntfy" as const };
	const scan = async () => ({ ...report(new Date().toISOString(), [finding("high", "H-1")]) });
	const server = await start(t, { fetchFn, scanEveryHours: 24, scheduleTickMs: 20, notify, digest: true, scan });
	for (let i = 0; i < 200 && sent.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(sent.length, 2);
	assert.match(sent[1]!, /scan in the last 7 days|scans in the last 7 days/);
	// The record is written once the digest was delivered.
	let record: string | null = null;
	for (let i = 0; i < 200 && record === null; i++) {
		await new Promise((resolve) => setTimeout(resolve, 10));
		record = await readFile(join(server.dir, "state", "digest.json"), "utf8").catch(() => null);
	}
	const state = JSON.parse(record ?? "{}");
	assert.ok(typeof state.lastSentAt === "string");

	// The next scheduled scan within the week sends its own notice, and no second digest.
	await writeFile(join(server.dir, "state", "repo-scan.json"), JSON.stringify(report(new Date(Date.now() - 48 * 3_600_000).toISOString(), [])));
	for (let i = 0; i < 200 && sent.length < 3; i++) await new Promise((resolve) => setTimeout(resolve, 10));
	await new Promise((resolve) => setTimeout(resolve, 100));
	assert.equal(sent.length, 3);
	assert.doesNotMatch(sent[2]!, /last 7 days/);

	// Without the setting, only the scan's own notice goes.
	const quiet: string[] = [];
	const other = await start(t, {
		fetchFn: (async (_url: URL | string, init?: RequestInit) => {
			quiet.push(String(init?.body));
			return new Response("ok");
		}) as unknown as typeof fetch,
		scanEveryHours: 24,
		scheduleTickMs: 20,
		notify,
		scan,
	});
	for (let i = 0; i < 100 && quiet.length < 1; i++) await new Promise((resolve) => setTimeout(resolve, 10));
	await new Promise((resolve) => setTimeout(resolve, 150));
	assert.equal(quiet.length, 1);
	void other;
});
