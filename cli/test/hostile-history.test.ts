// M9: a scanned repository is hostile input (invariant 14). Each fixture here is one way a repository's
// own .git could run a program or hide history from gitleaks' internal `git log -p`, found by the audit
// of 2026-11-20 (docs/AUDIT-PLAN-2026-11-20.md: S9, S14, S15, S16, S48, S53, S54, S55, S62, B63). All are
// scanned once, with the real git and gitleaks, through Porchlight's own copy of each history.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, chmod, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { coverageNotes } from "../src/repos/report.ts";
import { scanRepos } from "../src/repos/scan.ts";
import type { RepoResult, ScanReport } from "../src/repos/types.ts";
import { FAKE_COMMIT, fakeAwsKeyId, git, installed, makeTree, tempDir } from "./helpers.ts";

const exec = promisify(execFile);
const NOW = () => new Date("2026-11-21T12:00:00Z");

/** A GitHub token shape gitleaks' github-pat rule matches, made at run time (see helpers.ts). */
function fakeGithubToken(): string {
	return `ghp_${randomBytes(18).toString("hex")}`;
}

async function head(repo: string): Promise<string> {
	return (await exec("git", ["rev-parse", "HEAD"], { cwd: repo })).stdout.trim();
}

/** Writes a script that leaves a mark when run, and returns how a git setting would name it. */
async function trap(root: string, name: string): Promise<{ program: string; marker: string }> {
	const marker = join(root, `${name}.ran`);
	const script = join(root, `${name}.sh`);
	await writeFile(script, `#!/bin/sh\ntouch '${marker}'\nexit 1\n`);
	await chmod(script, 0o755);
	return { program: script, marker };
}

async function ran(marker: string): Promise<boolean> {
	return access(marker).then(
		() => true,
		() => false,
	);
}

interface Fixtures {
	root: string;
	keys: Record<string, string>;
	markers: string[];
}

async function build(): Promise<Fixtures> {
	const root = await tempDir();
	const outside = await tempDir();
	const keys: Record<string, string> = {};
	const markers: string[] = [];

	// S9 (a): a submodule whose own config names an external diff, reached through diff.submodule=diff.
	{
		const sub = join(outside, "sub-source");
		await makeTree(sub, { "lib.txt": "one\n" });
		await git(sub, "init", "-q");
		await git(sub, "add", "-A");
		await git(sub, "commit", "-q", "-m", "one");
		const repo = join(root, "submodule");
		keys.submodule = fakeAwsKeyId();
		await makeTree(repo, { "app.env": `aws_access_key_id = ${keys.submodule}\n` });
		await git(repo, "init", "-q");
		await git(repo, "-c", "protocol.file.allow=always", "submodule", "add", "-q", sub, "sub");
		await git(repo, "add", "-A");
		await git(repo, "commit", "-q", "-m", "one");
		await writeFile(join(sub, "lib.txt"), "two\n");
		await git(sub, "commit", "-q", "-am", "two");
		await git(join(repo, "sub"), "pull", "-q");
		await git(repo, "commit", "-q", "-am", "move the submodule");
		const { program, marker } = await trap(outside, "submodule");
		markers.push(marker);
		await git(repo, "config", "diff.submodule", "diff");
		await git(join(repo, ".git", "modules", "sub"), "config", "diff.external", program);
	}

	// S9 (b): a partial clone whose config names an ssh command for fetching the blobs it lacks.
	{
		const source = join(outside, "partial-source");
		keys.partial = fakeAwsKeyId();
		await makeTree(source, { "app.env": `aws_access_key_id = ${keys.partial}\n` });
		await git(source, "init", "-q");
		await git(source, "config", "uploadpack.allowFilter", "true");
		await git(source, "add", "-A");
		await git(source, "commit", "-q", "-m", "one");
		await writeFile(join(source, "app.env"), "removed\n");
		await git(source, "commit", "-q", "-am", "two");
		await git(root, "clone", "-q", "--filter=blob:none", "--no-checkout", `file://${source}`, "partial");
		const repo = join(root, "partial");
		const { program, marker } = await trap(outside, "partial");
		markers.push(marker);
		await git(repo, "config", "remote.origin.url", "ssh://example.invalid/x.git");
		await git(repo, "config", "core.sshCommand", program);
	}

	// S14: a replace ref swaps the commit holding a key for a clean one.
	{
		const repo = join(root, "replaced");
		keys.replaced = fakeAwsKeyId();
		await makeTree(repo, { "app.env": `aws_access_key_id = ${keys.replaced}\n` });
		await git(repo, "init", "-q");
		await git(repo, "add", "-A");
		await git(repo, "commit", "-q", "-m", "one");
		const leaky = await head(repo);
		await writeFile(join(repo, "app.env"), "removed\n");
		await git(repo, "commit", "-q", "-am", "two");
		await git(repo, "replace", leaky, await head(repo));
	}

	// S62: grafts make the clean commit look like the first, with git's warning about them switched off.
	{
		const repo = join(root, "grafted");
		keys.grafted = fakeAwsKeyId();
		await makeTree(repo, { "app.env": `aws_access_key_id = ${keys.grafted}\n` });
		await git(repo, "init", "-q");
		await git(repo, "add", "-A");
		await git(repo, "commit", "-q", "-m", "one");
		await writeFile(join(repo, "app.env"), "removed\n");
		await git(repo, "commit", "-q", "-am", "two");
		await writeFile(join(repo, ".git", "info", "grafts"), `${await head(repo)}\n`);
		await git(repo, "config", "advice.graftFileDeprecated", "false");
	}

	// S48, S55: settings that blank or rewrite what `git log -p` prints. The key is in the root commit.
	{
		const repo = join(root, "settings");
		keys.settings = fakeAwsKeyId();
		await makeTree(repo, { "keys/app.env": `aws_access_key_id = ${keys.settings}\n`, ".gitattributes": "* -diff\n" });
		await git(repo, "init", "-q");
		await git(repo, "add", "-A");
		await git(repo, "commit", "-q", "-m", "one");
		for (const [name, value] of [
			["color.ui", "always"],
			["core.bigFileThreshold", "1"],
			["log.showRoot", "false"],
			["diff.noprefix", "true"],
			["diff.dstPrefix", "x/node_modules/"],
			["format.pretty", "oneline"],
			["log.abbrevCommit", "true"],
		] as const) {
			await git(repo, "config", name, value);
		}
	}

	// S54: a key that only a merge's resolution added.
	{
		const repo = join(root, "merged");
		keys.merged = fakeAwsKeyId();
		await makeTree(repo, { "app.env": "start\n" });
		await git(repo, "init", "-q", "-b", "main");
		await git(repo, "add", "-A");
		await git(repo, "commit", "-q", "-m", "one");
		await git(repo, "checkout", "-q", "-b", "side");
		await writeFile(join(repo, "app.env"), "side\n");
		await git(repo, "commit", "-q", "-am", "side");
		await git(repo, "checkout", "-q", "main");
		await writeFile(join(repo, "app.env"), "main\n");
		await git(repo, "commit", "-q", "-am", "main");
		await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "merge", "-q", "side"], { cwd: repo }).catch(() => undefined);
		await writeFile(join(repo, "app.env"), `aws_access_key_id = ${keys.merged}\n`);
		await git(repo, "add", "app.env");
		await git(repo, "commit", "-q", "--no-edit");
	}

	// S16, S53: a `gitleaks:allow` comment, and files gitleaks' default allowlist skips by name.
	{
		const repo = join(root, "named");
		keys.allowed = fakeAwsKeyId();
		keys.bootstrap = fakeGithubToken();
		keys.svg = fakeGithubToken();
		keys.pipfile = fakeGithubToken();
		await makeTree(repo, {
			"app.py": `KEY = "${keys.allowed}"  # gitleaks:allow\n`,
			"static/bootstrap.min.js": `var token = "${keys.bootstrap}";\n`,
			"logo.svg": `<svg><!-- token = "${keys.svg}" --></svg>\n`,
			"Pipfile.lock": `{"token": "${keys.pipfile}"}\n`,
		});
		await git(repo, "init", "-q");
		await git(repo, "add", "-A");
		await git(repo, "commit", "-q", "-m", "one");
	}

	// S15: a shallow clone, whose history before the cut is not on this computer.
	{
		const source = join(outside, "shallow-source");
		await makeTree(source, { "a.txt": "one\n" });
		await git(source, "init", "-q");
		await git(source, "add", "-A");
		await git(source, "commit", "-q", "-m", "one");
		await writeFile(join(source, "a.txt"), "two\n");
		await git(source, "commit", "-q", "-am", "two");
		await git(root, "clone", "-q", "--depth", "1", `file://${source}`, "shallow");
	}
	return { root, keys, markers };
}

function repoIn(report: ScanReport, name: string): RepoResult {
	const found = report.repos.find((repo) => repo.path.endsWith(`/${name}`));
	assert.ok(found, `${name} was scanned`);
	return found;
}

test("end to end: no hostile repository runs a program, hides history or skips a file by name (M9)", async (t) => {
	if (!(await installed("gitleaks"))) return t.skip("gitleaks is not installed");
	const fixtures = await build();
	// What the owner's own git config holds must not matter either (B63): this scan runs with whatever
	// ~/.gitconfig the machine has, and the settings fixture proves the repository's own does not count.
	const report = await scanRepos({ root: fixtures.root, depth: 1, now: NOW, settingFiles: async () => [], choices: { preset: "standard", secrets: true, dependencies: false, privateData: false, history: "all", localFiles: false, skip: [], analyse: false } });

	for (const marker of fixtures.markers) assert.equal(await ran(marker), false, `no program a repository names ran (${marker})`);

	const secretsIn = (name: string) => repoIn(report, name).findings.filter((finding) => finding.kind === "secret");
	for (const name of ["submodule", "replaced", "grafted", "merged"]) {
		assert.deepEqual(repoIn(report, name).errors, [], `${name}: scanned`);
		assert.ok(secretsIn(name).some((finding) => finding.ruleId === "aws-access-token"), `${name}: the key in its history is found`);
	}

	const settings = secretsIn("settings");
	assert.deepEqual(
		settings.map((finding) => finding.location),
		["keys/app.env:1"],
		"settings that blank or rewrite git's output change nothing: the key is found, at its own path",
	);
	assert.match(settings[0]!.detail, /^commit [0-9a-f]{8}/, "and the commit is named in full form, not with the date 0001-01-01");

	const named = secretsIn("named").map((finding) => finding.location.replace(/:\d+$/, "")).sort();
	assert.deepEqual(named, ["Pipfile.lock", "app.py", "logo.svg", "static/bootstrap.min.js"], "no file is skipped by its name, and gitleaks:allow hides nothing");

	const partial = repoIn(report, "partial");
	assert.equal(partial.errors.length, 1, "a partial clone is not read as clean");
	assert.match(partial.errors[0]!.message, /partial clone/);

	const shallow = repoIn(report, "shallow");
	assert.deepEqual(shallow.errors, []);
	assert.match(shallow.notCovered?.[0]?.message ?? "", /shallow clone/);
	assert.ok(coverageNotes(report).some((note) => /^gitleaks on shallow: .*shallow clone/.test(note)), "the cut-short history is named under Not covered");

	const text = JSON.stringify(report);
	for (const key of Object.values(fixtures.keys)) assert.ok(!text.includes(key), "no key value is in the report");
});

test("the copy leaves nothing behind, and the repository's own files are untouched", async (t) => {
	if (!(await installed("gitleaks"))) return t.skip("gitleaks is not installed");
	const root = await tempDir();
	const repo = join(root, "plain");
	await makeTree(repo, { "a.txt": "one\n" });
	await git(repo, "init", "-q");
	await git(repo, "add", "-A");
	await git(repo, "commit", "-q", "-m", "one");
	const config = await readFile(join(repo, ".git", "config"), "utf8");
	const { readdir } = await import("node:fs/promises");
	// A temporary folder of this test's own: other test files run at the same time and make copies too.
	const temporary = await tempDir();
	const earlier = process.env.TMPDIR;
	process.env.TMPDIR = temporary;
	try {
		await scanRepos({ root, depth: 1, now: NOW, settingFiles: async () => [] });
	} finally {
		if (earlier === undefined) delete process.env.TMPDIR;
		else process.env.TMPDIR = earlier;
	}

	assert.deepEqual((await readdir(temporary)).filter((name) => name.startsWith("porchlight-")), [], "the copy of the history, and every other temporary folder, is removed once read");
	assert.equal(await readFile(join(repo, ".git", "config"), "utf8"), config, "the repository's config is as it was");
});

test("a key staged but never committed is on this computer only, whatever the scan reads (B28)", async (t) => {
	if (!(await installed("gitleaks"))) return t.skip("gitleaks is not installed");
	const root = await tempDir();
	const repo = join(root, "staged");
	await makeTree(repo, { "README.md": "one\n" });
	await git(repo, "init", "-q");
	await git(repo, "add", "-A");
	await git(repo, "commit", "-q", "-m", "one");
	await writeFile(join(repo, "app.env"), `aws_access_key_id = ${fakeAwsKeyId()}\n`);
	await git(repo, "add", "app.env");

	const base = { preset: "custom" as const, secrets: true, dependencies: false, privateData: false, skip: [], analyse: false };
	const quick = await scanRepos({ root, depth: 1, now: NOW, settingFiles: async () => [], choices: { ...base, history: "none", localFiles: false } });
	const standard = await scanRepos({ root, depth: 1, now: NOW, settingFiles: async () => [], choices: { ...base, history: "all", localFiles: true } });
	for (const [name, report] of [["quick", quick], ["standard with local files", standard]] as const) {
		const found = report.repos[0]!.findings.filter((finding) => finding.location === "app.env:1");
		assert.equal(found.length, 1, `${name}: the staged key is found`);
		assert.equal(found[0]!.detail, "on this computer only, an uncommitted change", `${name}: and is not called committed`);
	}
});

test("Deep counts the addresses a file holds now, not only one commit's worth: a file grown one address a commit is a data dump (B29)", async (t) => {
	if (!(await installed("gitleaks"))) return t.skip("gitleaks is not installed");
	const root = await tempDir();
	const repo = join(root, "grown");
	await makeTree(repo, { "README.md": "one\n" });
	await git(repo, "init", "-q");
	const lines: string[] = [];
	for (let n = 1; n <= 25; n++) {
		lines.push(`person ${n}: ${["person", String(n)].join("")}${"@"}mailbox-${n}.org`);
		await writeFile(join(repo, "people.txt"), `${lines.join("\n")}\n`);
		await git(repo, "add", "-A");
		await git(repo, "commit", "-q", "-m", `add ${n}`);
	}
	const deep = await scanRepos({ root, depth: 1, now: NOW, settingFiles: async () => [], choices: { preset: "custom", secrets: true, dependencies: false, privateData: true, history: "all", localFiles: false, skip: [], analyse: false } });
	const found = deep.repos[0]!.findings.filter((finding) => finding.kind === "private-data" && finding.location.startsWith("people.txt"));
	assert.deepEqual(
		found.map((finding) => [finding.ruleId, finding.count, finding.severity]),
		[["private-data-dump", 25, "high"]],
	);
	assert.match(found[0]!.detail ?? "", /^commit [0-9a-f]{8} on /, "placed at the oldest commit, where it is most exposed");
	assert.deepEqual(deep.repos[0]!.notCovered ?? [], [], "reading the files as they are now adds nothing to Not covered");
});

test("a key committed in a repository nested in another is that repository's, committed, and a submodule not checked out is named (B30)", async (t) => {
	if (!(await installed("gitleaks"))) return t.skip("gitleaks is not installed");
	const root = await tempDir();
	const outer = join(root, "outer");
	await makeTree(outer, { "README.md": "outer\n" });
	await git(outer, "init", "-q");
	const inner = join(outer, "libs", "inner");
	await makeTree(inner, { "app.env": `aws_access_key_id = ${fakeAwsKeyId()}\n` });
	await git(inner, "init", "-q");
	await git(inner, "add", "-A");
	await git(inner, "commit", "-q", "-m", "inner");
	// A submodule the outer repository records but that is not checked out: a gitlink in its index alone.
	await git(outer, "update-index", "--add", "--cacheinfo", `160000,${FAKE_COMMIT},modules/theme`);
	await git(outer, "add", "README.md");
	await git(outer, "commit", "-q", "-m", "outer");

	const choices = { preset: "custom" as const, secrets: true, dependencies: false, privateData: false, history: "all" as const, localFiles: true, skip: [], analyse: false };
	const report = await scanRepos({ root, depth: 3, now: NOW, settingFiles: async () => [], choices });
	assert.deepEqual(
		report.repos.map((repo) => relative(root, repo.path)),
		["outer", "outer/libs/inner"],
		"the nested repository is scanned in its own right",
	);
	const [outerResult, innerResult] = report.repos;
	assert.deepEqual(outerResult!.findings, [], "its key is not called the outer repository's, on this computer only");
	assert.equal(innerResult!.findings.length, 1);
	assert.match(innerResult!.findings[0]!.detail, /^commit [0-9a-f]{8}/, "it is committed, in the repository that holds it");
	assert.deepEqual(report.notSearched, [{ name: "outer/modules/theme", reason: "it is a submodule that is not checked out here, so nothing in it was read" }]);

	// Searched less deep, the nested repository is not found, and is named rather than read as the outer's.
	const shallow = await scanRepos({ root: outer, depth: 0, now: NOW, settingFiles: async () => [], choices });
	assert.deepEqual(shallow.repos[0]!.findings, []);
	assert.deepEqual(
		shallow.notSearched?.map((entry) => entry.name),
		["libs/inner", "modules/theme"],
	);
});

test("keys in commit messages, tag messages and a file a tag points at are found, and a tag pointing at a folder is named (S57)", async (t) => {
	if (!(await installed("gitleaks"))) return t.skip("gitleaks is not installed");
	const root = await tempDir();
	const repo = join(root, "messages");
	await makeTree(repo, { "README.md": "one\n" });
	await git(repo, "init", "-q");
	await git(repo, "add", "-A");
	await git(repo, "commit", "-q", "-m", `deploy\n\nused aws_access_key_id = ${fakeAwsKeyId()} for this`);
	await git(repo, "tag", "-a", "v1", "-m", `release\n\naws_access_key_id = ${fakeAwsKeyId()}`);
	const blob = await new Promise<string>((done, fail) => {
		const child = execFile("git", ["-C", repo, "hash-object", "-w", "--stdin"], (err, stdout) => (err ? fail(err) : done(stdout.trim())));
		child.stdin!.end(`aws_access_key_id = ${fakeAwsKeyId()}\n`);
	});
	await git(repo, "tag", "loose-file", blob);
	const tree = await new Promise<string>((done, fail) => execFile("git", ["-C", repo, "rev-parse", "HEAD^{tree}"], (err, stdout) => (err ? fail(err) : done(stdout.trim()))));
	await git(repo, "tag", "a-folder", tree);

	const report = await scanRepos({ root, depth: 1, now: NOW, settingFiles: async () => [], choices: { preset: "standard", secrets: true, dependencies: false, privateData: false, history: "all", localFiles: false, skip: [], analyse: false } });
	const found = report.repos[0]!.findings.map((finding) => [finding.location, finding.detail.replace(/[0-9a-f]{8} on \d{4}-\d{2}-\d{2}/, "<commit>")]).sort();
	assert.deepEqual(found, [
		["commit message:3", "commit <commit>"],
		["file refs/tags/loose-file points at:1", "refs/tags/loose-file, a file rather than a commit"],
		["message of tag v1:3", "tag v1"],
	]);
	assert.deepEqual(report.repos[0]!.notCovered, [{ tool: "gitleaks", message: "refs/tags/a-folder points at a folder rather than a commit, which was not read" }]);
});
