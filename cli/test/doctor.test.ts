import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { renderDoctor, runDoctor, type Check } from "../src/doctor.ts";
import { asksForHelp, helpFor, usage } from "../src/help.ts";
import { doctor, main } from "../src/main.ts";
import { ToolMissingError, type Runner } from "../src/repos/exec.ts";

const TOKEN = "t".repeat(40);

/** A runner where only the named programs are installed. */
function installed(...names: string[]): Runner {
	return async (command) => {
		if (!names.includes(command)) throw new ToolMissingError(command);
		return { code: 0, stdout: `${command} version 1.2.3\n`, stderr: "" };
	};
}

async function withDataDir<T>(body: (dir: string) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "porchlight-doctor-"));
	try {
		await chmod(dir, 0o700);
		return await body(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

const byName = (checks: Check[]) => Object.fromEntries(checks.map((check) => [check.name, check]));

test("doctor passes a working setup and contacts nothing when offline", async () => {
	await withDataDir(async (dataDir) => {
		const checks = byName(await runDoctor({ run: installed("git", "gitleaks", "osv-scanner"), env: {}, dataDir, nodeVersion: "24.22.0" }));

		assert.deepEqual(
			Object.values(checks).map((check) => `${check.status} ${check.name}`),
			["ok Node.js", "ok git", "ok gitleaks", "ok osv-scanner", "ok Porchlight's folder", "note Last scan", "note Monitor", "note Model", "note GitHub", "note Cloudflare"],
		);
		assert.equal(checks.gitleaks!.detail, "Version 1.2.3.");
	});
});

test("doctor tells a missing scanner, which leaves a scan incomplete, from having none at all", async () => {
	await withDataDir(async (dataDir) => {
		const one = byName(await runDoctor({ run: installed("git", "gitleaks"), env: {}, dataDir, nodeVersion: "24.22.0" }));
		assert.deepEqual([one.gitleaks!.status, one["osv-scanner"]!.status, one["osv-scanner"]!.fix], ["ok", "warning", "brew install osv-scanner"]);

		const none = byName(await runDoctor({ run: installed(), env: {}, dataDir, nodeVersion: "22.10.0" }));
		assert.deepEqual([none["Node.js"]!.status, none.git!.status, none.gitleaks!.status, none["osv-scanner"]!.status], ["problem", "problem", "problem", "problem"]);
		assert.match(renderDoctor(Object.values(none)), /4 things stop Porchlight from working/);
	});
});

test("doctor reports the folder, the scan and each setting without printing a secret", async () => {
	await withDataDir(async (dataDir) => {
		await chmod(dataDir, 0o755);
		await writeFile(join(dataDir, "repo-scan.json"), JSON.stringify({ root: "/work", scannedAt: "2026-11-20T12:00:00.000Z", tools: [], repos: [{}, {}] }));
		const seen: string[] = [];
		const fetchFn = (async (url: URL, init?: RequestInit) => {
			seen.push(`${url} ${(init?.headers as Record<string, string> | undefined)?.authorization ? "with token" : "no token"}`);
			if (String(url).includes("monitor.example")) return Response.json({ error: "Unauthorized" }, { status: 401 });
			return Response.json({ models: [{ name: "other:latest" }] });
		}) as unknown as typeof fetch;
		const env = {
			PORCHLIGHT_MONITOR_URL: "https://monitor.example",
			PORCHLIGHT_ADMIN_TOKEN: TOKEN,
			PORCHLIGHT_LLM_URL: "http://localhost:11434",
			PORCHLIGHT_LLM_MODEL: "qwen-test:9b",
			PORCHLIGHT_GITHUB_TOKEN: "not a token",
		};

		const all = await runDoctor({ run: installed("git", "gitleaks", "osv-scanner"), env, dataDir, nodeVersion: "24.22.0", fetchFn });
		const checks = byName(all);

		assert.deepEqual([checks["Porchlight's folder"]!.status, checks["Porchlight's folder"]!.fix], ["warning", `chmod 700 ${dataDir}`]);
		assert.equal(checks["Last scan"]!.detail, "2 repositories, scanned 2026-11-20.");
		assert.match(checks.Monitor!.detail, /monitor\.example refused the admin token/);
		assert.deepEqual([checks.Model!.status, checks.Model!.fix], ["warning", "ollama pull qwen-test:9b"]);
		assert.equal(checks.GitHub!.status, "warning");
		assert.deepEqual(seen, ["https://monitor.example/domains with token", "http://localhost:11434/api/tags no token"]);
		assert.ok(!JSON.stringify(all).includes(TOKEN) && !renderDoctor(all).includes(TOKEN), "the admin token is never printed");
	});
});

test("doctor never contacts a hosted model, and exits 1 only when something essential is missing", async () => {
	await withDataDir(async (dataDir) => {
		const fetchFn = (async () => {
			throw new Error("nothing should be contacted");
		}) as unknown as typeof fetch;
		const env = { PORCHLIGHT_LLM_PROVIDER: "anthropic", PORCHLIGHT_LLM_API_KEY: "k".repeat(40) };
		const checks = byName(await runDoctor({ run: installed("git", "gitleaks", "osv-scanner"), env, dataDir, nodeVersion: "24.22.0", fetchFn }));
		assert.match(checks.Model!.detail, /hosted.*Not contacted/);
		assert.ok(!checks.Model!.detail.includes("k".repeat(40)));

		let printed = "";
		const write = (text: string) => void (printed += text);
		assert.equal(await doctor(["--offline"], { run: installed("git", "gitleaks"), env: {}, dataDir, nodeVersion: "24.22.0", write }), 0);
		assert.match(printed, /Porchlight works\. 1 thing is worth a look/);
		assert.equal(await doctor(["--offline", "--json"], { run: installed(), env: {}, dataDir, nodeVersion: "24.22.0", write: () => {} }), 1);
	});
});

test("each command has its own help, and a group lists its commands", () => {
	assert.match(helpFor(["repos", "scan", "--help"])!, /^Usage: porchlight repos scan \[path\]/);
	assert.doesNotMatch(helpFor(["repos", "scan"])!, /Usage: porchlight repos export/);
	const group = helpFor(["repos"])!;
	assert.ok(group.includes("porchlight repos scan") && group.includes("porchlight repos export"));
	assert.match(helpFor(["domains", "verify"])!, /Usage: porchlight domains <command>/);
	assert.equal(helpFor(["nonsense"]), null);
	for (const command of ["repos scan", "repos export", "domains", "host check", "cloudflare audit", "ui", "doctor"]) assert.ok(usage().includes(`  ${command} `), command);

	assert.deepEqual([[], ["help"], ["ui", "--help"], ["repos", "scan", "-h"], ["ui"], ["repos", "export", "r.json", "--", "--help"]].map(asksForHelp), [true, true, true, true, false, false]);
});

test("help and the version exit 0, and a mistyped command exits 1", async () => {
	assert.equal(await main(["repos", "scan", "--help"]), 0);
	assert.equal(await main(["--version"]), 0);
	assert.equal(await main(["help", "doctor"]), 0);
	assert.equal(await main(["repos", "scna"]), 1);
});
