// FT-10: `porchlight hook`, a pre-commit check of the staged files with Porchlight's own rules.
import assert from "node:assert/strict";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "../src/repos/exec.ts";
import { checkStaged, hookCommand, hookScript, renderHook } from "../src/repos/hook.ts";
import { fakeAwsKeyId, fakeRunner, git, installed, makeTree, tempDir } from "./helpers.ts";

function io() {
	const out: string[] = [];
	const err: string[] = [];
	return { out, err, print: (text: string) => out.push(text), warn: (text: string) => err.push(text) };
}

test("hook print prints a hook for the owner to install, quoted for sh, and writes nothing", async () => {
	const dir = await tempDir();
	const streams = io();
	assert.equal(await hookCommand("print", streams, { run: fakeRunner({}), cwd: dir, node: "/opt/node 22/bin/node", porchlight: "/opt/porch'light/bin/porchlight.js" }), 0);
	assert.equal(streams.out[0], hookScript("/opt/node 22/bin/node", "/opt/porch'light/bin/porchlight.js"));
	assert.match(streams.out[0]!, /^#!\/bin\/sh\n/);
	assert.match(streams.out[0]!, /\nexec '\/opt\/node 22\/bin\/node' '\/opt\/porch'\\''light\/bin\/porchlight\.js' hook\n$/);
	assert.match(streams.err[0]!, /porchlight hook print > \.git\/hooks\/pre-commit/);
	assert.deepEqual(await readdir(dir), []);
	assert.throws(() => hookScript("/usr/bin/node\nrm -rf ~", "/x.js"), /line break/);
});

test("a check that cannot run stops the commit, and is never called clean", async () => {
	const streams = io();
	const missing = fakeRunner({ git: () => ({ code: 128, stderr: "fatal: not a git repository" }) });
	assert.equal(await hookCommand(undefined, streams, { run: missing, cwd: "/" }), 1);
	assert.match(streams.err[0]!, /the staged files were not checked: Not inside a git repository.*git commit --no-verify/);
});

test("reads the staged content from git's objects, with the caller's index, and none of the user's git settings", async () => {
	const id = "a".repeat(40);
	const runner = fakeRunner({
		git: (args) => {
			if (args.includes("rev-parse")) return { stdout: "/repo\n" };
			if (args.includes("ls-files")) return { stdout: [`100644 ${id} 0\tsrc/new.ts`, `100644 ${"b".repeat(40)} 0\tsame.ts`, `120000 ${"c".repeat(40)} 0\tlink`, ""].join("\x00") };
			if (args.includes("ls-tree")) return { stdout: `100644 blob ${"b".repeat(40)}\tsame.ts\x00` };
			if (args.includes("--batch-check")) return { stdout: `${id} blob 5\n` };
			if (args.includes("--batch")) return { stdout: `${id} blob 5\nhello\n` };
			return {};
		},
		gitleaks: () => ({ stdout: JSON.stringify([{ RuleID: "generic-api-key", File: "src/new.ts", StartLine: 1, Secret: "REDACTED", Match: "REDACTED" }]) }),
	});
	const result = await checkStaged("/repo/src", runner, { GIT_INDEX_FILE: ".git/next-index.lock", HOME: "/home/someone" });
	assert.deepEqual(result, { matches: [{ kind: "secret", rule: "generic-api-key", file: "src/new.ts", line: 1 }], staged: 1, unread: [], ignoreFile: false });
	const lsFiles = runner.calls.findIndex((call) => call.includes("ls-files"));
	assert.equal(runner.envs[lsFiles]?.GIT_INDEX_FILE, "/repo/.git/next-index.lock");
	assert.equal(runner.envs[lsFiles]?.GIT_CONFIG_GLOBAL, "/dev/null");
	const gitleaks = runner.calls.find((call) => call[0] === "gitleaks")!;
	assert.ok(gitleaks.includes("--redact"));
	assert.ok(gitleaks.includes("--ignore-gitleaks-allow"));
	assert.ok(!gitleaks.some((arg) => arg.endsWith(".gitleaks.toml")), "never the repository's own rules");
	assert.match(renderHook(result), /secret {2}generic-api-key {2}src\/new\.ts:1/);
	assert.doesNotMatch(renderHook(result), /REDACTED|hello/);
});

test("with the real gitleaks: finds a key in a staged file, prints its place and never its value", async (t) => {
	if (!(await installed("gitleaks"))) return t.skip("gitleaks is not installed");
	const repo = await tempDir();
	await git(repo, "init", "-q", "-b", "main");
	await makeTree(repo, { "README.md": "hello\n" });
	await git(repo, "add", ".");
	await git(repo, "commit", "-q", "-m", "first");

	const clean = io();
	assert.equal(await hookCommand(undefined, clean, { run, cwd: repo }), 0);
	assert.match(clean.out[0]!, /nothing found in 0 staged files/);

	const key = fakeAwsKeyId();
	await writeFile(join(repo, "config.env"), `REGION=eu\nAWS_ACCESS_KEY_ID=${key}\n`);
	await git(repo, "add", "config.env");
	const found = io();
	assert.equal(await hookCommand(undefined, found, { run, cwd: repo }), 1);
	const text = found.err.join("\n");
	assert.match(text, /secret {2}aws-access-token {2}config\.env:2/);
	assert.ok(!text.includes(key), "the value is never printed");
	assert.ok(!text.includes(key.slice(4)), "nor part of it");
});
