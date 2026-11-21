import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { GIT_SAFE_ARGS } from "../github/github.ts";
import { firstLine, type Runner } from "./exec.ts";
import { copyHistory, gitReadEnv, type HistoryCopy } from "./git-copy.ts";
import { hasGpsPosition, isPrivateRule, namedFindings, PHOTO_TYPES, photoFinding, placeOf, privateFindings, type Match, type NamedFile } from "./private.ts";
import { gitleaksConfig } from "./rules.ts";
import { makeTemp, removeTemp } from "./temp.ts";
import { triageSecret } from "./triage.ts";
import type { Finding, HistoryReach, NotCovered, SecretSource } from "./types.ts";

/**
 * What gitleaks hands to `git log`, which reads Porchlight's own copy of the history (git-copy.ts), so
 * none of the repository's settings apply. `--full-history --all` are gitleaks' own defaults, which a
 * custom --log-opts replaces. Programs a config could name (a textconv driver, an external diff, a
 * signature checker) stay off. `--text` reads a file git would take for binary, `--encoding=none` keeps
 * a commit's dates as written whatever encoding it claims, and `--diff-merges=first-parent` shows what a
 * merge brought in, where a conflict's resolution can add a key no other commit holds.
 */
export const GIT_LOG_OPTIONS = "--full-history --all --no-textconv --no-ext-diff --no-show-signature --text --encoding=none --diff-merges=first-parent";


/** Where a secrets scan looks: how much history, and whether files git does not track are read too. */
export interface SecretScope {
	history: HistoryReach;
	localFiles: boolean;
	/** Report secrets (the default). Off when only private data was asked for. */
	secrets?: boolean;
	/** Also look for private data, with Porchlight's own rules in the same gitleaks pass (see private.ts). */
	privateData?: boolean;
}

/** Every commit, and nothing git does not track: what a scan looked at before there were choices. */
export const FULL_HISTORY: SecretScope = { history: "all", localFiles: false };


/** The largest tracked file the scan of the current files reads; report.ts says it in words. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** gitleaks' options shared by every way it is run. `--redact` is not optional (invariant 3). */
function common(ignoreFrom: string, config: string): string[] {
	return [
		"--config",
		config,
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
		// A `gitleaks:allow` comment in a scanned file would hide a match without a trace (invariant 14).
		"--ignore-gitleaks-allow",
	];
}

/**
 * Scans a repository for secrets as far as `scope` reaches:
 *
 * - history: every commit on every branch, the last so many, or none;
 * - the files git tracks, as they are now, whenever history is not read in full, so a secret still
 *   in a file is found however long ago it was committed;
 * - with `localFiles`, the files git does not track (an .env, say), reported as on this computer only.
 *
 * The same secret found twice is reported once, from history first. With `privateData`, gitleaks
 * runs once with Porchlight's private-data rules beside its own, and its matches are split by rule.
 */
export async function scanSecrets(repo: string, run: Runner, scope: SecretScope = FULL_HISTORY): Promise<{ findings: Finding[]; unreadFiles: number; notCovered: NotCovered[] }> {
	const copy = scope.history === "none" ? null : await copyHistory(repo, run);
	try {
		return await scanWith(repo, copy, run, scope);
	} finally {
		if (copy) await removeTemp(copy.dir);
	}
}

async function scanWith(repo: string, copy: HistoryCopy | null, run: Runner, scope: SecretScope): Promise<{ findings: Finding[]; unreadFiles: number; notCovered: NotCovered[] }> {
	const config = gitleaksConfig({ privateData: scope.privateData === true });
	const notCovered: NotCovered[] = [];
	if (copy?.shallow) notCovered.push({ tool: "gitleaks", message: "its history is cut short (a shallow clone), so commits older than the cut were not read" });
	const rows: Located[] = [];
	if (copy && !copy.empty && scope.history !== "none") rows.push(...(await historyRows(copy.dir, repo, run, scope.history, config)).map((row) => ({ row, source: "history" as const })));
	if (scope.history === "all" && !scope.localFiles && !scope.privateData) return { findings: findingsOf(rows), unreadFiles: 0, notCovered };

	const tracked = await trackedFiles(repo, run);
	let unreadFiles = 0;
	if (scope.history !== "all") {
		const files = await copyTracked(repo, tracked);
		try {
			unreadFiles = files.unread;
			const found = await folderRows(files.dir, repo, run, config);
			// A key in a file changed since it was committed may be in that change alone: then it is on this computer only.
			const committed = await committedSecrets(repo, run, tracked, [...new Set(found.map(fileOf).filter((file) => files.changed.has(file)))], config);
			for (const row of found) {
				const file = fileOf(row);
				const uncommitted = committed.read.has(file) && !committed.ids.has(secretId(row));
				rows.push(uncommitted ? { row, source: "local", changed: true } : { row, source: "files", changed: files.changed.has(file) });
			}
		} finally {
			await removeTemp(files.dir);
		}
	}
	if (scope.localFiles) {
		// gitleaks reads the whole working tree. A file git does not track is on this computer only. A
		// tracked one was read above when history was not read in full; otherwise a key in it counts as
		// on this computer only when the file has changed since it was committed and no commit holds
		// that key in that file.
		const committed = new Set(rows.filter((located) => located.source === "history").map((located) => secretId(located.row)));
		const top = await realpath(repo);
		// Third-party code a package manager installed beside the project is not read here (rules.ts).
		for (const row of await folderRows(repo, repo, run, gitleaksConfig({ privateData: scope.privateData === true, thirdParty: true }))) {
			const file = fileOf(row);
			const id = tracked.get(file);
			if (id === undefined) rows.push({ row, source: "local" });
			else if (scope.history === "all" && !committed.has(secretId(row))) {
				const content = await readTracked(top, file);
				if (Buffer.isBuffer(content) && (id === "" || blobId(content, id.length) !== id)) rows.push({ row, source: "local", changed: true });
			}
		}
	}
	const isPrivate = (located: Located) => isPrivateRule((located.row as { RuleID?: unknown } | null)?.RuleID);
	const findings = scope.secrets === false ? [] : findingsOf(rows.filter((located) => !isPrivate(located)));
	if (scope.privateData) findings.push(...(await privateData(repo, copy, run, scope.history, rows.filter(isPrivate), tracked)));
	return { findings, unreadFiles, notCovered };
}

/**
 * Private data in a repository (see private.ts): gitleaks' matches of Porchlight's rules, grouped and
 * counted; files that hold people's data by their type or name, among those history added and those
 * tracked now; and tracked photos whose EXIF data holds a GPS position.
 */
async function privateData(repo: string, copy: HistoryCopy | null, run: Runner, history: HistoryReach, located: Located[], tracked: Map<string, string>): Promise<Finding[]> {
	const matches: Match[] = located.map(({ row, source, changed }) => {
		const { RuleID, StartLine, StartColumn, Commit, Date: date } = (row ?? {}) as Record<string, unknown>;
		return {
			ruleId: String(RuleID),
			file: fileOf(row),
			...(typeof StartLine === "number" ? { line: StartLine } : {}),
			...(typeof StartColumn === "number" ? { column: StartColumn } : {}),
			...(source === "history" && typeof Commit === "string" && Commit ? { commit: Commit } : {}),
			...(source === "history" && typeof date === "string" ? { date } : {}),
			source,
			...(changed ? { changed } : {}),
		};
	});
	const added = history === "none" || !copy || copy.empty ? new Map<string, Added>() : await addedFiles(copy.dir, run, history);
	const place = (path: string, at = added.get(path)): NamedFile => (at ? { path, source: "history", commit: at.commit, date: at.date } : { path, source: "files" });
	const named: NamedFile[] = [...[...added.keys()].map((path) => place(path)), ...[...tracked.keys()].map((path) => ({ path, source: "files" as const }))];
	const photo = (path: string) => PHOTO_TYPES.has(path.slice(path.lastIndexOf(".") + 1).toLowerCase());
	const top = await realpath(repo);
	const photos = new Map<string, Finding>();
	// Photos as they are now.
	for (const path of tracked.keys()) {
		if (!photo(path)) continue;
		const content = await readTracked(top, path);
		if (Buffer.isBuffer(content) && hasGpsPosition(content)) photos.set(path, photoFinding(place(path)));
	}
	// Photos history added that are gone now, or changed since: their committed versions, read with
	// `cat-file blob`, which converts nothing. One past the size limit is not read.
	const checked = new Map<string, boolean>();
	for (const [path, at] of added) {
		if (!photo(path) || photos.has(path) || at.blob === "" || tracked.get(path) === at.blob) continue;
		let found = checked.get(at.blob);
		if (found === undefined) {
			const blob = copy ? await run("git", [...GIT_SAFE_ARGS, "-C", copy.dir, "cat-file", "blob", at.blob], { env: gitReadEnv(), latin1: true }).catch(() => null) : null;
			found = blob !== null && blob.code === 0 && blob.stdout.length <= MAX_FILE_BYTES && hasGpsPosition(Buffer.from(blob.stdout, "latin1"));
			checked.set(at.blob, found);
		}
		if (found) photos.set(path, photoFinding(place(path, at)));
	}
	return [...privateFindings(matches), ...namedFindings(named), ...photos.values()];
}

/** A file a commit added: the oldest such commit, and the id of the content it added (empty for a link or a submodule). */
interface Added {
	commit: string;
	date: string;
	blob: string;
}

/**
 * Every file a commit added, by path, with the oldest commit that added it and the id of what it
 * added: read with `git log --raw`, which compares no file's content and so runs no diff program.
 */
async function addedFiles(repo: string, run: Runner, reach: "all" | number): Promise<Map<string, Added>> {
	const limit = typeof reach === "number" ? [`--max-count=${reach}`] : [];
	const { code, stdout, stderr } = await run(
		"git",
		[...GIT_SAFE_ARGS, "-C", repo, "log", ...GIT_LOG_OPTIONS.split(" "), ...limit, "--no-renames", "--diff-filter=A", "--raw", "--no-abbrev", "-z", "--format=%x01%H %aI"],
		{ env: gitReadEnv() },
	);
	if (code !== 0) throw new Error(firstLine(stderr) || `git exited with code ${code}`);
	const added = new Map<string, Added>();
	// Newest first: an older commit that added the same path again overwrites, so the oldest stays.
	for (const chunk of stdout.split("\x01")) {
		const end = chunk.indexOf("\0");
		if (end < 0) continue;
		const [commit = "", date = ""] = chunk.slice(0, end).split(" ");
		// Each file: ":000000 100644 <old id> <new id> A", then its path.
		const fields = chunk.slice(end + 1).replace(/^\n/, "").split("\0");
		for (let i = 0; i + 1 < fields.length; i += 2) {
			const [, mode = "", , blob = ""] = (fields[i] ?? "").split(" ");
			const path = fields[i + 1] ?? "";
			if (path !== "") added.set(path, { commit, date, blob: mode === "100644" || mode === "100755" || mode === "100664" ? blob : "" });
		}
	}
	return added;
}

/**
 * The secrets in the committed versions of these files, by `secretId`, and which files could be read
 * that way. git prints a committed file with `cat-file blob`, which applies no filter and runs
 * nothing a repository's settings name. A file that cannot be read is left out of `read`, so its
 * keys are reported as committed: the more careful reading.
 */
async function committedSecrets(repo: string, run: Runner, tracked: Map<string, string>, files: string[], config: string): Promise<{ ids: Set<string>; read: Set<string> }> {
	const ids = new Set<string>();
	const read = new Set<string>();
	if (files.length === 0) return { ids, read };
	const dir = await makeTemp("committed");
	try {
		for (const file of files) {
			const id = tracked.get(file);
			// In a merge conflict there is no one committed version to compare with.
			if (!id) continue;
			const { code, stdout } = await run("git", [...GIT_SAFE_ARGS, "-C", repo, "cat-file", "blob", id], { env: gitReadEnv() });
			if (code !== 0) continue;
			const target = join(dir, ...file.split("/"));
			await mkdir(dirname(target), { recursive: true, mode: 0o700 });
			await writeFile(target, stdout, { mode: 0o600, flag: "wx" });
			read.add(file);
		}
		if (read.size > 0) for (const row of await folderRows(dir, repo, run, config)) ids.add(secretId(row));
	} finally {
		await removeTemp(dir);
	}
	return { ids, read };
}

/** A secret by rule, file and entropy: the same in every commit that carries it, wherever its line moved. */
function secretId(row: unknown): string {
	const { RuleID, Entropy } = (row ?? {}) as Record<string, unknown>;
	return `${String(RuleID)}\n${fileOf(row)}\n${typeof Entropy === "number" ? Entropy : ""}`;
}

/**
 * gitleaks over the history `git log` shows it in Porchlight's copy (`history`), limited to the latest
 * `reach` commits when that is a number. The repository's .gitleaksignore is read from `repo` itself.
 */
async function historyRows(history: string, repo: string, run: Runner, reach: "all" | number, config: string): Promise<unknown[]> {
	const logOptions = reach === "all" ? GIT_LOG_OPTIONS : `--max-count=${reach} ${GIT_LOG_OPTIONS}`;
	const { code, stdout, stderr } = await run("gitleaks", ["git", ...common(repo, config), `--log-opts=${logOptions}`, history], { env: gitReadEnv() });
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
async function folderRows(folder: string, repo: string, run: Runner, config: string): Promise<unknown[]> {
	const { code, stdout, stderr } = await run("gitleaks", ["dir", ...common(repo, config), "."], { cwd: folder });
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
	const { code, stdout, stderr } = await run("git", [...GIT_SAFE_ARGS, "-C", repo, "ls-files", "--stage", "-z"], { env: gitReadEnv() });
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
	const dir = await makeTemp("files");
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
		await removeTemp(dir);
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
		let detail =
			source === "history"
				? typeof Commit === "string" && Commit
					? placeOf({ source, commit: Commit, ...(typeof date === "string" ? { date } : {}) })
					: `working tree${typeof date === "string" ? ` on ${date.slice(0, 10)}` : ""}`
				: placeOf({ source, ...(changed ? { changed } : {}) });
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
