/**
 * Porchlight's temporary folders. Some hold copies of a repository's files or history, keys included, so
 * each is private (mkdtemp makes it 0700), removed when the work that made it ends, and removed on
 * SIGTERM or SIGINT as well: a stopped scan, a quit Mac app or `docker stop` must not leave them behind
 * (S33). A crash or SIGKILL still can, so sweepStaleTemp removes old ones at the next start.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The kinds of folder Porchlight makes, as they are named: `porchlight-<kind>-XXXXXX`. */
export type TempKind = "files" | "committed" | "copy" | "host" | "run" | "rules";
const KINDS: readonly TempKind[] = ["files", "committed", "copy", "host", "run", "rules"];

const live = new Set<string>();
let handled = false;

function onStop(): void {
	if (handled) return;
	handled = true;
	for (const signal of ["SIGINT", "SIGTERM"] as const) {
		process.once(signal, () => {
			for (const dir of live) rmSync(dir, { recursive: true, force: true });
			// Then stop as the signal would have stopped the process: this listener was the only one, and
			// `once` has removed it.
			process.kill(process.pid, signal);
		});
	}
	process.once("exit", () => {
		for (const dir of live) rmSync(dir, { recursive: true, force: true });
	});
}

/** A new private folder of this kind, removed on stop and exit until removeTemp is called. */
export async function makeTemp(kind: TempKind): Promise<string> {
	onStop();
	const dir = await mkdtemp(join(tmpdir(), `porchlight-${kind}-`));
	live.add(dir);
	return dir;
}

/** As makeTemp, for the few places that must make one synchronously. */
export function makeTempSync(kind: TempKind): string {
	onStop();
	const dir = mkdtempSync(join(tmpdir(), `porchlight-${kind}-`));
	live.add(dir);
	return dir;
}

export async function removeTemp(dir: string): Promise<void> {
	live.delete(dir);
	await rm(dir, { recursive: true, force: true });
}

/** How old a folder a crash left must be before another start removes it: longer than any scan runs. */
export const STALE_AFTER_MS = 6 * 60 * 60_000;

/**
 * Removes Porchlight's temporary folders that a crash or SIGKILL left behind, older than STALE_AFTER_MS,
 * and says how many. Only names Porchlight makes are touched, and none this process is using.
 */
export async function sweepStaleTemp(now = Date.now(), base = tmpdir()): Promise<number> {
	const pattern = new RegExp(`^porchlight-(?:${KINDS.join("|")})-[A-Za-z0-9]{6}$`);
	let removed = 0;
	for (const name of await readdir(base).catch(() => [])) {
		if (!pattern.test(name)) continue;
		const dir = join(base, name);
		if (live.has(dir)) continue;
		const info = await stat(dir).catch(() => null);
		if (!info?.isDirectory() || now - info.mtimeMs < STALE_AFTER_MS) continue;
		await rm(dir, { recursive: true, force: true }).catch(() => undefined);
		removed++;
	}
	return removed;
}
