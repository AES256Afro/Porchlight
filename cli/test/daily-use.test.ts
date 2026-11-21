// M15, daily use: each test names the audit item it covers.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmod, lstat, mkdir, readdir, readFile, symlink, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { changeLine, findingsCommand, forget, reposHistory, type Out } from "../src/daily.ts";
import { runSelfCheck } from "../src/doctor.ts";
import { auditChecks, changedSinceAudit, compareChecks, KeptRuns } from "../src/kept-checks.ts";
import { failCode } from "../src/main.ts";
import { History, mergeRescan, orphanNotes, readNotes, removeNotes, setNote, setNotes } from "../src/repos/history.ts";
import { ToolMissingError, type Runner } from "../src/repos/exec.ts";
import { parseFilter } from "../src/roadmap/export.ts";
import { buildRepoRoadmap } from "../src/roadmap/repos.ts";
import type { Finding, RepoResult, ScanReport } from "../src/repos/types.ts";
import { startUiServer, type UiOptions, type UiServer } from "../src/ui/server.ts";
import { describeFilter, isFiltering, matchesFilter, noFilter } from "../ui/filter.js";
import { checkChangeWords, coverageGroups, OUTSIDE, overdueDomains, previewAdvice, reviewQueue, scheduleLines, toolAdvice } from "../ui/hints.js";
import { filterFromParams, paramsFromFilter } from "../ui/list.js";
import { findingKey, rescanWords } from "../ui/tracking.js";
import { tempDir } from "./helpers.ts";

const vuln = (name: string, version = "1.0.0", severity: Finding["severity"] = "high"): Finding => ({
	tool: "osv-scanner",
	kind: "vulnerability",
	severity,
	ruleId: `GHSA-${name}`,
	title: `${name} has a hole`,
	location: "package-lock.json",
	detail: `${name}@${version}`,
});
const secret = (place: string): Finding => ({ tool: "gitleaks", kind: "secret", severity: "high", ruleId: "aws-access-token", title: "AWS key", location: place, detail: "commit 1111111" });
const okTools = [
	{ tool: "gitleaks" as const, status: "ok" as const, installHint: "brew install gitleaks" },
	{ tool: "osv-scanner" as const, status: "ok" as const, installHint: "brew install osv-scanner" },
];

function report(root: string, scannedAt: string, repos: Record<string, Finding[]>): ScanReport {
	return { root, scannedAt, tools: okTools, repos: Object.entries(repos).map(([name, findings]) => ({ path: join(root, name), findings, errors: [] })) };
}

function capture(): Out & { out: string[]; err: string[] } {
	const out: string[] = [];
	const err: string[] = [];
	return { out, err, say: (text) => out.push(text), warn: (text) => err.push(text) };
}

test("New since the last scan is a filter in filter.js, so the page and an export match (B-Q1)", () => {
	const keys = new Set([findingKey("shop", vuln("lodash"))]);
	const filter = { ...noFilter(), newOnly: true, newKeys: keys };
	assert.ok(isFiltering(filter));
	assert.equal(matchesFilter(vuln("lodash"), "shop", filter), true);
	assert.equal(matchesFilter(vuln("axios"), "shop", filter), false);
	// No comparison: nothing is new, so nothing matches rather than everything.
	assert.equal(matchesFilter(vuln("lodash"), "shop", { ...noFilter(), newOnly: true }), false);
	assert.match(describeFilter(filter) ?? "", /new since the last scan only/);
	// In the address and back.
	const params = new URLSearchParams(paramsFromFilter(filter));
	assert.equal(params.get("new"), "1");
	const back = filterFromParams(params, keys);
	assert.equal(back.newOnly, true);
	assert.equal(back.newKeys, keys);
	// The server takes the keys from its own history, never from the request.
	const exported = parseFilter({ new: "1" }, keys);
	assert.equal(exported.newOnly, true);
	const roadmap = buildRepoRoadmap(report("/r", "2026-11-21T00:00:00.000Z", { shop: [vuln("lodash"), vuln("axios")] }), exported);
	assert.deepEqual(
		roadmap.phases.flatMap((phase) => phase.groups.flatMap((group) => group.actions.map((action) => action.where))).filter((where) => /axios/.test(where)),
		[],
	);
});

test("scanning one repository again counts fixed and new by findingKey, and keeps what a scanner did not look at (US-4, R6Q-6)", () => {
	const before: RepoResult = { path: "/r/shop", findings: [vuln("lodash"), vuln("axios"), secret("a.env")], errors: [] };
	const now = { repo: { path: "/r/shop", findings: [vuln("lodash", "1.0.0"), vuln("left-pad")], errors: [{ tool: "gitleaks" as const, message: "failed" }] }, tools: okTools };
	const choices = { preset: "standard" as const, secrets: true, dependencies: true, privateData: false, history: "all" as const, localFiles: false, skip: [], analyse: false };
	const { merged, change } = mergeRescan("shop", before, now, choices, new Date("2026-11-21T00:00:00Z"));
	assert.deepEqual(change, { repo: "shop", fixedCount: 1, newCount: 1, uncheckedCount: 1 });
	// The secret is kept: gitleaks failed this time, and not looking is not fixed (invariant 5).
	assert.ok(merged.findings.some((finding) => finding.kind === "secret"));
	assert.equal(rescanWords(change), "1 fixed, 1 new in shop; 1 could not be checked again, so it stays as before.");
	assert.equal(rescanWords({ repo: "shop", fixedCount: 0, newCount: 0, uncheckedCount: 0 }), "Nothing fixed and nothing new in shop.");
});

test("a status records where it was set and what it replaced; many are set at once; notes no kept scan has are found and removed only on asking (R6U-7, B-Q2, R6Q-12)", async () => {
	const dir = await tempDir();
	const path = join(dir, "finding-notes.json");
	const key = findingKey("shop", vuln("lodash"));
	await setNote(path, key, "accepted", "waiting on upstream", new Date("2026-11-20T00:00:00Z"), "2027-01-01", "device");
	const changed = await setNote(path, key, "fixed", "", new Date("2026-11-21T00:00:00Z"), undefined, "here");
	assert.equal(changed?.by, "here");
	assert.deepEqual(changed?.previous, { status: "accepted", updatedAt: "2026-11-20T00:00:00.000Z", by: "device" });
	const other = findingKey("gone", vuln("x"));
	const saved = await setNotes(path, [key, other], "false-positive", "test data", new Date(), undefined, "cli");
	assert.equal(saved.length, 2);
	assert.equal((await readNotes(path))[other]?.status, "false-positive");
	const history = new History(dir);
	await history.add(report("/r", "2026-11-21T00:00:00.000Z", { shop: [vuln("lodash")] }));
	const orphans = await orphanNotes(await readNotes(path), history, null);
	assert.deepEqual(orphans, [other]);
	assert.equal(await removeNotes(path, orphans), 1);
	assert.deepEqual(Object.keys(await readNotes(path)), [key]);
});

test("checks and audits are compared with the one before: not checked again is never fixed (G-Q1, F-Q3, F-Q2)", async () => {
	const previous = { at: "2026-11-20T00:00:00Z", checks: [
		{ place: "", id: "filevault", title: "FileVault", status: "failed", severity: "high" },
		{ place: "", id: "firewall", title: "Firewall", status: "failed", severity: "medium" },
		{ place: "", id: "sip", title: "SIP", status: "passed", severity: "high" },
		{ place: "", id: "guest", title: "Guest", status: "unknown", severity: "low" },
	] };
	const current = { checks: [
		{ place: "", id: "filevault", title: "FileVault", status: "passed", severity: "high" },
		{ place: "", id: "firewall", title: "Firewall", status: "unknown", severity: "medium" },
		{ place: "", id: "sip", title: "SIP", status: "failed", severity: "high" },
		{ place: "", id: "guest", title: "Guest", status: "failed", severity: "low" },
	] };
	const change = compareChecks(previous, current);
	assert.deepEqual([change.fixedCount, change.newCount, change.uncheckedCount], [1, 1, 1]);
	assert.deepEqual(change.new.map((check) => check.id), ["sip"], "guest could not be checked before, so it is not new");
	assert.equal(checkChangeWords(change, "check"), "1 fixed, 1 new since the check before. 1 could not be checked again, so it is not counted as fixed.");
	assert.equal(checkChangeWords(null, "audit"), null);
	// Zone checks are told apart by their zone.
	assert.deepEqual(auditChecks({ zones: [{ name: "a.example", checks: [{ id: "dnssec", title: "DNSSEC", status: "failed", severity: "low" }] }] }).map((check) => check.place), ["a.example"]);
	// A change Cloudflare accepted after the audit marks its check; one refused, or older, does not.
	const changed = changedSinceAudit("2026-11-20T00:00:00Z", [
		{ at: "2026-11-21T00:00:00Z", zoneId: "z1", change: "dnssec", ok: true },
		{ at: "2026-11-21T00:00:00Z", zoneId: "z1", change: "hsts", ok: false },
		{ at: "2026-11-19T00:00:00Z", zoneId: "z1", change: "tls-1.3", ok: true },
	]);
	assert.deepEqual([...changed], ["z1\ndnssec"]);
	// Kept runs: 0600, the one before a given time, the oldest dropped past the limit.
	const dir = join(await tempDir(), "host-checks");
	const runs = new KeptRuns<{ checkedAt: string }>(dir);
	await runs.add({ checkedAt: "2026-11-20T00:00:00.000Z" }, "2026-11-20T00:00:00.000Z");
	await runs.add({ checkedAt: "2026-11-21T00:00:00.000Z" }, "2026-11-21T00:00:00.000Z");
	assert.equal((await runs.before("2026-11-21T00:00:00.000Z"))?.checkedAt, "2026-11-20T00:00:00.000Z");
	assert.equal(await runs.before("2026-11-20T00:00:00.000Z"), null);
	for (const name of await readdir(dir)) assert.equal((await lstat(join(dir, name))).mode & 0o777, 0o600);
});

test("the Overview's words: schedule, overdue domains, the review queue, Not covered by cause, tools and the home folder (QL-5, QL-8, QL-3, US-9, US-2)", () => {
	const now = new Date("2026-11-21T12:00:00Z");
	const when = (iso: string) => iso.slice(0, 16);
	const lines = scheduleLines(
		{ everyHours: 24, root: "/repos", lastRun: { at: "2026-11-21T02:00:00Z", ok: true, summary: "3 findings" }, nextRun: "2026-11-22T02:00:00Z", notify: { host: "ntfy.sh", last: { at: "2026-11-21T02:01:00Z", delivered: false, detail: "ntfy.sh refused it (HTTP 403)" } } },
		{ cloudflareEnds: "2026-11-25T00:00:00Z" },
		when,
		now,
	);
	assert.match(lines[0] ?? "", /every day\. Last run 2026-11-21T02:00: 3 findings\. Next run 2026-11-22T02:00\./);
	assert.match(lines[1] ?? "", /not delivered: ntfy\.sh refused it/);
	assert.match(lines[2] ?? "", /Cloudflare token ends in 4 days/);
	assert.deepEqual(scheduleLines(null, {}, when, now), []);

	const day = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
	assert.equal(overdueDomains([{ verified: true, lastScanAt: day(2) }], now), null);
	assert.match(overdueDomains([{ verified: true, lastScanAt: day(30) }, { verified: false, lastScanAt: null }], now)?.words ?? "", /^1 domain is overdue/);
	const many = Array.from({ length: 150 }, () => ({ verified: true, lastScanAt: day(30) }));
	assert.match(overdueDomains(many, now)?.words ?? "", /scans 144 domains a day/);

	const rows = [{ repo: "a", ruleId: "r", location: "1", detail: "" }, { repo: "a", ruleId: "r", location: "2", detail: "" }, { repo: "a", ruleId: "r", location: "3", detail: "" }, { repo: "a", ruleId: "r", location: "4", detail: "" }];
	const notes: Record<string, { status: string; until?: string }> = { "1": { status: "accepted", until: "2026-11-01" }, "2": { status: "accepted", until: "2026-11-30" }, "3": { status: "fixed" }, "4": { status: "accepted", until: "2027-06-01" } };
	const queue = reviewQueue(rows, (row) => notes[row.location] ?? null, now);
	assert.deepEqual([queue.ended, queue.ending, queue.stillReported].map((list) => list.map((row) => row.location)), [["1"], ["2"], ["3"]]);

	const groups = coverageGroups({ repos: ["a", "b", "c"].map((name) => ({ name, errors: [{ tool: "osv-scanner", message: "exit 127" }] })) });
	assert.equal(groups.length, 1);
	assert.deepEqual(groups[0]?.repos, ["a", "b", "c"]);

	const preview = { root: "/Users/me", exists: true, total: 0, repos: [], fetched: 0, depth: 3, isHome: true, tools: [{ tool: "git", ready: false, fix: "xcode-select --install" }, { tool: "gitleaks", ready: true, fix: "brew install gitleaks" }] };
	assert.match(previewAdvice(preview, null).title, /whole home folder/);
	assert.deepEqual(toolAdvice(preview), ["git is not ready, so no repository's history can be read. Install it first: `xcode-select --install`"]);
});

test("one verb and one noun per thing, and one wording for data that leaves your machines (RD-8 to RD-11)", async () => {
	const dir = new URL("../ui/", import.meta.url);
	const texts = await Promise.all((await readdir(dir)).filter((name) => name.endsWith(".js")).map(async (name) => ({ name, text: await readFile(new URL(name, dir), "utf8") })));
	const found = (pattern: RegExp) => texts.flatMap(({ name, text }) => text.split("\n").filter((line) => pattern.test(line) && !/^\s*(\/\/|\*)/.test(line)).map((line) => `${name}: ${line.trim()}`));
	assert.equal(OUTSIDE, "outside your machines");
	assert.deepEqual(found(/off your machines|leaves your machines|outside your own machines|leave your machines/), []);
	assert.deepEqual(found(/Audit my account|"Check your code"|Check your Cloudflare account|Check your websites/), []);
	assert.deepEqual(found(/[Ww]ebsites?\b/).filter((line) => !/^dom\.js|^paths\.js/.test(line)), []);
	assert.deepEqual(found(/statTile\("Problems"|"resolved"| resolved`/), []);
});

test("the command line: what changed after --save, the kept scans, statuses, --fail-on for checks (R6Q-5, R6Q-7, J-Q3)", async () => {
	const dir = await tempDir();
	const history = new History(dir);
	const first = report("/r", "2026-11-20T00:00:00.000Z", { shop: [vuln("lodash"), vuln("axios")] });
	const second = report("/r", "2026-11-21T00:00:00.000Z", { shop: [vuln("lodash"), vuln("left-pad")] });
	await history.add(first);
	assert.match(changeLine(await history.compare(first)), /first scan/);
	await history.add(second);
	assert.equal(changeLine(await history.compare(second)), "1 new, 1 fixed since the previous scan.");
	const listed = capture();
	await reposHistory([], dir, listed);
	assert.match(listed.out.join("\n"), /2 scans kept/);
	const json = capture();
	await reposHistory(["--json"], dir, json);
	assert.equal(JSON.parse(json.out.join("")).scans[0].newCount, 1);

	const reportPath = join(dir, "repo-scan.json");
	await writeFile(reportPath, JSON.stringify(second));
	const set = capture();
	await findingsCommand("note", ["--repo", "shop", "--rule", "GHSA-lodash", "--location", "package-lock.json", "--status", "accepted", "--until", "2099-01-01", "--note", "upstream"], reportPath, set, new Date("2026-11-21T00:00:00Z"));
	assert.match(set.out.join(""), /^Accepted risk: shop GHSA-lodash/);
	// Two findings share that place: the detail is asked for, never guessed.
	await assert.rejects(findingsCommand("note", ["--repo", "shop", "--rule", "GHSA-lodash", "--location", "nowhere", "--status", "fixed"], reportPath, capture()), /not in the saved scan/);
	await assert.rejects(findingsCommand("note", ["--repo", "shop", "--rule", "GHSA-lodash", "--location", "package-lock.json", "--status", "rotated"], reportPath, capture()), /Only a secret/);
	const list = capture();
	await findingsCommand("notes", [], reportPath, list);
	assert.match(list.out.join("\n"), /Accepted risk until 2099-01-01 {2}shop {2}GHSA-lodash/);
	assert.match(list.out.join("\n"), /set from the command line: upstream/);

	const checks = [{ status: "failed", severity: "medium" }, { status: "passed", severity: "critical" }];
	assert.equal(failCode(checks, undefined), 0);
	assert.equal(failCode(checks, "medium"), 2);
	assert.equal(failCode(checks, "high"), 0);
	assert.equal(failCode([...checks, { status: "unknown", severity: "low" }], "high"), 1);
});

test("forget lists first, removes only Porchlight's own files by name with --yes, and never a project folder, a link or anything else (R6F-4, invariant 23)", async () => {
	const home = await tempDir();
	const data = join(home, ".porchlight");
	const project = join(home, "acme");
	await mkdir(join(data, "history"), { recursive: true });
	await mkdir(join(project, "Porchlight"), { recursive: true });
	await writeFile(join(data, "repo-scan.json"), "{}");
	await writeFile(join(data, "model-settings.json"), JSON.stringify({ choice: "ollama", keys: { anthropic: "x".repeat(40) } }));
	await writeFile(join(data, "projects.json"), JSON.stringify({ projects: [{ folder: project }] }));
	await writeFile(join(data, "app.env"), "PORCHLIGHT_ROOT=~/code\n");
	await writeFile(join(data, "mine.txt"), "not Porchlight's");
	await writeFile(join(project, "Porchlight", "export.md"), "kept");
	await symlink(project, join(data, "github"));

	const dry = capture();
	assert.equal(await forget([], { dataDir: data }, dry), 0);
	const said = dry.out.join("\n");
	assert.match(said, /Would remove:/);
	assert.match(said, /repo-scan\.json/);
	assert.match(said, /mine\.txt: not Porchlight's, left alone/);
	assert.match(said, /github: a link, left alone/);
	assert.match(said, /Keys saved for anthropic: revoke them/);
	assert.doesNotMatch(said, /x{40}/, "a key is never printed");
	assert.match(said, /Nothing was removed/);
	assert.ok(await lstat(join(data, "repo-scan.json")));

	assert.equal(await forget(["--yes"], { dataDir: data }, capture()), 0);
	assert.deepEqual((await readdir(data)).sort(), ["app.env", "github", "mine.txt"]);
	assert.equal(await readFile(join(project, "Porchlight", "export.md"), "utf8"), "kept");
	assert.ok((await lstat(join(data, "github"))).isSymbolicLink());

	// A data folder inside a project folder, or a git repository, is refused before anything is listed.
	await mkdir(join(project, "data"), { recursive: true });
	await writeFile(join(project, "data", "projects.json"), JSON.stringify({ projects: [{ folder: project }] }));
	await assert.rejects(forget(["--yes", "--data", join(project, "data")], { dataDir: data }, capture()), /project folder/);
	const repo = join(home, "repo");
	await mkdir(join(repo, ".git", "x"), { recursive: true });
	await assert.rejects(forget(["--yes", "--data", join(repo, ".git", "x")], { dataDir: data }, capture()), /git repository/);
});

test("doctor --self reads modes, keys by name, scanners by path, and leftovers, and prints no key (R6F-1)", async () => {
	const data = await tempDir();
	await writeFile(join(data, "model-settings.json"), JSON.stringify({ choice: "ollama", keys: { openai: "sk-" + "z".repeat(40) } }));
	await writeFile(join(data, "app.log"), "log");
	await chmod(join(data, "app.log"), 0o644);
	await writeFile(join(data, "repo-scan.json.1.abcdefabcdef.tmp"), "");
	const bin = join(data, "bin");
	await mkdir(bin);
	await writeFile(join(bin, "gitleaks"), "#!/bin/sh\n");
	await chmod(join(bin, "gitleaks"), 0o755);
	const run: Runner = async (command) => {
		if (command === "lsof") return { code: 0, stdout: "COMMAND PID USER FD TYPE DEVICE SIZE NODE NAME\nnode 1 me 20u IPv4 0 0 TCP 127.0.0.1:4747 (LISTEN)\n", stderr: "" };
		if (command.endsWith("gitleaks")) return { code: 0, stdout: "8.30.1", stderr: "" };
		throw new ToolMissingError(command);
	};
	const checks = await runSelfCheck({ run, env: { PATH: `${bin}:relative/bin` }, dataDir: data, nodeVersion: "24.0.0" });
	const by = Object.fromEntries(checks.map((check) => [check.name, check]));
	assert.equal(by["File modes"]?.status, "warning");
	assert.match(by["File modes"]?.detail ?? "", /app\.log/);
	assert.match(by["File modes"]?.fix ?? "", /chmod 600/);
	assert.equal(by.Listening?.status, "ok");
	assert.match(by.Listening?.detail ?? "", /127\.0\.0\.1:4747/);
	assert.equal(by["Saved keys"]?.status, "warning", "a key kept for a provider not chosen is said");
	assert.match(by["Saved keys"]?.detail ?? "", /openai/);
	assert.equal(by.gitleaks?.status, "ok");
	assert.match(by.gitleaks?.detail ?? "", new RegExp(`${bin}/gitleaks, version 8\\.30\\.1`));
	assert.equal(by["osv-scanner"]?.status, "warning");
	assert.equal(by.Leftovers?.status, "warning");
	assert.doesNotMatch(JSON.stringify(checks), /z{40}/);
});

test("the Mac app ignores a fixed page key in app.env and expands ~ in the folder (B60)", async () => {
	const script = await readFile(new URL("../../mac/build.sh", import.meta.url), "utf8");
	const body = /read_settings='([\s\S]*?)'\n\nif/.exec(script)?.[1];
	assert.ok(body);
	const home = await tempDir();
	await mkdir(join(home, ".porchlight"));
	await writeFile(join(home, ".porchlight", "app.env"), `PORCHLIGHT_ROOT=~/code\nPORCHLIGHT_UI_KEY=${"k".repeat(40)}\nPORCHLIGHT_MONITOR_URL=https://m.example\n`);
	const out = execFileSync("sh", ["-c", `root=/x\n${body}\nprintf '%s|%s|%s' "$root" "\${PORCHLIGHT_UI_KEY:-none}" "$PORCHLIGHT_MONITOR_URL"`], { env: { HOME: home, PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "ignore"] }).toString();
	assert.equal(out, `${home}/code|none|https://m.example`);
});

async function start(t: TestContext, overrides: Partial<UiOptions> = {}): Promise<UiServer & { dir: string }> {
	const dir = await tempDir();
	const server = await startUiServer({ port: 0, reportPath: join(dir, "state", "repo-scan.json"), defaultRoot: dir, monitor: null, monitorError: "Set PORCHLIGHT_MONITOR_URL", ...overrides });
	t.after(() => server.close());
	return Object.assign(server, { dir });
}

// oxlint-disable-next-line typescript/no-explicit-any -- assertions read arbitrary response shapes
function send(server: UiServer, method: string, path: string, body?: unknown): Promise<{ status: number; json: any; text: string }> {
	const payload = body === undefined ? undefined : JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = request(
			{ host: "127.0.0.1", port: server.port, method, path, headers: { "x-porchlight-session": server.sessionKey, ...(payload ? { "content-type": "application/json" } : {}) } },
			(res) => {
				let text = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => (text += chunk));
				res.on("end", () => {
					let json;
					try {
						json = JSON.parse(text);
					} catch {
						json = undefined;
					}
					resolve({ status: res.statusCode ?? 0, json, text });
				});
			},
		);
		req.on("error", reject);
		req.end(payload);
	});
}

async function until(check: () => Promise<boolean>): Promise<void> {
	for (let tries = 0; tries < 200; tries++) {
		if (await check()) return;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("timed out");
}

test("the server: version, attention, statuses in bulk, notes no scan has, several repositories again, and New in an export (R6Q-4, E-Q1, B-Q2, R6Q-12, US-9, B-Q1)", async (t) => {
	const root = "/r";
	let rescans = 0;
	const server = await start(t, {
		scan: async () => report(root, "2026-11-21T00:00:00.000Z", { shop: [vuln("lodash"), vuln("left-pad")], blog: [vuln("axios")] }),
		rescan: async (path) => {
			rescans++;
			return { repo: { path, findings: path.endsWith("shop") ? [vuln("lodash")] : [], errors: [] }, tools: okTools };
		},
	});
	const state = await send(server, "GET", "/api/state");
	assert.match(state.json.version, /^\d+\.\d+\.\d+/);
	assert.equal(state.json.schedule, null);
	assert.deepEqual((await send(server, "GET", "/api/attention")).json, { approval: null });

	// A scan before, then the one shown: left-pad is new.
	await mkdir(join(server.dir, "state"), { recursive: true });
	await new History(join(server.dir, "state")).add(report(root, "2026-11-20T00:00:00.000Z", { shop: [vuln("lodash")], blog: [vuln("axios")] }));
	assert.equal((await send(server, "POST", "/api/repos/scan", { root: server.dir })).status, 202);
	await until(async () => (await send(server, "GET", "/api/repos/scan")).json.scan.state === "done");
	const done = (await send(server, "GET", "/api/repos/scan")).json.scan;
	assert.deepEqual(done.change, { newCount: 1, fixedCount: 0, uncheckedCount: 0 });
	const exported = await send(server, "GET", "/api/repos/export?content=findings&format=csv&new=1");
	assert.equal(exported.status, 200);
	assert.match(exported.text, /left-pad/);
	assert.doesNotMatch(exported.text, /lodash|axios/);

	// One status for several findings, recorded as set on this computer.
	const bulk = await send(server, "POST", "/api/findings/notes", {
		status: "false-positive",
		note: "fixture",
		findings: [
			{ repo: "shop", ruleId: "GHSA-lodash", location: "package-lock.json", detail: "lodash@1.0.0" },
			{ repo: "blog", ruleId: "GHSA-axios", location: "package-lock.json", detail: "axios@1.0.0" },
		],
	});
	assert.equal(bulk.status, 200);
	assert.deepEqual(bulk.json.notes.map((item: { note: { by: string } }) => item.note.by), ["here", "here"]);
	assert.equal((await send(server, "POST", "/api/findings/notes", { status: "fixed", findings: [{ repo: "nope", ruleId: "x", location: "y", detail: "z" }] })).status, 404);
	assert.equal((await send(server, "POST", "/api/findings/notes", { status: "fixed", findings: [] })).status, 400);
	assert.equal((await send(server, "GET", "/api/findings/orphans")).json.count, 0);

	// Several repositories again, as one job, with fixed and new summed.
	assert.equal((await send(server, "POST", "/api/repos/rescan", { repos: ["shop", "blog"] })).status, 202);
	await until(async () => (await send(server, "GET", "/api/repos/scan")).json.scan.state === "done");
	assert.equal(rescans, 2);
	assert.deepEqual((await send(server, "GET", "/api/repos/scan")).json.scan.rescan, { repo: "2 repositories", fixedCount: 2, newCount: 0, uncheckedCount: 0 });
	assert.equal((await send(server, "POST", "/api/repos/rescan", { repos: ["shop", "missing"] })).status, 404);

	// Check connections, with nothing set up, says so and contacts nothing.
	assert.deepEqual(Object.keys((await send(server, "GET", "/api/connections")).json).sort(), ["at", "cloudflare", "model", "monitor"]);
});
