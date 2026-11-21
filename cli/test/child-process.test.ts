// M9: what a child process receives (S10, S13, S31), how osv-scanner is limited (S19), and how
// Porchlight's temporary folders are cleaned up (S33). See docs/AUDIT-PLAN-2026-11-20.md.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { findOnPath } from "../src/host/packages.ts";
import { childEnv, run, safePath, ToolMissingError } from "../src/repos/exec.ts";
import { OSV_LIMITS, scanDependencies } from "../src/repos/osv.ts";
import { STALE_AFTER_MS, sweepStaleTemp } from "../src/repos/temp.ts";
import { fakeRunner, tempDir } from "./helpers.ts";

test("a child process never receives Porchlight's keys, and finds programs only in absolute folders", () => {
	const env = childEnv(
		{ GIT_TERMINAL_PROMPT: "0" },
		{
			PATH: `${["", ".", "relative/bin", "/usr/bin", "/opt/homebrew/bin"].join(delimiter)}`,
			HOME: "/home/owner",
			HTTPS_PROXY: "http://proxy.example:3128",
			PORCHLIGHT_ADMIN_TOKEN: "admin",
			PORCHLIGHT_LLM_API_KEY: "model",
			PORCHLIGHT_GITHUB_TOKEN: "github",
			PORCHLIGHT_CLOUDFLARE_TOKEN: "cloudflare",
			PORCHLIGHT_UI_KEY: "ui",
			PORCHLIGHT_NOTIFY_URL: "https://hooks.example/x",
			GITHUB_TOKEN: "other",
			PYTHONPATH: "/somewhere",
		},
	);
	assert.deepEqual(Object.keys(env).sort(), ["GIT_TERMINAL_PROMPT", "HOME", "HTTPS_PROXY", "NPM_CONFIG_UPDATE_NOTIFIER", "PATH", "PYTHONSAFEPATH"]);
	assert.equal(env.PATH, ["/usr/bin", "/opt/homebrew/bin"].join(delimiter));
	assert.equal(env.PYTHONSAFEPATH, "1", "python3 -m pip never imports a repository's own pip/");
	assert.equal(env.NPM_CONFIG_UPDATE_NOTIFIER, "false", "npm does not ask the registry about itself");
	assert.equal(safePath(undefined), "");
});

test("a command runs in a private empty folder, never the one Porchlight was started in, and without its keys", async () => {
	const saved = process.env.PORCHLIGHT_ADMIN_TOKEN;
	process.env.PORCHLIGHT_ADMIN_TOKEN = "admin-token-that-must-not-leak-0123456789";
	try {
		const { stdout } = await run("sh", ["-c", 'pwd; env | grep -c PORCHLIGHT_ || true; ls -A | wc -l']);
		const [folder, keys, entries] = stdout.trim().split("\n").map((line) => line.trim());
		assert.match(folder!, /porchlight-run-/);
		assert.notEqual(folder, process.cwd());
		assert.equal(keys, "0");
		assert.equal(entries, "0");
	} finally {
		if (saved === undefined) delete process.env.PORCHLIGHT_ADMIN_TOKEN;
		else process.env.PORCHLIGHT_ADMIN_TOKEN = saved;
	}
});

test("a program in the folder a command runs in is not run in place of the real one (S10)", async () => {
	const repo = await tempDir();
	const fake = join(repo, "porchlight-probe-tool");
	await writeFile(fake, "#!/bin/sh\necho ran\n");
	await chmod(fake, 0o755);
	const saved = process.env.PATH;
	process.env.PATH = `${delimiter}.${delimiter}${saved}`;
	try {
		await assert.rejects(run("porchlight-probe-tool", [], { cwd: repo }), ToolMissingError);
	} finally {
		process.env.PATH = saved;
	}
	// The host check's own lookup skips relative folders too.
	assert.equal(await findOnPath("porchlight-probe-tool", [relative(process.cwd(), repo), "."].join(delimiter)), null);
	assert.equal(await findOnPath("porchlight-probe-tool", repo), fake);
});

test("osv-scanner never resolves, runs a toolchain or hashes vendored files, and says what that leaves out (S19)", async () => {
	const repo = await tempDir();
	const run = fakeRunner({
		"osv-scanner": () => ({ code: 0, stdout: "{}", stderr: `Scanned ${repo}/api/requirements.txt file and found 2 packages\nScanned ${repo}/requirements-dev.txt file and found 1 package\n` }),
		git: (args) => (args.includes("ls-files") ? { stdout: "api/requirements.txt\0requirements-dev.txt\0" } : {}),
	});
	const { notCovered } = await scanDependencies(repo, run);
	const scan = run.calls.find((call) => call[0] === "osv-scanner")!;
	for (const limit of OSV_LIMITS) assert.ok(scan.includes(limit), limit);
	assert.deepEqual(OSV_LIMITS, ["--no-resolve", "--no-call-analysis=all", "--x-disable-plugins=filesystem/vendored"]);
	assert.deepEqual(notCovered, [{ tool: "osv-scanner", message: "packages its requirements-dev.txt and requirements.txt files pull in indirectly were not worked out: that would send their names to deps.dev" }]);

	const none = await scanDependencies(repo, fakeRunner({ "osv-scanner": () => ({ code: 128 }) }));
	assert.deepEqual(none.notCovered, [], "nothing to say when no such manifest is tracked");
});

test("a filter osv-scanner applied is named wherever it was, and a lockfile it did not read is said (S17, S18)", async () => {
	const repo = await tempDir();
	// osv-scanner's own words, as 2.7 writes them (checked against the real binary).
	const stderr = [
		`Scanned ${repo}/build/package-lock.json file and found 1 package`,
		`Scanned ${repo}/empty/package-lock.json file and found 0 packages`,
		`Loaded filter from: ${repo}/build/osv-scanner.toml`,
		"Filtered 1 ignored package/s from the scan.",
	].join("\n");
	const run = fakeRunner({
		"osv-scanner": () => ({ code: 0, stdout: "{}", stderr }),
		git: (args) => (args.includes("ls-files") ? { stdout: "app/package-lock.json\0build/package-lock.json\0empty/package-lock.json\0vendor/node_modules/x/package-lock.json\0" } : {}),
	});
	const result = await scanDependencies(repo, run);
	assert.deepEqual(result.settingFiles, ["build/osv-scanner.toml"], "a filter in a folder the setting-file search skips is still named");
	assert.deepEqual(result.notCovered, [{ tool: "osv-scanner", message: "a lockfile git tracks was not read (app/package-lock.json), most likely because the repository's .gitignore covers it" }]);
	const listed = run.calls.find((call) => call[0] === "git")!;
	assert.ok(listed.includes(":(glob)**/package-lock.json") && listed.includes(":(glob)**/requirements*.txt"));
});

test("temporary folders a crash left are removed at the next start, and nothing else (S33)", async () => {
	const base = await tempDir();
	const now = Date.now();
	const old = new Date(now - STALE_AFTER_MS - 60_000);
	for (const name of ["porchlight-copy-AbC123", "porchlight-files-xyz789", "porchlight-run-recent", "porchlight-test-old123", "other-copy-AbC123"]) {
		await mkdir(join(base, name));
		await writeFile(join(base, name, "config.env"), "secret\n");
		if (name !== "porchlight-run-recent") await utimes(join(base, name), old, old);
	}
	assert.equal(await sweepStaleTemp(now, base), 2);
	assert.deepEqual((await readdir(base)).sort(), ["other-copy-AbC123", "porchlight-run-recent", "porchlight-test-old123"]);
});

test("a stopped process removes its temporary folders on SIGTERM (S33)", async () => {
	const temp = fileURLToPath(new URL("../src/repos/temp.ts", import.meta.url));
	const child = spawn(process.execPath, ["--input-type=module", "-e", `const m = await import(${JSON.stringify(temp)}); const dir = await m.makeTemp("copy"); console.log(dir); setInterval(() => {}, 1000);`], { stdio: ["ignore", "pipe", "inherit"] });
	const dir = await new Promise<string>((resolve) => child.stdout.once("data", (data: Buffer) => resolve(data.toString().trim())));
	assert.ok((await readdir(tmpdir())).includes(dir.split("/").at(-1)!));
	const ended = new Promise<NodeJS.Signals | null>((resolve) => child.once("exit", (_code, signal) => resolve(signal)));
	child.kill("SIGTERM");
	assert.equal(await ended, "SIGTERM", "it still stops as SIGTERM stops it");
	assert.ok(!(await readdir(tmpdir())).includes(dir.split("/").at(-1)!), "the folder is gone");
});
