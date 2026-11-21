import assert from "node:assert/strict";
import { chmod, mkdir, symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { discoverRepos, findRepos } from "../src/repos/discover.ts";
import { makeTree, tempDir } from "./helpers.ts";

test("finds repositories and skips what cannot be one", async () => {
	const root = await tempDir();
	await makeTree(root, {
		"alpha/.git/": "",
		"group/beta/.git/": "",
		"group/worktree/.git": "gitdir: ../beta/.git/worktrees/worktree",
		"alpha/packages/nested/.git/": "", // Inside another repository: its commits are its own, so it is listed too (B30).
		"node_modules/dep/.git/": "",
		".cache/hidden/.git/": "",
		"plain/readme.md": "no repository here",
	});
	await symlink(join(root, "alpha"), join(root, "link-to-alpha"));

	assert.deepEqual(await discoverRepos(root, 3), [
		join(root, "alpha"),
		join(root, "alpha/packages/nested"),
		join(root, "group/beta"),
		join(root, "group/worktree"),
	]);
});

test("names what it passes over that could hold a repository, and nothing else (S59)", async (t) => {
	const root = await tempDir();
	await makeTree(root, {
		"alpha/.git/": "",
		".dotfiles/.git/": "",
		".cache/readme.md": "a hidden folder that is not a repository",
		"vendor/.git/": "",
		"node_modules/dep/readme.md": "",
	});
	await symlink(join(root, "alpha"), join(root, "link-to-alpha"));
	await mkdir(join(root, "private"));
	const { repos, notSearched } = await findRepos(root, 3);
	assert.deepEqual(repos, [join(root, "alpha")]);
	assert.deepEqual(
		notSearched.map((entry) => [entry.path, entry.reason]),
		[
			[join(root, ".dotfiles"), "it is a repository in a hidden folder, which is not searched"],
			[join(root, "link-to-alpha"), "it is a link to a repository, and links are not followed"],
			[join(root, "vendor"), "it is a repository in a folder named vendor, which is not searched"],
		],
	);

	// A folder that cannot be read (how macOS shows Documents and Desktop to a program without access).
	if (process.getuid?.() === 0) return t.skip("root reads every folder");
	await chmod(join(root, "private"), 0o000);
	try {
		const unreadable = await findRepos(root, 3);
		assert.deepEqual(unreadable.notSearched.find((entry) => entry.path === join(root, "private"))?.reason, "it could not be read");
	} finally {
		await chmod(join(root, "private"), 0o700);
	}
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
