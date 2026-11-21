// Measures M16's done-when figures for the UI server on made-up reports (cli/test/big-report.ts):
//   node scripts/measure-speed.ts
// - the report's response on the wire at 5,000 findings (OP-5: under 300 KB),
// - the server's RSS over 25 report requests at 20,000 findings (R6O-1: under 200 MB), from the server
//   idle with the report (it has answered the page once and settled), with the report unchanged and with
//   a judgement saved before each request (a Deeper analysis, where the page asked for the report again),
// - the newest judgement on its own, which the page now asks for instead (OP-6),
// - the page's own files raw and gzipped (OP-7),
// - a made-up repository's history read in full and then reused unchanged (OP-1; needs gitleaks).
// The server runs in a child process, so its memory is measured apart from this one's. Nothing leaves
// this computer: the only server is the one it starts on the loopback address, in a temporary folder.
import { execFile, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as sleep } from "node:timers/promises";
import { promisify } from "node:util";
import { saveAnalysis, unitKey, type Judgement } from "../cli/src/analysis/analyse.ts";
import { run } from "../cli/src/repos/exec.ts";
import { FULL_HISTORY, scanSecrets } from "../cli/src/repos/gitleaks.ts";
import { repoName } from "../cli/src/repos/report.ts";
import { SCRIPTS, STYLES, startUiServer } from "../cli/src/ui/server.ts";
import { bigReport } from "../cli/test/big-report.ts";

const KB = 1024;
const MB = 1024 * 1024;

interface Address {
	port: number;
	sessionKey: string;
}

function get(server: Address, path: string, gzip: boolean, key = true): Promise<{ status: number; bytes: number }> {
	return new Promise((resolve, reject) => {
		const headers: Record<string, string> = { ...(key ? { "x-porchlight-session": server.sessionKey } : {}), ...(gzip ? { "accept-encoding": "gzip, deflate, br" } : {}) };
		const req = request({ host: "127.0.0.1", port: server.port, method: "GET", path, headers }, (res) => {
			let bytes = 0;
			res.on("data", (chunk: Buffer) => (bytes += chunk.length));
			res.on("end", () => resolve({ status: res.statusCode ?? 0, bytes }));
		});
		req.on("error", reject);
		req.end();
	});
}

/** The UI server in a child process, asked about its own memory over its standard input and output. */
interface Child {
	server: Address;
	/** Asks the child: `rss` (now), `peak` (the highest sampled since the last `reset`), `reset`, `max` (its lifetime high-water mark). */
	ask(question: "rss" | "peak" | "reset" | "max"): Promise<number>;
	close(): void;
}

async function serve(reportPath: string, dir: string): Promise<Child> {
	const child = spawn(process.execPath, [import.meta.filename, "serve", reportPath, dir], { stdio: ["pipe", "pipe", "inherit"] });
	const waiting: ((line: string) => void)[] = [];
	createInterface({ input: child.stdout! }).on("line", (line) => waiting.shift()?.(line));
	const next = () => new Promise<string>((resolve) => waiting.push(resolve));
	const server = JSON.parse(await next()) as Address;
	return {
		server,
		async ask(question) {
			const answer = next();
			child.stdin!.write(`${question}\n`);
			return Number(await answer);
		},
		close: () => child.kill(),
	};
}

async function withServer<T>(findings: number, work: (child: Child, dir: string, report: ReturnType<typeof bigReport>) => Promise<T>): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), "porchlight-measure-"));
	try {
		await mkdir(join(dir, "state"));
		const report = bigReport("/work", findings);
		await writeFile(join(dir, "state", "repo-scan.json"), JSON.stringify(report));
		const child = await serve(join(dir, "state", "repo-scan.json"), dir);
		try {
			return await work(child, dir, report);
		} finally {
			child.close();
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

/** Waits until the child's memory stops falling (V8 gives memory back a while after it goes idle), at most `limitMs`. */
async function settle(child: Child, limitMs = 45_000): Promise<number> {
	let last = await child.ask("rss");
	for (let waited = 0; waited < limitMs; waited += 3000) {
		await sleep(3000);
		const now = await child.ask("rss");
		if (now >= last - MB && waited >= 9000) return now;
		last = Math.min(last, now);
	}
	return last;
}

if (process.argv[2] === "serve") {
	const [reportPath, dir] = process.argv.slice(3) as [string, string];
	const server = await startUiServer({ port: 0, reportPath, defaultRoot: dir, dataDir: join(dir, "data"), monitor: null, monitorError: "none" });
	console.log(JSON.stringify({ port: server.port, sessionKey: server.sessionKey }));
	let peak = process.memoryUsage.rss();
	setInterval(() => (peak = Math.max(peak, process.memoryUsage.rss())), 2).unref();
	createInterface({ input: process.stdin }).on("line", (question) => {
		const rss = process.memoryUsage.rss();
		peak = Math.max(peak, rss);
		if (question === "reset") peak = rss;
		// maxRSS is the process's lifetime high-water mark, in kilobytes.
		console.log(question === "peak" ? peak : question === "max" ? process.resourceUsage().maxRSS * 1024 : rss);
	});
} else {
	await measure();
}

async function measure(): Promise<void> {
	const results: string[] = [];
	const say = (line: string) => {
		results.push(line);
		console.log(line);
	};
	const mb = (bytes: number) => `${(bytes / MB).toFixed(0)} MB`;

	await withServer(5000, async ({ server }) => {
		const plain = await get(server, "/api/repos/report", false);
		const zipped = await get(server, "/api/repos/report", true);
		say(`OP-5  report at 5,000 findings: ${(plain.bytes / KB).toFixed(0)} KB plain, ${(zipped.bytes / KB).toFixed(0)} KB gzipped on the wire (limit 300 KB): ${zipped.bytes < 300 * KB ? "pass" : "FAIL"}`);
	});

	await withServer(20000, async (child, dir, report) => {
		const { server } = child;
		const started = await child.ask("rss");
		await get(server, "/api/repos/report", true);
		const firstBuild = await child.ask("max");
		const idle = await settle(child);
		say(`R6O-1 server at 20,000 findings: ${mb(started)} started, ${mb(firstBuild)} high-water after building the first response, ${mb(idle)} idle with the report`);

		await child.ask("reset");
		for (let i = 0; i < 25; i++) await get(server, "/api/repos/report", i % 2 === 0);
		const steady = await child.ask("peak");
		say(`R6O-1 25 report requests, report unchanged: peak RSS ${mb(steady)} (limit 200 MB): ${steady < 200 * MB ? "pass" : "FAIL"}`);

		// A Deeper analysis saves a judgement after each finding. Before OP-6 the page asked for the whole
		// report each time, and the response was rebuilt for each; this is that worst case.
		const units = report.repos.map((repo) => unitKey(repoName(report, repo), repo.findings[0]!));
		const items: Record<string, Judgement> = {};
		await child.ask("reset");
		for (let i = 0; i < 25; i++) {
			items[units[i]!] = { verdict: "likely", reason: "Made up for a measurement.", steps: [], model: "none", at: new Date(Date.UTC(2026, 10, 20, 10, 0, i)).toISOString() };
			await saveAnalysis(join(dir, "state", "repo-analysis.json"), { scannedAt: report.scannedAt, items });
			await get(server, "/api/repos/report", true);
		}
		const judging = await child.ask("peak");
		say(`R6O-1 25 report requests, a judgement saved before each: peak RSS ${mb(judging)} (limit 200 MB): ${judging < 200 * MB ? "pass" : "FAIL"}`);

		const whole = await get(server, "/api/repos/report", true);
		const delta = await get(server, `/api/analysis/judgements?since=${encodeURIComponent(items[units[24]!]!.at)}`, true);
		say(`OP-6  the newest judgement on its own: ${delta.bytes} bytes, where the page fetched the report (${(whole.bytes / KB).toFixed(0)} KB gzipped) and history each time before`);
	});

	await withServer(1, async ({ server }) => {
		let raw = 0;
		let zipped = 0;
		for (const path of ["/", ...STYLES.map((name) => `/${name}.css`), ...SCRIPTS.map((name) => `/${name}.js`)]) {
			raw += (await get(server, path, false, false)).bytes;
			zipped += (await get(server, path, true, false)).bytes;
		}
		say(`OP-7  the page's ${SCRIPTS.length + STYLES.length + 1} files: ${(raw / KB).toFixed(0)} KB plain, ${(zipped / KB).toFixed(0)} KB gzipped; unchanged ones answered 304 afterwards`);
	});

	await measureHistoryReuse(say);

	if (results.some((line) => line.endsWith("FAIL"))) process.exitCode = 1;
}

/** OP-1: a made-up repository of 300 commits, its history read once, then again unchanged. Needs git and gitleaks. */
async function measureHistoryReuse(say: (line: string) => void): Promise<void> {
	const exec = promisify(execFile);
	try {
		await exec("gitleaks", ["version"]);
	} catch {
		say("OP-1  skipped: gitleaks is not installed");
		return;
	}
	const dir = await mkdtemp(join(tmpdir(), "porchlight-measure-"));
	try {
		const repo = join(dir, "repo");
		await mkdir(repo);
		const git = (...args: string[]) => exec("git", ["-c", "user.name=Measure", "-c", "user.email=measure@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: repo });
		await git("init", "-q", "-b", "main");
		for (let i = 0; i < 300; i++) {
			await writeFile(join(repo, `file-${i % 40}.js`), `export const value${i} = ${i};\n`.repeat(20));
			await git("add", ".");
			await git("commit", "-q", "-m", `change ${i}`);
		}
		const reuse = { dir: join(dir, "history-scans") };
		const timed = async () => {
			const started = performance.now();
			const result = await scanSecrets(repo, run, FULL_HISTORY, reuse);
			return { ms: performance.now() - started, reused: result.reusedFrom !== undefined };
		};
		const first = await timed();
		const second = await timed();
		say(`OP-1  history of 300 commits: ${first.ms.toFixed(0)} ms read in full, ${second.ms.toFixed(0)} ms when unchanged (${second.reused ? "reused" : "NOT reused: FAIL"})`);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}
