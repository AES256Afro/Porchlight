// An unchanged repository's history scan is reused; anything that could change what it finds forces a
// full reading (M16: OP-1).
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { FULL_HISTORY, scanSecrets } from "../src/repos/gitleaks.ts";
import { FULL_READ_EVERY_MS, type HistoryReuse } from "../src/repos/history-reuse.ts";
import { scanRepos } from "../src/repos/scan.ts";
import { presetChoices } from "../ui/scan-choices.js";
import { run as realRun, type Runner } from "../src/repos/exec.ts";
import { FAKE_COMMIT, fakeAwsKeyId, fakeGit, fakeRunner, git, installed, makeTree, tempDir } from "./helpers.ts";

const START = new Date("2026-11-21T09:00:00Z");

/** A repository on disk (for its .gitleaksignore and git folder), git and gitleaks scripted around it. */
async function world() {
	const repo = join(await tempDir(), "service");
	const gitDir = join(repo, ".git");
	await mkdir(gitDir, { recursive: true });
	const state = { refs: `${FAKE_COMMIT} refs/heads/main\n`, gitleaksVersion: "8.30.1", shallowCopy: false, gitleaksFails: false };
	const run = fakeRunner({
		git: (args) => {
			if (args.includes("for-each-ref")) return { stdout: `${state.refs}${FAKE_COMMIT} refs/porchlight/head-0\n` };
			if (args.includes("--git-common-dir")) return { stdout: `${gitDir}\n` };
			if (args.includes("--is-shallow-repository")) return { stdout: state.shallowCopy ? "true\n" : "false\n" };
			return fakeGit(args);
		},
		gitleaks: (args) => {
			if (args[0] === "version") return { stdout: `${state.gitleaksVersion}\n` };
			if (state.gitleaksFails) return { code: 1, stderr: "ERR something broke" };
			if (args[0] === "git") return { stdout: JSON.stringify([{ RuleID: "generic-api-key", Description: "Generic API key", StartLine: 3, File: "config.js", Commit: "a".repeat(40), Date: "2026-01-02T03:04:05Z", Entropy: 4.2, Author: "Someone", Email: "someone@example.test", Match: "REDACTED", Secret: "REDACTED" }]) };
			return { stdout: "[]" };
		},
	});
	const historyRuns = () => run.calls.filter((call) => call[0] === "gitleaks" && call[1] === "git").length;
	let clock = START;
	const reuse: HistoryReuse = { dir: join(await tempDir(), "history-scans"), now: () => clock };
	return { repo, gitDir, state, run, historyRuns, reuse, later: (ms: number) => (clock = new Date(clock.getTime() + ms)) };
}

test("an unchanged repository's history is read once, then reused with its findings and its Not covered lines", async () => {
	const w = await world();
	w.state.shallowCopy = true;
	await writeFile(join(w.gitDir, "shallow"), `${FAKE_COMMIT}\n`);
	const first = await scanSecrets(w.repo, w.run, FULL_HISTORY, w.reuse);
	assert.equal(w.historyRuns(), 1);
	assert.equal(first.reusedFrom, undefined);
	assert.equal(first.findings.length, 1);
	assert.match(first.notCovered[0]!.message, /shallow/);

	w.later(60 * 60 * 1000);
	const second = await scanSecrets(w.repo, w.run, FULL_HISTORY, w.reuse);
	assert.equal(w.historyRuns(), 1, "the history was not read again");
	assert.equal(second.reusedFrom, START.toISOString());
	assert.deepEqual(second.findings, first.findings);
	assert.deepEqual(second.notCovered, first.notCovered, "what the reading could not cover is still said");

	// What is kept is what a report holds: no author, email or match, readable only by the owner.
	const [file] = await readdir(w.reuse.dir);
	const kept = await readFile(join(w.reuse.dir, file!), "utf8");
	assert.doesNotMatch(kept, /Someone|example\.test|REDACTED|Entropy|4\.2/);
	assert.equal((await stat(join(w.reuse.dir, file!))).mode & 0o777, 0o600);
});

test("a new commit, a rewrite, a new ignore file, a new shallow boundary or a new gitleaks reads the history again", async () => {
	const w = await world();
	await scanSecrets(w.repo, w.run, FULL_HISTORY, w.reuse);
	const changes: [string, () => Promise<void> | void][] = [
		["a new commit", () => void (w.state.refs = `${"2".repeat(40)} refs/heads/main\n`)],
		["a history rewritten back to the first commit", () => void (w.state.refs = `${FAKE_COMMIT} refs/heads/main\n`)],
		["a new tag", () => void (w.state.refs += `${"3".repeat(40)} refs/tags/v1\n`)],
		["a replace ref", () => void (w.state.refs += `${"4".repeat(40)} refs/replace/${FAKE_COMMIT}\n`)],
		[".gitleaksignore", () => writeFile(join(w.repo, ".gitleaksignore"), "config.js:generic-api-key:3\n")],
		["its shallow boundary", () => writeFile(join(w.gitDir, "shallow"), `${"5".repeat(40)}\n`)],
		["a new gitleaks", () => void (w.state.gitleaksVersion = "8.31.0")],
	];
	let expected = 1;
	for (const [what, change] of changes) {
		await change();
		await scanSecrets(w.repo, w.run, FULL_HISTORY, w.reuse);
		assert.equal(w.historyRuns(), ++expected, `${what} reads the history again`);
		await scanSecrets(w.repo, w.run, FULL_HISTORY, w.reuse);
		assert.equal(w.historyRuns(), expected, `and after ${what}, the new reading is reused`);
	}
});

test("a week on, a failed reading, or a reach that reads more than history: always read", async () => {
	const w = await world();
	await scanSecrets(w.repo, w.run, FULL_HISTORY, w.reuse);
	w.later(FULL_READ_EVERY_MS);
	await scanSecrets(w.repo, w.run, FULL_HISTORY, w.reuse);
	assert.equal(w.historyRuns(), 2, "read in full again after a week");

	w.state.refs = `${"6".repeat(40)} refs/heads/main\n`;
	w.state.gitleaksFails = true;
	await assert.rejects(scanSecrets(w.repo, w.run, FULL_HISTORY, w.reuse));
	w.state.gitleaksFails = false;
	await scanSecrets(w.repo, w.run, FULL_HISTORY, w.reuse);
	assert.equal(w.historyRuns(), 4, "a failure is never kept, so the next scan reads");

	// Private data and files git does not track are compared with the files as they are now: never reused.
	for (const scope of [{ ...FULL_HISTORY, privateData: true }, { ...FULL_HISTORY, localFiles: true }, { history: 50, localFiles: false }] as const) {
		const before = w.historyRuns();
		await scanSecrets(w.repo, w.run, scope, w.reuse);
		await scanSecrets(w.repo, w.run, scope, w.reuse);
		assert.equal(w.historyRuns(), before + 2, JSON.stringify(scope));
	}
});

test("a commit made while the history is read is not kept under the key from before it", async () => {
	const w = await world();
	let calls = 0;
	const moving = Object.assign(async (command: string, args: string[], options?: Parameters<typeof w.run>[2]) => {
		// The refs change after the first look, as a commit made during the reading would.
		if (command === "git" && args.includes("for-each-ref") && ++calls > 1) w.state.refs = `${"7".repeat(40)} refs/heads/main\n`;
		return w.run(command, args, options);
	});
	await scanSecrets(w.repo, moving, FULL_HISTORY, w.reuse);
	assert.deepEqual(await readdir(w.reuse.dir).catch(() => []), [], "nothing kept");
});

test("a Standard scan says which repositories' history it reused", async () => {
	const w = await world();
	const options = { root: join(w.repo, ".."), depth: 1, run: w.run, historyReuse: w.reuse, choices: { ...presetChoices("standard"), dependencies: false } };
	const first = await scanRepos(options);
	const second = await scanRepos(options);
	assert.equal(first.repos[0]!.historyReusedFrom, undefined);
	assert.equal(second.repos[0]!.historyReusedFrom, START.toISOString());
	assert.deepEqual(second.repos[0]!.findings, first.repos[0]!.findings);
	assert.equal(w.historyRuns(), 1);
});

test("with the real git and gitleaks: an unchanged repository is reused, a new commit or an amended one is read again", async (t) => {
	if (!(await installed("gitleaks"))) return t.skip("gitleaks is not installed");
	const repo = join(await tempDir(), "app");
	await makeTree(repo, { "config.js": `const key = "${fakeAwsKeyId()}";\n` });
	await git(repo, "init", "-q", "-b", "main");
	await git(repo, "add", ".");
	await git(repo, "commit", "-q", "-m", "first");
	const reads: string[][] = [];
	const run: Runner = (command, args, options) => {
		if (command === "gitleaks" && args[0] === "git") reads.push(args);
		return realRun(command, args, options);
	};
	const reuse: HistoryReuse = { dir: join(await tempDir(), "history-scans") };

	const first = await scanSecrets(repo, run, FULL_HISTORY, reuse);
	const second = await scanSecrets(repo, run, FULL_HISTORY, reuse);
	assert.equal(reads.length, 1, "the unchanged history was reused");
	assert.ok(first.findings.some((finding) => finding.location.startsWith("config.js")));
	assert.deepEqual(second.findings, first.findings);
	assert.ok(second.reusedFrom);

	await makeTree(repo, { "README.md": "notes\n" });
	await git(repo, "add", ".");
	await git(repo, "commit", "-q", "-m", "second");
	await scanSecrets(repo, run, FULL_HISTORY, reuse);
	assert.equal(reads.length, 2, "a new commit is read");

	// Rewriting the commit (the same tree, a new message) is a new history.
	await git(repo, "commit", "-q", "--amend", "-m", "second, reworded");
	const amended = await scanSecrets(repo, run, FULL_HISTORY, reuse);
	assert.equal(reads.length, 3, "an amended commit is read");
	assert.equal(amended.reusedFrom, undefined);
});
