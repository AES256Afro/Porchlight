import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { GIT_LOG_OPTIONS, GITLEAKS_CONFIG } from "../src/repos/gitleaks.ts";
import { coverageNotes, exceeds, exitCode, renderMarkdown, renderSummary, repoName } from "../src/repos/report.ts";
import { scanRepos } from "../src/repos/scan.ts";
import { scannerSettingFiles } from "../src/repos/settings.ts";
import type { ScanReport } from "../src/repos/types.ts";
import { fakeAwsKeyId, fakeRunner, git, installed, makeTree, tempDir } from "./helpers.ts";

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
				: { stdout: args.at(-1)!.endsWith("leaky") ? JSON.stringify([gitleaksRow("app/settings.py")]) : "[]" },
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
			return args.at(-1)!.endsWith("clean") ? { code: 1, stderr: "fatal: bad object HEAD\nmore detail" } : { stdout: "[]" };
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

test("gitleaks uses Porchlight's rules and stops git running the repository's diff programs", async () => {
	const root = await twoRepos();
	const run = fakeRunner({ gitleaks: (args) => ({ stdout: args[0] === "version" ? "8.30.1" : "[]" }), "osv-scanner": "missing" });

	await scanRepos({ root, depth: 2, run, now: NOW });

	const scan = run.calls.find((call) => call[0] === "gitleaks" && call[1] === "git")!;
	const repo = scan.at(-1)!;
	assert.equal(scan[scan.indexOf("--config") + 1], GITLEAKS_CONFIG);
	assert.ok(scan.includes(`--log-opts=${GIT_LOG_OPTIONS}`));
	for (const option of ["--no-textconv", "--no-ext-diff", "--all"]) assert.ok(GIT_LOG_OPTIONS.split(" ").includes(option), option);
	assert.equal(scan[scan.indexOf("--gitleaks-ignore-path") + 1], repo, "ignore files come from the repository, not the working folder");
	assert.ok(scan.includes("--redact"));
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
				: { stdout: args.at(-1)!.endsWith("leaky") ? JSON.stringify([gitleaksRow("tests/test_settings.py"), gitleaksRow("app/settings.py")]) : "[]" },
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
