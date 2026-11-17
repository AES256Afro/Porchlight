import { readdir } from "node:fs/promises";
import { join } from "node:path";

/** Directories never worth descending into when looking for repositories. */
const SKIP = new Set(["node_modules", "vendor", "Library"]);

/**
 * Git repositories at or under `root`, down to `maxDepth` directory levels.
 * Does not look inside a repository for nested ones, follow symlinks, or
 * enter hidden directories.
 */
export async function discoverRepos(root: string, maxDepth: number): Promise<string[]> {
	const repos: string[] = [];

	async function walk(dir: string, depth: number): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch {
			return; // Unreadable directories are skipped, not fatal.
		}
		// A worktree or submodule has a `.git` file rather than a directory.
		if (entries.some((entry) => entry.name === ".git")) {
			repos.push(dir);
			return;
		}
		if (depth >= maxDepth) return;
		const children = entries.filter(
			(entry) => entry.isDirectory() && !entry.name.startsWith(".") && !SKIP.has(entry.name),
		);
		await Promise.all(children.map((entry) => walk(join(dir, entry.name), depth + 1)));
	}

	await walk(root, 0);
	return repos.sort();
}
