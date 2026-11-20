import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { assistantConfig } from "../src/assist/ollama.ts";
import { challengeName } from "../src/investigate/ownership.ts";
import type { Net } from "../src/investigate/tools.ts";
import { startUiServer, type UiOptions, type UiServer } from "../src/ui/server.ts";
import { tempDir } from "./helpers.ts";

interface Reply {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	text: string;
	// oxlint-disable-next-line typescript/no-explicit-any -- assertions read arbitrary response shapes
	json: any;
}

function send(server: UiServer, method: string, path: string, body?: unknown): Promise<Reply> {
	const payload = body === undefined ? undefined : JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = request(
			{ host: "127.0.0.1", port: server.port, method, path, headers: { "x-porchlight-session": server.sessionKey, ...(payload ? { "content-type": "application/json" } : {}) } },
			(res) => {
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
			},
		);
		req.on("error", reject);
		req.end(payload);
	});
}

/**
 * One fake for everything that would leave the machine: DNS-over-HTTPS (the ownership record and
 * lookups), the local model (Ollama's /api/chat, answering from a script) and the monitor.
 */
function fakeWorld(options: { replies?: unknown[]; owned?: () => boolean; monitorToken?: string } = {}) {
	const replies = [...(options.replies ?? [])];
	const prompts: string[] = [];
	const requests: string[] = [];
	let published: string | null = null;
	const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input instanceof Request ? input.url : input));
		requests.push(`${init?.method ?? "GET"} ${url.host}${url.pathname} ${url.searchParams.get("name") ?? ""}`.trim());
		if (url.host === "cloudflare-dns.com") {
			const name = url.searchParams.get("name") ?? "";
			if (name.startsWith("_porchlight-challenge.")) {
				const owned = options.owned ? options.owned() : true;
				return Response.json({ Status: 0, Answer: owned && published ? [{ name, type: 16, data: `"${published}"` }] : [] });
			}
			return Response.json({ Status: 0, Answer: [{ name, type: 1, TTL: 300, data: "93.184.215.14" }] });
		}
		if (url.pathname === "/api/chat") {
			const body = JSON.parse(String(init?.body));
			prompts.push(body.messages.at(-1).content);
			const reply = replies.shift() ?? { done: true, summary: "out of script" };
			const content = typeof reply === "function" ? JSON.stringify(reply(body.messages.at(-1).content)) : JSON.stringify(reply);
			return Response.json({ message: { content } });
		}
		if (url.pathname.startsWith("/domains/") && options.monitorToken) {
			return Response.json({ domain: { challenge: { value: `porchlight-verify=${options.monitorToken}` } } });
		}
		return new Response("not found", { status: 404 });
	}) as typeof fetch;
	const netCalls: string[] = [];
	const net: Net = {
		fetch: fetchFn,
		lookup: async () => ["93.184.215.14"],
		http: async ({ url, method }) => {
			netCalls.push(`${method} ${url.href}`);
			return { status: 200, statusText: "OK", httpVersion: "1.1", headers: [["Server", "test"]], body: "<html>ok</html>", truncated: false };
		},
		tcp: async ({ host, port }) => {
			netCalls.push(`tcp ${host}:${port}`);
			return { open: false, detail: "ECONNREFUSED" };
		},
	};
	return { fetchFn, net, prompts, requests, netCalls, publish: (value: string) => (published = value) };
}

async function start(t: TestContext, world: ReturnType<typeof fakeWorld>, overrides: Partial<UiOptions> = {}) {
	const dir = await tempDir();
	const server = await startUiServer({
		port: 0,
		reportPath: join(dir, "state", "repo-scan.json"),
		defaultRoot: dir,
		monitor: null,
		assistant: assistantConfig({ PORCHLIGHT_LLM_URL: "http://127.0.0.1:11434", PORCHLIGHT_LLM_MODEL: "scripted-model" }),
		fetchFn: world.fetchFn,
		investigateNet: world.net,
		investigateMinGapMs: 0,
		...overrides,
	});
	t.after(() => server.close());
	return Object.assign(server, { dir });
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
	for (let attempt = 0; attempt < 200; attempt++) {
		const value = await read();
		if (done(value)) return value;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("timed out waiting");
}

const act = (tool: string, args: Record<string, unknown>) => ({ thought: "next", action: { tool, args, rationale: "check it" }, done: false });

async function addAndPublish(server: UiServer, world: ReturnType<typeof fakeWorld>, domain = "example.com") {
	const added = await send(server, "POST", "/api/investigate/domains", { domain });
	assert.equal(added.status, 200);
	const entry = added.json.domains.find((item: { name: string }) => item.name === domain.toLowerCase());
	world.publish(entry.challenge.value);
	return entry;
}

test("investigate: a domain gets a challenge record, kept readable only by the owner", async (t) => {
	const world = fakeWorld();
	const server = await start(t, world);
	const entry = await addAndPublish(server, world, "Example.COM");
	assert.equal(entry.name, "example.com");
	assert.equal(entry.challenge.name, challengeName("example.com"));
	assert.match(entry.challenge.value, /^porchlight-verify=[0-9a-f]{48}$/);
	assert.equal(entry.source, "local");
	const file = await stat(join(server.dir, "state", "investigate-domains.json"));
	assert.equal(file.mode & 0o777, 0o600);
	assert.equal((await send(server, "POST", "/api/investigate/domains", { domain: "not a domain" })).status, 400);
	const verified = await send(server, "POST", "/api/investigate/verify", { domain: "example.com" });
	assert.equal(verified.json.verified, true);
});

test("investigate: the monitor's token is adopted, so one record serves both", async (t) => {
	const world = fakeWorld({ monitorToken: "cd".repeat(24) });
	const server = await start(t, world, { monitor: { url: new URL("https://monitor.example.net"), token: "x".repeat(40) } });
	const added = await send(server, "POST", "/api/investigate/domains", { domain: "example.com" });
	assert.equal(added.json.domains[0].source, "monitor");
	assert.equal(added.json.domains[0].challenge.value, `porchlight-verify=${"cd".repeat(24)}`);
});

test("investigate: an unverified or unknown domain is refused, and the model is never asked", async (t) => {
	const world = fakeWorld({ owned: () => false, replies: [act("dns_lookup", { host: "example.com" })] });
	const server = await start(t, world);
	assert.equal((await send(server, "POST", "/api/investigate/start", { domain: "other.com" })).status, 404);
	await addAndPublish(server, world);
	const refused = await send(server, "POST", "/api/investigate/start", { domain: "example.com" });
	assert.equal(refused.status, 409);
	assert.match(refused.json.error, /does not hold/);
	assert.deepEqual(world.prompts, []);
	assert.deepEqual(world.netCalls, []);
});

test("investigate: a hosted model needs the owner's yes, after being told what is sent", async (t) => {
	const world = fakeWorld();
	const server = await start(t, world, {
		assistant: assistantConfig({ PORCHLIGHT_LLM_PROVIDER: "anthropic", PORCHLIGHT_LLM_API_KEY: "k".repeat(40) }),
	});
	await addAndPublish(server, world);
	const state = await send(server, "GET", "/api/investigate");
	assert.match(state.json.disclosure, /outside your machines/);
	assert.match(state.json.disclosure, /never sends the ownership token/);
	const refused = await send(server, "POST", "/api/investigate/start", { domain: "example.com" });
	assert.equal(refused.status, 409);
	assert.match(refused.json.error, /Claude \(api\.anthropic\.com\)/);
	assert.ok(!world.requests.some((line) => line.includes("anthropic")), "nothing was sent to the hosted model");
});

test("investigate: end to end with a scripted model, approval, findings, review and export", async (t) => {
	const world = fakeWorld({
		replies: [
			act("dns_lookup", { host: "example.com", record_type: "A" }),
			act("http_request", { url: "https://example.com/", method: "GET" }),
			act("tcp_connect", { host: "example.com", port: 22 }),
			(prompt: string) => ({
				findings: [
					{ title: "Server header reveals software", severity: "low", description: "The Server header is set.", asset: "example.com", evidence_ids: [[...prompt.matchAll(/evidence_id="(ev_[0-9a-f]+)"/g)][1]?.[1]] },
					{ title: "Invented", severity: "critical", evidence_ids: ["ev_00000000"] },
				],
				done: true,
				summary: "Looked at the front page.",
			}),
		],
	});
	const server = await start(t, world);
	await addAndPublish(server, world);
	const started = await send(server, "POST", "/api/investigate/start", { domain: "example.com", goal: "Check the front page", maxTurns: 10 });
	assert.equal(started.status, 202);
	const runId = started.json.run.id;
	assert.match(runId, /^inv_[0-9a-f]{16}$/);

	const read = () => send(server, "GET", "/api/investigate").then((reply) => reply.json);
	// The HTTP request waits for approval, showing exactly what would be sent.
	let state = await until(read, (value) => value.active?.pending !== undefined);
	assert.equal(state.active.pending.description, "http_request GET https://example.com/");
	assert.deepEqual(world.netCalls, []);
	const busy = await send(server, "GET", "/api/busy");
	assert.ok(busy.json.busy.some((line: string) => /investigation of example\.com/.test(line)));
	assert.equal((await send(server, "POST", "/api/investigate/approve", { run: runId, step: "step_000000000000", approve: true })).status, 409);
	assert.equal((await send(server, "POST", "/api/investigate/approve", { run: runId, step: state.active.pending.stepId, approve: true })).status, 200);

	state = await until(read, (value) => value.active?.pending?.description === "tcp_connect example.com:22");
	// Denied: it never runs.
	await send(server, "POST", "/api/investigate/approve", { run: runId, step: state.active.pending.stepId, approve: false });
	state = await until(read, (value) => value.active === null);
	assert.deepEqual(world.netCalls, ["GET https://example.com/"]);

	const run = (await send(server, "GET", `/api/investigate/run?id=${runId}`)).json.run;
	assert.equal(run.status, "done");
	assert.deepEqual(run.steps.map((step: { outcome: string }) => step.outcome), ["ran", "ran", "denied"]);
	assert.deepEqual(run.findings.map((finding: { title: string }) => finding.title), ["Server header reveals software"]);
	assert.equal(run.discarded, 1);
	assert.equal(state.runs[0].id, runId);
	const file = await stat(join(server.dir, "state", "investigations", `${runId}.json`));
	assert.equal(file.mode & 0o777, 0o600);
	assert.equal((await stat(join(server.dir, "state", "investigations"))).mode & 0o777, 0o700);
	// Every action re-proved ownership first, and no prompt carried the token.
	assert.ok(world.requests.filter((line) => line.startsWith("GET cloudflare-dns.com")).length >= 5);
	assert.ok(world.prompts.every((prompt) => !prompt.includes("porchlight-verify")));

	const accepted = await send(server, "POST", "/api/investigate/finding", { run: runId, finding: run.findings[0].id, status: "accepted" });
	assert.equal(accepted.json.finding.status, "accepted");
	const exported = await send(server, "GET", `/api/investigate/export?id=${runId}&format=md`);
	assert.equal(exported.status, 200);
	assert.match(String(exported.headers["content-disposition"]), /filename="porchlight-investigation-\d{4}-\d{2}-\d{2}\.md"/);
	assert.match(exported.text, /Your review: accepted by you/);
	assert.match(exported.text, /model's judgement/);
	assert.equal((await send(server, "GET", `/api/investigate/export?id=${runId}&format=html`)).status, 400);
	assert.equal((await send(server, "GET", "/api/investigate/run?id=../../etc/passwd")).status, 404);
});

test("investigate: a run approved at its start sends its requests without waiting, and the project's log says so", async (t) => {
	const world = fakeWorld({
		replies: [act("http_request", { url: "https://example.com/", method: "GET" }), act("tcp_connect", { host: "example.com", port: 22 }), act("http_request", { url: "https://other.example.net/", method: "GET" }), { done: true, summary: "Done." }],
	});
	const server = await start(t, world);
	await addAndPublish(server, world);
	const folder = join(server.dir, "audit");
	assert.equal((await send(server, "POST", "/api/projects", { name: "audit", folder })).status, 200);

	// Said plainly or not at all: anything but true or false is refused, and nothing starts.
	for (const approveAll of ["yes", 1, null]) {
		assert.equal((await send(server, "POST", "/api/investigate/start", { domain: "example.com", approveAll })).status, 400, String(approveAll));
	}
	assert.equal((await send(server, "GET", "/api/investigate")).json.active, null);

	const started = await send(server, "POST", "/api/investigate/start", { domain: "example.com", maxTurns: 10, approveAll: true });
	assert.equal(started.status, 202);
	assert.equal(started.json.run.approvedRest.turn, 0);
	const read = () => send(server, "GET", "/api/investigate").then((reply) => reply.json);
	const state = await until(read, (value) => value.active === null);
	// What the page lists before the owner approves a run comes from the server's own tools.
	assert.deepEqual(
		state.tools.filter((tool: { needsApproval: boolean }) => tool.needsApproval).map((tool: { name: string }) => tool.name),
		["http_request", "tcp_connect"],
	);

	const run = (await send(server, "GET", `/api/investigate/run?id=${started.json.run.id}`)).json.run;
	assert.equal(run.status, "done");
	assert.deepEqual(world.netCalls, ["GET https://example.com/", "tcp example.com:22"], "the request outside the domain was still refused");
	assert.deepEqual(
		run.steps.map((step: { outcome: string; approvedBy?: string }) => [step.outcome, step.approvedBy]),
		[
			["ran", "run"],
			["ran", "run"],
			["refused", undefined],
		],
	);
	// Ownership was proven for the start request, for the run, and again before each action that ran.
	assert.ok(world.requests.filter((line) => line.includes("_porchlight-challenge.example.com")).length >= 4);

	const logs = join(folder, "Porchlight", "Log");
	const lines = await until(
		async () => (await readFile(join(logs, (await readdir(logs))[0]!), "utf8")).split("\n"),
		(value) => value.some((line) => /Investigation of example\.com finished/.test(line)),
	);
	assert.ok(lines.some((line) => /Investigation of example\.com started: scripted-model at 127\.0\.0\.1:11434, at most 10 turns, every request approved at the start$/.test(line)));
	assert.ok(lines.some((line) => /Investigation of example\.com finished: 2 actions run, 0 findings from the model$/.test(line)));
});

test("investigate: the rest of a run can be approved at any request, only with a yes", async (t) => {
	const world = fakeWorld({
		replies: [act("http_request", { url: "https://example.com/a", method: "GET" }), act("http_request", { url: "https://example.com/b", method: "GET" }), act("tcp_connect", { host: "example.com", port: 443 }), { done: true }],
	});
	const server = await start(t, world);
	await addAndPublish(server, world);
	const started = await send(server, "POST", "/api/investigate/start", { domain: "example.com" });
	const runId = started.json.run.id;
	assert.equal(started.json.run.approvedRest, undefined, "a run asks before each request unless told otherwise");
	const read = () => send(server, "GET", "/api/investigate").then((reply) => reply.json);
	let state = await until(read, (value) => value.active?.pending !== undefined);
	const step = state.active.pending.stepId;

	// A denial of the rest, or anything but true or false, is refused; the request goes on waiting.
	assert.equal((await send(server, "POST", "/api/investigate/approve", { run: runId, step, approve: false, rest: true })).status, 400);
	assert.equal((await send(server, "POST", "/api/investigate/approve", { run: runId, step, approve: true, rest: "yes" })).status, 400);
	state = await read();
	assert.equal(state.active.pending.stepId, step);
	assert.deepEqual(world.netCalls, []);

	const answered = await send(server, "POST", "/api/investigate/approve", { run: runId, step, approve: true, rest: true });
	assert.deepEqual([answered.status, answered.json.rest], [200, true]);
	await until(read, (value) => value.active === null);
	const run = (await send(server, "GET", `/api/investigate/run?id=${runId}`)).json.run;
	assert.deepEqual(world.netCalls, ["GET https://example.com/a", "GET https://example.com/b", "tcp example.com:443"]);
	assert.deepEqual(
		run.steps.map((item: { approvedBy?: string }) => item.approvedBy),
		["owner", "run", "run"],
	);
	assert.equal(run.approvedRest.turn, 1);
	const exported = await send(server, "GET", `/api/investigate/export?id=${runId}&format=md`);
	assert.match(exported.text, /- Approval: you approved each HTTP request and TCP connection up to turn 1, and at that turn every later one/);
});

test("investigate: ownership lost mid-run stops it; Stop ends a run waiting for approval", async (t) => {
	// Checks 1 to 3 pass: the start request, the run's own first check, before the first action. The 4th fails.
	let checks = 0;
	const world = fakeWorld({ owned: () => ++checks <= 3, replies: [act("dns_lookup", { host: "example.com" }), act("dns_lookup", { host: "www.example.com" })] });
	const server = await start(t, world);
	await addAndPublish(server, world);
	const read = () => send(server, "GET", "/api/investigate").then((reply) => reply.json);
	const first = await send(server, "POST", "/api/investigate/start", { domain: "example.com" });
	await until(read, (value) => value.active === null);
	const lost = (await send(server, "GET", `/api/investigate/run?id=${first.json.run.id}`)).json.run;
	assert.equal(lost.status, "stopped");
	assert.match(lost.ended, /Ownership is no longer proven/);
	assert.equal(lost.evidence.length, 1, "the second lookup never ran");
	assert.ok(!world.requests.some((line) => line.includes("www.example.com")));

	const world2 = fakeWorld({ replies: [act("http_request", { url: "https://example.com/", method: "GET" })] });
	const server2 = await start(t, world2);
	await addAndPublish(server2, world2);
	const second = await send(server2, "POST", "/api/investigate/start", { domain: "example.com" });
	const read2 = () => send(server2, "GET", "/api/investigate").then((reply) => reply.json);
	await until(read2, (value) => value.active?.pending !== undefined);
	assert.equal((await send(server2, "POST", "/api/investigate/stop")).json.stopped, true);
	await until(read2, (value) => value.active === null);
	const stopped = (await send(server2, "GET", `/api/investigate/run?id=${second.json.run.id}`)).json.run;
	assert.equal(stopped.status, "stopped");
	assert.equal(stopped.ended, "Stopped by you.");
	assert.deepEqual(world2.netCalls, []);
});
