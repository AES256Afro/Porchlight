import assert from "node:assert/strict";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { assistantConfig } from "../src/assist/ollama.ts";
import type { HostReport } from "../src/host/types.ts";
import { listenOnFirstFree } from "../src/main.ts";
import { monitorConfig } from "../src/monitor/client.ts";
import { CancelledError, type Runner } from "../src/repos/exec.ts";
import type { ScanOptions } from "../src/repos/scan.ts";
import type { ScanReport } from "../src/repos/types.ts";
import { hostAllowed, MIN_KEY_LENGTH, originAllowed, SCRIPTS, startUiServer, type UiOptions, type UiServer } from "../src/ui/server.ts";
import { makeTree, tempDir } from "./helpers.ts";

const ADMIN_TOKEN = "admin-token-that-must-never-reach-the-browser";

async function start(t: TestContext, overrides: Partial<UiOptions> = {}): Promise<UiServer & { dir: string }> {
	const dir = await tempDir();
	const server = await startUiServer({
		port: 0,
		reportPath: join(dir, "state", "repo-scan.json"),
		defaultRoot: dir,
		monitor: null,
		monitorError: "Set PORCHLIGHT_MONITOR_URL",
		...overrides,
	});
	t.after(() => server.close());
	return Object.assign(server, { dir });
}

interface Reply {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	text: string;
	// oxlint-disable-next-line typescript/no-explicit-any -- assertions read arbitrary response shapes
	json: any;
}

/** A raw request, so tests can send headers a browser would not let a page set. */
function send(
	server: UiServer,
	method: string,
	path: string,
	options: { key?: string | null; headers?: Record<string, string>; body?: unknown; rawBody?: string; host?: string } = {},
): Promise<Reply> {
	const key = options.key === undefined ? server.sessionKey : options.key;
	const payload = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
	const headers: Record<string, string> = {
		...(key === null ? {} : { "x-porchlight-session": key }),
		...(payload === undefined ? {} : { "content-type": "application/json" }),
		...options.headers,
	};
	return new Promise((resolve, reject) => {
		const req = request({ host: options.host ?? "127.0.0.1", port: server.port, method, path, headers }, (res) => {
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
				resolve({ status: res.statusCode ?? 0, headers: res.headers, text, json });
			});
		});
		req.on("error", reject);
		req.end(payload);
	});
}

const finding = (severity: "critical" | "high" | "medium" | "low", kind: "secret" | "vulnerability" = "vulnerability") => ({
	tool: kind === "secret" ? ("gitleaks" as const) : ("osv-scanner" as const),
	kind,
	severity,
	ruleId: `rule-${severity}`,
	title: `A ${severity} problem`,
	location: "package-lock.json",
	detail: "pkg@1.0.0",
});

function sampleReport(root: string): ScanReport {
	return {
		root,
		scannedAt: "2026-11-17T12:00:00.000Z",
		tools: [
			{ tool: "gitleaks", status: "ok", version: "8.30.1", installHint: "brew install gitleaks" },
			{ tool: "osv-scanner", status: "missing", installHint: "brew install osv-scanner" },
		],
		repos: [
			{ path: join(root, "clean"), findings: [], errors: [] },
			{ path: join(root, "mild"), findings: [finding("low"), finding("medium")], errors: [] },
			{ path: join(root, "group/worst"), findings: [finding("high", "secret"), finding("critical")], errors: [] },
		],
	};
}

test("serves the page with headers that confine it to this server", async (t) => {
	const server = await start(t);

	const page = await send(server, "GET", "/", { key: null });

	assert.equal(page.status, 200);
	assert.match(page.text, /<title>Porchlight<\/title>/);
	assert.match(String(page.headers["content-security-policy"]), /default-src 'none'.*script-src 'self'.*frame-ancestors 'none'/);
	assert.equal(page.headers["x-content-type-options"], "nosniff");
	assert.equal(page.headers["cache-control"], "no-store");
	assert.ok(!page.text.includes(server.sessionKey), "the page itself must not contain the session key");
	const scripts = ["app", "api", "dom", "filter", "list", "hints", "generated", "store", "export", "assist", "overview", "findings", "roadmap", "repos", "domains"];
	for (const asset of ["/styles.css", "/favicon.svg", ...scripts.map((name) => `/${name}.js`)]) {
		assert.equal((await send(server, "GET", asset, { key: null })).status, 200, asset);
	}
});

test("serves every script in ui/, so a new one cannot be left out", async () => {
	const { readdir } = await import("node:fs/promises");
	const files = (await readdir(new URL("../ui/", import.meta.url))).filter((name) => name.endsWith(".js")).map((name) => name.slice(0, -3));
	assert.deepEqual([...SCRIPTS].sort(), files.sort());
});

test("serves only its own files", async (t) => {
	const server = await start(t);

	for (const path of ["/../package.json", "/..%2f..%2fpackage.json", "/ui/../package.json", "/src/main.ts", "/index.html", "/nope"]) {
		assert.equal((await send(server, "GET", path, { key: null })).status, 404, path);
	}
	assert.equal((await send(server, "POST", "/", { key: null })).status, 405);
});

test("refuses requests addressed to any other host name", async (t) => {
	const server = await start(t);

	// What a DNS-rebinding page would send: the right port, its own host name.
	for (const host of ["evil.example", `evil.example:${server.port}`, "127.0.0.1", `127.0.0.1.evil.example:${server.port}`]) {
		assert.equal((await send(server, "GET", "/api/state", { headers: { host } })).status, 403, host);
		assert.equal((await send(server, "GET", "/", { headers: { host } })).status, 403, host);
	}
	assert.equal((await send(server, "GET", "/api/state", { headers: { host: `localhost:${server.port}` } })).status, 200);
});

test("requires the session key on every API call and refuses cross-site origins", async (t) => {
	const server = await start(t);

	assert.equal((await send(server, "GET", "/api/state", { key: null })).status, 401);
	assert.equal((await send(server, "GET", "/api/state", { key: "wrong" })).status, 401);
	assert.equal((await send(server, "GET", "/api/state", { key: `${server.sessionKey}x` })).status, 401);
	assert.equal((await send(server, "POST", "/api/repos/scan", { key: null, body: { root: "/" } })).status, 401);

	const crossSite = await send(server, "GET", "/api/state", { headers: { origin: "https://evil.example" } });
	assert.equal(crossSite.status, 403);
	const sameSite = await send(server, "GET", "/api/state", { headers: { origin: `http://127.0.0.1:${server.port}` } });
	assert.equal(sameSite.status, 200);
	assert.deepEqual(sameSite.json.monitor, { configured: false, error: "Set PORCHLIGHT_MONITOR_URL", unset: false });
	// On loopback it was started from a terminal, so the page explains setup in shell terms.
	assert.equal(sameSite.json.service, false);
	assert.deepEqual(sameSite.json.scan, { state: "idle" });
});

test("answers /healthz without the key, and says nothing else there", async (t) => {
	const server = await start(t);

	const health = await send(server, "GET", "/healthz", { key: null });
	assert.equal(health.status, 200);
	assert.equal(health.text, "ok\n");
	assert.equal((await send(server, "POST", "/healthz", { key: null })).status, 405);
	assert.equal((await send(server, "GET", "/healthz", { key: null, headers: { host: "evil.example" } })).status, 403);
});

test("listens beyond loopback only with a fixed key long enough to guard it", async (t) => {
	const dir = await tempDir();
	const base = { port: 0, reportPath: join(dir, "repo-scan.json"), defaultRoot: dir, monitor: null };
	const key = "k".repeat(MIN_KEY_LENGTH);

	// Refused before anything listens.
	await assert.rejects(startUiServer({ ...base, host: "0.0.0.0" }), /PORCHLIGHT_UI_KEY/);
	await assert.rejects(startUiServer({ ...base, host: "0.0.0.0", sessionKey: key.slice(1) }), /at least 32/);
	await assert.rejects(startUiServer({ ...base, host: "0.0.0.0", sessionKey: `${key.slice(1)} ` }), /no spaces/);
	// A key given on loopback is held to the same rule.
	await assert.rejects(startUiServer({ ...base, sessionKey: "short" }), /at least 32/);

	const server = await startUiServer({ ...base, sessionKey: key });
	t.after(() => server.close());
	assert.equal(server.sessionKey, key);
	assert.equal((await send(server, "GET", "/api/state")).status, 200);
	assert.equal((await send(server, "GET", "/api/state", { key: null })).status, 401);
});

test("a refused key says whether this is a service or another device, and nothing more", async (t) => {
	const local = await start(t);
	assert.deepEqual((await send(local, "GET", "/api/state", { key: null })).json, { error: "Session key required", service: false, tailnet: false });

	// A second loopback address stands in for "beyond loopback" without opening a port to the network.
	// macOS has none by default, so there the flag is covered by the expression alone.
	const service = await start(t, { host: "127.0.0.2", sessionKey: "k".repeat(MIN_KEY_LENGTH) }).catch(() => null);
	if (service) {
		assert.deepEqual((await send(service, "GET", "/api/state", { key: null, host: "127.0.0.2" })).json, { error: "Session key required", service: true, tailnet: false });
	}
});

test("previews what a scan would cover without running anything", async (t) => {
	const scans: string[] = [];
	const server = await start(t, {
		scan: async (options) => {
			scans.push(options.root);
			return { root: options.root, scannedAt: "2026-11-17T22:00:00Z", tools: [], repos: [] };
		},
	});
	await makeTree(server.dir, { "projects/shop/.git/HEAD": "ref", "projects/blog/.git/HEAD": "ref", "projects/notes/readme.md": "x", "projects/deep/a/b/c/site/.git/HEAD": "ref" });
	const root = join(server.dir, "projects");
	const preview = async (query: string) => (await send(server, "GET", `/api/repos/preview?${query}`)).json.preview;

	assert.deepEqual(await preview(`root=${encodeURIComponent(root)}`), { root, exists: true, total: 2, repos: ["blog", "shop"], fetched: 0, depth: 3 });
	assert.deepEqual((await preview(`root=${encodeURIComponent(root)}&depth=6`)).repos, ["blog", "deep/a/b/c/site", "shop"]);
	// A folder that is itself a repository is named as the report names it.
	assert.deepEqual((await preview(`root=${encodeURIComponent(join(root, "shop"))}`)).repos, ["shop"]);
	// An empty folder and a missing one are different answers, and neither is an error.
	assert.deepEqual(await preview(`root=${encodeURIComponent(join(root, "notes"))}`), { root: join(root, "notes"), exists: true, total: 0, repos: [], fetched: 0, depth: 3 });
	assert.equal((await preview(`root=${encodeURIComponent(join(root, "missing"))}`)).exists, false);
	// With no folder named, the one the server was started with.
	assert.equal((await preview("")).root, server.dir);

	assert.equal((await send(server, "GET", `/api/repos/preview?root=${encodeURIComponent(root)}&depth=9`)).status, 400);
	assert.equal((await send(server, "GET", "/api/repos/preview?root=", { key: null })).status, 401);
	assert.deepEqual(scans, []);
});

test("fetches chosen repositories from GitHub one at a time, and scans them along with the folder", async (t) => {
	const token = ["github", "pat", "y".repeat(30)].join("_");
	const cloned: string[] = [];
	// Stands in for git: a clone makes the folder git would have made.
	const run: Runner = async (command, args) => {
		assert.equal(command, "git");
		const url = args.find((arg) => arg.startsWith("https://github.com/")) ?? "";
		cloned.push(url);
		if (url.endsWith("/broken.git")) return { code: 128, stdout: "", stderr: "fatal: early EOF\n" };
		await makeTree(args.at(-1) ?? "", { ".git/HEAD": "ref" });
		return { code: 0, stdout: "", stderr: "" };
	};
	let scanned: ScanOptions | undefined;
	const dir = await tempDir();
	const withToken = await startUiServer({
		port: 0,
		reportPath: join(dir, "state", "repo-scan.json"),
		defaultRoot: dir,
		monitor: null,
		run,
		github: { dir: join(dir, "state", "github"), token },
		fetchFn: (async (_url: string, init: RequestInit) => {
			assert.equal((init.headers as Record<string, string>).authorization, `Bearer ${token}`);
			return Response.json([{ full_name: "me/app", private: true }, { full_name: "me/broken" }]);
		}) as unknown as typeof fetch,
		scan: async (options) => ((scanned = options), sampleReport(options.root)),
	});
	t.after(() => withToken.close());

	// The page learns that a token is set, and never the token.
	const state = await send(withToken, "GET", "/api/state");
	assert.deepEqual(state.json.github, { token: true });
	assert.ok(!state.text.includes(token));
	const listed = await send(withToken, "GET", "/api/github/repos");
	assert.deepEqual(listed.json.repos.map((repo: { name: string }) => repo.name), ["me/app", "me/broken"]);
	assert.ok(!listed.text.includes(token));

	for (const body of [{}, { repos: [] }, { repos: ["me/app", "../etc"] }, { repos: "me/app" }, { repos: ["https://evil.example/x.git"] }]) {
		assert.equal((await send(withToken, "POST", "/api/github/fetch", { body })).status, 400);
	}
	assert.deepEqual(cloned, []);

	assert.equal((await send(withToken, "POST", "/api/github/fetch", { body: { repos: ["me/app", "me/broken", "me/app"] } })).status, 202);
	const job = await untilFetched(withToken);
	assert.equal(job.total, 2, "a repository named twice is fetched once");
	assert.deepEqual(job.errors, [{ repo: "me/broken", message: "early EOF" }]);
	assert.deepEqual(cloned, ["https://github.com/me/app.git", "https://github.com/me/broken.git"]);
	assert.deepEqual((await send(withToken, "GET", "/api/github")).json.fetched, ["me/app"]);

	// What a scan would cover now includes it, named apart from the folder's own repositories.
	const { preview } = (await send(withToken, "GET", "/api/repos/preview")).json;
	assert.deepEqual([preview.total, preview.fetched, preview.repos], [1, 1, ["github/me/app"]]);
	assert.equal((await send(withToken, "POST", "/api/repos/scan", { body: { root: dir } })).status, 202);
	await untilScan(withToken, "done");
	// Exactly the repositories fetched, by path, whatever they are named (S50).
	assert.deepEqual(scanned?.also, [{ root: join(dir, "state", "github"), repos: [join(dir, "state", "github", "me", "app")] }]);

	assert.equal((await send(withToken, "DELETE", "/api/github/fetched?repo=..%2F..")).status, 400);
	assert.deepEqual((await send(withToken, "DELETE", "/api/github/fetched?repo=me%2Fapp")).json.fetched, []);
	assert.equal((await send(withToken, "GET", "/api/github", { key: null })).status, 401);
});

test("without a token, lists only a named account, and a scan covers the folder alone", async (t) => {
	let scanned: ScanOptions | undefined;
	const asked: string[] = [];
	const server = await start(t, {
		fetchFn: (async (url: string) => (asked.push(url), Response.json([{ full_name: "octocat/Hello-World" }]))) as unknown as typeof fetch,
		scan: async (options) => ((scanned = options), sampleReport(options.root)),
	});

	assert.deepEqual((await send(server, "GET", "/api/state")).json.github, { token: false });
	const noOwner = await send(server, "GET", "/api/github/repos");
	assert.equal(noOwner.status, 400);
	assert.match(noOwner.json.error, /Name a GitHub account/);
	assert.equal((await send(server, "GET", "/api/github/repos?owner=..%2Fuser")).status, 400);
	assert.deepEqual(asked, []);
	assert.equal((await send(server, "GET", "/api/github/repos?owner=octocat")).json.repos[0].name, "octocat/Hello-World");

	await send(server, "POST", "/api/repos/scan", { body: { root: server.dir } });
	await untilScan(server, "done");
	assert.equal(scanned?.also, undefined);
});

test("beyond loopback, accepts the names people use and still refuses other sites", () => {
	// Loopback: its own names only, which defeats DNS rebinding.
	assert.equal(hostAllowed("127.0.0.1:4747", 4747, true), true);
	assert.equal(hostAllowed("box.example.ts.net", 4747, true), false);
	// Beyond loopback: a Tailscale name, a LAN address, an IPv6 address; the key guards the API.
	for (const host of ["box.example.ts.net", "Box.Example.ts.net:8443", "192.168.1.20:4747", "[fd7a:115c::1]:4747", "127.0.0.1:4747"]) {
		assert.equal(hostAllowed(host, 4747, false), true, host);
	}
	for (const host of ["", "box example", "box.example/path", "user@box.example", "box.example:port", "-box.example"]) {
		assert.equal(hostAllowed(host, 4747, false), false, host);
	}

	// Tailscale Serve terminates HTTPS, so the page's origin is https while the server sees http.
	assert.equal(originAllowed(undefined, "box.example.ts.net", false), true);
	assert.equal(originAllowed("https://box.example.ts.net", "box.example.ts.net", false), true);
	assert.equal(originAllowed("https://box.example.ts.net:8443", "Box.Example.ts.net:8443", false), true);
	assert.equal(originAllowed("http://192.168.1.20:4747", "192.168.1.20:4747", false), true);
	for (const origin of ["https://evil.example", "https://box.example.ts.net.evil.example", "https://box.example.ts.net:444", "null", "not a url"]) {
		assert.equal(originAllowed(origin, "box.example.ts.net", false), false, origin);
	}
	// Loopback keeps the exact comparison.
	assert.equal(originAllowed("https://127.0.0.1:4747", "127.0.0.1:4747", true), false);
});

test("rejects malformed scan requests before anything runs", async (t) => {
	let scans = 0;
	const server = await start(t, { scan: async () => (scans++, sampleReport("/")) });

	const cases: [unknown, number, RegExp][] = [
		[{}, 400, /Choose a folder/],
		[{ root: "   " }, 400, /Choose a folder/],
		[{ root: join(server.dir, "missing") }, 400, /Not a folder/],
		[{ root: server.dir, depth: 99 }, 400, /Depth/],
		[{ root: server.dir, depth: "3" }, 400, /Depth/],
	];
	for (const [body, status, message] of cases) {
		const reply = await send(server, "POST", "/api/repos/scan", { body });
		assert.equal(reply.status, status);
		assert.match(reply.json.error, message);
	}
	assert.equal((await send(server, "POST", "/api/repos/scan", { rawBody: "{not json" })).status, 400);
	assert.equal(
		(await send(server, "POST", "/api/repos/scan", { rawBody: "root=/", headers: { "content-type": "text/plain" } })).status,
		415,
	);
	assert.equal((await send(server, "POST", "/api/repos/scan", { rawBody: "x".repeat(70_000) })).status, 413);
	assert.equal(scans, 0);
});

test("runs one scan at a time, reports progress, and stores the result privately", async (t) => {
	let finish!: (report: ScanReport) => void;
	let progress!: NonNullable<ScanOptions["onProgress"]>;
	const server = await start(t, {
		scan: (options) => {
			progress = options.onProgress!;
			return new Promise((resolve) => (finish = resolve));
		},
	});
	await makeTree(server.dir, { "projects/": "" });
	const root = join(server.dir, "projects");

	assert.deepEqual((await send(server, "GET", "/api/repos/report")).json, { report: null, notes: [], settingNotes: [], findingNotes: {} });

	const started = await send(server, "POST", "/api/repos/scan", { body: { root, depth: 2 } });
	assert.equal(started.status, 202);
	assert.equal(started.json.scan.state, "running");
	assert.equal((await send(server, "POST", "/api/repos/scan", { body: { root } })).status, 409);

	progress({ done: 1, total: 3, path: join(root, "group/worst") });
	assert.deepEqual(
		pick((await send(server, "GET", "/api/repos/scan")).json.scan, ["state", "root", "done", "total", "current"]),
		{ state: "running", root, done: 1, total: 3, current: "group/worst" },
	);

	finish(sampleReport(root));
	await untilScan(server, "done");

	const reportPath = join(server.dir, "state", "repo-scan.json");
	assert.equal((await stat(reportPath)).mode & 0o777, 0o600, "the report is readable only by its owner");
	assert.equal((await stat(join(server.dir, "state"))).mode & 0o777, 0o700);
	assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), sampleReport(root));

	const { report, notes } = (await send(server, "GET", "/api/repos/report")).json;
	assert.deepEqual(
		report.repos.map((repo: { name: string }) => repo.name),
		["group/worst", "mild", "clean"],
		"repositories arrive worst first",
	);
	assert.deepEqual(
		report.repos[0].findings.map((entry: { severity: string }) => entry.severity),
		["critical", "high"],
	);
	assert.deepEqual(notes, ["Dependencies were not checked: osv-scanner is not installed (brew install osv-scanner)."]);
});

test("a scan can be stopped: its scanners get the signal, nothing is saved, and the last report stands", async (t) => {
	let signal!: AbortSignal;
	const server = await start(t, {
		scan: (options) => {
			signal = options.signal!;
			// As the real scan does: it ends, cancelled, once its scanners have been stopped.
			return new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new CancelledError())));
		},
	});
	await makeTree(server.dir, { "projects/": "", "state/": "" });
	const reportPath = join(server.dir, "state", "repo-scan.json");
	await writeFile(reportPath, JSON.stringify(sampleReport("/work")));

	assert.equal((await send(server, "POST", "/api/repos/scan/cancel")).status, 409, "nothing to stop yet");
	await send(server, "POST", "/api/repos/scan", { body: { root: join(server.dir, "projects") } });
	assert.equal((await send(server, "POST", "/api/repos/scan/cancel")).status, 200);
	assert.equal(signal.aborted, true);

	await untilScan(server, "idle");
	assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), sampleReport("/work"));
	assert.ok((await send(server, "GET", "/api/activity")).json.lines.some((line: { text: string }) => /Scan stopped before it finished/.test(line.text)));
});

test("scans one repository again, keeping what a scanner that did not look had found", async (t) => {
	const asked: string[] = [];
	let outcome: "fixed" | "gitleaks-failed" = "fixed";
	const server = await start(t, {
		rescan: async (path) => {
			asked.push(path);
			const tools: ScanReport["tools"] = [
				{ tool: "gitleaks", status: "ok", version: "8.30.1", installHint: "brew install gitleaks" },
				// osv-scanner was not installed for the scan either, and still is not.
				{ tool: "osv-scanner", status: "missing", installHint: "brew install osv-scanner" },
			];
			if (outcome === "gitleaks-failed") return { repo: { path, findings: [], errors: [{ tool: "gitleaks", message: "fatal: bad object" }] }, tools };
			return { repo: { path, findings: [], errors: [] }, tools };
		},
	});
	await makeTree(server.dir, { "state/": "" });
	const reportPath = join(server.dir, "state", "repo-scan.json");
	await writeFile(reportPath, JSON.stringify(sampleReport("/work")));
	const worst = async () => (JSON.parse(await readFile(reportPath, "utf8")) as ScanReport).repos.find((repo) => repo.path === "/work/group/worst")!;

	// A path is never taken from the request: only a repository of the report, by its name.
	assert.equal((await send(server, "POST", "/api/repos/rescan", { body: { repo: "/etc" } })).status, 404);
	assert.equal((await send(server, "POST", "/api/repos/rescan", { body: {} })).status, 400);

	// gitleaks fails this time: its secret stays, and the failure is recorded.
	outcome = "gitleaks-failed";
	assert.equal((await send(server, "POST", "/api/repos/rescan", { body: { repo: "group/worst" } })).status, 202);
	await untilScan(server, "done");
	assert.deepEqual((await worst()).findings.map((entry) => entry.severity).sort(), ["critical", "high"]);
	assert.deepEqual((await worst()).errors, [{ tool: "gitleaks", message: "fatal: bad object" }]);

	// gitleaks looks and finds the secret gone: that one clears. osv-scanner did not look, so its finding stays.
	outcome = "fixed";
	await send(server, "POST", "/api/repos/rescan", { body: { repo: "group/worst" } });
	await untilScan(server, "done");
	const after = await worst();
	assert.deepEqual(after.findings.map((entry) => `${entry.tool} ${entry.severity}`), ["osv-scanner critical"]);
	assert.deepEqual(after.errors, []);
	assert.match(after.rescannedAt ?? "", /^\d{4}-/);

	assert.deepEqual(asked, ["/work/group/worst", "/work/group/worst"]);
	const stored = JSON.parse(await readFile(reportPath, "utf8")) as ScanReport;
	assert.equal(stored.scannedAt, sampleReport("/work").scannedAt, "the report keeps its scan time");
	assert.deepEqual(stored.repos.find((repo) => repo.path === "/work/mild"), sampleReport("/work").repos[1], "other repositories are untouched");
	assert.equal((await stat(reportPath)).mode & 0o777, 0o600);
});

test("a schedule scans the folder again once the last scan is old enough, and not before", async (t) => {
	const scans: { root: string; depth: number }[] = [];
	const server = await start(t, {
		scanDepth: 5,
		scanEveryHours: 24,
		scheduleTickMs: 20,
		scan: async (options) => {
			scans.push({ root: options.root, depth: options.depth });
			return { ...sampleReport(options.root), scannedAt: new Date().toISOString() };
		},
	});

	// No scan yet: the first look starts one, at the default depth. It is fresh, so no second one follows.
	await untilScan(server, "done");
	await new Promise((resolve) => setTimeout(resolve, 120));
	assert.deepEqual(scans, [{ root: server.dir, depth: 5 }]);
	assert.deepEqual(pick((await send(server, "GET", "/api/state")).json, ["scanDepth", "scanEveryHours"]), { scanDepth: 5, scanEveryHours: 24 });

	// The stored scan is now two days old: the next look scans again.
	await writeFile(join(server.dir, "state", "repo-scan.json"), JSON.stringify({ ...sampleReport(server.dir), scannedAt: new Date(Date.now() - 48 * 3_600_000).toISOString() }));
	for (let i = 0; i < 100 && scans.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(scans.length, 2);
});

test("a scheduled scan tells the owner what is new and fixed, and a scan they start does not", async (t) => {
	const sent: { url: string; body: string }[] = [];
	const fetchFn = (async (url: URL | string, init?: RequestInit) => {
		sent.push({ url: String(url), body: String(init?.body) });
		return new Response("ok");
	}) as unknown as typeof fetch;
	let next = sampleReport("/work");
	const server = await start(t, {
		fetchFn,
		scanEveryHours: 24,
		scheduleTickMs: 20,
		notify: { url: new URL("https://hooks.slack.com/services/T/B/x"), format: "slack" },
		scan: async () => ({ ...next, scannedAt: new Date().toISOString() }),
	});

	// The first scheduled scan: counts only, there is nothing to compare with.
	await untilScan(server, "done");
	for (let i = 0; i < 50 && sent.length < 1; i++) await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(sent.length, 1);
	assert.equal(sent[0]!.url, "https://hooks.slack.com/services/T/B/x");
	// osv-scanner is not installed, so the title says not everything was covered (B54).
	assert.match(JSON.parse(sent[0]!.body).text, /^\*Porchlight: 4 findings in 3 repositories \(not everything was covered\)\*/);

	// A day later a new one appears, and the critical one is gone. osv-scanner, which reported it, is not
	// installed, so its absence is not counted as fixed: the notice says it could not be checked.
	next = sampleReport("/work");
	next.repos[2]!.findings = [next.repos[2]!.findings[0]!, { ...next.repos[2]!.findings[0]!, ruleId: "rule-fresh", title: "A fresh problem" }];
	await writeFile(join(server.dir, "state", "repo-scan.json"), JSON.stringify({ ...sampleReport("/work"), scannedAt: new Date(Date.now() - 48 * 3_600_000).toISOString() }));
	for (let i = 0; i < 100 && sent.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 20));
	const text = JSON.parse(sent[1]!.body).text as string;
	assert.match(text, /1 new and 0 fixed since the last scan/);
	assert.match(text, /New:\n {2}\[high\] group\/worst: A fresh problem \(package-lock\.json\)/);
	assert.match(text, /1 finding of the last scan could not be checked again, so it is not counted as fixed/);
	assert.match(text, /Not covered, so this is not a clean bill of health/);

	// One started from the page is not announced.
	await makeTree(server.dir, { "projects/": "" });
	await send(server, "POST", "/api/repos/scan", { body: { root: join(server.dir, "projects") } });
	await untilScan(server, "done");
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(sent.length, 2);
	assert.ok((await send(server, "GET", "/api/activity")).json.lines.some((line: { text: string }) => line.text === "Sent the scan's outcome to hooks.slack.com"));
});

test("downloads a bill of materials of the scan's own repositories, read offline", async (t) => {
	const asked: string[][] = [];
	const run: Runner = async (command, args) => {
		asked.push([command, ...args]);
		if (args[0] === "--version") return { code: 0, stdout: "2.7.1\n", stderr: "" };
		const name = args.at(-1)!.split("/").at(-1);
		return { code: 0, stdout: JSON.stringify({ components: [{ name: `pkg-${name}`, version: "1.0.0", purl: `pkg:npm/pkg-${name}@1.0.0` }] }), stderr: "" };
	};
	const server = await start(t, { run });
	assert.equal((await send(server, "GET", "/api/repos/sbom")).status, 404, "no scan yet");
	await withReport(server);

	const reply = await send(server, "GET", "/api/repos/sbom?root=/etc");
	assert.equal(reply.status, 200);
	assert.match(String(reply.headers["content-disposition"]), /^attachment; filename="porchlight-sbom-\d{4}-\d{2}-\d{2}\.cdx\.json"$/);
	assert.equal(reply.headers["content-type"], "application/vnd.cyclonedx+json");
	const sbom = JSON.parse(reply.text);
	assert.deepEqual(sbom.components.map((repo: { name: string; components: { name: string }[] }) => [repo.name, repo.components[0]?.name]), [
		["clean", "pkg-clean"],
		["mild", "pkg-mild"],
		["group/worst", "pkg-worst"],
	]);
	// The report's repositories, never the path in the request.
	assert.ok(asked.filter((call) => call[1] === "scan").every((call) => call.at(-1)!.startsWith("/work/") && call.includes("--offline")));
});

test("reads a report that changed on disk, and serves the kept one until then", async (t) => {
	const server = await start(t);
	await makeTree(server.dir, { "state/": "" });
	const reportPath = join(server.dir, "state", "repo-scan.json");
	const names = async () => (await send(server, "GET", "/api/repos/report")).json.report.repos.map((repo: { name: string }) => repo.name);

	await writeFile(reportPath, JSON.stringify(sampleReport("/work")));
	assert.deepEqual(await names(), ["group/worst", "mild", "clean"]);
	assert.deepEqual(await names(), ["group/worst", "mild", "clean"]);

	const smaller = sampleReport("/work");
	smaller.repos = smaller.repos.slice(0, 2);
	await writeFile(reportPath, JSON.stringify(smaller));
	assert.deepEqual(await names(), ["mild", "clean"]);
});

test("reports a failed scan, and a scan that found no repositories, as failures", async (t) => {
	const outcomes: (() => Promise<ScanReport>)[] = [
		async () => {
			throw new Error("gitleaks crashed");
		},
		async () => ({ ...sampleReport("/x"), repos: [] }),
	];
	const server = await start(t, { scan: () => outcomes.shift()!() });

	await send(server, "POST", "/api/repos/scan", { body: { root: server.dir } });
	const crashed = await untilScan(server, "failed");
	assert.equal(crashed.error, "gitleaks crashed");
	assert.equal(crashed.noRepositories, undefined, "a scanner failing is not an empty folder");

	await send(server, "POST", "/api/repos/scan", { body: { root: server.dir, depth: 2 } });
	const empty = await untilScan(server, "failed");
	assert.match(empty.error, /No git repositories found/);
	// Said in data, so the page can point at the folder and the depth without parsing the message.
	assert.equal(empty.noRepositories, true);
	assert.equal(empty.depth, 2);
	assert.deepEqual((await send(server, "GET", "/api/repos/report")).json.report, null);
});

test("a scan with no scanner installed fails and keeps the report it would have replaced", async (t) => {
	const nothingInstalled: ScanReport = {
		...sampleReport("/x"),
		tools: [
			{ tool: "gitleaks", status: "missing", installHint: "brew install gitleaks" },
			{ tool: "osv-scanner", status: "missing", installHint: "brew install osv-scanner" },
		],
		repos: [{ path: "/x/app", findings: [], errors: [] }],
	};
	const server = await start(t, { scan: async () => nothingInstalled });
	const reportPath = join(server.dir, "state", "repo-scan.json");
	await makeTree(server.dir, { "state/": "" });
	await writeFile(reportPath, JSON.stringify(sampleReport("/work")));

	await send(server, "POST", "/api/repos/scan", { body: { root: server.dir } });
	const failed = await untilScan(server, "failed");

	assert.match(failed.error, /No scanner is installed\. Install one: brew install gitleaks; brew install osv-scanner/);
	assert.equal(JSON.parse(await readFile(reportPath, "utf8")).root, "/work", "the earlier report is still there");
});

test("names the files that tell a scanner to leave findings out", async (t) => {
	const server = await start(t);
	const reportPath = join(server.dir, "state", "repo-scan.json");
	await makeTree(server.dir, { "state/": "" });
	const report = sampleReport("/work");
	report.repos[0]!.settingFiles = [".gitleaks.toml", ".gitleaksignore", "web/osv-scanner.toml"];
	await writeFile(reportPath, JSON.stringify(report));

	const reply = (await send(server, "GET", "/api/repos/report")).json;

	assert.deepEqual(reply.settingNotes, [
		"clean has .gitleaks.toml: Porchlight ignored it and used gitleaks' built-in rules.",
		"clean has .gitleaksignore: secrets it lists are not in this report.",
		"clean has web/osv-scanner.toml: vulnerabilities or packages it ignores are not in this report.",
	]);
	assert.equal(reply.notes.length, 1, "setting files do not make the scan incomplete");
});

test("shows an existing report file and says so when it is not one", async (t) => {
	const server = await start(t);
	const reportPath = join(server.dir, "state", "repo-scan.json");
	await makeTree(server.dir, { "state/": "" });

	await writeFile(reportPath, JSON.stringify(sampleReport("/work")));
	assert.equal((await send(server, "GET", "/api/repos/report")).json.report.repos.length, 3);

	await writeFile(reportPath, "{broken");
	assert.match((await send(server, "GET", "/api/repos/report")).json.error, /not valid JSON/);
	await writeFile(reportPath, '{"some":"other file"}');
	assert.match((await send(server, "GET", "/api/repos/report")).json.error, /not a Porchlight scan report/);
});

test("gives every finding in the report its suggested fix", async (t) => {
	const server = await start(t);
	await makeTree(server.dir, { "state/": "" });
	await writeFile(join(server.dir, "state", "repo-scan.json"), JSON.stringify(sampleReport("/work")));

	const { report } = (await send(server, "GET", "/api/repos/report")).json;

	const worst = report.repos[0];
	assert.equal(worst.name, "group/worst");
	assert.deepEqual(
		worst.findings.map((entry: { severity: string; suggestion: { title: string; phase: string } }) => [entry.severity, entry.suggestion.title, entry.suggestion.phase]),
		[
			["critical", "Replace or mitigate pkg 1.0.0: no fixed release is published", "now"],
			["high", "Rotate the credential in package-lock.json", "now"],
		],
	);
});

test("exports the scan as a roadmap or a findings list, in each format, as a file to save", async (t) => {
	const server = await start(t);
	assert.equal((await send(server, "GET", "/api/repos/export")).status, 404, "nothing to export before a scan");
	await makeTree(server.dir, { "state/": "" });
	await writeFile(join(server.dir, "state", "repo-scan.json"), JSON.stringify(sampleReport("/work")));

	const expected: [string, string, RegExp][] = [
		["", "porchlight-roadmap-2026-11-17.md", /^# Repair roadmap/],
		["?format=html", "porchlight-roadmap-2026-11-17.html", /^<!doctype html>/],
		["?format=csv", "porchlight-roadmap-2026-11-17.csv", /^Phase,Priority,Place,Action/],
		["?format=json", "porchlight-roadmap-2026-11-17.json", /^\{\n\t"title": "Repair roadmap"/],
		["?content=findings", "porchlight-findings-2026-11-17.md", /^# Findings and suggested fixes/],
		["?content=findings&format=csv", "porchlight-findings-2026-11-17.csv", /^Severity,Type,Place,ID,Finding/],
	];
	for (const [query, filename, start] of expected) {
		const reply = await send(server, "GET", `/api/repos/export${query}`);
		assert.equal(reply.status, 200, query);
		assert.equal(reply.headers["content-disposition"], `attachment; filename="${filename}"`);
		assert.equal(reply.headers["x-content-type-options"], "nosniff");
		assert.match(reply.text, start);
	}

	const partial = await send(server, "GET", "/api/repos/export?severity=critical&kind=vulnerability&repo=group%2Fworst&q=pkg");
	assert.equal(partial.headers["content-disposition"], 'attachment; filename="porchlight-roadmap-partial-2026-11-17.md"');
	assert.match(partial.text, /\*\*Partial roadmap\.\*\* It covers only: critical severity only; vulnerabilities only; in group\/worst; matching "pkg"\./);
	assert.match(partial.text, /1 action clears 1 finding across 1 place/);

	const roadmap = (await send(server, "GET", "/api/repos/roadmap?severity=critical")).json.roadmap;
	assert.deepEqual([roadmap.totals.actions, roadmap.scope], [1, "critical severity only"]);
});

test("refuses an export it cannot make, and says what to change", async (t) => {
	const server = await start(t);
	await makeTree(server.dir, { "state/": "" });
	await writeFile(join(server.dir, "state", "repo-scan.json"), JSON.stringify(sampleReport("/work")));

	const cases: [string, RegExp][] = [
		["?format=pdf", /Unknown format "pdf"\. Choose one of: md, html, csv, json/],
		["?content=everything", /Unknown content "everything"/],
		["?severity=urgent", /Unknown severity "urgent"/],
		["?kind=bug", /Unknown type "bug"/],
	];
	for (const [query, message] of cases) {
		const reply = await send(server, "GET", `/api/repos/export${query}`);
		assert.equal(reply.status, 400, query);
		assert.match(reply.json.error, message);
		assert.equal(reply.headers["content-disposition"], undefined);
	}
	assert.equal((await send(server, "GET", "/api/repos/export", { key: null })).status, 401);
	// POST saves into the project in use; with none, nothing is written anywhere.
	const post = await send(server, "POST", "/api/repos/export");
	assert.deepEqual([post.status, post.json.error], [409, "Choose a project first, under Settings → Projects, or download the file instead."]);
	assert.equal((await send(server, "PUT", "/api/repos/export")).status, 405);
});

test("exports a domain's roadmap, and shows each of its findings with a fix", async (t) => {
	const report = {
		domain: "example.com",
		takenAt: "2026-11-17T09:00:00.000Z",
		notes: [],
		findings: [
			{ id: "dangling-cname:shop.example.com", severity: "high", host: "shop.example.com", title: "CNAME target old.vendor.example does not resolve; check for subdomain takeover" },
			{ id: "missing-header:www.example.com:referrer-policy", severity: "low", host: "www.example.com", title: "Missing referrer-policy header" },
		],
	};
	const fetchFn = (async (url: URL) => {
		if (url.pathname === "/domains/unscanned.example") return Response.json({ domain: { name: "unscanned.example" }, report: null });
		if (url.pathname === "/domains/missing.example") return Response.json({ error: "Domain is not registered" }, { status: 404 });
		return Response.json({ domain: { name: "example.com" }, report });
	}) as unknown as typeof fetch;
	const monitor = monitorConfig({ PORCHLIGHT_MONITOR_URL: "https://monitor.example", PORCHLIGHT_ADMIN_TOKEN: ADMIN_TOKEN });
	const server = await start(t, { monitor, fetchFn });

	const shown = (await send(server, "GET", "/api/domains/example.com")).json;
	assert.deepEqual(shown.suggestions["dangling-cname:shop.example.com"].title, "Remove or repoint the DNS record for shop.example.com");
	assert.deepEqual(shown.suggestions["missing-header:www.example.com:referrer-policy"], {
		title: "Add 1 security header to responses from www.example.com",
		how: ["`Referrer-Policy: strict-origin-when-cross-origin`."],
	});
	assert.equal((await send(server, "GET", "/api/domains/unscanned.example")).json.suggestions, undefined);

	const file = await send(server, "GET", "/api/domains/example.com/export?format=csv");
	assert.equal(file.headers["content-disposition"], 'attachment; filename="porchlight-roadmap-example.com-2026-11-17.csv"');
	assert.match(file.text, /1\. Fix now,high,shop\.example\.com,Remove or repoint the DNS record for shop\.example\.com/);
	assert.match((await send(server, "GET", "/api/domains/example.com/export?content=findings")).text, /^# Findings and suggested fixes for example\.com/);

	assert.deepEqual(
		[(await send(server, "GET", "/api/domains/unscanned.example/export")).status, (await send(server, "GET", "/api/domains/missing.example/export")).status],
		[404, 404],
	);
	assert.equal((await send(server, "POST", "/api/domains/example.com/export")).status, 409, "saving needs a project");
	assert.equal((await send(server, "DELETE", "/api/domains/example.com/export")).status, 405);
	assert.equal((await send(server, "GET", "/api/domains/..%2f..%2fadmin/export")).status, 400);
});

test("says the monitor is not connected instead of failing obscurely", async (t) => {
	const server = await start(t);

	const reply = await send(server, "GET", "/api/domains");

	assert.equal(reply.status, 503);
	assert.equal(reply.json.error, "Set PORCHLIGHT_MONITOR_URL");
});

test("says when the monitor was never set up, so the page can explain setup instead of quoting an error", async (t) => {
	const server = await start(t, { monitorUnset: true });

	const state = await send(server, "GET", "/api/state");

	assert.deepEqual(state.json.monitor, { configured: false, error: "Set PORCHLIGHT_MONITOR_URL", unset: true });
});

test("relays domain calls to the monitor without ever exposing the admin token", async (t) => {
	const seen: { method: string; url: string; authorization: string; body: string | undefined }[] = [];
	const fetchFn = (async (url: URL, init: RequestInit) => {
		seen.push({
			method: init.method!,
			url: url.toString(),
			authorization: (init.headers as Record<string, string>).authorization!,
			body: init.body as string | undefined,
		});
		const notFound = url.pathname.endsWith("/missing.example");
		return Response.json(notFound ? { error: "Domain is not registered" } : { ok: url.pathname }, { status: notFound ? 404 : 200 });
	}) as unknown as typeof fetch;
	const monitor = monitorConfig({ PORCHLIGHT_MONITOR_URL: "https://monitor.example", PORCHLIGHT_ADMIN_TOKEN: ADMIN_TOKEN });
	const server = await start(t, { monitor, fetchFn });

	const replies = [
		await send(server, "GET", "/api/state"),
		await send(server, "GET", "/api/domains"),
		await send(server, "POST", "/api/domains", { body: { domain: "example.com" } }),
		await send(server, "GET", "/api/domains/Example.COM"),
		await send(server, "POST", "/api/domains/example.com/verify"),
		await send(server, "POST", "/api/domains/example.com/scan"),
		await send(server, "DELETE", "/api/domains/example.com"),
		await send(server, "GET", "/api/domains/missing.example"),
	];

	assert.deepEqual(replies[0]!.json.monitor, { configured: true, host: "monitor.example" });
	assert.deepEqual(
		seen.map((call) => `${call.method} ${call.url} ${call.body ?? ""}`.trim()),
		[
			"GET https://monitor.example/domains",
			'POST https://monitor.example/domains {"domain":"example.com"}',
			"GET https://monitor.example/domains/example.com",
			"POST https://monitor.example/domains/example.com/verify",
			"POST https://monitor.example/domains/example.com/scan",
			"DELETE https://monitor.example/domains/example.com",
			"GET https://monitor.example/domains/missing.example",
		],
	);
	assert.ok(seen.every((call) => call.authorization === `Bearer ${ADMIN_TOKEN}`));
	assert.deepEqual([replies[7]!.status, replies[7]!.json], [404, { error: "Domain is not registered" }], "the monitor's answer passes through");
	for (const reply of replies) {
		assert.ok(!reply.text.includes(ADMIN_TOKEN) && !JSON.stringify(reply.headers).includes(ADMIN_TOKEN));
	}
});

test("only relays the routes the monitor has, with a well-formed domain", async (t) => {
	let calls = 0;
	const fetchFn = (async () => (calls++, Response.json({}))) as unknown as typeof fetch;
	const monitor = monitorConfig({ PORCHLIGHT_MONITOR_URL: "https://monitor.example", PORCHLIGHT_ADMIN_TOKEN: ADMIN_TOKEN });
	const server = await start(t, { monitor, fetchFn });

	const cases: [string, string, number][] = [
		["GET", "/api/domains/..%2f..%2fadmin", 400],
		["GET", "/api/domains/a%20b.com", 400],
		["GET", "/api/domains/%E0%A4%A", 400],
		["GET", "/api/domains/", 400],
		["POST", "/api/domains/example.com/scan/extra", 400],
		["POST", "/api/domains/example.com/delete-everything", 404],
		["GET", "/api/domains/example.com/scan", 404],
		["DELETE", "/api/domains", 405],
		["POST", "/api/domains/example.com", 405],
		["GET", "/api/unknown", 404],
	];
	for (const [method, path, status] of cases) {
		assert.equal((await send(server, method, path)).status, status, `${method} ${path}`);
	}
	assert.equal(calls, 0);
});

test("the monitor is connected in Settings: checked before it is saved, kept owner-only, and its token never comes back", async (t) => {
	const calls: string[] = [];
	// A monitor at monitor.example that knows one token; anything else is refused or is not a monitor.
	const fetchFn = (async (url: URL, init: RequestInit) => {
		const authorization = (init.headers as Record<string, string>).authorization;
		calls.push(`${init.method} ${url.toString()}`);
		if (url.host === "down.example") throw new Error(`connect ECONNREFUSED while sending ${authorization}`);
		if (url.host !== "monitor.example") return new Response("<html>a website</html>", { status: 200 });
		if (authorization !== `Bearer ${ADMIN_TOKEN}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
		return Response.json(url.pathname === "/domains" ? { domains: [] } : { ok: url.pathname });
	}) as unknown as typeof fetch;
	const server = await start(t, { fetchFn, monitorUnset: true });
	const saved = join(server.dir, "state", "monitor-settings.json");
	const connect = (address: unknown, token: unknown) => send(server, "POST", "/api/monitor", { body: { address, token } });

	// Refused before anything is sent: no address, not https, a user name in it, a token too short or with a space.
	for (const [address, token] of [
		["", ADMIN_TOKEN],
		["http://monitor.example", ADMIN_TOKEN],
		["https://user:pass@monitor.example", ADMIN_TOKEN],
		["ftp://monitor.example", ADMIN_TOKEN],
		["https://monitor.example", "short"],
		["https://monitor.example", `${ADMIN_TOKEN} with spaces`],
		["https://monitor.example", 42],
	] as [unknown, unknown][]) {
		assert.equal((await connect(address, token)).status, 400, `${String(address)} ${String(token).length}`);
	}
	assert.deepEqual(calls, [], "nothing was asked of anyone");

	// Asked of the monitor before it is saved: a wrong token, something that is not a monitor, or no answer saves nothing.
	const wrong = await connect("https://monitor.example", ADMIN_TOKEN.toUpperCase());
	assert.deepEqual([wrong.status, /refused this admin token/.test(wrong.json.error)], [400, true]);
	const other = await connect("https://www.example", ADMIN_TOKEN);
	assert.deepEqual([other.status, /not as a Porchlight monitor/.test(other.json.error)], [400, true]);
	const down = await connect("https://down.example", ADMIN_TOKEN);
	assert.deepEqual([down.status, /Could not reach down\.example/.test(down.json.error)], [400, true]);
	assert.ok(!down.text.includes(ADMIN_TOKEN), "an error never carries the token");
	await assert.rejects(stat(saved));
	assert.equal((await send(server, "GET", "/api/state")).json.monitor.configured, false);

	// The address is reduced to its origin; a path or query typed after it is dropped.
	const connected = await connect(" monitor.example/domains?x=1 ", `  ${ADMIN_TOKEN}\n`);
	assert.equal(connected.status, 200);
	assert.deepEqual([connected.json.monitor.configured, connected.json.monitor.host, connected.json.monitor.source], [true, "monitor.example", "settings"]);
	assert.ok(!connected.text.includes(ADMIN_TOKEN));
	assert.equal((await stat(saved)).mode & 0o777, 0o600);
	assert.equal(JSON.parse(await readFile(saved, "utf8")).url, "https://monitor.example");

	// It is in use at once, with no restart, and the token still never reaches the page.
	const state = await send(server, "GET", "/api/state");
	assert.equal(state.json.monitor.host, "monitor.example");
	assert.ok(!state.text.includes(ADMIN_TOKEN));
	assert.equal((await send(server, "GET", "/api/domains")).status, 200);
	assert.equal(calls.at(-1), "GET https://monitor.example/domains");

	// A mistake later never replaces the connection that works.
	assert.equal((await connect("https://monitor.example", `${ADMIN_TOKEN}x`)).status, 400);
	assert.equal((await send(server, "GET", "/api/domains")).status, 200);

	// It is read again when Porchlight next starts, and comes before what was given at start-up.
	const again = await start(t, { fetchFn, reportPath: join(server.dir, "state", "repo-scan.json"), monitor: monitorConfig({ PORCHLIGHT_MONITOR_URL: "https://old.example", PORCHLIGHT_ADMIN_TOKEN: ADMIN_TOKEN }) });
	assert.equal((await send(again, "GET", "/api/state")).json.monitor.host, "monitor.example");
	const removed = await send(again, "POST", "/api/monitor/remove");
	assert.deepEqual(removed.json.monitor, { configured: true, host: "old.example" }, "removing it falls back to the start-up setting");
	await assert.rejects(stat(saved));
});

test("turns an unreachable monitor into a clear error", async (t) => {
	const fetchFn = (async () => {
		throw new Error("connect ECONNREFUSED");
	}) as unknown as typeof fetch;
	const monitor = monitorConfig({ PORCHLIGHT_MONITOR_URL: "http://localhost:5173", PORCHLIGHT_ADMIN_TOKEN: ADMIN_TOKEN });
	const server = await start(t, { monitor, fetchFn });

	const reply = await send(server, "GET", "/api/domains");

	assert.deepEqual([reply.status, reply.json], [502, { error: "Could not reach the monitor: connect ECONNREFUSED" }]);
});

test("takes the next free port when the default is taken, but not when a port was asked for", async (t) => {
	const first = await start(t);
	const options = { reportPath: join(first.dir, "r.json"), defaultRoot: first.dir, monitor: null };
	const startOn = (port: number) => startUiServer({ ...options, port });

	// The second candidate is 0, which the system resolves to any free port.
	const second = await listenOnFirstFree([first.port, 0], startOn);
	t.after(() => second.close());
	assert.notEqual(second.port, first.port);
	assert.equal((await send(second, "GET", "/api/state")).status, 200);

	await assert.rejects(listenOnFirstFree([first.port], startOn), new RegExp(`Port ${first.port} is in use. Choose another with --port`));
	await assert.rejects(listenOnFirstFree([first.port, second.port], startOn), /Ports \d+ to \d+ are in use/);
	await assert.rejects(
		listenOnFirstFree([first.port, 0], async () => {
			throw new Error("permission denied");
		}),
		/permission denied/,
	);
});

// The local model

const MODEL = "qwen-test:9b";
const assistant = assistantConfig({ PORCHLIGHT_LLM_URL: "http://ollama.test:11434", PORCHLIGHT_LLM_MODEL: MODEL });

/**
 * A scripted network: the monitor at monitor.example and Ollama at ollama.test. Records what each
 * was sent, so tests can check what reached the model.
 */
function fakeNetwork(handlers: { model?: (body: { messages: { role: string; content: string }[] }) => Response | Promise<Response>; monitor?: (url: URL) => Response } = {}) {
	const modelCalls: string[] = [];
	const monitorCalls: { url: string; authorization: string }[] = [];
	const fetchFn = (async (url: URL, init: RequestInit) => {
		if (url.hostname === "ollama.test") {
			modelCalls.push(String(init.body));
			const answer = handlers.model ?? (() => Response.json({ message: { role: "assistant", content: "<think>Reasoning.</think>\n\nWhat it is: a test answer." } }));
			return answer(JSON.parse(String(init.body)));
		}
		monitorCalls.push({ url: url.toString(), authorization: (init.headers as Record<string, string>).authorization! });
		return (handlers.monitor ?? (() => Response.json({ error: "Domain is not registered" }, { status: 404 })))(url);
	}) as unknown as typeof fetch;
	return { fetchFn, modelCalls, monitorCalls };
}

async function withReport(server: UiServer & { dir: string }): Promise<void> {
	await makeTree(server.dir, { "state/": "" });
	await writeFile(join(server.dir, "state", "repo-scan.json"), JSON.stringify(sampleReport("/work")));
}

const ASSIST_REQUESTS: [string, unknown][] = [
	["/api/assist/finding", { repo: "group/worst", ruleId: "rule-critical", location: "package-lock.json" }],
	["/api/assist/roadmap", {}],
	["/api/assist/domain", { domain: "example.com" }],
	["/api/assist/ask", { question: "What first?" }],
];

test("says when the local model is off, and every assist route then answers 503", async (t) => {
	const network = fakeNetwork();
	const server = await start(t, { fetchFn: network.fetchFn, assistantError: "Set PORCHLIGHT_LLM_URL to Ollama's address", assistantUnset: true });
	await withReport(server);

	assert.deepEqual((await send(server, "GET", "/api/state")).json.assistant, { configured: false, error: "Set PORCHLIGHT_LLM_URL to Ollama's address", unset: true });
	for (const [path, body] of ASSIST_REQUESTS) {
		const reply = await send(server, "POST", path, { body });
		assert.deepEqual([reply.status, reply.json.error], [503, "Set PORCHLIGHT_LLM_URL to Ollama's address"], path);
	}
	assert.deepEqual([network.modelCalls.length, network.monitorCalls.length], [0, 0]);

	// A setting given but wrong is a mistake to show, not the usual off state.
	const wrong = await start(t, { assistantError: "Set PORCHLIGHT_LLM_MODEL to the model's name in Ollama" });
	assert.deepEqual((await send(wrong, "GET", "/api/state")).json.assistant, { configured: false, error: "Set PORCHLIGHT_LLM_MODEL to the model's name in Ollama", unset: false });
});

test("names the configured model and where it runs", async (t) => {
	const server = await start(t, { assistant });

	assert.deepEqual((await send(server, "GET", "/api/state")).json.assistant, { configured: true, model: MODEL, host: "ollama.test:11434", hosted: false });
});

test("refuses malformed assist requests before asking anything", async (t) => {
	const network = fakeNetwork();
	const monitor = monitorConfig({ PORCHLIGHT_MONITOR_URL: "https://monitor.example", PORCHLIGHT_ADMIN_TOKEN: ADMIN_TOKEN });
	const server = await start(t, { assistant, monitor, fetchFn: network.fetchFn });
	await withReport(server);

	const valid = { repo: "group/worst", ruleId: "rule-critical", location: "package-lock.json" };
	const cases: [string, unknown, RegExp][] = [
		["finding", {}, /repo must be text/],
		["finding", { ...valid, repo: 7 }, /repo must be text/],
		["finding", { ...valid, ruleId: "" }, /ruleId must be text of 1 to 500/],
		["finding", { ...valid, location: "x".repeat(2001) }, /location must be text of 1 to 2000/],
		["finding", { ...valid, detail: null }, /detail must be text/],
		["domain", {}, /Invalid domain name/],
		["domain", { domain: "../admin" }, /Invalid domain name/],
		["domain", { domain: "a b.com" }, /Invalid domain name/],
		["domain", { domain: ["example.com"] }, /Invalid domain name/],
		["ask", {}, /Ask a question of 1 to 500 characters/],
		["ask", { question: "   " }, /Ask a question/],
		["ask", { question: "x".repeat(501) }, /Ask a question/],
		["ask", { question: { text: "hi" } }, /Ask a question/],
		["roadmap", [], /Body must be a JSON object/],
		["ask", "What first?", /Body must be a JSON object/],
	];
	for (const [route, body, message] of cases) {
		const reply = await send(server, "POST", `/api/assist/${route}`, { body });
		assert.equal(reply.status, 400, `${route} ${JSON.stringify(body)}`);
		assert.match(reply.json.error, message);
	}
	assert.equal((await send(server, "POST", "/api/assist/ask", { rawBody: "question=hi", headers: { "content-type": "text/plain" } })).status, 415);
	assert.equal((await send(server, "GET", "/api/assist/ask")).status, 405);
	assert.equal((await send(server, "POST", "/api/assist/everything", { body: {} })).status, 404);
	assert.equal((await send(server, "POST", "/api/assist/ask", { key: null, body: { question: "hi" } })).status, 401);
	assert.equal((await send(server, "POST", "/api/assist/ask", { body: { question: "hi" }, headers: { origin: "https://evil.example" } })).status, 403);
	assert.deepEqual([network.modelCalls.length, network.monitorCalls.length], [0, 0]);
});

test("answers 404 when there is nothing to explain", async (t) => {
	const network = fakeNetwork({
		monitor: (url) =>
			url.pathname === "/domains/unscanned.example"
				? Response.json({ domain: { name: "unscanned.example" }, report: null })
				: Response.json({ error: "Domain is not registered" }, { status: 404 }),
	});
	const monitor = monitorConfig({ PORCHLIGHT_MONITOR_URL: "https://monitor.example", PORCHLIGHT_ADMIN_TOKEN: ADMIN_TOKEN });
	const server = await start(t, { assistant, monitor, fetchFn: network.fetchFn });

	for (const [path, body] of ASSIST_REQUESTS.filter(([path]) => !path.endsWith("/domain"))) {
		const reply = await send(server, "POST", path, { body });
		assert.deepEqual([reply.status, reply.json.error], [404, "There is no scan yet. Scan a folder first."], path);
	}
	await withReport(server);
	const gone = await send(server, "POST", "/api/assist/finding", { body: { repo: "group/worst", ruleId: "rule-critical", location: "elsewhere.json" } });
	assert.deepEqual([gone.status, gone.json.error], [404, "That finding is not in the latest scan. Reload the page to see the current one."]);
	const otherCommit = await send(server, "POST", "/api/assist/finding", { body: { repo: "group/worst", ruleId: "rule-critical", location: "package-lock.json", detail: "other@2.0.0" } });
	assert.equal(otherCommit.status, 404);

	const unscanned = await send(server, "POST", "/api/assist/domain", { body: { domain: "unscanned.example" } });
	assert.deepEqual([unscanned.status, unscanned.json.error], [404, "unscanned.example has not been scanned yet, so there is nothing to explain."]);
	const unknown = await send(server, "POST", "/api/assist/domain", { body: { domain: "missing.example" } });
	assert.deepEqual([unknown.status, unknown.json.error], [404, "Domain is not registered"]);
	assert.equal(network.modelCalls.length, 0);
});

test("explains a finding, summarises the roadmap and answers a question from the stored report", async (t) => {
	const network = fakeNetwork();
	const server = await start(t, { assistant, fetchFn: network.fetchFn });
	await withReport(server);

	const explained = await send(server, "POST", "/api/assist/finding", { body: { repo: "group/worst", ruleId: "rule-high", location: "package-lock.json", detail: "pkg@1.0.0" } });
	assert.deepEqual([explained.status, pick(explained.json, ["text", "model"])], [200, { text: "What it is: a test answer.", model: MODEL }]);
	assert.match(explained.json.discussion, /^dsc_[0-9a-f]{16}$/, "every answer is kept as a discussion");
	const sent = JSON.parse(network.modelCalls[0]!);
	assert.deepEqual([sent.model, sent.stream, sent.think], [MODEL, false, false]);
	assert.match(sent.messages[1].content, /"title":"A high problem"/);
	assert.match(sent.messages[1].content, /"repo":"group\/worst"/);
	assert.ok(!sent.messages[1].content.includes("A critical problem"), "only the finding asked about");

	assert.equal((await send(server, "POST", "/api/assist/roadmap")).status, 200, "the roadmap needs no body");
	assert.match(JSON.parse(network.modelCalls[1]!).messages[1].content, /"actions":\[\{"phase":"Fix now"/);

	const answered = await send(server, "POST", "/api/assist/ask", { body: { question: "Which repository first?" } });
	assert.deepEqual(pick(answered.json, ["text", "model"]), { text: "What it is: a test answer.", model: MODEL });
	assert.match(JSON.parse(network.modelCalls[2]!).messages[1].content, /DATA>>>\n\nThe owner's question:\nWhich repository first\?$/);
});

test("keeps each answer as a discussion, and answers follow-up questions from the same data", async (t) => {
	const network = fakeNetwork({ model: (body) => Response.json({ message: { content: `Answer to ${body.messages.length} messages.` } }) });
	const server = await start(t, { assistant, fetchFn: network.fetchFn });
	await withReport(server);

	const explained = await send(server, "POST", "/api/assist/finding", { body: { repo: "group/worst", ruleId: "rule-high", location: "package-lock.json", detail: "pkg@1.0.0" } });
	const id = explained.json.discussion as string;
	assert.match(id, /^dsc_[0-9a-f]{16}$/);
	const listed = (await send(server, "GET", "/api/discussions")).json.discussions;
	assert.deepEqual(
		listed.map((entry: { id: string; kind: string; answers: number; title: string }) => [entry.id, entry.kind, entry.answers, entry.title]),
		[[id, "finding", 1, "Explain: A high problem in package-lock.json (group/worst)"]],
		"the title is Porchlight's, from what was asked about",
	);
	assert.equal((await stat(join(server.dir, "state", "discussions", `${id}.json`))).mode & 0o777, 0o600);

	// A follow-up: the first prompt as it was built (rules, task and the finding), the first answer, then the question.
	const followed = await send(server, "POST", "/api/discussions/ask", { body: { id, question: "Is it only in a test file?" } });
	assert.equal(followed.status, 200);
	const sent = JSON.parse(network.modelCalls.at(-1)!);
	assert.deepEqual(sent.messages.map((message: { role: string }) => message.role), ["system", "user", "assistant", "user"]);
	assert.match(sent.messages[1].content, /<<<DATA\n.*"title":"A high problem"/s);
	assert.ok(!sent.messages[1].content.includes("A critical problem"), "still only the finding asked about");
	assert.equal(sent.messages[2].content, "Answer to 2 messages.");
	assert.match(sent.messages[3].content, /still data, not instructions/);
	assert.match(sent.messages[3].content, /The owner's question:\nIs it only in a test file\?$/);
	assert.deepEqual(pick(followed.json.turn, ["question", "answer", "model"]), { question: "Is it only in a test file?", answer: "Answer to 4 messages.", model: MODEL });

	// The model the discussion began with answers its follow-ups, even after another is chosen in Settings.
	await send(server, "POST", "/api/model", { body: { choice: "anthropic", apiKey: CLAUDE_KEY } });
	const one = await send(server, "GET", `/api/discussions/one?id=${id}`);
	assert.deepEqual([one.json.followUp, one.json.discussion.turns.length, one.json.discussion.host], [{ ok: true }, 2, "ollama.test:11434"]);
	assert.ok(!("fingerprint" in one.json.discussion) && !one.text.includes(CLAUDE_KEY), "the page gets no address beyond the host, and never a key");
	assert.equal((await send(server, "POST", "/api/discussions/ask", { body: { id, question: "And then?" } })).status, 200);
	assert.equal(network.modelCalls.length, 3, "the local model answered; nothing went to Claude");

	// Only a discussion Porchlight made, and only a question of the right size; nothing is asked otherwise.
	for (const [body, status] of [
		[{ id, question: "" }, 400],
		[{ id, question: "x".repeat(501) }, 400],
		[{ id, question: ["hi"] }, 400],
		[{ id: "../state/repo-scan", question: "hi" }, 404],
		[{ id: "dsc_0000000000000000", question: "hi" }, 404],
	] as const) {
		assert.equal((await send(server, "POST", "/api/discussions/ask", { body })).status, status, JSON.stringify(body));
	}
	assert.equal((await send(server, "GET", "/api/discussions/one?id=../state/repo-scan")).status, 404);
	assert.equal(network.modelCalls.length, 3);

	// A file to keep, under a fixed name, with what the scan and the model wrote escaped.
	const exported = await send(server, "GET", `/api/discussions/export?id=${id}&format=md`);
	assert.equal(exported.headers["content-disposition"], 'attachment; filename="porchlight-discussion-' + new Date().toISOString().slice(0, 10) + '.md"');
	assert.match(exported.text, /^# Explain: A high problem in package-lock\.json \\\(group\/worst\\\)/);
	assert.match(exported.text, /## You\n\nIs it only in a test file\?/);
	assert.equal((await send(server, "GET", `/api/discussions/export?id=${id}&format=html`)).status, 400);

	// After a newer scan the discussion can still be read, but a follow-up would mix two scans: refused.
	const newer = { ...sampleReport("/work"), scannedAt: "2026-11-20T12:00:00.000Z" };
	await writeFile(join(server.dir, "state", "repo-scan.json"), JSON.stringify(newer));
	const stale = (await send(server, "GET", `/api/discussions/one?id=${id}`)).json;
	assert.equal(stale.followUp.ok, false);
	assert.match(stale.followUp.reason, /A newer scan has replaced the one this discussion is about/);
	assert.equal((await send(server, "POST", "/api/discussions/ask", { body: { id, question: "Still?" } })).status, 409);
	assert.equal(network.modelCalls.length, 3);

	assert.equal((await send(server, "POST", "/api/discussions/delete", { body: { id } })).status, 200);
	assert.equal((await send(server, "GET", `/api/discussions/one?id=${id}`)).status, 404);
	assert.equal((await send(server, "POST", "/api/discussions/delete", { body: { id } })).status, 404);
	assert.deepEqual((await send(server, "GET", "/api/discussions")).json.discussions, []);
});

test("a project folder gets saved exports, discussions and a log, under Porchlight's own names and nowhere else", async (t) => {
	const network = fakeNetwork({ model: (body) => Response.json({ message: { content: `Answer to ${body.messages.length} messages.` } }) });
	const server = await start(t, { assistant, fetchFn: network.fetchFn, scan: async (options) => sampleReport(options.root) });
	await withReport(server);
	assert.deepEqual((await send(server, "GET", "/api/state")).json.projects, { current: null, projects: [], canChange: true });
	assert.equal((await send(server, "POST", "/api/repos/export?content=roadmap&format=md")).status, 409, "no project: nothing is written anywhere");

	// What choosing a folder would make is shown first, and nothing is made until the project is added.
	const folder = join(server.dir, "work", "acme");
	await makeTree(server.dir, { "work/": "" });
	const preview = (await send(server, "GET", `/api/projects/preview?folder=${encodeURIComponent(folder)}`)).json.check;
	assert.deepEqual(
		preview.creates.map((path: string) => path.slice(preview.folder.length)),
		["", "/Porchlight", "/Porchlight/Exports", "/Porchlight/Discussions", "/Porchlight/Log"],
	);
	assert.equal(await stat(folder).catch(() => null), null);
	for (const body of [{ name: "", folder }, { name: "x".repeat(61), folder }, { name: "acme", folder: "work/acme" }, { name: "acme", folder: "/" }]) {
		assert.equal((await send(server, "POST", "/api/projects", { body })).status, 400, JSON.stringify(body));
	}
	const added = await send(server, "POST", "/api/projects", { body: { name: "acme\naudit", folder } });
	assert.equal(added.status, 200);
	const id = added.json.added as string;
	assert.deepEqual([added.json.current, added.json.projects[0].name], [id, "acme audit"]);
	const own = join(preview.folder, "Porchlight");
	assert.equal((await stat(join(own, "Exports"))).mode & 0o777, 0o700);
	assert.equal((await stat(join(server.dir, "state", "projects.json"))).mode & 0o777, 0o600);

	// Exports: written into Exports under a name from the fixed list, the same bytes a download gets.
	const saved = (await send(server, "POST", "/api/repos/export?content=findings&format=csv")).json.saved;
	assert.match(saved.name, /^\d{4}-\d{2}-\d{2} \d{2}\.\d{2} Findings\.csv$/);
	assert.deepEqual([saved.project, saved.part, saved.projectName, saved.path], [id, "Exports", "acme audit", join(own, "Exports", saved.name)]);
	assert.equal(await readFile(saved.path, "utf8"), (await send(server, "GET", "/api/repos/export?content=findings&format=csv")).text);
	assert.equal((await stat(saved.path)).mode & 0o777, 0o600);
	const again = (await send(server, "POST", "/api/repos/export?content=findings&format=csv")).json.saved;
	assert.ok(again.name === saved.name.replace(".csv", " 2.csv") || again.name.endsWith(" Findings.csv"), "a second in the same minute never overwrites the first");
	assert.match((await send(server, "POST", "/api/repos/export?content=roadmap&format=md&q=group")).json.saved.name, / Repair roadmap \(partial\)\.md$/);
	assert.equal((await send(server, "POST", "/api/repos/export?content=roadmap&format=exe")).status, 400);

	// A discussion begun in the project keeps its transcript there, written again after each answer.
	const explained = await send(server, "POST", "/api/assist/finding", { body: { repo: "group/worst", ruleId: "rule-high", location: "package-lock.json" } });
	const discussionId = explained.json.discussion as string;
	const kept = (await send(server, "GET", `/api/discussions/one?id=${discussionId}`)).json.discussion.saved;
	assert.equal(kept.project, id);
	assert.match(kept.name, /^\d{4}-\d{2}-\d{2} \d{2}\.\d{2} Explain a finding\.md$/);
	await send(server, "POST", "/api/discussions/ask", { body: { id: discussionId, question: "Is it only in a test file?" } });
	const transcript = await readFile(join(own, "Discussions", kept.name), "utf8");
	assert.match(transcript, /^# Explain: A high problem in package-lock\.json/);
	assert.match(transcript, /Is it only in a test file\?[\s\S]*Answer to 4 messages\./);
	assert.deepEqual((await send(server, "GET", "/api/discussions")).json.discussions.map((one: { project?: string }) => one.project), [id]);

	// A scan is logged with its counts. The log never holds what the model wrote.
	assert.equal((await send(server, "POST", "/api/repos/scan", { body: { root: server.dir } })).status, 202);
	await untilScan(server, "done");
	const logs = await readdir(join(own, "Log"));
	assert.equal(logs.length, 1);
	assert.match(logs[0]!, /^\d{4}-\d{2}-\d{2}\.log$/);
	await new Promise((resolve) => setTimeout(resolve, 50));
	const log = await readFile(join(own, "Log", logs[0]!), "utf8");
	for (const line of [
		/^\d{2}:\d{2}:\d{2} {2}Project started: acme audit, in /m,
		/ {2}Exported Findings \(csv\) to Porchlight\/Exports\/\d{4}-\d{2}-\d{2} \d{2}\.\d{2} Findings\.csv$/m,
		/ {2}Exported Findings \(csv\) as a download$/m,
		/ {2}Asked qwen-test:9b at ollama\.test:11434: Explain a finding, answered in [\d.]+ s$/m,
		/ {2}Follow-up question to qwen-test:9b at ollama\.test:11434: Explain a finding, answered in [\d.]+ s$/m,
		/ {2}Scan started: .*, 3 levels down\. Standard: secrets in every commit on every branch, dependencies$/m,
		/ {2}Scan finished: 3 repositories, 4 findings \(1 critical, 1 high, 1 medium, 1 low\)$/m,
	]) {
		assert.match(log, line);
	}
	assert.ok(!log.includes("Answer to") && !log.includes("test file"), "neither the model's words nor the owner's question");
	assert.equal((await stat(join(own, "Log", logs[0]!))).mode & 0o777, 0o600);

	// No project: exports go back to downloads, and an older discussion can be saved into a project later.
	assert.equal((await send(server, "POST", "/api/projects/use", { body: { id: null } })).json.current, null);
	assert.equal((await send(server, "POST", "/api/repos/export?content=roadmap&format=md")).status, 409);
	const asked = await send(server, "POST", "/api/assist/ask", { body: { question: "What first?" } });
	const askId = asked.json.discussion as string;
	assert.equal((await send(server, "GET", `/api/discussions/one?id=${askId}`)).json.discussion.saved, undefined);
	assert.equal((await send(server, "POST", "/api/discussions/save", { body: { id: askId } })).status, 409);
	await send(server, "POST", "/api/projects/use", { body: { id } });
	const later = (await send(server, "POST", "/api/discussions/save", { body: { id: askId } })).json.saved;
	assert.match(later.name, / Question about the scan\.md$/);

	// Removing a project takes it off the list and leaves its folder as it was.
	const before = await readdir(join(own, "Exports"));
	assert.deepEqual((await send(server, "POST", "/api/projects/remove", { body: { id } })).json.projects, []);
	assert.deepEqual(await readdir(join(own, "Exports")), before);
	for (const [path, body] of [
		["/api/projects/use", { id: "../x" }],
		["/api/projects/remove", { id: "prj_0000000000000000" }],
	] as const) {
		assert.notEqual((await send(server, "POST", path, { body })).status, 200, path);
	}
});

test("keeps an Ask question as the first turn and rebuilds it for a follow-up", async (t) => {
	const network = fakeNetwork();
	const server = await start(t, { assistant, fetchFn: network.fetchFn });
	await withReport(server);

	const asked = await send(server, "POST", "/api/assist/ask", { body: { question: "  Which repository first?  " } });
	const one = (await send(server, "GET", `/api/discussions/one?id=${asked.json.discussion}`)).json.discussion;
	assert.deepEqual([one.kind, one.title, one.turns[0].question], ["ask", "Ask: Which repository first?", "Which repository first?"]);

	await send(server, "POST", "/api/discussions/ask", { body: { id: one.id, question: "Why that one?" } });
	const sent = JSON.parse(network.modelCalls.at(-1)!);
	assert.match(sent.messages[1].content, /DATA>>>\n\nThe owner's question:\nWhich repository first\?$/, "the first question, as first asked");
	assert.match(sent.messages.at(-1).content, /Why that one\?$/);
});

test("has the model judge findings in the background, worst first, and shows each judgement beside its finding", async (t) => {
	const asked: string[] = [];
	const server = await start(t, {
		assistant,
		fetchFn: (async (_url: string, init: RequestInit) => {
			asked.push(String(init.body));
			return Response.json({ message: { content: '{"verdict":"unlikely","reason":"Nothing imports it.","steps":["Upgrade it anyway"]}' } });
		}) as unknown as typeof fetch,
	});
	await makeTree(server.dir, { "state/": "" });
	await writeFile(join(server.dir, "state", "repo-scan.json"), JSON.stringify(sampleReport(server.dir)));

	const before = (await send(server, "GET", "/api/analysis")).json;
	assert.deepEqual(before.status, { state: "idle" });
	assert.equal(before.summary.judged, 0);
	for (const body of [{ limit: 0 }, { limit: 501 }, { limit: "2" }, { severities: ["urgent"] }, { severities: [] }]) {
		assert.equal((await send(server, "POST", "/api/analysis", { body })).status, 400);
	}
	assert.deepEqual(asked, []);

	assert.equal((await send(server, "POST", "/api/analysis", { body: { limit: 1, severities: ["critical", "high", "medium", "low"] } })).status, 202);
	let after = (await send(server, "GET", "/api/analysis")).json;
	for (let attempt = 0; attempt < 200 && after.status.state === "running"; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 5));
		after = (await send(server, "GET", "/api/analysis")).json;
	}
	assert.deepEqual([after.status.state, after.status.done, after.status.failed], ["done", 1, 0]);
	assert.equal(after.summary.judged, 1);
	assert.equal(after.summary.verdicts.unlikely, 1);
	assert.equal(asked.length, 1);

	// The judgement rides beside the finding; the finding itself, and every count, is as the scanner left it.
	const { report } = (await send(server, "GET", "/api/repos/report")).json;
	const findings = report.repos.flatMap((repo: { findings: unknown[] }) => repo.findings) as { severity: string; analysis?: { verdict: string; model: string } }[];
	const judged = findings.filter((finding) => finding.analysis);
	assert.ok(judged.length >= 1);
	assert.deepEqual([judged[0]?.analysis?.verdict, judged[0]?.analysis?.model], ["unlikely", MODEL]);
	assert.deepEqual(findings.map((finding) => finding.severity).sort(), sampleReport(server.dir).repos.flatMap((repo) => repo.findings.map((finding) => finding.severity)).sort());
	assert.equal((await stat(join(server.dir, "state", "repo-analysis.json"))).mode & 0o777, 0o600);
});

test("analysis needs a model, and a report to analyse", async (t) => {
	const off = await start(t);
	assert.equal((await send(off, "POST", "/api/analysis", { body: {} })).status, 503);
	assert.deepEqual((await send(off, "GET", "/api/analysis")).json, { status: { state: "idle" }, summary: null });
	const noReport = await start(t, { assistant });
	assert.equal((await send(noReport, "POST", "/api/analysis", { body: {} })).status, 404);
});

test("asks the model one request at a time", async (t) => {
	let release!: () => void;
	const network = fakeNetwork({
		model: () => new Promise<Response>((resolve) => (release = () => resolve(Response.json({ message: { content: "Done." } })))),
	});
	const server = await start(t, { assistant, fetchFn: network.fetchFn });
	await withReport(server);

	const first = send(server, "POST", "/api/assist/roadmap", { body: {} });
	for (let attempt = 0; attempt < 200 && network.modelCalls.length === 0; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(network.modelCalls.length, 1);

	const second = await send(server, "POST", "/api/assist/ask", { body: { question: "Anything?" } });
	assert.deepEqual([second.status, second.json.error], [409, "The model is still answering another request. Try again when it has finished."]);
	assert.equal(network.modelCalls.length, 1, "the second request never reached the model");

	release();
	assert.deepEqual(pick((await first).json, ["text", "model"]), { text: "Done.", model: MODEL });
	const third = send(server, "POST", "/api/assist/ask", { body: { question: "Anything?" } });
	for (let attempt = 0; attempt < 200 && network.modelCalls.length < 2; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
	release();
	assert.equal((await third).status, 200, "the model is free again once it has answered");
});

test("explains a domain's latest scan from the monitor without ever exposing the admin token", async (t) => {
	const report = {
		domain: "example.com",
		takenAt: "2026-11-17T09:00:00.000Z",
		baseline: false,
		hostCount: 2,
		notes: [],
		changes: [{ kind: "host_added", host: "new.example.com" }],
		newFindings: [],
		resolvedFindings: [],
		findings: [{ id: "dangling-cname:shop.example.com", severity: "high", host: "shop.example.com", basis: "dns", title: "CNAME target does not resolve" }],
	};
	const challenge = "porchlight-verify=challenge-value-for-the-owner-only";
	const network = fakeNetwork({
		monitor: (url) =>
			url.pathname === "/domains/refused.example"
				? Response.json({ error: "Unauthorized" }, { status: 401 })
				: Response.json({ domain: { name: "example.com", challenge: { type: "TXT", name: "_porchlight-challenge.example.com", value: challenge } }, report }),
	});
	const monitor = monitorConfig({ PORCHLIGHT_MONITOR_URL: "https://monitor.example", PORCHLIGHT_ADMIN_TOKEN: ADMIN_TOKEN });
	const server = await start(t, { assistant, monitor, fetchFn: network.fetchFn });

	const reply = await send(server, "POST", "/api/assist/domain", { body: { domain: " Example.COM " } });

	assert.deepEqual([reply.status, pick(reply.json, ["text", "model"])], [200, { text: "What it is: a test answer.", model: MODEL }]);
	assert.deepEqual(network.monitorCalls, [{ url: "https://monitor.example/domains/example.com", authorization: `Bearer ${ADMIN_TOKEN}` }]);
	const prompt = network.modelCalls[0]!;
	assert.match(prompt, /new\.example\.com/);
	assert.match(prompt, /Remove or repoint the DNS record for shop\.example\.com/);
	for (const kept of [ADMIN_TOKEN, challenge]) assert.ok(!prompt.includes(kept), "the model gets the scan report and nothing else");
	assert.ok(!reply.text.includes(ADMIN_TOKEN) && !JSON.stringify(reply.headers).includes(ADMIN_TOKEN));

	// The monitor refusing the token is its problem: the page must not read it as its own key being wrong.
	const refused = await send(server, "POST", "/api/assist/domain", { body: { domain: "refused.example" } });
	assert.deepEqual([refused.status, refused.json.error], [502, "The monitor refused the request: Unauthorized"]);

	const unmonitored = await start(t, { assistant, fetchFn: network.fetchFn });
	assert.deepEqual((await send(unmonitored, "POST", "/api/assist/domain", { body: { domain: "example.com" } })).json, { error: "Set PORCHLIGHT_MONITOR_URL" });
});

test("turns a model that cannot answer into a clear error, and frees it for the next request", async (t) => {
	const answers: (() => Response | Promise<Response>)[] = [
		() => Promise.reject(new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) })),
		() => Response.json({ error: `model "${MODEL}" not found, try pulling it first` }, { status: 404 }),
		() => Response.json({ message: { content: "Recovered." } }),
	];
	const network = fakeNetwork({ model: () => answers.shift()!() });
	const server = await start(t, { assistant, fetchFn: network.fetchFn });
	await withReport(server);

	const unreachable = await send(server, "POST", "/api/assist/roadmap");
	assert.deepEqual([unreachable.status, unreachable.json.error], [502, "Could not reach the model at ollama.test:11434 (ECONNREFUSED). Is Ollama running there?"]);
	const missing = await send(server, "POST", "/api/assist/roadmap");
	assert.deepEqual([missing.status, missing.json.error], [502, `Ollama has no model ${MODEL}: add it in Ollama first`]);
	assert.deepEqual(pick((await send(server, "POST", "/api/assist/roadmap")).json, ["text", "model"]), { text: "Recovered.", model: MODEL });
});

function pick(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
	return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

// oxlint-disable-next-line typescript/no-explicit-any -- the status shape varies by state
// oxlint-disable-next-line typescript/no-explicit-any -- assertions read arbitrary response shapes
async function untilFetched(server: UiServer): Promise<any> {
	for (let attempt = 0; attempt < 200; attempt++) {
		const { job } = (await send(server, "GET", "/api/github")).json;
		if (job.state === "done") return job;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error("the fetch never finished");
}

async function untilScan(server: UiServer, state: string): Promise<any> {
	for (let attempt = 0; attempt < 200; attempt++) {
		const { scan } = (await send(server, "GET", "/api/repos/scan")).json;
		if (scan.state === state) return scan;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`scan never reached state "${state}"`);
}

test("keeps the chosen appearance beside the report, and accepts only the offered looks", async (t) => {
	const server = await start(t);
	assert.equal((await send(server, "GET", "/api/state")).json.appearance, "today");

	const saved = await send(server, "POST", "/api/settings", { body: { appearance: "terminal" } });
	assert.equal(saved.status, 200);
	assert.equal((await send(server, "GET", "/api/state")).json.appearance, "terminal");

	for (const appearance of ["../../etc/passwd", "", 3, null]) {
		const refused = await send(server, "POST", "/api/settings", { body: { appearance } });
		assert.equal(refused.status, 400);
	}
	assert.equal((await send(server, "POST", "/api/settings", { key: null, body: { appearance: "light" } })).status, 401);
	assert.equal((await send(server, "GET", "/api/state")).json.appearance, "terminal");

	// A copy started later reads the same choice.
	const again = await start(t, { reportPath: join(server.dir, "state", "repo-scan.json") });
	assert.equal((await send(again, "GET", "/api/state")).json.appearance, "terminal");
});

test("keeps where answers appear beside the look, and accepts only the places offered", async (t) => {
	const server = await start(t);
	assert.equal((await send(server, "GET", "/api/state")).json.answers, "right");

	await send(server, "POST", "/api/settings", { body: { appearance: "terminal" } });
	const saved = await send(server, "POST", "/api/settings", { body: { answers: "bottom" } });
	assert.deepEqual([saved.status, saved.json], [200, { appearance: "terminal", answers: "bottom" }], "one preference leaves the other as it was");

	for (const body of [{ answers: "left" }, { answers: 1 }, { answers: null }, {}, { appearance: "terminal", answers: "../x" }, { appearance: "nope", answers: "below" }]) {
		assert.equal((await send(server, "POST", "/api/settings", { body })).status, 400, JSON.stringify(body));
	}
	const state = (await send(server, "GET", "/api/state")).json;
	assert.deepEqual([state.appearance, state.answers], ["terminal", "bottom"], "a refused request changes nothing");

	const again = await start(t, { reportPath: join(server.dir, "state", "repo-scan.json") });
	assert.equal((await send(again, "GET", "/api/state")).json.answers, "bottom");
});

test("serves every module the page imports", async (t) => {
	const server = await start(t);
	const { readFile, readdir } = await import("node:fs/promises");
	const names = (await readdir(new URL("../ui/", import.meta.url))).filter((name) => name.endsWith(".js"));
	const imported = new Set<string>(["app.js"]);
	for (const name of names) {
		const text = await readFile(new URL(`../ui/${name}`, import.meta.url), "utf8");
		for (const [, target] of text.matchAll(/^import [^;]*? from "\.\/([\w-]+\.js)";$/gm)) imported.add(target!);
	}
	for (const name of imported) assert.equal((await send(server, "GET", `/${name}`, { key: null })).status, 200, name);
});

test("serves every look's script, and offers twelve looks", async (t) => {
	const server = await start(t);
	for (const path of ["/looks.js", "/appearance.js", "/settings.js"]) assert.equal((await send(server, "GET", path, { key: null })).status, 200);
	const { LOOKS } = await import("../ui/looks.js");
	assert.equal(LOOKS.length, 12);
	assert.equal(new Set(LOOKS.map((look) => look.id)).size, 12);
});

/** Records every request a model setting makes: where it went and what authorised it. */
function modelNetwork(answer: (url: URL) => Response = () => Response.json({ choices: [{ message: { content: "ready" } }] })) {
	const calls: { url: string; headers: Record<string, string> }[] = [];
	const fetchFn = (async (input: URL | string, init: RequestInit = {}) => {
		const url = new URL(String(input));
		calls.push({ url: url.href, headers: Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v])) });
		return answer(url);
	}) as unknown as typeof fetch;
	return { calls, fetchFn };
}

const CLAUDE_KEY = ["sk", "ant", "test", "c".repeat(30)].join("-");
const SERVER_KEY = ["sk", "unsloth", "s".repeat(24)].join("-");

test("a model chosen in Settings is used at once, kept beside the report, and its key is never sent back", async (t) => {
	const network = modelNetwork((url) =>
		url.hostname === "api.anthropic.com" ? Response.json({ content: [{ type: "text", text: "ready" }], stop_reason: "end_turn" }) : Response.json({}),
	);
	const server = await start(t, { fetchFn: network.fetchFn, assistantUnset: true });
	const before = (await send(server, "GET", "/api/model")).json;
	assert.deepEqual([before.source, before.choice, before.assistant.configured], ["startup", "off", false]);

	const saved = await send(server, "POST", "/api/model", { body: { choice: "anthropic", apiKey: CLAUDE_KEY } });
	assert.equal(saved.status, 200);
	assert.deepEqual([saved.json.source, saved.json.choice, saved.json.model, saved.json.keys.anthropic], ["settings", "anthropic", "", true]);
	assert.deepEqual(saved.json.assistant, { configured: true, model: "claude-opus-5-5", host: "api.anthropic.com", hosted: true });
	for (const reply of [saved, await send(server, "GET", "/api/model"), await send(server, "GET", "/api/state")]) {
		assert.ok(!reply.text.includes(CLAUDE_KEY), "the page is never sent a key");
	}

	const file = join(server.dir, "state", "model-settings.json");
	assert.equal((await stat(file)).mode & 0o777, 0o600);
	assert.ok((await readFile(file, "utf8")).includes(CLAUDE_KEY));

	const tested = await send(server, "POST", "/api/model/test", { body: { choice: "anthropic" } });
	assert.deepEqual([tested.status, tested.json.text, tested.json.model], [200, "ready", "claude-opus-5-5"]);
	assert.deepEqual(network.calls.map((call) => [call.url, call.headers["x-api-key"] === CLAUDE_KEY]), [["https://api.anthropic.com/v1/messages", true]]);

	// A copy started later uses the same choice, whatever it was started with.
	const again = await start(t, { reportPath: join(server.dir, "state", "repo-scan.json"), assistant });
	assert.deepEqual((await send(again, "GET", "/api/state")).json.assistant.model, "claude-opus-5-5");
	assert.equal(again.model().source, "settings");
});

test("a key goes only to the provider or the server address it was saved for", async (t) => {
	const network = modelNetwork((url) =>
		url.pathname.endsWith("/models") ? Response.json({ data: [{ id: "models/gemini-test-pro" }, { id: "models/text-embedding-9" }] }) : Response.json({ choices: [{ message: { content: "ready" } }] }),
	);
	const server = await start(t, { fetchFn: network.fetchFn });
	await send(server, "POST", "/api/model", { body: { choice: "anthropic", apiKey: CLAUDE_KEY } });

	// Another choice never gets Claude's key, even pointed at any address.
	await send(server, "POST", "/api/model/test", { body: { choice: "openai-server", url: "http://elsewhere.test/v1", model: "m" } });
	assert.equal(network.calls.at(-1)!.url, "http://elsewhere.test/v1/chat/completions");
	assert.ok(!JSON.stringify(network.calls).includes(CLAUDE_KEY));

	// A server's key is tied to its address.
	const own = await send(server, "POST", "/api/model", { body: { choice: "unsloth-mac", model: "local-model", apiKey: SERVER_KEY } });
	assert.deepEqual([own.status, own.json.keys.servers], [200, ["http://localhost:8888/v1"]]);
	await send(server, "POST", "/api/model/test", { body: { choice: "unsloth-mac", model: "local-model" } });
	assert.deepEqual([network.calls.at(-1)!.url, network.calls.at(-1)!.headers.authorization], ["http://localhost:8888/v1/chat/completions", `Bearer ${SERVER_KEY}`]);
	await send(server, "POST", "/api/model/test", { body: { choice: "openai-server", url: "http://other.test/v1", model: "m" } });
	assert.equal(network.calls.at(-1)!.headers.authorization, undefined);

	// Gemini: Google's fixed address, its own key, and model names a person would type.
	const geminiKey = ["AIza", "g".repeat(35)].join("");
	const listed = await send(server, "POST", "/api/model/models", { body: { choice: "gemini", apiKey: geminiKey } });
	assert.deepEqual(listed.json.models, ["gemini-test-pro"]);
	assert.deepEqual([network.calls.at(-1)!.url, network.calls.at(-1)!.headers.authorization], ["https://generativelanguage.googleapis.com/v1beta/openai/models", `Bearer ${geminiKey}`]);
	assert.ok(!listed.text.includes(geminiKey));
});

test("a setting to correct never replaces a working model, and the start-up model can be restored", async (t) => {
	const network = modelNetwork((url) => (url.pathname === "/api/tags" ? Response.json({ models: [{ name: MODEL }, { name: "other:7b" }] }) : Response.json({})));
	const server = await start(t, { assistant, fetchFn: network.fetchFn });
	const startup = (await send(server, "GET", "/api/model")).json;
	assert.deepEqual([startup.source, startup.choice, startup.url, startup.model], ["startup", "ollama-server", "http://ollama.test:11434", MODEL]);

	for (const [body, error] of [
		[{ choice: "anthropic" }, "Enter your Claude API key"],
		[{ choice: "openai", apiKey: "short" }, "That is not an API key: it should be 20 or more characters with no spaces"],
		[{ choice: "ollama-mac", url: "ftp://x", model: "m" }, "The address must start with http:// or https://"],
		[{ choice: "ollama-mac" }, "Choose a model: Find models lists the ones Ollama has"],
		[{ choice: "made-up" }, "Choose where the model runs"],
	] as const) {
		const refused = await send(server, "POST", "/api/model", { body });
		assert.deepEqual([refused.status, refused.json.error], [400, error]);
	}
	assert.equal((await send(server, "GET", "/api/state")).json.assistant.model, MODEL);

	const listed = await send(server, "POST", "/api/model/models", { body: { choice: "ollama-server", url: "http://ollama.test:11434" } });
	assert.deepEqual(listed.json.models, ["other:7b", MODEL]);

	const off = await send(server, "POST", "/api/model", { body: { choice: "off" } });
	assert.deepEqual(off.json.assistant, { configured: false, error: "No model is connected", unset: true });
	assert.equal((await send(server, "POST", "/api/assist/roadmap")).status, 503);

	const back = await send(server, "POST", "/api/model/startup");
	assert.deepEqual([back.json.source, back.json.assistant.model], ["startup", MODEL]);
	await assert.rejects(stat(join(server.dir, "state", "model-settings.json")));
	assert.equal((await send(server, "POST", "/api/model", { key: null, body: { choice: "off" } })).status, 401);
});

test("other devices get in only on the tailnet address, only with the access key, and cannot change access", async (t) => {
	const server = await start(t, { tailnetAddress: () => "127.0.0.1", accessPort: 0 });
	const off = await send(server, "GET", "/api/access");
	assert.deepEqual([off.json.enabled, off.json.listening, off.json.canChange, off.json.link], [false, false, true, undefined]);

	const on = await send(server, "POST", "/api/access", { body: { enabled: true } });
	assert.deepEqual([on.status, on.json.listening], [200, true]);
	const link = new URL(on.json.link);
	const key = link.hash.slice("#k=".length);
	assert.ok(key.length >= MIN_KEY_LENGTH && key !== server.sessionKey);
	const file = join(server.dir, "state", "access.json");
	assert.equal((await stat(file)).mode & 0o777, 0o600);

	const tailnetPort = Number(link.port);
	const device = (sessionKey: string | null) => ({ ...server, port: tailnetPort, sessionKey: sessionKey ?? "" }) as UiServer;
	const viaName = { headers: { host: `mac.tail-example.ts.net:${tailnetPort}` } };
	// The page loads by any tailnet name; its data needs the access key, and only that key.
	assert.equal((await send(device(null), "GET", "/", { key: null, ...viaName })).status, 200);
	const noKey = await send(device(null), "GET", "/api/state", { key: null, ...viaName });
	assert.deepEqual([noKey.status, noKey.json.tailnet, noKey.json.service], [401, true, false]);
	assert.equal((await send(device(server.sessionKey), "GET", "/api/state", viaName)).status, 401);
	const state = await send(device(key), "GET", "/api/state", viaName);
	assert.deepEqual([state.status, state.json.remote], [200, true]);
	assert.equal((await send(server, "GET", "/api/state", { key })).status, 401, "this computer's page takes only its own session key");
	assert.equal(
		(await send(device(key), "GET", "/api/state", { headers: { host: `mac.tail-example.ts.net:${tailnetPort}`, origin: "https://evil.example" } })).status,
		403,
	);

	// A device sees whether access is on, never the key, and cannot change it.
	const seen = await send(device(key), "GET", "/api/access", viaName);
	assert.deepEqual([seen.json.canChange, seen.json.link], [false, undefined]);
	assert.ok(!seen.text.includes(key));
	assert.equal((await send(device(key), "POST", "/api/access", { ...viaName, body: { enabled: false } })).status, 403);
	assert.equal((await send(device(key), "POST", "/api/access/key", viaName)).status, 403);

	// A device can move between projects, but only the computer that runs Porchlight chooses a folder: it cannot add, look into or remove one.
	assert.equal((await send(device(key), "GET", "/api/projects", viaName)).json.canChange, false);
	assert.equal((await send(device(key), "GET", `/api/projects/preview?folder=${encodeURIComponent(server.dir)}`, viaName)).status, 403);
	assert.equal((await send(device(key), "POST", "/api/projects", { ...viaName, body: { name: "x", folder: join(server.dir, "x") } })).status, 403);
	assert.equal((await send(device(key), "POST", "/api/projects/use", { ...viaName, body: { id: null } })).status, 200);

	// A device can watch an investigation and stop one, but never start one or approve a request, let alone a whole run.
	assert.equal((await send(device(key), "GET", "/api/investigate", viaName)).json.canChange, false);
	assert.equal((await send(device(key), "POST", "/api/investigate/start", { ...viaName, body: { domain: "example.com", approveAll: true } })).status, 403);
	assert.equal((await send(device(key), "POST", "/api/investigate/approve", { ...viaName, body: { run: "inv_0000000000000000", step: "step_000000000000", approve: true, rest: true } })).status, 403);
	assert.equal((await send(device(key), "POST", "/api/investigate/stop", viaName)).status, 200);

	// Nor can a device connect or remove the monitor.
	assert.equal((await send(device(key), "POST", "/api/monitor", { ...viaName, body: { address: "https://monitor.example", token: ADMIN_TOKEN } })).status, 403);
	assert.equal((await send(device(key), "POST", "/api/monitor/remove", viaName)).status, 403);

	// Nor choose where the owner's data goes, delete the saved keys, or have this computer probe an address (S20).
	const modelFile = join(server.dir, "state", "model-settings.json");
	await writeFile(modelFile, `${JSON.stringify({ choice: "off", keys: { anthropic: "kept-key-0123456789" } })}\n`);
	for (const [path, body] of [
		["/api/model", { choice: "anthropic" }],
		["/api/model/startup", {}],
		["/api/model/test", { choice: "compatible", url: "http://127.0.0.1:8080/v1" }],
		["/api/model/models", { choice: "compatible", url: "http://127.0.0.1:8080/v1" }],
		["/api/model/local/pull", { name: "llama3" }],
	] as const) {
		assert.equal((await send(device(key), "POST", path, { ...viaName, body })).status, 403, path);
	}
	assert.match(await readFile(modelFile, "utf8"), /kept-key-0123456789/, "the saved settings and keys are as they were");
	assert.equal((await send(device(key), "GET", "/api/model", viaName)).status, 200, "a device can still see which model is used");

	// A new key turns the old one away.
	const renewed = await send(server, "POST", "/api/access/key");
	const newKey = new URL(renewed.json.link).hash.slice("#k=".length);
	const newPort = Number(new URL(renewed.json.link).port);
	assert.notEqual(newKey, key);
	assert.equal((await send({ ...server, port: newPort, sessionKey: key } as UiServer, "GET", "/api/state")).status, 401);
	assert.equal((await send({ ...server, port: newPort, sessionKey: newKey } as UiServer, "GET", "/api/state")).status, 200);

	// A copy started later listens again by itself.
	await server.close();
	const again = await start(t, { reportPath: join(server.dir, "state", "repo-scan.json"), tailnetAddress: () => "127.0.0.1", accessPort: 0 });
	assert.equal(again.access().listening, true);
	const againPort = Number(new URL(again.access().url!).port);
	assert.equal((await send({ ...again, port: againPort, sessionKey: newKey } as UiServer, "GET", "/api/state")).status, 200, "the saved key still works");

	const stopped = await send(again, "POST", "/api/access", { body: { enabled: false } });
	assert.deepEqual([stopped.json.enabled, stopped.json.listening], [false, false]);
	await assert.rejects(send({ ...again, port: againPort, sessionKey: newKey } as UiServer, "GET", "/api/state"), "nothing listens on the tailnet once access is off");
});

test("access waits for Tailscale, and a service never opens a second listener", async (t) => {
	const server = await start(t, { tailnetAddress: () => null, accessPort: 0 });
	const waiting = await send(server, "POST", "/api/access", { body: { enabled: true } });
	assert.deepEqual([waiting.json.enabled, waiting.json.listening], [true, false]);
	assert.match(waiting.json.error, /Tailscale is not connected/);

	const key = "k".repeat(MIN_KEY_LENGTH);
	const service = await start(t, { host: "0.0.0.0", sessionKey: key, tailnetAddress: () => "127.0.0.1", accessPort: 0 });
	const refused = await send(service, "POST", "/api/access", { key, body: { enabled: true } });
	assert.equal(refused.status, 403);
	assert.equal(service.access().listening, false);
});

test("a service keeps its project folders in a projects folder of its own data folder", async (t) => {
	const key = "k".repeat(MIN_KEY_LENGTH);
	const service = await start(t, { host: "0.0.0.0", sessionKey: key });
	const within = join(service.dir, "state", "projects");
	const state = (await send(service, "GET", "/api/projects", { key })).json;
	assert.deepEqual([state.canChange, state.within], [true, within]);
	assert.equal((await stat(within)).mode & 0o777, 0o700);
	for (const folder of [join(service.dir, "elsewhere"), within, join(within, "..", "history")]) {
		const reply = await send(service, "POST", "/api/projects", { key, body: { name: "acme", folder } });
		assert.deepEqual([reply.status, /Choose one inside/.test(reply.json.error)], [400, true], folder);
	}
	const added = await send(service, "POST", "/api/projects", { key, body: { name: "acme", folder: join(within, "acme") } });
	assert.equal(added.status, 200);
	// A service is given its monitor where it is managed, never from its page.
	assert.equal((await send(service, "POST", "/api/monitor", { key, body: { address: "https://monitor.example", token: ADMIN_TOKEN } })).status, 403);
	assert.ok((await stat(join(within, "acme", "Porchlight", "Exports"))).isDirectory());
});

test("a mural is written in the background for one scan and its filters, and an export carries it only when asked", async (t) => {
	let answer = JSON.stringify({ headline: "Where things stand", found: ["Four problems"], decided: ["Rotate the key first"], done: ["Scanned three repositories"], next: ["Upgrade"] });
	let calls = 0;
	const fetchFn = (async () => (calls++, Response.json({ message: { content: answer } }))) as unknown as typeof fetch;
	const server = await start(t, { assistant, fetchFn });
	await withReport(server);
	const settle = async (query = "") => {
		for (let i = 0; i < 100; i++) {
			const job = (await send(server, "GET", `/api/repos/mural${query}`)).json;
			if (job.state !== "running") return job;
			await new Promise((resolve) => setTimeout(resolve, 5));
		}
		throw new Error("the mural never finished");
	};

	assert.equal((await send(server, "GET", "/api/repos/export?format=html&mural=1")).status, 409, "no mural has been written yet");
	assert.equal((await send(server, "POST", "/api/repos/mural")).status, 202);
	const done = await settle();
	assert.deepEqual([done.state, done.current, done.headline, done.model], ["done", true, "Where things stand", MODEL]);
	assert.equal((await stat(join(server.dir, "state", "repo-mural.json"))).mode & 0o777, 0o600);

	const page = await send(server, "GET", "/api/repos/export?format=html&mural=1");
	assert.equal(page.status, 200);
	assert.match(page.text, /Where things stand/);
	assert.match(page.text, /Written by qwen-test:9b/);
	assert.ok(!(await send(server, "GET", "/api/repos/export?format=html")).text.includes("Where things stand"), "not unless asked for");

	// Other filters describe a different part of the scan, so they need their own mural.
	assert.equal((await send(server, "GET", "/api/repos/export?format=html&mural=1&severity=high")).status, 409);
	assert.equal((await send(server, "GET", "/api/repos/mural?severity=high")).json.current, false);

	// An answer that is not a mural is an error, never a mural, after one more try.
	answer = "I could not do that.";
	const callsBefore = calls;
	await send(server, "POST", "/api/repos/mural?severity=high");
	const failed = await settle("?severity=high");
	assert.deepEqual([failed.state, failed.current], ["failed", true]);
	assert.match(failed.error, /did not answer with the mural/);
	assert.equal(calls - callsBefore, 2, "it tried twice");

	const without = await start(t);
	await withReport(without);
	assert.equal((await send(without, "POST", "/api/repos/mural")).status, 503);
});

// Send to a model

test("sends the roadmap or the findings to the model the owner picks, from the stored report only", async (t) => {
	const calls: { host: string; key?: string; body: Record<string, any> }[] = [];
	const fetchFn = (async (input: URL | string, init: RequestInit = {}) => {
		const url = new URL(String(input));
		const headers = (init.headers ?? {}) as Record<string, string>;
		calls.push({ host: url.host, key: headers["x-api-key"], body: JSON.parse(String(init.body)) });
		if (url.hostname === "api.anthropic.com") return Response.json({ content: [{ type: "text", text: "Overall risk: one critical package." }], stop_reason: "end_turn" });
		return Response.json({ message: { role: "assistant", content: "Repair 1: upgrade pkg." } });
	}) as unknown as typeof fetch;
	const server = await start(t, { assistant, fetchFn });
	await withReport(server);

	// Only the model given at start-up so far.
	const first = (await send(server, "GET", "/api/state")).json.sendTargets;
	assert.deepEqual(first, [{ id: "startup", label: `${MODEL} · set when Porchlight started (ollama.test:11434)`, model: MODEL, host: "ollama.test:11434", hosted: false, current: true }]);

	// Every model set up in Settings stays on offer, the one in use first; keys never reach the page.
	await send(server, "POST", "/api/model", { body: { choice: "ollama-mac", model: "qwen3:8b" } });
	await send(server, "POST", "/api/model", { body: { choice: "anthropic", apiKey: CLAUDE_KEY } });
	const state = await send(server, "GET", "/api/state");
	assert.ok(!state.text.includes(CLAUDE_KEY));
	assert.deepEqual(
		state.json.sendTargets.map((target: { id: string; hosted: boolean; current: boolean }) => [target.id, target.hosted, target.current]),
		[
			["anthropic", true, true],
			["ollama-mac", false, false],
			["startup", false, false],
		],
	);

	// A repair plan of the whole roadmap from the local model, with room for a longer answer.
	const planned = await send(server, "POST", "/api/repos/send", { body: { target: "startup", content: "roadmap", purpose: "repair" } });
	assert.deepEqual([planned.status, planned.json.text, planned.json.model, planned.json.hosted], [200, "Repair 1: upgrade pkg.", MODEL, false]);
	const local = calls.at(-1)!;
	assert.equal(local.host, "ollama.test:11434");
	assert.equal(local.body.options.num_predict, 3000);
	assert.match(local.body.messages[1].content, /remediation plan/);
	assert.match(local.body.messages[1].content, /"actions":\[\{"phase":"Fix now"/);

	// The critical findings only, analysed by Claude: its fixed address, its key, and the model told it sees part of the scan.
	const analysed = await send(server, "POST", "/api/repos/send", { body: { target: "anthropic", content: "findings", purpose: "analyse", severity: "critical" } });
	assert.deepEqual([analysed.status, analysed.json.text, analysed.json.hosted, analysed.json.partial], [200, "Overall risk: one critical package.", true, "critical severity only"]);
	const hosted = calls.at(-1)!;
	assert.deepEqual([hosted.host, hosted.key === CLAUDE_KEY], ["api.anthropic.com", true]);
	const content = hosted.body.messages[0].content as string;
	assert.match(content, /"filtered":"critical severity only"/);
	assert.match(content, /A critical problem/);
	assert.ok(!content.includes("A high problem"), "only what the filter leaves");

	// A follow-up goes to the same model at its fixed address, with the same part of the scan, the first answer and the question.
	const followed = await send(server, "POST", "/api/discussions/ask", { body: { id: analysed.json.discussion, question: "Which package is it?" } });
	assert.equal(followed.status, 200);
	const again = calls.at(-1)!;
	assert.deepEqual([again.host, again.key === CLAUDE_KEY], ["api.anthropic.com", true]);
	assert.deepEqual(again.body.messages.map((message: { role: string }) => message.role), ["user", "assistant", "user"]);
	assert.match(again.body.messages[0].content, /"filtered":"critical severity only"/);
	assert.ok(!again.body.messages[0].content.includes("A high problem"), "the same part of the scan as the first answer");
	assert.equal(again.body.messages[1].content, "Overall risk: one critical package.");
	assert.match(again.body.messages[2].content, /Which package is it\?$/);
	const kept = (await send(server, "GET", `/api/discussions/one?id=${analysed.json.discussion}`)).json.discussion;
	assert.deepEqual([kept.kind, kept.title, kept.hosted, kept.target], ["send", "Deeper analysis of the findings (critical severity only)", true, "anthropic"]);

	// Only the models on offer, and only the choices there are; nothing is asked otherwise.
	const before = calls.length;
	for (const body of [
		{ target: "http://evil.test", content: "roadmap", purpose: "analyse" },
		{ target: "startup", content: "secrets", purpose: "analyse" },
		{ target: "startup", content: "roadmap", purpose: "deploy" },
		{ target: "startup", content: "roadmap", purpose: "analyse", severity: "urgent" },
	]) {
		assert.equal((await send(server, "POST", "/api/repos/send", { body })).status, 400, JSON.stringify(body));
	}
	assert.equal(calls.length, before);
});

test("sending needs a scan to send", async (t) => {
	const server = await start(t, { assistant });
	const reply = await send(server, "POST", "/api/repos/send", { body: { target: "startup", content: "roadmap", purpose: "analyse" } });
	assert.equal(reply.status, 404);
});

// History, the owner's notes, and what quitting would lose

test("keeps every scan, and says what is new and what was fixed since the one before", async (t) => {
	// Both scans ran both scanners. (The sample has osv-scanner missing, and a scanner that did not run
	// finds nothing: that is never a fix. test/history.test.ts covers that case.)
	const ran = (report: ScanReport): ScanReport => ({ ...report, tools: report.tools.map((tool) => ({ ...tool, status: "ok" as const })) });
	let next = ran(sampleReport("/work"));
	const scan = (async () => next) as unknown as UiOptions["scan"];
	const server = await start(t, { scan });
	await withReport(server);
	await writeFile(join(server.dir, "state", "repo-scan.json"), JSON.stringify(ran(sampleReport("/work"))));

	// A report from before history was kept starts it once the server reads it again.
	const restarted = await start(t, { reportPath: join(server.dir, "state", "repo-scan.json"), scan });
	const first = (await send(restarted, "GET", "/api/repos/history")).json;
	assert.deepEqual([first.scans.length, first.change], [1, null]);

	// The next scan: the critical finding upgraded away, a new one in "mild".
	next = ran(sampleReport("/work"));
	next.scannedAt = "2026-11-19T12:00:00.000Z";
	next.repos[2]!.findings = [next.repos[2]!.findings[0]!];
	next.repos[1]!.findings.push({ ...next.repos[1]!.findings[0]!, ruleId: "rule-brand-new", title: "A brand new problem" });
	assert.equal((await send(restarted, "POST", "/api/repos/scan", { body: { root: server.dir, depth: 1 } })).status, 202);
	for (let i = 0; i < 50 && (await send(restarted, "GET", "/api/repos/scan")).json.scan.state === "running"; i++) await new Promise((r) => setTimeout(r, 20));

	const after = (await send(restarted, "GET", "/api/repos/history")).json;
	assert.deepEqual(after.scans.map((entry: { scannedAt: string; newCount?: number; fixedCount?: number }) => [entry.scannedAt, entry.newCount, entry.fixedCount]), [
		["2026-11-19T12:00:00.000Z", 1, 1],
		["2026-11-17T12:00:00.000Z", undefined, undefined],
	]);
	assert.equal(after.change.previousScannedAt, "2026-11-17T12:00:00.000Z");
	assert.deepEqual(after.change.newKeys, ["mild\nrule-brand-new\npackage-lock.json\npkg@1.0.0"]);
	assert.deepEqual(after.change.fixed.map((item: { title: string; repo: string }) => [item.title, item.repo]), [["A critical problem", "group/worst"]]);
	const kept = join(server.dir, "state", "history");
	assert.equal((await stat(join(kept, after.scans[0].file))).mode & 0o777, 0o600);
});

test("keeps the owner's status and note for a finding of the latest scan, privately, without changing it", async (t) => {
	const server = await start(t);
	await withReport(server);
	const finding = { repo: "group/worst", ruleId: "rule-high", location: "package-lock.json", detail: "pkg@1.0.0" };

	const saved = await send(server, "POST", "/api/findings/note", { body: { ...finding, status: "accepted", note: "Test data only; ticket SEC-12" } });
	assert.equal(saved.status, 200);
	assert.deepEqual([saved.json.note.status, saved.json.note.note], ["accepted", "Test data only; ticket SEC-12"]);
	const report = (await send(server, "GET", "/api/repos/report")).json;
	assert.equal(report.findingNotes[saved.json.key].note, "Test data only; ticket SEC-12");
	assert.equal(report.report.repos[0].findings.find((f: { ruleId: string }) => f.ruleId === "rule-high").severity, "high", "the finding itself is unchanged");
	assert.equal((await stat(join(server.dir, "state", "finding-notes.json"))).mode & 0o777, 0o600);

	// Back to open with no note leaves nothing behind.
	const cleared = await send(server, "POST", "/api/findings/note", { body: { ...finding, status: "open", note: "  " } });
	assert.deepEqual([cleared.status, cleared.json.note], [200, null]);

	for (const [body, status] of [
		[{ ...finding, status: "ignored" }, 400],
		[{ ...finding, status: "fixed", note: "x".repeat(2001) }, 400],
		[{ ...finding, ruleId: "rule-nowhere", status: "fixed" }, 404],
	] as const) {
		assert.equal((await send(server, "POST", "/api/findings/note", { body })).status, status, JSON.stringify(body).slice(0, 80));
	}
});

test("a secret can be marked rotated, and an accepted risk can carry the day it ends", async (t) => {
	const server = await start(t);
	await withReport(server);
	const secret = { repo: "group/worst", ruleId: "rule-high", location: "package-lock.json", detail: "pkg@1.0.0" };
	const vulnerability = { ...secret, ruleId: "rule-critical" };
	const note = (body: object) => send(server, "POST", "/api/findings/note", { body });
	const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

	// Rotated is for a credential; a package is upgraded, which the next scan sees for itself.
	assert.equal((await note({ ...secret, status: "rotated", note: "New key issued" })).json.note.status, "rotated");
	assert.equal((await note({ ...vulnerability, status: "rotated" })).status, 400);

	const accepted = await note({ ...vulnerability, status: "accepted", note: "No fix published yet", until: day(30) });
	assert.deepEqual([accepted.status, accepted.json.note.until], [200, day(30)]);
	for (const [body, why] of [
		[{ ...vulnerability, status: "accepted", until: day(-3) }, "a day that has passed"],
		[{ ...vulnerability, status: "accepted", until: "2027-02-30" }, "not a real day"],
		[{ ...vulnerability, status: "accepted", until: "next month" }, "not a day"],
		[{ ...vulnerability, status: "fixed", until: day(30) }, "only an accepted risk ends"],
	] as const) {
		assert.equal((await note(body)).status, 400, why);
	}

	// Neither changes the finding: it is still listed, at its own severity, and counted.
	const { report, findingNotes } = (await send(server, "GET", "/api/repos/report")).json;
	assert.deepEqual(report.repos[0].findings.map((f: { ruleId: string; severity: string }) => `${f.ruleId} ${f.severity}`), ["rule-critical critical", "rule-high high"]);
	assert.deepEqual(Object.values(findingNotes).map((entry) => (entry as { status: string }).status).sort(), ["accepted", "rotated"]);

	// Moving off "accepted" drops the end date.
	assert.equal((await note({ ...vulnerability, status: "in-progress", note: "Upgrading" })).json.note.until, undefined);
});

test("says what is still running, and remembers the place in the page but never the key", async (t) => {
	let release = () => {};
	const scan = (() => new Promise((resolve) => (release = () => resolve(sampleReport("/work"))))) as unknown as UiOptions["scan"];
	const server = await start(t, { scan });
	assert.deepEqual((await send(server, "GET", "/api/busy")).json.busy, []);
	await send(server, "POST", "/api/repos/scan", { body: { root: server.dir, depth: 1 } });
	assert.deepEqual((await send(server, "GET", "/api/busy")).json.busy, ["A scan is running"]);
	release();

	assert.equal((await send(server, "GET", "/api/state")).json.lastView, null);
	assert.equal((await send(server, "POST", "/api/view", { body: { view: "#/findings?severity=critical" } })).status, 200);
	assert.equal((await send(server, "GET", "/api/state")).json.lastView, "#/findings?severity=critical");
	for (const view of ["#k=secret", "#/overview&k=abc", "https://evil.test/#/x", "#/a b"]) {
		assert.equal((await send(server, "POST", "/api/view", { body: { view } })).status, 400, view);
	}
});

test("this computer is checked in the background, kept readable only by its owner, and named while busy", async (t) => {
	let finish: (report: HostReport) => void = () => {};
	const asked: unknown[] = [];
	const server = await start(t, {
		hostCheck: (options) => {
			asked.push({ askApple: options.askApple, lookUpPackages: options.lookUpPackages });
			options.onProgress?.({ done: 2, total: 10, current: "FileVault" });
			return new Promise((resolve) => (finish = resolve));
		},
	});
	assert.deepEqual((await send(server, "GET", "/api/host")).json, { status: { state: "idle" }, report: null, service: false });
	assert.equal((await send(server, "POST", "/api/host/check", { body: { askApple: "yes" } })).status, 400);

	const started = await send(server, "POST", "/api/host/check", { body: { askApple: false } });
	assert.equal(started.status, 202);
	assert.deepEqual(asked, [{ askApple: false, lookUpPackages: true }]);
	const running = (await send(server, "GET", "/api/host")).json.status;
	assert.deepEqual([running.state, running.done, running.total, running.current], ["running", 2, 10, "FileVault"]);
	assert.equal((await send(server, "POST", "/api/host/check", { body: {} })).status, 409);
	assert.ok((await send(server, "GET", "/api/busy")).json.busy.includes("This computer is being checked"));

	finish({
		checkedAt: "2026-11-19T00:00:00.000Z",
		platform: "darwin",
		os: { name: "macOS", version: "27.2.1", build: "26B131" },
		checks: [{ id: "filevault", area: "protection", title: "FileVault disk encryption", status: "passed", severity: "high", detail: "On." }],
		notCovered: ["Apps are not checked."],
		lookups: { apple: false, packages: true },
	});
	let done;
	for (let tries = 0; tries < 50; tries++) {
		done = (await send(server, "GET", "/api/host")).json;
		if (done.status.state !== "running") break;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.equal(done.status.state, "done");
	assert.equal(done.report.checks[0].id, "filevault");
	const file = join(server.dir, "state", "host-check.json");
	assert.equal((await stat(file)).mode & 0o777, 0o600);
	assert.equal(JSON.parse(await readFile(file, "utf8")).os.version, "27.2.1");
	assert.equal((await send(server, "GET", "/api/state")).json.platform, process.platform);
	assert.equal((await send(server, "GET", "/host.js")).status, 200);
});

test("a failed host check is reported as failed, and a service never checks the computer it runs on", async (t) => {
	const server = await start(t, { hostCheck: async () => Promise.reject(new Error("netstat timed out")) });
	await send(server, "POST", "/api/host/check", { body: {} });
	let status;
	for (let tries = 0; tries < 50; tries++) {
		status = (await send(server, "GET", "/api/host")).json.status;
		if (status.state !== "running") break;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	assert.deepEqual([status.state, status.error], ["failed", "netstat timed out"]);

	let called = false;
	const service = await start(t, {
		host: "127.0.0.2",
		sessionKey: "k".repeat(MIN_KEY_LENGTH),
		hostCheck: async () => {
			called = true;
			throw new Error("must not run");
		},
	}).catch(() => null);
	if (!service) return t.skip("127.0.0.2 is not available on this machine");
	const refused = await send(service, "POST", "/api/host/check", { body: {}, host: "127.0.0.2" });
	assert.equal(refused.status, 409);
	assert.match(refused.json.error, /container/);
	assert.deepEqual((await send(service, "GET", "/api/host", { host: "127.0.0.2" })).json, { status: { state: "idle" }, report: null, service: true });
	assert.equal(called, false);
});

test("a scan request carries its choices to the scanner, and choices it does not understand are refused", async (t) => {
	const scanned: ScanOptions[] = [];
	const server = await start(t, { scan: async (options) => (scanned.push(options), { ...sampleReport(options.root), choices: options.choices }) });

	for (const [choices, message] of [
		["quick", /Choices must be an object/],
		[{ preset: "thorough" }, /Choose a preset/],
		[{ secrets: false, dependencies: false }, /at least one check/],
		[{ history: -1 }, /History must be/],
		[{ skip: "a\u0000b" }, /Skip names/],
	] as const) {
		const reply = await send(server, "POST", "/api/repos/scan", { body: { root: server.dir, choices } });
		assert.equal(reply.status, 400);
		assert.match(reply.json.error, message);
	}
	assert.equal(scanned.length, 0);

	assert.equal((await send(server, "POST", "/api/repos/scan", { body: { root: server.dir, choices: { preset: "quick", skip: ["mild"], localFiles: true } } })).status, 202);
	await untilScan(server, "done");
	assert.deepEqual(scanned[0]!.choices, { preset: "quick", secrets: true, dependencies: true, privateData: false, history: "none", localFiles: true, skip: ["mild"], analyse: false });
	// The choices are kept with the report and named in the log; the report says what was not covered.
	const { report, notes } = (await send(server, "GET", "/api/repos/report")).json;
	assert.equal(report.choices.preset, "quick");
	assert.ok(notes.some((note: string) => note.startsWith("Git history was not read for secrets")));
	assert.ok((await send(server, "GET", "/api/activity")).json.lines.some((line: { text: string }) => /Scan started: .*\. Quick: secrets in the files as they are now/.test(line.text)));

	// No choices is a Standard scan, as before there were any.
	await send(server, "POST", "/api/repos/scan", { body: { root: server.dir } });
	await untilScan(server, "done");
	assert.equal(scanned[1]!.choices?.preset, "standard");
});

test("scanning one repository again uses the report's own choices, so it covers what the report says", async (t) => {
	const asked: unknown[] = [];
	const server = await start(t, {
		rescan: async (path, options) => {
			asked.push(options?.choices);
			return { repo: { path, findings: [], errors: [] }, tools: sampleReport("/work").tools };
		},
	});
	await makeTree(server.dir, { "state/": "" });
	const quick = { preset: "quick", secrets: true, dependencies: false, history: "none", localFiles: false, skip: [], analyse: false };
	await writeFile(join(server.dir, "state", "repo-scan.json"), JSON.stringify({ ...sampleReport("/work"), choices: { ...quick, preset: "custom", analyse: true } }));

	await send(server, "POST", "/api/repos/rescan", { body: { repo: "group/worst" } });
	await untilScan(server, "done");
	// The model's analysis is never started by scanning one repository again.
	assert.deepEqual(asked, [{ ...quick, preset: "custom" }]);
	const stored = JSON.parse(await readFile(join(server.dir, "state", "repo-scan.json"), "utf8")) as ScanReport;
	// Dependencies were off: osv-scanner did not look, so its finding is kept.
	assert.deepEqual(stored.repos.find((repo) => repo.path === "/work/group/worst")!.findings.map((finding) => finding.tool), ["osv-scanner"]);
});

test("a Deep scan starts the model's analysis when it finishes, and a hosted model only after a yes", async (t) => {
	const judged: string[] = [];
	const fetchFn = (async (_url: string, init: RequestInit) => {
		judged.push(String(init.body));
		return Response.json({ message: { content: '{"verdict":"likely","reason":"It is imported.","steps":[]}' } });
	}) as unknown as typeof fetch;
	const scan = async (options: ScanOptions) => ({ ...sampleReport(options.root), choices: options.choices });
	const activity = async (server: UiServer) => ((await send(server, "GET", "/api/activity")).json.lines as { text: string }[]).map((line) => line.text);

	const local = await start(t, { assistant, fetchFn, scan });
	await send(local, "POST", "/api/repos/scan", { body: { root: local.dir, choices: { preset: "deep" } } });
	await untilScan(local, "done");
	let status = (await send(local, "GET", "/api/analysis")).json.status;
	for (let attempt = 0; attempt < 200 && status.state !== "done"; attempt++) {
		await new Promise((resolve) => setTimeout(resolve, 5));
		status = (await send(local, "GET", "/api/analysis")).json.status;
	}
	// The critical and high findings, as the analysis card starts it.
	assert.deepEqual([status.state, status.done], ["done", 2]);
	assert.equal(judged.length, 2);

	// A Standard scan leaves the model alone.
	const standard = await start(t, { assistant, fetchFn, scan });
	await send(standard, "POST", "/api/repos/scan", { body: { root: standard.dir } });
	await untilScan(standard, "done");
	assert.deepEqual((await send(standard, "GET", "/api/analysis")).json.status, { state: "idle" });

	const none = await start(t, { scan });
	await send(none, "POST", "/api/repos/scan", { body: { root: none.dir, choices: { preset: "deep" } } });
	await untilScan(none, "done");
	assert.ok((await activity(none)).includes("Deeper analysis did not start: no model is set up (Settings → Model)"));

	const hostedModel = assistantConfig({ PORCHLIGHT_LLM_PROVIDER: "anthropic", PORCHLIGHT_LLM_API_KEY: ["sk", "ant", "test", "0123456789abcdef"].join("-") });
	const hosted = await start(t, { assistant: hostedModel, fetchFn, scan });
	const before = judged.length;
	await send(hosted, "POST", "/api/repos/scan", { body: { root: hosted.dir, choices: { preset: "deep" } } });
	await untilScan(hosted, "done");
	assert.ok((await activity(hosted)).some((text) => /^Deeper analysis did not start: .* is hosted, and the scan did not say yes to sending to it$/.test(text)));
	assert.equal(judged.length, before, "nothing was sent to the hosted model");
	assert.deepEqual((await send(hosted, "GET", "/api/analysis")).json.status, { state: "idle" });

	// The page showed what would be sent beside the Deep choice, and the owner went ahead.
	await send(hosted, "POST", "/api/repos/scan", { body: { root: hosted.dir, choices: { preset: "deep" }, sendsToHosted: true } });
	await untilScan(hosted, "done");
	for (let attempt = 0; attempt < 200 && judged.length === before; attempt++) await new Promise((resolve) => setTimeout(resolve, 5));
	assert.ok(judged.length > before, "the analysis started with the hosted model");
});

test("settings and keys are kept in the data folder, never beside a report kept elsewhere, and earlier ones are moved there (S34)", async (t) => {
	const dir = await tempDir();
	const reports = join(dir, "project", "reports");
	const data = join(dir, "data");
	// What an earlier version kept beside the report.
	await makeTree(reports, {
		"model-settings.json": `${JSON.stringify({ choice: "off", keys: { anthropic: "moved-key-0123456789" } })}\n`,
		"access.json": `${JSON.stringify({ enabled: false, key: "k".repeat(43) })}\n`,
		"finding-notes.json": "{}\n",
	});
	const server = await startUiServer({ port: 0, reportPath: join(reports, "repo-scan.json"), dataDir: data, defaultRoot: dir, monitor: null });
	t.after(() => server.close());

	assert.match(await readFile(join(data, "model-settings.json"), "utf8"), /moved-key-0123456789/, "an earlier key keeps working, from the data folder");
	assert.ok(!(await readdir(reports)).includes("model-settings.json"), "and no longer sits beside the report");
	assert.ok((await readdir(reports)).includes("finding-notes.json"), "the report's own notes stay beside it");

	const saved = await send(server as UiServer & { dir: string }, "POST", "/api/view", { body: { view: "#/findings" } });
	assert.equal(saved.status, 200);
	assert.ok((await readdir(data)).includes("ui-view.json"));
	assert.ok(!(await readdir(reports)).some((name) => /settings|access|view/.test(name)), "nothing of the kind is written beside the report");
});

test("a scan started twice at once runs once: the second request is refused, not started too (B24)", async (t) => {
	let scans = 0;
	let finish!: () => void;
	const held = new Promise<void>((resolve) => (finish = resolve));
	const server = await start(t, { scan: async (options) => (scans++, await held, sampleReport(options.root)) });
	const replies = await Promise.all([1, 2, 3].map(() => send(server, "POST", "/api/repos/scan", { body: { root: server.dir } })));
	assert.deepEqual(replies.map((reply) => reply.status).sort(), [202, 409, 409]);
	finish();
	for (let n = 0; n < 50 && (await send(server, "GET", "/api/repos/scan")).json.scan.state === "running"; n++) await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(scans, 1, "one scan ran");
	// And a rescan of a repository the report does not have puts the state back as it was.
	const missing = await send(server, "POST", "/api/repos/rescan", { body: { repo: "no-such-repository" } });
	assert.equal(missing.status, 404);
	assert.notEqual((await send(server, "GET", "/api/repos/scan")).json.scan.state, "running");
});

test("turning access on and off many times at once leaves the saved setting and the listener agreeing (S25)", async (t) => {
	const server = await start(t, { tailnetAddress: () => "127.0.0.1", accessPort: 0 });
	const replies = await Promise.all(Array.from({ length: 20 }, (_, n) => send(server, "POST", "/api/access", { body: { enabled: n % 3 !== 0 } })));
	assert.ok(replies.every((reply) => reply.status === 200));
	const state = (await send(server, "GET", "/api/access")).json;
	const saved = JSON.parse(await readFile(join(server.dir, "state", "access.json"), "utf8")) as { enabled: boolean };
	assert.equal(state.enabled, saved.enabled, "what a restart would open is what is open now");
	assert.equal(state.listening, saved.enabled);
	await send(server, "POST", "/api/access", { body: { enabled: false } });
});
