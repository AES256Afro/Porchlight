import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

/** Directories never worth descending into when looking for repositories. */
const SKIP = new Set(["node_modules", "vendor", "Library"]);

/** A folder the search passed over, and why: said under "Not covered", never left out silently (S59). */
export interface NotSearched {
	path: string;
	reason: string;
}

/**
 * Git repositories at or under `root`, down to `maxDepth` directory levels, and the folders the
 * search passed over that could hold one. A repository inside another (nested, or a submodule's
 * checkout) is listed too: its commits are its own, and the outer repository's scan never reads them
 * (B30). Symbolic links are not followed, and hidden, `node_modules`, `vendor` and `Library` folders
 * are not entered; one of those that is itself a repository is named, as is a folder that could not
 * be read (macOS's privacy controls show Documents and Desktop this way).
 */
export async function findRepos(root: string, maxDepth: number): Promise<{ repos: string[]; notSearched: NotSearched[] }> {
	const repos: string[] = [];
	const notSearched: NotSearched[] = [];
	const holdsRepo = (dir: string) => stat(join(dir, ".git")).then(
		() => true,
		() => false,
	);

	async function walk(dir: string, depth: number): Promise<void> {
		let entries;
		try {
			entries = await readdir(dir, { withFileTypes: true });
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			// A folder that is not there has nothing to miss; one that could not be read may.
			if (code !== "ENOENT" && code !== "ENOTDIR" && dir !== root) notSearched.push({ path: dir, reason: "it could not be read" });
			return;
		}
		// A worktree or submodule has a `.git` file rather than a directory.
		if (entries.some((entry) => entry.name === ".git")) repos.push(dir);
		if (depth >= maxDepth) return;
		await Promise.all(
			entries.map(async (entry) => {
				if (entry.name === ".git") return;
				const path = join(dir, entry.name);
				if (entry.isSymbolicLink()) {
					if (await holdsRepo(path)) notSearched.push({ path, reason: "it is a link to a repository, and links are not followed" });
					return;
				}
				if (!entry.isDirectory()) return;
				if (entry.name.startsWith(".") || SKIP.has(entry.name)) {
					if (await holdsRepo(path)) notSearched.push({ path, reason: entry.name.startsWith(".") ? "it is a repository in a hidden folder, which is not searched" : `it is a repository in a folder named ${entry.name}, which is not searched` });
					return;
				}
				await walk(path, depth + 1);
			}),
		);
	}

	await walk(root, 0);
	return { repos: repos.sort(), notSearched: notSearched.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) };
}

/** The repositories `findRepos` finds, without what it passed over. */
export async function discoverRepos(root: string, maxDepth: number): Promise<string[]> {
	return (await findRepos(root, maxDepth)).repos;
}
