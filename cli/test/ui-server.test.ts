import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { listenOnFirstFree } from "../src/main.ts";
import { monitorConfig } from "../src/monitor/client.ts";
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
		monitorError: "Set SECURITYX_MONITOR_URL",
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
	options: { key?: string | null; headers?: Record<string, string>; body?: unknown; rawBody?: string } = {},
): Promise<Reply> {
	const key = options.key === undefined ? server.sessionKey : options.key;
	const payload = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
	const headers: Record<string, string> = {
		...(key === null ? {} : { "x-securityx-session": key }),
		...(payload === undefined ? {} : { "content-type": "application/json" }),
		...options.headers,
	};
	return new Promise((resolve, reject) => {
		const req = request({ host: "127.0.0.1", port: server.port, method, path, headers }, (res) => {
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
	assert.match(page.text, /<title>SecurityX<\/title>/);
	assert.match(String(page.headers["content-security-policy"]), /default-src 'none'.*script-src 'self'.*frame-ancestors 'none'/);
	assert.equal(page.headers["x-content-type-options"], "nosniff");
	assert.equal(page.headers["cache-control"], "no-store");
	assert.ok(!page.text.includes(server.sessionKey), "the page itself must not contain the session key");
	const scripts = ["app", "api", "dom", "filter", "list", "hints", "store", "export", "overview", "findings", "roadmap", "repos", "domains"];
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
	assert.deepEqual(sameSite.json.monitor, { configured: false, error: "Set SECURITYX_MONITOR_URL", unset: false });
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
	await assert.rejects(startUiServer({ ...base, host: "0.0.0.0" }), /SECURITYX_UI_KEY/);
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

	assert.deepEqual((await send(server, "GET", "/api/repos/report")).json, { report: null, notes: [] });

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

test("shows an existing report file and says so when it is not one", async (t) => {
	const server = await start(t);
	const reportPath = join(server.dir, "state", "repo-scan.json");
	await makeTree(server.dir, { "state/": "" });

	await writeFile(reportPath, JSON.stringify(sampleReport("/work")));
	assert.equal((await send(server, "GET", "/api/repos/report")).json.report.repos.length, 3);

	await writeFile(reportPath, "{broken");
	assert.match((await send(server, "GET", "/api/repos/report")).json.error, /not valid JSON/);
	await writeFile(reportPath, '{"some":"other file"}');
	assert.match((await send(server, "GET", "/api/repos/report")).json.error, /not a SecurityX scan report/);
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
		["", "securityx-roadmap-2026-11-17.md", /^# Repair roadmap/],
		["?format=html", "securityx-roadmap-2026-11-17.html", /^<!doctype html>/],
		["?format=csv", "securityx-roadmap-2026-11-17.csv", /^Phase,Priority,Place,Action/],
		["?format=json", "securityx-roadmap-2026-11-17.json", /^\{\n\t"title": "Repair roadmap"/],
		["?content=findings", "securityx-findings-2026-11-17.md", /^# Findings and suggested fixes/],
		["?content=findings&format=csv", "securityx-findings-2026-11-17.csv", /^Severity,Type,Place,ID,Finding/],
	];
	for (const [query, filename, start] of expected) {
		const reply = await send(server, "GET", `/api/repos/export${query}`);
		assert.equal(reply.status, 200, query);
		assert.equal(reply.headers["content-disposition"], `attachment; filename="${filename}"`);
		assert.equal(reply.headers["x-content-type-options"], "nosniff");
		assert.match(reply.text, start);
	}

	const partial = await send(server, "GET", "/api/repos/export?severity=critical&kind=vulnerability&repo=group%2Fworst&q=pkg");
	assert.equal(partial.headers["content-disposition"], 'attachment; filename="securityx-roadmap-partial-2026-11-17.md"');
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
	const monitor = monitorConfig({ SECURITYX_MONITOR_URL: "https://monitor.example", SECURITYX_ADMIN_TOKEN: ADMIN_TOKEN });
	const server = await start(t, { monitor, fetchFn });

	const shown = (await send(server, "GET", "/api/domains/example.com")).json;
	assert.deepEqual(shown.suggestions["dangling-cname:shop.example.com"].title, "Remove or repoint the DNS record for shop.example.com");
	assert.deepEqual(shown.suggestions["missing-header:www.example.com:referrer-policy"], {
		title: "Add 1 security header to responses from www.example.com",
		how: ["`Referrer-Policy: strict-origin-when-cross-origin`."],
	});
	assert.equal((await send(server, "GET", "/api/domains/unscanned.example")).json.suggestions, undefined);

	const file = await send(server, "GET", "/api/domains/example.com/export?format=csv");
	assert.equal(file.headers["content-disposition"], 'attachment; filename="securityx-roadmap-example.com-2026-11-17.csv"');
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
	assert.equal(reply.json.error, "Set SECURITYX_MONITOR_URL");
});

test("says when the monitor was never set up, so the page can explain setup instead of quoting an error", async (t) => {
	const server = await start(t, { monitorUnset: true });

	const state = await send(server, "GET", "/api/state");

	assert.deepEqual(state.json.monitor, { configured: false, error: "Set SECURITYX_MONITOR_URL", unset: true });
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
	const monitor = monitorConfig({ SECURITYX_MONITOR_URL: "https://monitor.example", SECURITYX_ADMIN_TOKEN: ADMIN_TOKEN });
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
	const monitor = monitorConfig({ SECURITYX_MONITOR_URL: "https://monitor.example", SECURITYX_ADMIN_TOKEN: ADMIN_TOKEN });
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
	const monitor = monitorConfig({ SECURITYX_MONITOR_URL: "http://localhost:5173", SECURITYX_ADMIN_TOKEN: ADMIN_TOKEN });
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

function pick(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
	return Object.fromEntries(keys.map((key) => [key, value[key]]));
}

// oxlint-disable-next-line typescript/no-explicit-any -- the status shape varies by state
async function untilScan(server: UiServer, state: string): Promise<any> {
	for (let attempt = 0; attempt < 200; attempt++) {
		const { scan } = (await send(server, "GET", "/api/repos/scan")).json;
		if (scan.state === state) return scan;
		await new Promise((resolve) => setTimeout(resolve, 5));
	}
	throw new Error(`scan never reached state "${state}"`);
}
