import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { startUiServer, type UiOptions, type UiServer } from "../src/ui/server.ts";
import { ALERT_SECRET, DEPLOY_KEY, fakeGithub, fakeGithubToken, HOOK_PATH } from "./github-fake.ts";
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

async function start(t: TestContext, token: string | undefined, overrides: Partial<UiOptions> = {}) {
	const dir = await tempDir();
	const world = fakeGithub();
	const state = join(dir, "state");
	const server = await startUiServer({
		port: 0,
		reportPath: join(state, "repo-scan.json"),
		defaultRoot: dir,
		monitor: null,
		fetchFn: world.fetchFn,
		github: { dir: join(state, "github"), ...(token ? { token } : {}) },
		...overrides,
	});
	t.after(() => server.close());
	return { server, world, state };
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
	for (let attempt = 0; attempt < 300; attempt++) {
		const value = await read();
		if (done(value)) return value;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("timed out waiting");
}

test("the GitHub settings audit runs from the page, is kept 0600, exports, and the token never reaches the page (invariant 24)", async (t) => {
	const token = fakeGithubToken();
	const { server, world, state } = await start(t, token);

	let page = await send(server, "GET", "/api/github/audit");
	assert.equal(page.status, 200);
	assert.equal(page.json.token, true);
	assert.equal(page.json.report, null);
	assert.ok(page.json.permissions.some((permission: { name: string }) => permission.name === "Administration: Read-only"));
	assert.equal((await send(server, "GET", "/api/github/audit/export?format=md")).status, 404, "nothing to export yet");

	const started = await send(server, "POST", "/api/github/audit", {});
	assert.equal(started.status, 202);
	page = await until(() => send(server, "GET", "/api/github/audit"), (reply) => reply.json.status.state !== "running");
	assert.equal(page.json.status.state, "done");
	assert.equal(page.json.report.repos.length, 4);
	const file = join(state, "github-audit.json");
	assert.equal((await stat(file)).mode & 0o777, 0o600);
	const kept = await readFile(file, "utf8");
	for (const text of [page.text, kept]) for (const never of [token, ALERT_SECRET, DEPLOY_KEY, HOOK_PATH]) assert.ok(!text.includes(never));
	// It only reads, and only from GitHub's API.
	assert.ok(world.sent.every((request) => request.method === "GET" && request.host === "api.github.com"));

	const md = await send(server, "GET", "/api/github/audit/export?format=md");
	assert.equal(md.status, 200);
	assert.equal(md.headers["content-disposition"], 'attachment; filename="porchlight-github-settings-' + page.json.report.checkedAt.slice(0, 10) + '.md"');
	assert.ok(!md.text.includes(token));
	assert.equal((await send(server, "GET", "/api/github/audit/export?format=csv")).status, 200);
	assert.equal((await send(server, "GET", "/api/github/audit/export?format=json")).status, 200);
	assert.equal((await send(server, "GET", "/api/github/audit/export?format=html")).status, 400);
	// The GitHub area's own routes still answer beside it.
	assert.equal((await send(server, "GET", "/api/github")).status, 200);
	assert.equal((await send(server, "GET", "/api/github/audit/nothing")).status, 404);
});

test("without a token the audit is refused, and a kept audit that cannot be read is said, never shown as none (invariant 5)", async (t) => {
	const { server, state } = await start(t, undefined);
	assert.equal((await send(server, "GET", "/api/github/audit")).json.token, false);
	const refused = await send(server, "POST", "/api/github/audit", {});
	assert.equal(refused.status, 409);
	assert.match(refused.json.error, /PORCHLIGHT_GITHUB_TOKEN/);

	await mkdir(state, { recursive: true });
	await writeFile(join(state, "github-audit.json"), "{ not json", { mode: 0o600 });
	const page = await send(server, "GET", "/api/github/audit");
	assert.equal(page.json.report, null);
	assert.match(page.json.unreadable, /could not be read/);
	assert.equal((await send(server, "GET", "/api/github/audit/export?format=md")).status, 409);
});
