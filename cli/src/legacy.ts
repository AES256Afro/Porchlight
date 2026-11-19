/**
 * What was set up before Porchlight had its name keeps working: settings given with the old prefix
 * (a BoxPilot server and a Mac app's app.env still use it), and the folder that holds the report,
 * history and settings.
 */
import { lstat, rename, symlink } from "node:fs/promises";
import { join } from "node:path";

const OLD_PREFIX = "SECURITYX_";
const PREFIX = "PORCHLIGHT_";

/** Copies each old-prefix setting to its current name, unless the current name is already set. */
export function adoptOldSettings(env: NodeJS.ProcessEnv): void {
	for (const [name, value] of Object.entries(env)) {
		if (!name.startsWith(OLD_PREFIX) || value === undefined) continue;
		const current = `${PREFIX}${name.slice(OLD_PREFIX.length)}`;
		if (env[current] === undefined) env[current] = value;
	}
}

/**
 * ~/.porchlight, where Porchlight keeps its data. A folder from before the rename is moved there
 * once, and its old path is left as a link to the new one, so an app built before the rename still
 * finds its settings and its log. Nothing is moved when ~/.porchlight already exists.
 */
export async function dataFolder(home: string): Promise<string> {
	const current = join(home, ".porchlight");
	const old = join(home, ".securityx");
	if (await exists(current)) return current;
	try {
		const info = await lstat(old);
		if (info.isDirectory() && !info.isSymbolicLink()) {
			await rename(old, current);
			await symlink(".porchlight", old).catch(() => {});
		}
	} catch {
		// No old folder: nothing to move.
	}
	return current;
}

async function exists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}
