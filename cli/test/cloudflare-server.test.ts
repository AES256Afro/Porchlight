import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { assistantConfig } from "../src/assist/ollama.ts";
import { startUiServer, type UiOptions, type UiServer } from "../src/ui/server.ts";
import { fakeCloudflare, fakeCloudflareToken, FREE_ZONE, OWNERSHIP_TOKEN, PRO_ZONE } from "./cloudflare-fake.ts";
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

async function start(t: TestContext, overrides: Partial<UiOptions> = {}) {
	const dir = await tempDir();
	const world = fakeCloudflare();
	const server = await startUiServer({ port: 0, reportPath: join(dir, "state", "repo-scan.json"), defaultRoot: dir, monitor: null, fetchFn: world.fetchFn, ...overrides });
	t.after(() => server.close());
	return { server, world, state: join(dir, "state") };
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
	for (let attempt = 0; attempt < 300; attempt++) {
		const value = await read();
		if (done(value)) return value;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("timed out waiting");
}

test("the Cloudflare page audits a fake account end to end, and the token never reaches the page", async (t) => {
	const { server, world, state } = await start(t);
	const token = fakeCloudflareToken();

	let page = await send(server, "GET", "/api/cloudflare");
	assert.equal(page.json.token.configured, false);
	assert.equal(page.json.canChange, true);
	assert.ok(page.json.guide.read.some((permission: { name: string }) => permission.name === "Zone Settings Read"));
	assert.equal((await send(server, "POST", "/api/cloudflare/audit", {})).status, 409, "no audit without a token");

	// A token is checked with Cloudflare before it is saved, and kept readable by its owner alone.
	assert.equal((await send(server, "POST", "/api/cloudflare/token", { token: "not a token" })).status, 400);
	const saved = await send(server, "POST", "/api/cloudflare/token", { token });
	assert.equal(saved.status, 200);
	assert.equal(saved.json.token.configured, true);
	assert.equal(saved.json.token.verified.status, "active");
	assert.ok(!saved.text.includes(token));
	assert.equal((await stat(join(state, "cloudflare-settings.json"))).mode & 0o777, 0o600);

	const started = await send(server, "POST", "/api/cloudflare/audit", { lookups: true });
	assert.equal(started.status, 202);
	page = await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.status.state !== "running");
	assert.equal(page.json.status.state, "done");
	assert.deepEqual(page.json.report.zones.map((zone: { name: string }) => zone.name), ["free.example", "pro.example"]);
	assert.ok(!page.text.includes(token));
	assert.equal((await stat(join(state, "cloudflare-audit.json"))).mode & 0o777, 0o600);
	assert.ok(!(await readFile(join(state, "cloudflare-audit.json"), "utf8")).includes(token));
	const appState = await send(server, "GET", "/api/state");
	assert.equal(appState.json.cloudflare.configured, true);
	assert.ok(!appState.text.includes(token));

	// Up to here only reads went to Cloudflare.
	assert.ok(world.sent.every((sent) => sent.method === "GET"));

	const exported = await send(server, "GET", "/api/cloudflare/export?format=html");
	assert.equal(exported.status, 200);
	assert.match(String(exported.headers["content-disposition"]), /filename="porchlight-cloudflare-\d{4}-\d{2}-\d{2}\.html"/);
	assert.ok(!exported.text.includes(token));
	assert.equal((await send(server, "GET", "/api/cloudflare/export?format=exe")).status, 400);
	assert.equal((await send(server, "GET", `/api/cloudflare/export?format=md&zone=${"9".repeat(32)}`)).status, 404);
});

test("a change is sent only after the owner approves the exact request, once, and is recorded", async (t) => {
	const { server, world, state } = await start(t);
	await send(server, "POST", "/api/cloudflare/token", { token: fakeCloudflareToken() });
	await send(server, "POST", "/api/cloudflare/audit", { lookups: false });
	await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.status.state === "done");
	const writes = () => world.sent.filter((sent) => sent.method !== "GET");

	// Only a change the audit offered for a problem in that zone.
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/preview", { zone: PRO_ZONE, change: "min-tls-1.2" })).status, 409);
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/preview", { zone: FREE_ZONE, change: "delete-everything" })).status, 400);
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/preview", { zone: "../../user", change: "min-tls-1.2" })).status, 404);

	const preview = await send(server, "POST", "/api/cloudflare/changes/preview", { zone: FREE_ZONE, change: "min-tls-1.2" });
	assert.equal(preview.status, 200);
	const pending = preview.json.pending;
	assert.equal(pending.request.method, "PATCH");
	assert.equal(pending.request.url, `https://api.cloudflare.com/client/v4/zones/${FREE_ZONE}/settings/min_tls_version`);
	assert.deepEqual(pending.request.body, { value: "1.2" });
	assert.match(pending.request.headers.Authorization, /not shown/);
	assert.ok(!preview.text.includes(fakeCloudflareToken()));
	assert.equal(writes().length, 0, "showing the request sends nothing");

	// Cancelled: nothing is sent, and the request cannot be approved afterwards.
	assert.deepEqual((await send(server, "POST", "/api/cloudflare/changes/approve", { id: pending.id, approve: false })).json, { applied: false });
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/approve", { id: pending.id, approve: true })).status, 409);
	assert.equal(writes().length, 0);

	const again = (await send(server, "POST", "/api/cloudflare/changes/preview", { zone: FREE_ZONE, change: "min-tls-1.2" })).json.pending;
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/approve", { id: again.id })).status, 400, "an answer must say yes or no");
	const applied = await send(server, "POST", "/api/cloudflare/changes/approve", { id: again.id, approve: true });
	assert.equal(applied.json.applied, true);
	assert.equal(applied.json.ok, true);
	assert.deepEqual(
		writes().map((sent) => [sent.method, sent.path, sent.body]),
		[["PATCH", `/client/v4/zones/${FREE_ZONE}/settings/min_tls_version`, { value: "1.2" }]],
	);
	assert.equal(writes()[0]?.authorization, `Bearer ${fakeCloudflareToken()}`);
	// Approving the same request twice sends it once.
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/approve", { id: again.id, approve: true })).status, 409);
	assert.equal(writes().length, 1);

	// The ownership record: the token is chosen when the request is shown, and kept once Cloudflare accepts it.
	const record = (await send(server, "POST", "/api/cloudflare/changes/preview", { zone: PRO_ZONE, change: "ownership-record" })).json.pending;
	assert.equal(record.request.body.name, "_porchlight-challenge.pro.example");
	const value = /^"porchlight-verify=([0-9a-f]+)"$/.exec(record.request.body.content)?.[1];
	assert.ok(value);
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/approve", { id: record.id, approve: true })).json.ok, true);
	const domains = JSON.parse(await readFile(join(state, "investigate-domains.json"), "utf8"));
	assert.equal(domains.domains["pro.example"].token, value);
	assert.notEqual(value, OWNERSHIP_TOKEN);

	// Every change sent is recorded, with the request and without the token.
	const log = await readFile(join(state, "cloudflare-changes.json"), "utf8");
	assert.equal((await stat(join(state, "cloudflare-changes.json"))).mode & 0o777, 0o600);
	assert.ok(!log.includes(fakeCloudflareToken()));
	const changes = JSON.parse(log).changes;
	assert.deepEqual(changes.map((change: { change: string; ok: boolean }) => [change.change, change.ok]), [["min-tls-1.2", true], ["ownership-record", true]]);
	assert.equal(changes[0].request.url, `https://api.cloudflare.com/client/v4/zones/${FREE_ZONE}/settings/min_tls_version`);
	const page = await send(server, "GET", "/api/cloudflare");
	assert.equal(page.json.changes.length, 2);
	assert.equal(page.json.changes[0].change, "ownership-record", "newest first");
});

test("removing the token forgets it and any change waiting for an answer", async (t) => {
	const { server, state } = await start(t);
	await send(server, "POST", "/api/cloudflare/token", { token: fakeCloudflareToken() });
	await send(server, "POST", "/api/cloudflare/audit", { lookups: false });
	await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.status.state === "done");
	const pending = (await send(server, "POST", "/api/cloudflare/changes/preview", { zone: FREE_ZONE, change: "always-use-https" })).json.pending;
	const removed = await send(server, "POST", "/api/cloudflare/token/remove");
	assert.equal(removed.json.token.configured, false);
	await assert.rejects(stat(join(state, "cloudflare-settings.json")));
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/approve", { id: pending.id, approve: true })).status, 409);
});

test("a token given at start-up is used, and the model analysis needs a model", async (t) => {
	const { server } = await start(t, { cloudflareToken: fakeCloudflareToken() });
	const page = await send(server, "GET", "/api/cloudflare");
	assert.equal(page.json.token.source, "startup");
	await send(server, "POST", "/api/cloudflare/audit", { lookups: false });
	await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.status.state === "done");
	const analysis = await send(server, "POST", "/api/assist/cloudflare", {});
	assert.equal(analysis.status, 503);
});

test("the model's analysis reads the stored audit as data, never the token, and is labelled as its own", async (t) => {
	const world = fakeCloudflare();
	const prompts: string[] = [];
	const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input instanceof Request ? input.url : input));
		if (url.pathname === "/api/chat") {
			prompts.push(JSON.stringify(JSON.parse(String(init?.body)).messages));
			return Response.json({ message: { content: "Fix the encryption mode of free.example first." } });
		}
		return world.fetchFn(input, init);
	}) as typeof fetch;
	const { server } = await start(t, { fetchFn, cloudflareToken: fakeCloudflareToken(), assistant: assistantConfig({ PORCHLIGHT_LLM_URL: "http://127.0.0.1:11434", PORCHLIGHT_LLM_MODEL: "scripted-model" }) });
	assert.equal((await send(server, "POST", "/api/assist/cloudflare", {})).status, 404, "no audit yet");
	await send(server, "POST", "/api/cloudflare/audit", { lookups: false });
	await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.status.state === "done");
	const analysis = await send(server, "POST", "/api/assist/cloudflare", { report: { zones: [{ name: "injected.example" }] } });
	assert.equal(analysis.status, 200);
	assert.equal(analysis.json.model, "scripted-model");
	assert.equal(prompts.length, 1);
	assert.match(prompts[0] ?? "", /free\.example/);
	assert.ok(!(prompts[0] ?? "").includes("injected.example"), "the request names nothing the model reads");
	assert.ok(!(prompts[0] ?? "").includes(fakeCloudflareToken()));
	assert.ok(!(prompts[0] ?? "").includes("@example.com"));
});
