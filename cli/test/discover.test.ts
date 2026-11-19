import assert from "node:assert/strict";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { discoverRepos } from "../src/repos/discover.ts";
import { makeTree, tempDir } from "./helpers.ts";

test("finds repositories and skips what cannot be one", async () => {
	const root = await tempDir();
	await makeTree(root, {
		"alpha/.git/": "",
		"group/beta/.git/": "",
		"group/worktree/.git": "gitdir: ../beta/.git/worktrees/worktree",
		"alpha/packages/nested/.git/": "", // Inside another repository: not listed separately.
		"node_modules/dep/.git/": "",
		".cache/hidden/.git/": "",
		"plain/readme.md": "no repository here",
	});
	await symlink(join(root, "alpha"), join(root, "link-to-alpha"));

	assert.deepEqual(await discoverRepos(root, 3), [
		join(root, "alpha"),
		join(root, "group/beta"),
		join(root, "group/worktree"),
	]);
});

test("stops at the depth limit", async () => {
	const root = await tempDir();
	await makeTree(root, { "one/.git/": "", "a/two/.git/": "", "a/b/three/.git/": "" });

	assert.deepEqual(await discoverRepos(root, 1), [join(root, "one")]);
	assert.deepEqual(await discoverRepos(root, 2), [join(root, "a/two"), join(root, "one")]);
});

test("treats the root itself as a repository when it is one", async () => {
	const root = await tempDir();
	await makeTree(root, { ".git/": "", "sub/.git/": "" });

	assert.deepEqual(await discoverRepos(root, 0), [root]);
});

test("returns nothing for a missing directory", async () => {
	assert.deepEqual(await discoverRepos("/nonexistent/porchlight", 3), []);
});
