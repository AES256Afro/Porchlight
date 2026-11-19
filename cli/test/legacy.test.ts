import assert from "node:assert/strict";
import { lstat, readFile, readlink, realpath } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { adoptOldSettings, dataFolder } from "../src/legacy.ts";
import { makeTree, tempDir } from "./helpers.ts";

test("settings under the earlier prefix still count, and never override the current name", () => {
	const env: NodeJS.ProcessEnv = { SECURITYX_UI_KEY: "old-key", SECURITYX_MONITOR_URL: "https://old.example", PORCHLIGHT_MONITOR_URL: "https://new.example", HOME: "/home/x" };
	adoptOldSettings(env);
	assert.equal(env.PORCHLIGHT_UI_KEY, "old-key");
	assert.equal(env.PORCHLIGHT_MONITOR_URL, "https://new.example");
	assert.equal(env.HOME, "/home/x");
});

test("the data folder moves to ~/.porchlight once, and the old path becomes a link to it", async () => {
	const home = await tempDir();
	await makeTree(home, { ".securityx/repo-scan.json": "{}", ".securityx/app.env": "SECURITYX_ROOT=/x\n" });
	const folder = await dataFolder(home);
	assert.equal(folder, join(home, ".porchlight"));
	assert.equal(await readFile(join(folder, "repo-scan.json"), "utf8"), "{}");
	assert.ok((await lstat(join(home, ".securityx"))).isSymbolicLink());
	assert.equal(await readlink(join(home, ".securityx")), ".porchlight");
	// Through the link, an app built before the rename still finds its settings.
	assert.equal(await realpath(join(home, ".securityx", "app.env")), await realpath(join(folder, "app.env")));
	// Once moved, nothing moves again.
	assert.equal(await dataFolder(home), folder);
});

test("an existing ~/.porchlight is kept, and the old folder is left alone", async () => {
	const home = await tempDir();
	await makeTree(home, { ".porchlight/repo-scan.json": "new", ".securityx/repo-scan.json": "old" });
	assert.equal(await dataFolder(home), join(home, ".porchlight"));
	assert.equal(await readFile(join(home, ".porchlight", "repo-scan.json"), "utf8"), "new");
	assert.ok((await lstat(join(home, ".securityx"))).isDirectory());
	// With neither folder, nothing is made until something is saved.
	const empty = await tempDir();
	assert.equal(await dataFolder(empty), join(empty, ".porchlight"));
	await assert.rejects(lstat(join(empty, ".porchlight")));
});
