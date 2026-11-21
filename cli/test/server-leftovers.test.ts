// M14, M16 and M17 leftovers on the server: one dispatch through the route table (RD-2), the scan's
// depth kept in the report (B42), network failures in plain words from the server (R6U-10), history
// reuse for "Scan this repository again" (OP-1), and budgets sized from a local model's context (R6F-8).
import assert from "node:assert/strict";
import { request } from "node:http";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { forgetContextLengths, modelContextLength, sizedFor } from "../src/assist/context.ts";
import { assistantConfig } from "../src/assist/ollama.ts";
import type { Call, Gate } from "../src/ui/gate.ts";
import { dispatch, notFoundUnder, otherMethods, type Route } from "../src/ui/router.ts";
import { startUiServer, type UiOptions, type UiServer } from "../src/ui/server.ts";
import { plainError } from "../ui/plain-error.js";
import { plainError as pagePlainError } from "../ui/hints.js";
import { OLDER_REPORT_DEPTH, reportDepth } from "../ui/scan-choices.js";
import { tempDir } from "./helpers.ts";

function call(method: string, path: string, gate: Partial<Gate> = {}): Call {
	return {
		req: { method } as Call["req"],
		res: {} as Call["res"],
		url: new URL(`http://127.0.0.1${path}`),
		route: `${method} ${path}`,
		body: undefined,
		gate: { loopbackOnly: true, tailnet: false, key: () => "k", port: () => 1, ...gate },
	};
}

test("the route table answers each request with one entry, and nothing answers twice (RD-2)", async () => {
	const answered: string[] = [];
	const table: Route[] = [
		["GET /api/thing", () => void answered.push("get")],
		["POST /api/thing", () => void answered.push("post"), "owner"],
		otherMethods(["/api/thing"], "owner"),
		notFoundUnder("/api/area"),
	];
	await dispatch(table, call("GET", "/api/thing"));
	await dispatch(table, call("POST", "/api/thing"));
	assert.deepEqual(answered, ["get", "post"]);
	// Another device may read, not change, through an "owner" route; refused before its handler runs.
	assert.throws(() => dispatch(table, call("POST", "/api/thing", { tailnet: true, loopbackOnly: false })), { status: 403 });
	assert.throws(() => dispatch(table, call("PUT", "/api/thing")), { status: 405 });
	assert.throws(() => dispatch(table, call("GET", "/api/area/else")), { status: 404 });
	assert.throws(() => dispatch(table, call("GET", "/api/elsewhere")), { status: 404 });
	assert.deepEqual(answered, ["get", "post"]);
});

test("a report keeps the depth it was scanned to, and an older one is taken as 3 (B42)", () => {
	assert.equal(reportDepth({ depth: 5 }), 5);
	assert.equal(reportDepth({}), OLDER_REPORT_DEPTH);
	assert.equal(OLDER_REPORT_DEPTH, 3);
	assert.equal(reportDepth({ depth: 99 }), 3);
	assert.equal(reportDepth(null), 3);
});

test("network failures are put into plain words by one module the page and the server share (R6U-10)", () => {
	assert.equal(pagePlainError, plainError);
	assert.match(plainError("Could not reach the monitor: fetch failed"), /no connection could be made/);
	assert.match(plainError("getaddrinfo ENOTFOUND monitor.example"), /the address monitor\.example could not be found/);
	assert.equal(plainError(plainError("Could not reach the monitor: fetch failed")), plainError("Could not reach the monitor: fetch failed"));
});

async function start(t: TestContext, overrides: Partial<UiOptions> = {}): Promise<UiServer> {
	const dir = await tempDir();
	const server = await startUiServer({ port: 0, reportPath: join(dir, "state", "repo-scan.json"), defaultRoot: dir, monitor: null, monitorError: "none", ...overrides });
	t.after(() => server.close());
	return server;
}

function send(server: UiServer, method: string, path: string, body?: unknown): Promise<{ status: number; json: { error?: string } }> {
	const payload = body === undefined ? undefined : JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = request({ host: "127.0.0.1", port: server.port, method, path, headers: { "x-porchlight-session": server.sessionKey, ...(payload ? { "content-type": "application/json" } : {}) } }, (res) => {
			let text = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => (text += chunk));
			res.on("end", () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(text || "{}") }));
		});
		req.on("error", reject);
		req.end(payload);
	});
}

test("an error the server answers with is in plain words, not Node's 'fetch failed' (R6U-10)", async (t) => {
	const server = await start(t, {
		assistant: assistantConfig({ PORCHLIGHT_LLM_URL: "http://127.0.0.1:11434", PORCHLIGHT_LLM_MODEL: "small" }),
		fetchFn: async () => {
			throw new TypeError("fetch failed");
		},
	});
	const reply = await send(server, "POST", "/api/model/models", { choice: "ollama", url: "http://127.0.0.1:11434" });
	assert.ok(reply.status >= 400);
	assert.doesNotMatch(reply.json.error ?? "", /fetch failed/);
});

test("a model's real context length sizes the budgets, never above the usual ones, and an unknown one changes nothing (R6F-8)", async () => {
	forgetContextLengths();
	const config = assistantConfig({ PORCHLIGHT_LLM_URL: "http://127.0.0.1:11434", PORCHLIGHT_LLM_MODEL: "tiny" })!;
	const show = (length: number) => async () => new Response(JSON.stringify({ model_info: { "llama.context_length": length } }), { headers: { "content-type": "application/json" } });
	// Nothing is asked in the middle of a request: a model not yet asked keeps the usual budgets.
	assert.deepEqual(sizedFor(config, { cap: 4000, maxTokens: 3000 }), { cap: 4000, maxTokens: 3000, contextLength: null });
	// Asked when the model is chosen, and remembered.
	assert.equal(await modelContextLength(config, show(2048) as unknown as typeof fetch), 2048);
	const small = sizedFor(config, { cap: 4000, maxTokens: 3000 });
	assert.equal(small.contextLength, 2048);
	assert.ok(small.cap < 4000);
	assert.ok((small.maxTokens ?? 0) <= 512);
	forgetContextLengths();
	await modelContextLength(config, show(131072) as unknown as typeof fetch);
	const big = sizedFor(config, { cap: 4000, maxTokens: 500 });
	assert.ok(big.cap <= 4000 && (big.maxTokens ?? 0) <= 500);
	forgetContextLengths();
	assert.equal(await modelContextLength(config, (async () => new Response("no", { status: 500 })) as unknown as typeof fetch), null);
	assert.deepEqual(sizedFor(config, { cap: 4000, maxTokens: 3000 }), { cap: 4000, maxTokens: 3000, contextLength: null });
	forgetContextLengths();
});

test("'Scan this repository again' reuses an unchanged history's reading (OP-1)", async (t) => {
	const seen: unknown[] = [];
	const dir = await tempDir();
	const report = {
		format: 2,
		root: dir,
		scannedAt: "2026-11-20T10:00:00.000Z",
		tools: [],
		repos: [{ path: join(dir, "one"), findings: [], errors: [] }],
	};
	const { writeFile, mkdir } = await import("node:fs/promises");
	await mkdir(join(dir, "state"), { recursive: true });
	await writeFile(join(dir, "state", "repo-scan.json"), JSON.stringify(report));
	const server = await startUiServer({
		port: 0,
		reportPath: join(dir, "state", "repo-scan.json"),
		defaultRoot: dir,
		monitor: null,
		monitorError: "none",
		rescan: async (path, options) => {
			seen.push(options?.historyReuse);
			return { repo: { path, findings: [], errors: [] }, tools: [] };
		},
	});
	t.after(() => server.close());
	assert.equal((await send(server, "POST", "/api/repos/rescan", { repo: "one" })).status, 202);
	for (let i = 0; i < 50 && seen.length === 0; i++) await new Promise((resolve) => setTimeout(resolve, 20));
	assert.equal(seen.length, 1);
	assert.match(String((seen[0] as { dir?: string } | undefined)?.dir), /history-scans$/);
});
