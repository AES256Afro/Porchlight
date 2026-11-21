import assert from "node:assert/strict";
import { readdir, readFile, stat } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { assistantConfig } from "../src/assist/ollama.ts";
import { APPROVAL_WINDOW_MS } from "../src/cloudflare/apply.ts";
import { MIN_KEY_LENGTH, startUiServer, type UiOptions, type UiServer } from "../src/ui/server.ts";
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

async function audited(t: TestContext, options: Parameters<typeof fakeCloudflare>[0] = {}) {
	const world = fakeCloudflare(options);
	const started = await start(t, { fetchFn: world.fetchFn });
	await send(started.server, "POST", "/api/cloudflare/token", { token: fakeCloudflareToken() });
	await send(started.server, "POST", "/api/cloudflare/audit", { lookups: false });
	await until(() => send(started.server, "GET", "/api/cloudflare"), (reply) => reply.json.status.state === "done");
	return { ...started, world, writes: () => world.sent.filter((sent) => sent.method !== "GET") };
}

test("Fix these: every change the audit offers is shown as its exact request, and one approval sends each once", async (t) => {
	const { server, state, writes } = await audited(t);
	const page = (await send(server, "GET", "/api/cloudflare")).json;
	const offered = page.report.zones.flatMap((zone: { name: string; checks: { status: string; change?: string }[] }) => zone.checks.filter((check) => check.status === "failed" && check.change).map((check) => `${zone.name} ${check.change}`));
	assert.ok(offered.length >= 3, "the fake account has several problems with a change");
	assert.deepEqual(page.batch, { state: "idle" });

	// Only a zone of the latest audit can be named; nothing else in the request chooses anything.
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/batch/preview", { zone: "../../user" })).status, 404);
	const preview = await send(server, "POST", "/api/cloudflare/changes/batch/preview", {});
	assert.equal(preview.status, 200);
	const batch = preview.json.batch;
	assert.deepEqual(batch.changes.map((change: { zone: string; change: string }) => `${change.zone} ${change.change}`), offered, "the audit's own list, in its order");
	assert.ok(batch.changes.every((change: { request: { url: string; headers: { Authorization: string } } }) => change.request.url.startsWith("https://api.cloudflare.com/client/v4/zones/") && /not shown/.test(change.request.headers.Authorization)));
	assert.ok(!preview.text.includes(fakeCloudflareToken()));
	assert.equal(writes().length, 0, "showing the requests sends nothing");

	// An answer is yes or no; a change that was not shown cannot be slipped in; none chosen is not a yes.
	const ids = batch.changes.map((change: { id: string }) => change.id);
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: batch.id })).status, 400);
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: batch.id, approve: true, include: [...ids, "0".repeat(24)] })).status, 400);
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: batch.id, approve: true, include: "all" })).status, 400);
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: batch.id, approve: true, include: [] })).status, 400);
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: "0".repeat(24), approve: true })).status, 409);
	assert.equal(writes().length, 0);

	// One left out: the rest are sent, each once, in order.
	const left = ids[0];
	const approved = await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: batch.id, approve: true, include: ids.slice(1) });
	assert.equal(approved.status, 202);
	const done = await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.batch.state === "finished");
	assert.deepEqual([done.json.batch.total, done.json.batch.applied, done.json.batch.failed, done.json.batch.skipped, done.json.batch.stopped], [ids.length - 1, ids.length - 1, 0, 0, false]);
	const expected = batch.changes.filter((change: { id: string }) => change.id !== left).map((change: { request: { method: string; url: string } }) => `${change.request.method} ${new URL(change.request.url).pathname}`);
	assert.deepEqual(writes().map((sent) => `${sent.method} ${sent.path}`), expected);
	assert.ok(writes().every((sent) => sent.authorization === `Bearer ${fakeCloudflareToken()}`));
	// The same answer again sends nothing more.
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: batch.id, approve: true })).status, 409);
	assert.equal(writes().length, ids.length - 1);

	// Every change is recorded, and the Activity view shows each as it was sent, without the token or a request's body.
	const recorded = JSON.parse(await readFile(join(state, "cloudflare-changes.json"), "utf8")).changes;
	assert.equal(recorded.length, ids.length - 1);
	const activity = await send(server, "GET", "/api/activity?after=0");
	const lines: string[] = activity.json.lines.map((line: { text: string }) => line.text);
	assert.equal(lines.filter((line) => line.startsWith("Sending: ")).length, ids.length - 1);
	assert.ok(lines.some((line) => new RegExp(`^Cloudflare changes finished: ${ids.length - 1} applied, 0 refused, 0 not sent$`).test(line)));
	assert.ok(!activity.text.includes(fakeCloudflareToken()) && !activity.text.includes("porchlight-verify="));
	// Asked again from where it left off, there is nothing new.
	assert.deepEqual((await send(server, "GET", `/api/activity?after=${activity.json.last}`)).json.lines, []);

	// Cancelled: nothing is sent, and it cannot be approved afterwards.
	const second = (await send(server, "POST", "/api/cloudflare/changes/batch/preview", { zone: FREE_ZONE })).json.batch;
	assert.ok(second.changes.every((change: { zone: string }) => change.zone === "free.example"));
	assert.deepEqual((await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: second.id, approve: false })).json, { started: false });
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: second.id, approve: true })).status, 409);
	assert.equal(writes().length, ids.length - 1);
});

test("Fix these: a permission the token lacks is found once, and the rest that need it are not sent", async (t) => {
	const { server, writes } = await audited(t, { denySettingWrites: true });
	const batch = (await send(server, "POST", "/api/cloudflare/changes/batch/preview", {})).json.batch;
	const settings = batch.changes.filter((change: { permission: string }) => change.permission === "Zone Settings Write").length;
	const records = batch.changes.length - settings;
	assert.ok(settings >= 2 && records >= 1);
	await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: batch.id, approve: true, include: batch.changes.map((change: { id: string }) => change.id) });
	const done = await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.batch.state === "finished");
	// One refusal says the token cannot change settings; the others are not tried. The ownership records still go.
	assert.deepEqual([done.json.batch.applied, done.json.batch.failed, done.json.batch.skipped], [records, 1, settings - 1]);
	assert.equal(writes().filter((sent) => sent.path.includes("/settings/")).length, 1);
	assert.equal(done.json.changes.filter((change: { ok: boolean }) => !change.ok).length, 1, "only what was sent is recorded");
	const lines: string[] = (await send(server, "GET", "/api/activity?after=0")).json.lines.map((line: { text: string }) => line.text);
	assert.equal(lines.filter((line) => /^Not sent: .* The token lacks "Zone Settings Write"$/.test(line)).length, settings - 1);
});

test("Fix these: a change that could affect the site carries its warning and is sent only when it is named", async (t) => {
	const { server, writes } = await audited(t);
	const batch = (await send(server, "POST", "/api/cloudflare/changes/batch/preview", {})).json.batch;
	const careful = batch.changes.filter((change: { care?: string }) => change.care);
	const plain = batch.changes.filter((change: { care?: string }) => !change.care);
	assert.ok(careful.length >= 2 && plain.length >= 1);
	// Each says what could go wrong, and is one of the fixed requests.
	const known: Record<string, [string, RegExp, unknown]> = {
		hsts: ["PATCH", /\/settings\/security_header$/, { value: { strict_transport_security: { enabled: true, max_age: 15_552_000, include_subdomains: false, preload: false, nosniff: true } } }],
		"ssl-strict": ["PATCH", /\/settings\/ssl$/, { value: "strict" }],
		"bot-fight-mode": ["PUT", /\/bot_management$/, { fight_mode: true }],
		dnssec: ["PATCH", /\/dnssec$/, { status: "active" }],
	};
	for (const change of careful) {
		assert.ok(change.care.length > 40, change.change);
		const expected = known[change.change];
		if (expected) {
			assert.deepEqual([change.request.method, expected[1].test(change.request.url), change.request.body], [expected[0], true, expected[2]], change.change);
		} else {
			assert.equal(change.change, "dmarc-monitor");
			assert.deepEqual([change.request.method, change.request.body.type, change.request.body.content], ["POST", "TXT", '"v=DMARC1; p=none"']);
			assert.match(change.request.body.name, /^_dmarc\./);
		}
	}
	// A yes that names nothing sends only the changes without a warning.
	await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: batch.id, approve: true });
	await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.batch.state === "finished");
	assert.equal(writes().length, plain.length);

	// Named, they are sent like any other, each once.
	const second = (await send(server, "POST", "/api/cloudflare/changes/batch/preview", {})).json.batch;
	const chosen = second.changes.filter((change: { care?: string }) => change.care).map((change: { id: string }) => change.id);
	await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: second.id, approve: true, include: chosen });
	await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.batch.state === "finished" && reply.json.batch.total === chosen.length);
	assert.equal(writes().length, plain.length + chosen.length);

	// One at a time, the warning comes with the request too.
	const zone = (await send(server, "GET", "/api/cloudflare")).json.report.zones.find((candidate: { checks: { change?: string }[] }) => candidate.checks.some((check) => check.change === "hsts"));
	const single = await send(server, "POST", "/api/cloudflare/changes/preview", { zone: zone.id, change: "hsts" });
	assert.match(single.json.pending.care, /refuse plain HTTP/);
});

test("Fix these: ten minutes to answer, and removing the token ends it", async (t) => {
	const { server, writes } = await audited(t);
	t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
	const late = (await send(server, "POST", "/api/cloudflare/changes/batch/preview", {})).json.batch;
	t.mock.timers.tick(APPROVAL_WINDOW_MS + 1);
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: late.id, approve: true })).status, 409);
	const waiting = (await send(server, "POST", "/api/cloudflare/changes/batch/preview", {})).json.batch;
	await send(server, "POST", "/api/cloudflare/token/remove");
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: waiting.id, approve: true })).status, 409);
	assert.equal(writes().length, 0);
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

test("another device on the tailnet reads the audit, but only the page on the computer that runs Porchlight saves a token, asks for a change or approves one", async (t) => {
	const { server, world, state } = await start(t, { tailnetAddress: () => "127.0.0.1", accessPort: 0 });
	await send(server, "POST", "/api/cloudflare/token", { token: fakeCloudflareToken() });
	await send(server, "POST", "/api/cloudflare/audit", { lookups: false });
	await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.status.state === "done");
	const writes = () => world.sent.filter((sent) => sent.method !== "GET");
	const verifies = () => world.sent.filter((sent) => sent.path.endsWith("/tokens/verify")).length;

	// The device comes in through the tailnet listener, with its own access key.
	const link = new URL((await send(server, "POST", "/api/access", { enabled: true })).json.link);
	const device = { ...server, port: Number(link.port), sessionKey: link.hash.slice("#k=".length) } as UiServer;
	const seen = await send(device, "GET", "/api/cloudflare");
	assert.deepEqual([seen.status, seen.json.canChange], [200, false]);
	assert.ok(seen.json.report, "the audit is there to read");
	assert.ok(!seen.text.includes(fakeCloudflareToken()));
	assert.equal((await send(device, "GET", "/api/cloudflare/token")).json.canChange, false);

	const checked = verifies();
	assert.equal((await send(device, "POST", "/api/cloudflare/token", { token: fakeCloudflareToken() })).status, 403);
	assert.equal((await send(device, "POST", "/api/cloudflare/token/remove")).status, 403);
	assert.equal((await send(device, "POST", "/api/cloudflare/changes/preview", { zone: FREE_ZONE, change: "min-tls-1.2" })).status, 403);
	assert.equal((await send(device, "POST", "/api/cloudflare/changes/batch/preview", {})).status, 403, "nor a set of them");
	assert.equal((await send(device, "POST", "/api/cloudflare/changes/batch/approve", { id: "0".repeat(24), approve: true })).status, 403);
	assert.equal(verifies(), checked, "a token sent from another device is never even checked with Cloudflare");
	await stat(join(state, "cloudflare-settings.json"));
	assert.equal((await send(server, "GET", "/api/cloudflare")).json.token.configured, true, "and the saved token is not forgotten");

	// A request shown on that computer cannot be approved from the device, and the refusal does not use it up.
	const pending = (await send(server, "POST", "/api/cloudflare/changes/preview", { zone: FREE_ZONE, change: "min-tls-1.2" })).json.pending;
	assert.equal((await send(device, "POST", "/api/cloudflare/changes/approve", { id: pending.id, approve: true })).status, 403);
	assert.equal((await send(device, "POST", "/api/cloudflare/changes/approve", { id: pending.id, approve: false })).status, 403, "nor can it be cancelled from there");
	assert.equal(writes().length, 0);
	await assert.rejects(stat(join(state, "cloudflare-changes.json")), "nothing is recorded as sent");
	const applied = await send(server, "POST", "/api/cloudflare/changes/approve", { id: pending.id, approve: true });
	assert.deepEqual([applied.json.applied, applied.json.ok], [true, true]);
	assert.equal(writes().length, 1);
});

test("run as a service, Porchlight audits with the token it was given but never saves one or sends a change", async (t) => {
	const { server, world, state } = await start(t, { host: "0.0.0.0", sessionKey: "k".repeat(MIN_KEY_LENGTH), cloudflareToken: fakeCloudflareToken() });
	await send(server, "POST", "/api/cloudflare/audit", { lookups: false });
	const page = await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.status.state === "done");
	assert.deepEqual([page.json.canChange, page.json.service], [false, true]);

	assert.equal((await send(server, "POST", "/api/cloudflare/token", { token: fakeCloudflareToken() })).status, 403);
	assert.equal((await send(server, "POST", "/api/cloudflare/token/remove")).status, 403);
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/preview", { zone: FREE_ZONE, change: "min-tls-1.2" })).status, 403);
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/approve", { id: "0".repeat(24), approve: true })).status, 403);
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/batch/preview", {})).status, 403);
	assert.equal(world.sent.filter((sent) => sent.method !== "GET").length, 0);
	await assert.rejects(stat(join(state, "cloudflare-settings.json")));
	await assert.rejects(stat(join(state, "cloudflare-changes.json")));
});

test("a change waits ten minutes for an answer, then has to be asked for again", async (t) => {
	const { server, world, state } = await start(t);
	await send(server, "POST", "/api/cloudflare/token", { token: fakeCloudflareToken() });
	await send(server, "POST", "/api/cloudflare/audit", { lookups: false });
	await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.status.state === "done");
	const writes = () => world.sent.filter((sent) => sent.method !== "GET").map((sent) => sent.path);
	const ask = (change: string) => send(server, "POST", "/api/cloudflare/changes/preview", { zone: FREE_ZONE, change });
	const approve = (id: string) => send(server, "POST", "/api/cloudflare/changes/approve", { id, approve: true });

	// Only the clock is mocked: the server's sockets and timers run as usual.
	t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
	const early = (await ask("min-tls-1.2")).json.pending;
	const late = (await ask("always-use-https")).json.pending;
	assert.equal(early.expiresAt, new Date(Date.now() + APPROVAL_WINDOW_MS).toISOString(), "the page is told when the request lapses");

	// Answered just inside the window, it is sent.
	t.mock.timers.tick(APPROVAL_WINDOW_MS - 1);
	assert.equal((await approve(early.id)).json.ok, true);
	// Just past it, it is refused, nothing is sent, and it stays refused.
	t.mock.timers.tick(2);
	assert.equal((await approve(late.id)).status, 409);
	assert.equal((await approve(late.id)).status, 409);
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/approve", { id: late.id, approve: false })).status, 409, "a lapsed request cannot be answered either way");
	assert.deepEqual(writes(), [`/client/v4/zones/${FREE_ZONE}/settings/min_tls_version`]);

	// Asking again shows a new request with a new window.
	const fresh = (await ask("always-use-https")).json.pending;
	assert.notEqual(fresh.id, late.id);
	assert.equal(fresh.expiresAt, new Date(Date.now() + APPROVAL_WINDOW_MS).toISOString());
	assert.equal((await approve(fresh.id)).json.ok, true);
	assert.deepEqual(writes(), [`/client/v4/zones/${FREE_ZONE}/settings/min_tls_version`, `/client/v4/zones/${FREE_ZONE}/settings/always_use_https`]);
	const log = JSON.parse(await readFile(join(state, "cloudflare-changes.json"), "utf8")).changes;
	assert.deepEqual(log.map((change: { change: string }) => change.change), ["min-tls-1.2", "always-use-https"], "the lapsed request is not recorded as sent");

	// Lapsed requests stop counting towards the twenty that may wait at once.
	for (let i = 0; i < 20; i++) assert.equal((await ask("min-tls-1.2")).status, 200);
	assert.equal((await ask("min-tls-1.2")).status, 409);
	t.mock.timers.tick(APPROVAL_WINDOW_MS + 1);
	assert.equal((await ask("min-tls-1.2")).status, 200);
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

test("the Cloudflare analysis is kept as a discussion, and the audit's export and events reach the project folder", async (t) => {
	const world = fakeCloudflare();
	const prompts: string[] = [];
	const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input instanceof Request ? input.url : input));
		if (url.pathname === "/api/chat") {
			prompts.push(JSON.stringify(JSON.parse(String(init?.body)).messages));
			return Response.json({ message: { content: `Answer ${prompts.length}.` } });
		}
		return world.fetchFn(input, init);
	}) as typeof fetch;
	const { server, state } = await start(t, { fetchFn, cloudflareToken: fakeCloudflareToken(), assistant: assistantConfig({ PORCHLIGHT_LLM_URL: "http://127.0.0.1:11434", PORCHLIGHT_LLM_MODEL: "scripted-model" }) });
	const folder = join(state, "..", "acme");
	assert.equal((await send(server, "POST", "/api/projects", { name: "acme", folder })).status, 200);
	await send(server, "POST", "/api/cloudflare/audit", { lookups: false });
	await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.status.state === "done");

	const analysis = await send(server, "POST", "/api/assist/cloudflare", {});
	const id = analysis.json.discussion as string;
	assert.match(analysis.json.title, /^Cloudflare: analysis of the audit of \d{4}-\d{2}-\d{2}, \d+ zones?$/);
	assert.equal((await send(server, "POST", "/api/discussions/ask", { id, question: "Which zone first?" })).status, 200);
	const sent = JSON.parse(prompts.at(-1) ?? "[]");
	assert.deepEqual(
		sent.map((message: { role: string }) => message.role),
		["system", "user", "assistant", "user"],
	);
	assert.match(sent[1].content, /free\.example/, "the same audit, rebuilt from the stored copy");
	assert.ok(!(prompts.at(-1) ?? "").includes(fakeCloudflareToken()));

	// The transcript, a saved export and the log are in the project's own folder; the token is in none of them.
	const own = join(folder, "Porchlight");
	const kept = (await send(server, "GET", `/api/discussions/one?id=${id}`)).json.discussion.saved;
	assert.match(kept.name, / Cloudflare analysis\.md$/);
	const saved = (await send(server, "POST", "/api/cloudflare/export?format=md")).json.saved;
	assert.match(saved.name, /^\d{4}-\d{2}-\d{2} \d{2}\.\d{2} Cloudflare audit\.md$/);
	await new Promise((resolve) => setTimeout(resolve, 50));
	const log = await readFile(join(own, "Log", (await readdir(join(own, "Log")))[0] ?? ""), "utf8");
	assert.match(log, / {2}Cloudflare audit started$/m);
	assert.match(log, / {2}Cloudflare audit finished: \d+ zones?, \d+ findings?$/m);
	assert.match(log, / {2}Asked scripted-model at 127\.0\.0\.1:11434: Cloudflare analysis, answered in /m);
	assert.match(log, / {2}Exported Cloudflare audit \(md\) to Porchlight\/Exports\//m);
	for (const text of [log, await readFile(join(own, "Discussions", kept.name), "utf8"), await readFile(saved.path, "utf8")]) {
		assert.ok(!text.includes(fakeCloudflareToken()));
	}

	// A newer audit replaces the one the discussion read: it can still be read, not followed up.
	await new Promise((resolve) => setTimeout(resolve, 5));
	await send(server, "POST", "/api/cloudflare/audit", { lookups: false });
	await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.status.state === "done");
	const stale = await send(server, "GET", `/api/discussions/one?id=${id}`);
	assert.match(stale.json.followUp.reason, /A newer Cloudflare audit has replaced/);
	assert.equal((await send(server, "POST", "/api/discussions/ask", { id, question: "And now?" })).status, 409);
});

test("a change is sent only while it still repairs what the audit found: read again just before sending (S28)", async (t) => {
	const { server, world, writes, state } = await audited(t);

	// One at a time: HSTS shown while off, then turned on with preload in Cloudflare's dashboard. The
	// fixed template (6 months, no subdomains, no preload) would lower it, so it is not sent.
	const hsts = (await send(server, "POST", "/api/cloudflare/changes/preview", { zone: FREE_ZONE, change: "hsts" })).json.pending;
	world.settings[FREE_ZONE]!.security_header = { strict_transport_security: { enabled: true, max_age: 63_072_000, include_subdomains: true, preload: true } };
	const answered = await send(server, "POST", "/api/cloudflare/changes/approve", { id: hsts.id, approve: true });
	assert.equal(answered.status, 200);
	assert.deepEqual([answered.json.ok, answered.json.notSent], [false, true]);
	assert.match(answered.json.result, /^Not sent: .*changed after the audit/);
	assert.equal(writes().length, 0);
	const recorded = JSON.parse(await readFile(join(state, "cloudflare-changes.json"), "utf8")).changes;
	assert.deepEqual(recorded.map((change: { change: string; ok: boolean; notSent?: boolean }) => [change.change, change.ok, change.notSent]), [["hsts", false, true]]);

	// Fix these: the minimum TLS version raised to 1.3 since is not lowered to 1.2; the rest still go.
	const batch = (await send(server, "POST", "/api/cloudflare/changes/batch/preview", { zone: FREE_ZONE })).json.batch;
	const ids = batch.changes.filter((change: { care?: string }) => !change.care).map((change: { id: string }) => change.id);
	assert.ok(batch.changes.some((change: { change: string }) => change.change === "min-tls-1.2"));
	world.settings[FREE_ZONE]!.min_tls_version = "1.3";
	await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: batch.id, approve: true, include: ids });
	const done = await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.batch.state === "finished");
	assert.equal(done.json.batch.skipped, 1);
	assert.equal(done.json.batch.applied, ids.length - 1);
	assert.ok(!writes().some((sent) => sent.path.endsWith("/settings/min_tls_version")), "TLS 1.3 is never lowered to 1.2");
	assert.equal(writes().length, ids.length - 1);
	const lines: string[] = (await send(server, "GET", "/api/activity?after=0")).json.lines.map((line: { text: string }) => line.text);
	assert.ok(lines.some((line) => /^Not sent: Set the minimum TLS version to 1\.2 for free\.example\. /.test(line)));
});

test("a newer audit ends every request still waiting, one at a time or together (S28)", async (t) => {
	const { server, writes } = await audited(t);
	const single = (await send(server, "POST", "/api/cloudflare/changes/preview", { zone: FREE_ZONE, change: "always-use-https" })).json.pending;
	const batch = (await send(server, "POST", "/api/cloudflare/changes/batch/preview", {})).json.batch;
	const before = (await send(server, "GET", "/api/cloudflare")).json.report.checkedAt;
	await new Promise((resolve) => setTimeout(resolve, 5));
	await send(server, "POST", "/api/cloudflare/audit", { lookups: false });
	await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.status.state === "done" && reply.json.report.checkedAt !== before);
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/approve", { id: single.id, approve: true })).status, 409);
	assert.equal((await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: batch.id, approve: true })).status, 409);
	assert.equal(writes().length, 0);
});

test("a single change cannot be approved while a set of changes is being sent (S28, CF-S2)", async (t) => {
	const world = fakeCloudflare();
	// Changes wait at the door until the test lets them through, so the set is still running.
	let release = () => {};
	const held = new Promise<void>((resolve) => (release = resolve));
	const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
		if ((init?.method ?? "GET") !== "GET") await held;
		return world.fetchFn(input, init);
	}) as typeof fetch;
	const { server } = await start(t, { fetchFn });
	await send(server, "POST", "/api/cloudflare/token", { token: fakeCloudflareToken() });
	await send(server, "POST", "/api/cloudflare/audit", { lookups: false });
	await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.status.state === "done");
	const single = (await send(server, "POST", "/api/cloudflare/changes/preview", { zone: FREE_ZONE, change: "always-use-https" })).json.pending;
	const batch = (await send(server, "POST", "/api/cloudflare/changes/batch/preview", {})).json.batch;
	await send(server, "POST", "/api/cloudflare/changes/batch/approve", { id: batch.id, approve: true });
	assert.equal((await send(server, "GET", "/api/cloudflare")).json.batch.state, "running");
	const refused = await send(server, "POST", "/api/cloudflare/changes/approve", { id: single.id, approve: true });
	assert.equal(refused.status, 409);
	assert.match(refused.json.error, /being sent now/);
	release();
	await until(() => send(server, "GET", "/api/cloudflare"), (reply) => reply.json.batch.state === "finished");
	const sent = world.sent.filter((request) => request.method !== "GET" && request.path.endsWith("/settings/always_use_https"));
	assert.equal(sent.length, 1, "the same template went out once");
});
