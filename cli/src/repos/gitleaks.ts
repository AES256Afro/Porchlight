import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { GIT_SAFE_ARGS } from "../github/github.ts";
import { firstLine, type Runner } from "./exec.ts";
import { triageSecret } from "./triage.ts";
import type { Finding, HistoryReach, SecretSource } from "./types.ts";

/**
 * gitleaks' built-in rules, shipped with Porchlight. Passing it with --config
 * means a scanned repository's own .gitleaks.toml is never loaded, so a
 * repository cannot switch detection off.
 */
export const GITLEAKS_CONFIG = fileURLToPath(new URL("./gitleaks.toml", import.meta.url));

/**
 * What gitleaks hands to `git log`. A scanned repository is hostile input, and
 * its .git/config can name programs for git to run while it prints diffs: a
 * textconv driver, an external diff, a signature checker. These options switch
 * all three off. `--full-history --all` are gitleaks' own defaults, which a
 * custom --log-opts replaces.
 */
export const GIT_LOG_OPTIONS = "--full-history --all --no-textconv --no-ext-diff --no-show-signature";

/** Where a secrets scan looks: how much history, and whether files git does not track are read too. */
export interface SecretScope {
	history: HistoryReach;
	localFiles: boolean;
}

/** Every commit, and nothing git does not track: what a scan looked at before there were choices. */
export const FULL_HISTORY: SecretScope = { history: "all", localFiles: false };

/**
 * How git is run to read a repository's index and committed files: in the same environment
 * gitleaks' own git runs in, so the system's settings still apply (the container marks /repos as
 * safe there), with GIT_SAFE_ARGS on top. These commands convert no file, run no hook and take no lock.
 */
const READ_ENV = { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };

/** The largest tracked file the scan of the current files reads; report.ts says it in words. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** gitleaks' options shared by every way it is run. `--redact` is not optional (invariant 3). */
function common(ignoreFrom: string): string[] {
	return [
		"--config",
		GITLEAKS_CONFIG,
		// Read .gitleaksignore from the repository only, never from the folder Porchlight runs in.
		"--gitleaks-ignore-path",
		ignoreFrom,
		"--report-format",
		"json",
		"--report-path",
		"-",
		"--redact",
		"--no-banner",
		"--no-color",
		"--log-level",
		"error",
		"--exit-code",
		"0",
	];
}

/**
 * Scans a repository's whole commit history for secrets. `--redact` is not
 * optional: the secret values must never reach this process's output, so a
 * report can be shared or stored without becoming a leak itself.
 */
export async function runGitleaks(repo: string, run: Runner): Promise<Finding[]> {
	return parseGitleaks(JSON.stringify(await historyRows(repo, run, "all")));
}

/**
 * Scans a repository for secrets as far as `scope` reaches:
 *
 * - history: every commit on every branch, the last so many, or none;
 * - the files git tracks, as they are now, whenever history is not read in full, so a secret still
 *   in a file is found however long ago it was committed;
 * - with `localFiles`, the files git does not track (an .env, say), reported as on this computer only.
 *
 * The same secret found twice is reported once, from history first.
 */
export async function scanSecrets(repo: string, run: Runner, scope: SecretScope = FULL_HISTORY): Promise<{ findings: Finding[]; unreadFiles: number }> {
	const rows: Located[] = [];
	if (scope.history !== "none") rows.push(...(await historyRows(repo, run, scope.history)).map((row) => ({ row, source: "history" as const })));
	if (scope.history === "all" && !scope.localFiles) return { findings: findingsOf(rows), unreadFiles: 0 };

	const tracked = await trackedFiles(repo, run);
	let unreadFiles = 0;
	if (scope.history !== "all") {
		const copy = await copyTracked(repo, tracked);
		try {
			unreadFiles = copy.unread;
			const found = await folderRows(copy.dir, repo, run);
			// A key in a file changed since it was committed may be in that change alone: then it is on this computer only.
			const committed = await committedSecrets(repo, run, tracked, [...new Set(found.map(fileOf).filter((file) => copy.changed.has(file)))]);
			for (const row of found) {
				const file = fileOf(row);
				const uncommitted = committed.read.has(file) && !committed.ids.has(secretId(row));
				rows.push(uncommitted ? { row, source: "local", changed: true } : { row, source: "files", changed: copy.changed.has(file) });
			}
		} finally {
			await rm(copy.dir, { recursive: true, force: true });
		}
	}
	if (scope.localFiles) {
		// gitleaks reads the whole working tree. A file git does not track is on this computer only. A
		// tracked one was read above when history was not read in full; otherwise a key in it counts as
		// on this computer only when the file has changed since it was committed and no commit holds
		// that key in that file.
		const committed = new Set(rows.filter((located) => located.source === "history").map((located) => secretId(located.row)));
		const top = await realpath(repo);
		for (const row of await folderRows(repo, repo, run)) {
			const file = fileOf(row);
			const id = tracked.get(file);
			if (id === undefined) rows.push({ row, source: "local" });
			else if (scope.history === "all" && !committed.has(secretId(row))) {
				const content = await readTracked(top, file);
				if (Buffer.isBuffer(content) && (id === "" || blobId(content, id.length) !== id)) rows.push({ row, source: "local", changed: true });
			}
		}
	}
	return { findings: findingsOf(rows), unreadFiles };
}

/**
 * The secrets in the committed versions of these files, by `secretId`, and which files could be read
 * that way. git prints a committed file with `cat-file blob`, which applies no filter and runs
 * nothing a repository's settings name. A file that cannot be read is left out of `read`, so its
 * keys are reported as committed: the more careful reading.
 */
async function committedSecrets(repo: string, run: Runner, tracked: Map<string, string>, files: string[]): Promise<{ ids: Set<string>; read: Set<string> }> {
	const ids = new Set<string>();
	const read = new Set<string>();
	if (files.length === 0) return { ids, read };
	const dir = await mkdtemp(join(tmpdir(), "porchlight-committed-"));
	try {
		for (const file of files) {
			const id = tracked.get(file);
			// In a merge conflict there is no one committed version to compare with.
			if (!id) continue;
			const { code, stdout } = await run("git", [...GIT_SAFE_ARGS, "-C", repo, "cat-file", "blob", id], { env: READ_ENV });
			if (code !== 0) continue;
			const target = join(dir, ...file.split("/"));
			await mkdir(dirname(target), { recursive: true, mode: 0o700 });
			await writeFile(target, stdout, { mode: 0o600, flag: "wx" });
			read.add(file);
		}
		if (read.size > 0) for (const row of await folderRows(dir, repo, run)) ids.add(secretId(row));
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
	return { ids, read };
}

/** A secret by rule, file and entropy: the same in every commit that carries it, wherever its line moved. */
function secretId(row: unknown): string {
	const { RuleID, Entropy } = (row ?? {}) as Record<string, unknown>;
	return `${String(RuleID)}\n${fileOf(row)}\n${typeof Entropy === "number" ? Entropy : ""}`;
}

/** gitleaks over the history `git log` shows it, limited to the latest `reach` commits when that is a number. */
async function historyRows(repo: string, run: Runner, reach: "all" | number): Promise<unknown[]> {
	const logOptions = reach === "all" ? GIT_LOG_OPTIONS : `--max-count=${reach} ${GIT_LOG_OPTIONS}`;
	const { code, stdout, stderr } = await run("gitleaks", ["git", ...common(repo), `--log-opts=${logOptions}`, repo]);
	if (code !== 0) throw new Error(errorLine(stderr) || `gitleaks exited with code ${code}`);
	// When git cannot read the repository (another user's, a broken worktree, a
	// corrupt .git), gitleaks logs the error, reports nothing and still exits 0.
	// At --log-level error a good run writes nothing to stderr, so anything
	// there means the history was not read: a failure, never a clean result.
	if (stderr.trim() !== "") throw new Error(errorLine(stderr));
	return rowsOf(stdout);
}

/**
 * gitleaks over a folder, run from inside it so the files it names are relative to it (and match a
 * repository's .gitleaksignore). It does not follow symbolic links, and skips .git.
 */
async function folderRows(folder: string, repo: string, run: Runner): Promise<unknown[]> {
	const { code, stdout, stderr } = await run("gitleaks", ["dir", ...common(repo), "."], { cwd: folder });
	if (code !== 0) throw new Error(errorLine(stderr) || `gitleaks exited with code ${code}`);
	if (stderr.trim() !== "") throw new Error(errorLine(stderr));
	return rowsOf(stdout);
}

function rowsOf(output: string): unknown[] {
	const rows: unknown = JSON.parse(output.trim() || "[]");
	if (!Array.isArray(rows)) throw new Error("gitleaks: unexpected report shape");
	return rows;
}

/** The file a gitleaks row names, as a path inside the repository. */
function fileOf(row: unknown): string {
	const file = (row as { File?: unknown } | null)?.File;
	return typeof file === "string" ? file.replace(/^\.\//, "") : "";
}

/**
 * The regular files git tracks, by path, with the id of each as committed. Read from git's index
 * alone with `ls-files --stage`: nothing in the working tree is compared or converted, so no filter
 * or other program a repository's settings name can run (invariant 14).
 */
async function trackedFiles(repo: string, run: Runner): Promise<Map<string, string>> {
	const { code, stdout, stderr } = await run("git", [...GIT_SAFE_ARGS, "-C", repo, "ls-files", "--stage", "-z"], { env: READ_ENV });
	if (code !== 0) throw new Error(firstLine(stderr) || `git exited with code ${code}`);
	const files = new Map<string, string>();
	for (const entry of stdout.split("\0")) {
		const match = /^(\d{6}) ([0-9a-f]{40,64}) (\d)\t(.+)$/s.exec(entry);
		if (!match) continue;
		const [, mode, id, stage, path] = match as unknown as [string, string, string, string, string];
		// Symbolic links and submodules are not files to read; a file in a merge conflict has no one committed version.
		if (mode !== "100644" && mode !== "100755" && mode !== "100664") continue;
		files.set(path, stage === "0" ? id : "");
	}
	return files;
}

/**
 * Copies the tracked files, as they are now, into a private temporary folder for gitleaks to read,
 * and notes which differ from what was committed (by git's own id for the content, worked out here).
 */
async function copyTracked(repo: string, tracked: Map<string, string>): Promise<{ dir: string; changed: Set<string>; unread: number }> {
	const dir = await mkdtemp(join(tmpdir(), "porchlight-files-"));
	const top = await realpath(repo);
	const changed = new Set<string>();
	let unread = 0;
	const queue = [...tracked.entries()];
	const worker = async () => {
		for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
			const [path, committed] = next;
			const content = await readTracked(top, path);
			if (content === "gone") continue;
			if (content === "unread") {
				unread++;
				continue;
			}
			if (committed === "" || blobId(content, committed.length) !== committed) changed.add(path);
			const target = join(dir, ...path.split("/"));
			await mkdir(dirname(target), { recursive: true, mode: 0o700 });
			await writeFile(target, content, { mode: 0o600, flag: "wx" });
		}
	};
	try {
		await Promise.all(Array.from({ length: 8 }, worker));
	} catch (err) {
		await rm(dir, { recursive: true, force: true });
		throw err;
	}
	return { dir, changed, unread };
}

/**
 * A tracked file as it is now. It is read only if it and every folder above it are inside the
 * repository (no symbolic link is followed out of it) and it is no larger than MAX_FILE_BYTES.
 * "gone": deleted since it was committed, or a symbolic link, so not among the files to read.
 */
async function readTracked(top: string, path: string): Promise<Buffer | "gone" | "unread"> {
	const parts = path.split("/");
	if (parts.some((part) => part === "" || part === "." || part === ".." || part.toLowerCase() === ".git")) return "unread";
	const source = join(top, ...parts);
	const parent = await realpath(dirname(source)).catch(() => null);
	if (parent === null) return "gone";
	if (parent !== top && !parent.startsWith(top + sep)) return "unread";
	const stats = await lstat(source).catch(() => null);
	if (stats === null || stats.isSymbolicLink()) return "gone";
	if (!stats.isFile() || stats.size > MAX_FILE_BYTES) return "unread";
	return (await readFile(source, { flag: constants.O_RDONLY | constants.O_NOFOLLOW }).catch(() => null)) ?? "unread";
}

/** git's id for a file's content: SHA-1, or SHA-256 in a repository that uses it (a 64-digit id). */
function blobId(content: Buffer, length: number): string {
	return createHash(length === 64 ? "sha256" : "sha1")
		.update(`blob ${content.length}\0`)
		.update(content)
		.digest("hex");
}

/** gitleaks' first error line without its timestamp and level, e.g. "[git] fatal: detected dubious ownership…". */
function errorLine(stderr: string): string {
	return firstLine(stderr.replace(/^.*?\bERR\s+/gm, ""));
}

export function parseGitleaks(output: string): Finding[] {
	return findingsOf(rowsOf(output).map((row) => ({ row, source: "history" as const })));
}

/** A gitleaks row and where it was found: in history, in the files as they are now (`changed` since committed), or in a file git does not track. */
interface Located {
	row: unknown;
	source: SecretSource;
	changed?: boolean;
}

/** What a finding's detail says about where it is, beside a commit for one found in history. */
const PLACES = {
	files: "current files",
	changed: "current files, changed since the last commit",
	local: "on this computer only, not in git",
	uncommitted: "on this computer only, an uncommitted change",
} as const;

function findingsOf(located: Located[]): Finding[] {
	// The same secret is reported again by each commit that rewrote its line; keep the first.
	// Which secret a match is cannot be told by its value (gitleaks runs with --redact), but its
	// entropy is a property of the value: equal for the same secret, all but never for two others.
	// It is used only to tell matches apart here and is never kept.
	const bySecret = new Map<string, Finding>();
	const details = new Set<string>();
	for (const { row, source, changed } of located) {
		if (typeof row !== "object" || row === null) continue;
		const { RuleID, Description, StartLine, StartColumn, Entropy, Commit, Date: date } = row as Record<string, unknown>;
		const File = fileOf(row);
		if (typeof RuleID !== "string" || File === "") continue;
		const location = typeof StartLine === "number" ? `${File}:${StartLine}` : File;
		const key = `${RuleID}\n${location}\n${typeof Entropy === "number" ? Entropy : ""}`;
		if (bySecret.has(key)) continue;
		let detail: string;
		if (source === "history") {
			const commit = typeof Commit === "string" && Commit ? `commit ${Commit.slice(0, 8)}` : "working tree";
			const day = typeof date === "string" ? ` on ${date.slice(0, 10)}` : "";
			detail = `${commit}${day}`;
		} else {
			detail = source === "local" ? (changed ? PLACES.uncommitted : PLACES.local) : changed ? PLACES.changed : PLACES.files;
		}
		// Two secrets on one line in one commit would otherwise read the same, and share one note and status.
		const place = `${RuleID}\n${location}\n`;
		if (details.has(place + detail)) {
			let extra = typeof StartColumn === "number" ? `, column ${StartColumn}` : ", another match";
			for (let n = 2; details.has(place + detail + extra); n++) extra = `, match ${n}`;
			detail += extra;
		}
		details.add(place + detail);
		bySecret.set(key, {
			tool: "gitleaks",
			kind: "secret",
			ruleId: RuleID,
			title: typeof Description === "string" ? firstSentence(Description) : RuleID,
			location,
			detail,
			source,
			// A committed credential is exposed and must be rotated: high, unless
			// triage finds reasons to doubt that this match is a live one.
			...triageSecret(RuleID, File, source === "local"),
		});
	}
	return [...bySecret.values()];
}

function firstSentence(text: string): string {
	const end = text.indexOf(", ");
	return end > 0 ? text.slice(0, end) : text;
}
