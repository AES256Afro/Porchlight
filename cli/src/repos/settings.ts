import { access, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

/** Folders that hold other people's code or build output, where a repository's own settings do not live. */
const SKIP_DIRS = new Set([".git", "node_modules", "vendor", "target", "dist", "build", ".venv", "venv", "__pycache__"]);
const MAX_DIRS = 5_000;

/**
 * Files in a repository that tell a scanner to leave findings out, as paths
 * relative to the repository. Porchlight honours them, since an owner uses them
 * to silence a false match, but the report names them so that nothing is
 * left out without a trace. A repository's .gitleaks.toml is listed too: it is
 * ignored (see GITLEAKS_CONFIG), and the report says so.
 *
 * Only the file system is read; git is never run here, so the repository's
 * .git/config has no say.
 */
export async function scannerSettingFiles(repo: string): Promise<string[]> {
	const found: string[] = [];
	for (const name of [".gitleaks.toml", ".gitleaksignore"]) {
		if (await exists(join(repo, name))) found.push(name);
	}
	// osv-scanner reads an osv-scanner.toml next to each lockfile, so look in every folder.
	const queue = [repo];
	for (let visited = 0; queue.length > 0 && visited < MAX_DIRS; visited++) {
		const dir = queue.shift()!;
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			// Symbolic links are neither followed nor reported: they may point outside the repository.
			if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) queue.push(join(dir, entry.name));
			else if (entry.isFile() && entry.name === "osv-scanner.toml") found.push(relative(repo, join(dir, entry.name)));
		}
	}
	return found;
}

async function exists(path: string): Promise<boolean> {
	return access(path).then(
		() => true,
		() => false,
	);
}
