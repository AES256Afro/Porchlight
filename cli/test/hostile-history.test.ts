// M9: a scanned repository is hostile input (invariant 14). Each fixture here is one way a repository's
// own .git could run a program or hide history from gitleaks' internal `git log -p`, found by the audit
// of 2026-11-20 (docs/AUDIT-PLAN-2026-11-20.md: S9, S14, S15, S16, S48, S53, S54, S55, S62, B63). All are
// scanned once, with the real git and gitleaks, through Porchlight's own copy of each history.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { access, chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { coverageNotes } from "../src/repos/report.ts";
import { scanRepos } from "../src/repos/scan.ts";
import type { RepoResult, ScanReport } from "../src/repos/types.ts";
import { fakeAwsKeyId, git, installed, makeTree, tempDir } from "./helpers.ts";

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
	const { tmpdir } = await import("node:os");
	const { readdir } = await import("node:fs/promises");
	const copies = async () => (await readdir(tmpdir())).filter((name) => name.startsWith("porchlight-copy-")).length;
	const before = await copies();

	await scanRepos({ root, depth: 1, now: NOW, settingFiles: async () => [] });

	assert.equal(await copies(), before, "the copy of the history is removed once read");
	assert.equal(await readFile(join(repo, ".git", "config"), "utf8"), config, "the repository's config is as it was");
});
