import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { assistantConfig } from "../src/assist/ollama.ts";
import type { HostReport } from "../src/host/types.ts";
import { listenOnFirstFree } from "../src/main.ts";
import { monitorConfig } from "../src/monitor/client.ts";
import type { Runner } from "../src/repos/exec.ts";
import type { ScanOptions } from "../src/repos/scan.ts";
import type { ScanReport } from "../src/repos/types.ts";
import { hostAllowed, MIN_KEY_LENGTH, originAllowed, startUiServer, type UiOptions, type UiServer } from "../src/ui/server.ts";
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
	assert.deepEqual(scanned?.also, [{ root: join(dir, "state", "github"), depth: 2 }]);

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
	assert.equal((await send(server, "POST", "/api/repos/export")).status, 404);
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
	assert.equal((await send(server, "POST", "/api/domains/example.com/export")).status, 405);
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
	assert.deepEqual([explained.status, explained.json], [200, { text: "What it is: a test answer.", model: MODEL }]);
	const sent = JSON.parse(network.modelCalls[0]!);
	assert.deepEqual([sent.model, sent.stream, sent.think], [MODEL, false, false]);
	assert.match(sent.messages[1].content, /"title":"A high problem"/);
	assert.match(sent.messages[1].content, /"repo":"group\/worst"/);
	assert.ok(!sent.messages[1].content.includes("A critical problem"), "only the finding asked about");

	assert.equal((await send(server, "POST", "/api/assist/roadmap")).status, 200, "the roadmap needs no body");
	assert.match(JSON.parse(network.modelCalls[1]!).messages[1].content, /"actions":\[\{"phase":"Fix now"/);

	const answered = await send(server, "POST", "/api/assist/ask", { body: { question: "Which repository first?" } });
	assert.deepEqual(answered.json, { text: "What it is: a test answer.", model: MODEL });
	assert.match(JSON.parse(network.modelCalls[2]!).messages[1].content, /DATA>>>\n\nThe owner's question:\nWhich repository first\?$/);
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
	assert.deepEqual((await first).json, { text: "Done.", model: MODEL });
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

	assert.deepEqual([reply.status, reply.json], [200, { text: "What it is: a test answer.", model: MODEL }]);
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
	assert.deepEqual((await send(server, "POST", "/api/assist/roadmap")).json, { text: "Recovered.", model: MODEL });
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
