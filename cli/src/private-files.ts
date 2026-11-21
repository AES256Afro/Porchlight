/**
 * Files Porchlight keeps for its owner: settings, keys, reports, history and notes.
 *
 * - Written readable by the owner alone (0600, in a 0700 folder), through a new temporary file with a
 *   name no other write shares, renamed over the old one: a crash leaves the old copy whole, and two
 *   writes at once never mix (B21).
 * - Changed one at a time per file (`updatePrivateJson`): a read, a change and a write are never
 *   interleaved with another change to the same file, so none is lost.
 * - Read as one of three answers (`readPrivateJson`): the file is not there, it was read, or it could
 *   not be read. The last says nothing about what the file holds, so it is never treated as empty and
 *   never written over (invariant 5, B25).
 */
import { randomBytes } from "node:crypto";
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** Written readable by the owner alone, through a temporary file so a crash leaves the old copy. */
export async function writePrivate(path: string, text: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
	try {
		await writeFile(temporary, text, { mode: 0o600, flag: "wx" });
		await chmod(temporary, 0o600);
		await rename(temporary, path);
	} catch (err) {
		await rm(temporary, { force: true });
		throw err;
	}
}

export async function writePrivateJson(path: string, value: unknown): Promise<void> {
	await writePrivate(path, `${JSON.stringify(value, null, "\t")}\n`);
}

/** What reading a kept file found. */
export type PrivateRead = { state: "missing" } | { state: "read"; value: unknown } | { state: "unreadable"; reason: string };

/** Reads a kept JSON file: missing (nothing was saved yet), its value, or why it could not be read. */
export async function readPrivateJson(path: string): Promise<PrivateRead> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return { state: "missing" };
		return { state: "unreadable", reason: (err as NodeJS.ErrnoException).code ?? (err instanceof Error ? err.message : String(err)) };
	}
	try {
		return { state: "read", value: JSON.parse(text) };
	} catch {
		return { state: "unreadable", reason: "it is not valid JSON" };
	}
}

/** A kept file that is there but could not be read: nothing is written over it. */
export class UnreadableFileError extends Error {
	constructor(what: string, reason: string) {
		super(`${what} could not be read (${reason}), so nothing was changed. Move the file aside to start it afresh.`);
		this.name = "UnreadableFileError";
	}
}

const queues = new Map<string, Promise<unknown>>();

/** Runs `task` after every earlier task for the same file has finished, so they never interleave. */
export function oneAtATime<T>(path: string, task: () => Promise<T>): Promise<T> {
	const previous = queues.get(path) ?? Promise.resolve();
	const next = previous.then(task, task);
	const settled = next.then(
		() => undefined,
		() => undefined,
	);
	queues.set(path, settled);
	void settled.then(() => {
		if (queues.get(path) === settled) queues.delete(path);
	});
	return next;
}

/**
 * Changes a kept JSON file, one change at a time per file. `change` gets the current value (undefined
 * when there is no file yet) and returns the new one, or `undefined` to leave the file as it is. A file
 * that is there but cannot be read is not written over: this throws UnreadableFileError instead.
 */
export function updatePrivateJson<T>(path: string, what: string, change: (current: unknown) => T | Promise<T>): Promise<T> {
	return oneAtATime(path, async () => {
		const read = await readPrivateJson(path);
		if (read.state === "unreadable") throw new UnreadableFileError(what, read.reason);
		const value = await change(read.state === "read" ? read.value : undefined);
		if (value !== undefined) await writePrivateJson(path, value);
		return value;
	});
}
