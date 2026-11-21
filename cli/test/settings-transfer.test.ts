import assert from "node:assert/strict";
import { chmod, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { decrypt, encrypt, exportSettings, importSettings, openSettings, settingsCommand, type TransferDeps } from "../src/settings-transfer.ts";
import { fakeCloudflareToken } from "./cloudflare-fake.ts";
import { makeTree, tempDir } from "./helpers.ts";

const PASSPHRASE = "correct horse battery staple";

async function source(): Promise<{ dir: string; secrets: string[] }> {
	const dir = await tempDir();
	const modelKey = ["sk", "ant", "test", "k".repeat(30)].join("-");
	const adminToken = "a".repeat(40);
	const cfToken = fakeCloudflareToken();
	await makeTree(dir, {
		"ui-settings.json": JSON.stringify({ appearance: "terminal", answers: "below" }),
		"due-dates.json": JSON.stringify({ critical: 3, high: 14, medium: null, low: null }),
		"model-tasks.json": JSON.stringify({ tasks: { analysis: "anthropic" } }),
		"model-settings.json": JSON.stringify({ choice: "anthropic", model: "claude-test", keys: { anthropic: modelKey } }),
		"monitor-settings.json": JSON.stringify({ url: "https://monitor.example.com", token: adminToken, savedAt: "2026-11-01" }),
		"cloudflare-settings.json": JSON.stringify({ token: cfToken, savedAt: "2026-11-01" }),
		"finding-notes.json": JSON.stringify({ "shop\nCVE-1\npackage-lock.json\npkg@1": { status: "accepted", note: "vendor fix due", updatedAt: "2026-11-01T00:00:00Z" } }),
		"access.json": JSON.stringify({ enabled: true, key: "z".repeat(40) }),
	});
	return { dir, secrets: [modelKey, adminToken, cfToken, "z".repeat(40)] };
}

const deps = (dataDir: string, passphrase = PASSPHRASE): TransferDeps => ({ dataDir, passphrase: async () => passphrase, home: dataDir });

test("an export without --include-keys holds every setting and no key or token, and never writes over a file (FT-17)", async () => {
	const { dir, secrets } = await source();
	const out = join(await tempDir(), "settings.json");
	const done = await exportSettings(out, deps(dir), false);
	assert.deepEqual(done.keys, []);
	const text = await readFile(out, "utf8");
	for (const secret of secrets) assert.ok(!text.includes(secret), "no key in plain text");
	assert.ok(!text.includes("access.json"), "the access key for other devices never moves");
	assert.equal(JSON.parse(text).files["model-settings.json"].choice, "anthropic");
	assert.equal((await stat(out)).mode & 0o777, 0o600);
	await assert.rejects(exportSettings(out, deps(dir), false), /already there/);
});

test("with keys the whole file is encrypted; the wrong passphrase opens nothing, and a changed file is refused", async () => {
	const { dir, secrets } = await source();
	const out = join(await tempDir(), "settings.json");
	await exportSettings(out, deps(dir), true);
	const text = await readFile(out, "utf8");
	for (const secret of secrets) assert.ok(!text.includes(secret));
	const document = JSON.parse(text);
	assert.equal(document.files, undefined);
	assert.equal(document.encrypted.kdf, "scrypt");
	await assert.rejects(openSettings(text, { passphrase: async () => "not the passphrase" }), /does not open this file/);
	const tampered = { ...document, encrypted: { ...document.encrypted, data: Buffer.from("x".repeat(40)).toString("base64") } };
	await assert.rejects(openSettings(JSON.stringify(tampered), { passphrase: async () => PASSPHRASE }), /does not open this file/);
	await assert.rejects(exportSettings(join(await tempDir(), "short.json"), deps(dir, "short"), true), /at least 12 characters/);

	// Into a new computer's empty data folder: everything comes in, 0600.
	const target = await tempDir();
	const bundle = await openSettings(text, { passphrase: async () => PASSPHRASE });
	const result = await importSettings(bundle, deps(target), false);
	assert.ok(result.lines.some((line) => line === "Monitor and its admin token: brought in"));
	assert.equal(JSON.parse(await readFile(join(target, "model-settings.json"), "utf8")).keys.anthropic, secrets[0]);
	assert.equal(JSON.parse(await readFile(join(target, "cloudflare-settings.json"), "utf8")).token, secrets[2]);
	assert.equal((await stat(join(target, "monitor-settings.json"))).mode & 0o777, 0o600);
	for (const line of result.lines) for (const secret of secrets) assert.ok(!line.includes(secret), "no key is printed");
	assert.equal(await stat(join(target, "access.json")).catch(() => null), null);

	const sealed = await encrypt("hello", PASSPHRASE);
	assert.equal(await decrypt(sealed, PASSPHRASE), "hello");
});

test("an import keeps what is here unless asked, merges notes, and stops before writing when a file cannot be read", async () => {
	const { dir } = await source();
	const out = join(await tempDir(), "settings.json");
	await exportSettings(out, deps(dir), false);
	const bundle = await openSettings(await readFile(out, "utf8"), { passphrase: async () => "" });

	const target = await tempDir();
	await makeTree(target, {
		"ui-settings.json": JSON.stringify({ appearance: "today" }),
		"finding-notes.json": JSON.stringify({ "shop\nCVE-2\nx\ny": { status: "fixed", note: "", updatedAt: "2026-11-02T00:00:00Z" } }),
	});
	const kept = await importSettings(bundle, deps(target), false);
	assert.ok(kept.lines.includes("Appearance: kept yours (--replace brings this one in)"));
	assert.equal(JSON.parse(await readFile(join(target, "ui-settings.json"), "utf8")).appearance, "today");
	assert.equal(Object.keys(JSON.parse(await readFile(join(target, "finding-notes.json"), "utf8"))).length, 2);
	await importSettings(bundle, deps(target), true);
	assert.equal(JSON.parse(await readFile(join(target, "ui-settings.json"), "utf8")).appearance, "terminal");

	// A file that is there but cannot be read: nothing at all is written.
	const blocked = await tempDir();
	await writeFile(join(blocked, "due-dates.json"), "{ not json");
	await assert.rejects(importSettings(bundle, deps(blocked), true), /could not be read/);
	assert.equal(await stat(join(blocked, "ui-settings.json")).catch(() => null), null);
	assert.equal(await readFile(join(blocked, "due-dates.json"), "utf8"), "{ not json");
	await chmod(join(blocked, "due-dates.json"), 0o600);
});

test("the command line says what moved and never prints a key", async () => {
	const { dir, secrets } = await source();
	const out = join(await tempDir(), "moved.json");
	const said: string[] = [];
	const io = { say: (text: string) => said.push(text), warn: (text: string) => said.push(text) };
	assert.equal(await settingsCommand("export", [out, "--include-keys"], io, { dataDir: dir, env: { PORCHLIGHT_SETTINGS_PASSPHRASE: PASSPHRASE } }), 0);
	const target = await tempDir();
	assert.equal(await settingsCommand("import", [out, "--data", target], io, { dataDir: dir, env: { PORCHLIGHT_SETTINGS_PASSPHRASE: PASSPHRASE } }), 0);
	for (const line of said) for (const secret of secrets) assert.ok(!line.includes(secret));
	assert.ok(said.some((line) => /keys and tokens, encrypted/.test(line)));
	await assert.rejects(settingsCommand("import", [out, "--data", target], io, { dataDir: dir, env: {} }), /PORCHLIGHT_SETTINGS_PASSPHRASE|terminal/);
});
