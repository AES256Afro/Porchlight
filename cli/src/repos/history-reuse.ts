/**
 * Reusing an unchanged repository's history scan (OP-1, the safe part of M6.9).
 *
 * Reading every commit is most of a scan, and a scheduled scan reads the same commits day after day.
 * When nothing that decides what gitleaks finds in a repository's history has changed, the findings of
 * the last full reading are used again, and the repository's result says so (`historyReusedFrom`).
 *
 * What decides it, all in the key: Porchlight's own scanning code and rules, gitleaks' version, the
 * rules it is given, what the scan was asked to look at, the repository's .gitleaksignore, and the
 * history itself: every ref and the object it names (replace refs too, though they are never read), each
 * worktree's HEAD, the shallow boundary and whether it is a partial clone. A commit is named by the hash
 * of its content, so the same refs name the same history; a rewrite, a new commit, a new tag, a new rule
 * or a new gitleaks changes the key, and the history is read again. So does a week passing.
 *
 * Only the reach where history is all gitleaks reads (every commit, no private data, no files git does
 * not track) is reused: the other reaches compare history with the files as they are now, which change
 * without a commit. Only a reading that succeeded is kept, with its "Not covered" lines, and only when the
 * key was the same after the reading as before it, so a commit made while it ran is never kept under the
 * older key. What is kept is what the report holds (invariant 3: no value, match, author or email), 0600
 * in the data folder, one file a repository, named by a hash of its path.
 */
import { createHash } from "node:crypto";
import { lstat, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { GIT_SAFE_ARGS } from "../github/github.ts";
import { readPrivateJson, writePrivateJson } from "../private-files.ts";
import type { Runner } from "./exec.ts";
import { gitReadEnv } from "./git-copy.ts";
import type { Finding, NotCovered } from "./types.ts";

/** Where kept readings go, and the time (tests set it). */
export interface HistoryReuse {
	dir: string;
	now?: () => Date;
}

/** A reading older than this is not reused: the history is read in full again. */
export const FULL_READ_EVERY_MS = 7 * 24 * 60 * 60 * 1000;

/** The largest .gitleaksignore or shallow file looked at; a larger one means no reuse. */
const MAX_LOOKED_AT = 4 * 1024 * 1024;

interface Kept {
	key: string;
	scannedAt: string;
	findings: Finding[];
	notCovered: NotCovered[];
}

let codeStamp: Promise<string> | null = null;

/** A hash of Porchlight's version and its scanning code and rules, read once. */
function porchlightCode(): Promise<string> {
	codeStamp ??= (async () => {
		const hash = createHash("sha256");
		hash.update(await readFile(new URL("../../package.json", import.meta.url)).catch(() => Buffer.from("no package.json")));
		const here = import.meta.dirname;
		for (const name of (await readdir(here)).filter((file) => /\.(ts|toml)$/.test(file)).sort()) hash.update(`\0${name}\0`).update(await readFile(join(here, name)));
		hash.update(await readFile(join(here, "../github/github.ts")));
		return hash.digest("hex");
	})();
	return codeStamp;
}

/** A file's content as a hash, "none" when there is none, or null when it is not a plain file of a size worth reading. */
async function fileHash(path: string): Promise<string | null> {
	const info = await lstat(path).catch((err: NodeJS.ErrnoException) => (err.code === "ENOENT" || err.code === "ENOTDIR" ? "none" : null));
	if (info === "none") return "none";
	if (info === null || !info.isFile() || info.size > MAX_LOOKED_AT) return null;
	const content = await readFile(path).catch(() => null);
	return content ? createHash("sha256").update(content).digest("hex") : null;
}

/**
 * The key of a repository's history scan as things are now, or null when it cannot be worked out (then
 * nothing is reused). It runs only git commands that list (refs, worktrees, two settings), as the copy of
 * the history does, and gitleaks' `version`.
 */
export async function historyKey(repo: string, run: Runner, scope: unknown, config: string): Promise<string | null> {
	const git = async (args: string[]) => {
		const answer = await run("git", [...GIT_SAFE_ARGS, "-C", repo, ...args], { env: gitReadEnv() });
		return answer;
	};
	try {
		const parts: string[] = [await porchlightCode(), createHash("sha256").update(config).digest("hex"), JSON.stringify(scope)];
		const gitleaks = await run("gitleaks", ["version"]);
		if (gitleaks.code !== 0 || gitleaks.stdout.trim() === "") return null;
		parts.push(gitleaks.stdout.trim());
		const ignore = await fileHash(join(repo, ".gitleaksignore"));
		if (ignore === null) return null;
		parts.push(ignore);
		const partial = await git(["config", "--get-regexp", "^(extensions\\.partialclone|remote\\..*\\.promisor)$"]);
		parts.push(`${partial.code}\n${partial.stdout}`);
		const refs = await git(["for-each-ref", "--format=%(objectname) %(refname)"]);
		const worktrees = await git(["worktree", "list", "--porcelain"]);
		const common = await git(["rev-parse", "--path-format=absolute", "--git-common-dir"]);
		if (refs.code !== 0 || worktrees.code !== 0 || common.code !== 0 || common.stdout.trim() === "") return null;
		parts.push(refs.stdout, worktrees.stdout.split("\n").filter((line) => line.startsWith("HEAD ")).join("\n"));
		const shallow = await fileHash(join(common.stdout.trim(), "shallow"));
		if (shallow === null) return null;
		parts.push(shallow);
		return createHash("sha256").update(parts.join("\0")).digest("hex");
	} catch {
		return null;
	}
}

function keptPath(reuse: HistoryReuse, repo: string): string {
	return join(reuse.dir, `${createHash("sha256").update(resolve(repo)).digest("hex").slice(0, 32)}.json`);
}

/** The kept reading for this key, when there is one less than a week old. */
export async function keptHistory(reuse: HistoryReuse, repo: string, key: string): Promise<Kept | null> {
	const read = await readPrivateJson(keptPath(reuse, repo)).catch(() => null);
	if (read?.state !== "read") return null;
	const kept = read.value as Partial<Kept> | null;
	if (!kept || kept.key !== key || typeof kept.scannedAt !== "string" || !Array.isArray(kept.findings) || !Array.isArray(kept.notCovered)) return null;
	const age = (reuse.now ?? (() => new Date()))().getTime() - new Date(kept.scannedAt).getTime();
	if (!(age >= 0 && age < FULL_READ_EVERY_MS)) return null;
	return kept as Kept;
}

/** Keeps a reading that succeeded, under the key it was read with. */
export async function keepHistory(reuse: HistoryReuse, repo: string, key: string, result: { findings: Finding[]; notCovered: NotCovered[] }): Promise<void> {
	const kept: Kept = { key, scannedAt: (reuse.now ?? (() => new Date()))().toISOString(), findings: result.findings, notCovered: result.notCovered };
	await writePrivateJson(keptPath(reuse, repo), kept);
}
