import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import { GIT_SAFE_ARGS } from "../github/github.ts";
import { firstLine, type Runner } from "./exec.ts";
import type { NotSearched } from "./discover.ts";
import { copyHistory, gitReadEnv, type HistoryCopy } from "./git-copy.ts";
import { hasGpsPosition, isPrivateRule, namedFindings, PHOTO_TYPES, photoFinding, placeOf, privateFindings, type Match, type NamedFile } from "./private.ts";
import { gitleaksConfig } from "./rules.ts";
import { makeTemp, removeTemp } from "./temp.ts";
import { triageSecret } from "./triage.ts";
import { severityRank, type Finding, type HistoryReach, type NotCovered, type SecretSource } from "./types.ts";

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
	/**
	 * Every repository the scan covers, by path. A repository nested in this one, or a submodule, that
	 * is not among them is added to `notSearched` (B30). It belongs to the report rather than to this
	 * repository, whose own files and commits were read in full. Absent: none is named.
	 */
	scanned?: Set<string>;
	notSearched?: NotSearched[];
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
	if (copy && !copy.empty && scope.history !== "none") {
		rows.push(...(await historyRows(copy.dir, repo, run, scope.history, config)).map((row) => ({ row, source: "history" as const })));
		if (scope.secrets !== false) {
			const unseen = await unseenRows(copy.dir, repo, run, scope.history);
			rows.push(...unseen.rows.map((row) => ({ row, source: "history" as const })));
			notCovered.push(...unseen.notCovered);
		}
	}
	if (scope.history === "all" && !scope.localFiles && !scope.privateData) return { findings: findingsOf(rows), unreadFiles: 0, notCovered };

	const { files: tracked, submodules } = await trackedFiles(repo, run);
	// What "committed" means: in HEAD's own tree, not merely staged in git's index (B28).
	const head = await headFiles(repo, run);
	let unreadFiles = 0;
	const nestedRepos = new Set<string>();
	// The files as they are now: for everything when history is not read in full, and for private data
	// in any case. History is read one commit at a time, so a file of 25 addresses added one per commit
	// shows one in each; the file as it is now shows all 25 (B29). Secrets in it were read in history.
	const isPrivateRow = (row: unknown) => isPrivateRule((row as { RuleID?: unknown } | null)?.RuleID);
	if (scope.history !== "all" || scope.privateData) {
		const files = await copyTracked(repo, tracked, head);
		try {
			if (scope.history !== "all") unreadFiles = files.unread;
			const found = (await folderRows(files.dir, repo, run, config)).filter((row) => scope.history !== "all" || isPrivateRow(row));
			// A key in a file changed since it was committed may be in that change alone: then it is on this computer only.
			const committed = await committedSecrets(repo, run, head, [...new Set(found.map(fileOf).filter((file) => files.changed.has(file)))], config);
			for (const row of found) {
				const file = fileOf(row);
				// A file no commit holds yet (staged, say) has never left this computer.
				const uncommitted = !head.has(file) || (committed.read.has(file) && !committed.ids.has(secretId(row)));
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
		const insideRepo = new Map<string, boolean>();
		// Third-party code a package manager installed beside the project is not read here (rules.ts).
		for (const row of await folderRows(repo, repo, run, gitleaksConfig({ privateData: scope.privateData === true, thirdParty: true }))) {
			const file = fileOf(row);
			if (!tracked.has(file)) {
				// A file in a repository nested in this one is that repository's, committed there or not: it is
				// read when that repository is scanned, never called "on this computer only" here (B30).
				const nested = await nestedRepo(top, file, insideRepo);
				if (nested !== null) nestedRepos.add(nested);
				else rows.push({ row, source: "local" });
			}
			else if (scope.history === "all" && !committed.has(secretId(row))) {
				const id = head.get(file) ?? "";
				const content = await readTracked(top, file);
				if (Buffer.isBuffer(content) && (id === "" || blobId(content, id.length) !== id)) rows.push({ row, source: "local", changed: true });
			}
		}
	}
	if (scope.scanned && scope.notSearched) {
		for (const path of submodules) {
			const at = join(repo, ...path.split("/"));
			const checkedOut = await lstat(join(at, ".git")).then(
				() => true,
				() => false,
			);
			if (!checkedOut) scope.notSearched.push({ path: at, reason: "it is a submodule that is not checked out here, so nothing in it was read" });
			else nestedRepos.add(path);
		}
		for (const path of nestedRepos) {
			const at = join(repo, ...path.split("/"));
			if (!scope.scanned.has(at)) scope.notSearched.push({ path: at, reason: "it is a repository inside another, deeper than the folders searched, so its commits were not read" });
		}
	}
	const isPrivate = (located: Located) => isPrivateRow(located.row);
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
	// `cat-file --batch`, which converts nothing, all in as few runs as fit (OP-3: 400 photos took
	// 3 s one run each). One past the size limit is not read.
	const older = [...added].filter(([path, at]) => photo(path) && !photos.has(path) && at.blob !== "" && tracked.get(path) !== at.blob);
	const blobs = copy ? await readBlobs(copy.dir, [...new Set(older.map(([, at]) => at.blob))], run) : new Map<string, Buffer>();
	const withPosition = new Map([...blobs].map(([id, content]) => [id, hasGpsPosition(content)]));
	for (const [path, at] of older) if (withPosition.get(at.blob)) photos.set(path, photoFinding(place(path, at)));
	return [...privateFindings(matches), ...namedFindings(named), ...photos.values()];
}

/** The most content one `cat-file --batch` run is asked for, well inside what a run's output may hold. */
const BATCH_BYTES = 64 * 1024 * 1024;

/**
 * The content of these blobs, by id: sizes first with `cat-file --batch-check`, then the content with
 * `cat-file --batch`, in runs of at most BATCH_BYTES. A blob past MAX_FILE_BYTES, or one git could not
 * give, is left out. Neither converts anything or runs a program a repository names.
 */
export async function readBlobs(dir: string, ids: string[], run: Runner): Promise<Map<string, Buffer>> {
	const contents = new Map<string, Buffer>();
	if (ids.length === 0) return contents;
	const git = (args: string[], input: string) => run("git", [...GIT_SAFE_ARGS, "-C", dir, "cat-file", ...args], { env: gitReadEnv(), input, latin1: true }).catch(() => null);
	const sizes = await git(["--batch-check"], `${ids.join("\n")}\n`);
	if (!sizes || sizes.code !== 0) return contents;
	const batches: string[][] = [[]];
	let used = 0;
	for (const line of sizes.stdout.split("\n")) {
		const found = /^([0-9a-f]{40,64}) blob (\d+)$/.exec(line);
		if (!found || Number(found[2]) > MAX_FILE_BYTES) continue;
		if (used + Number(found[2]) > BATCH_BYTES && batches.at(-1)!.length > 0) {
			batches.push([]);
			used = 0;
		}
		batches.at(-1)!.push(found[1]!);
		used += Number(found[2]);
	}
	for (const batch of batches) {
		if (batch.length === 0) continue;
		const answer = await git(["--batch"], `${batch.join("\n")}\n`);
		if (!answer || answer.code !== 0) continue;
		// Each: "<id> blob <size>\n", the content, "\n". Read byte for byte, so a size in bytes is a length here.
		const out = answer.stdout;
		let at = 0;
		while (at < out.length) {
			const end = out.indexOf("\n", at);
			if (end < 0) break;
			const header = /^([0-9a-f]{40,64}) blob (\d+)$/.exec(out.slice(at, end));
			if (!header) break;
			const size = Number(header[2]);
			contents.set(header[1]!, Buffer.from(out.slice(end + 1, end + 1 + size), "latin1"));
			at = end + 1 + size + 1;
		}
	}
	return contents;
}

/** A file a commit added: the oldest such commit, and the id of the content it added (empty for a link or a submodule). */
export interface Added {
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
	return parseAdded(stdout);
}

/**
 * `git log --raw -z --format=%x01%H %aI` read token by token: a commit's line, then for each file a
 * ":000000 100644 <old id> <new id> A" entry and its path. A path is taken whole as the token after its
 * entry, whatever it holds, so a file named with \x01 or a space cannot pass itself off as a commit
 * (S42). Newest first: an older commit that added the same path again overwrites, so the oldest stays.
 */
export function parseAdded(stdout: string): Map<string, Added> {
	const added = new Map<string, Added>();
	const tokens = stdout.split("\0");
	let commit = "";
	let date = "";
	for (let i = 0; i < tokens.length; i++) {
		const token = (tokens[i] ?? "").replace(/^\n/, "");
		const header = /^\x01([0-9a-f]{40,64}) (\S+)$/.exec(token);
		if (header) {
			[, commit = "", date = ""] = header;
			continue;
		}
		const entry = /^:\d{6} (\d{6}) [0-9a-f]{40,64} ([0-9a-f]{40,64}) [A-Z]\d*$/.exec(token);
		if (!entry) continue;
		const path = tokens[++i] ?? "";
		const [, mode = "", blob = ""] = entry;
		if (path !== "" && commit !== "") added.set(path, { commit, date, blob: mode === "100644" || mode === "100755" || mode === "100664" ? blob : "" });
	}
	return added;
}

/**
 * The secrets in the committed versions of these files, by `secretId`, and which files could be read
 * that way. git prints a committed file with `cat-file blob`, which applies no filter and runs
 * nothing a repository's settings name. A file that cannot be read is left out of `read`, so its
 * keys are reported as committed: the more careful reading.
 */
async function committedSecrets(repo: string, run: Runner, head: Map<string, string>, files: string[], config: string): Promise<{ ids: Set<string>; read: Set<string> }> {
	const ids = new Set<string>();
	const read = new Set<string>();
	if (files.length === 0) return { ids, read };
	const dir = await makeTemp("committed");
	try {
		for (const file of files) {
			const id = head.get(file);
			// A file no commit holds has no committed version to compare with.
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

/** Part of the text `unseenRows` gives gitleaks: where it came from, and the lines it takes up. */
interface Section {
	file: string;
	first: number;
	last: number;
	/** What a finding there is called: its place in the repository, as a finding's file is. */
	name: string;
	commit?: string;
	date?: string;
	/** Said instead of a commit, for a tag. */
	place?: string;
}

/** The most a tag's file is read; a larger one is said under "Not covered". */
const MAX_TAGGED_BYTES = 5 * 1024 * 1024;

/**
 * What `git log -p` never shows, which is pushed all the same (S57): commit messages, annotated tags'
 * messages, and what a tag holds when it points at a file rather than a commit. They are written to a
 * private folder, read by gitleaks with --redact, and each match is put back where it came from by its
 * line. A tag pointing at a folder is said under "Not covered". Secrets only, by gitleaks' own rules: a
 * message's sign-off names its author, which is not a leak. Tags are read only with every commit.
 */
async function unseenRows(copy: string, repo: string, run: Runner, reach: "all" | number): Promise<{ rows: unknown[]; notCovered: NotCovered[] }> {
	const notCovered: NotCovered[] = [];
	const files = new Map<string, string[]>();
	const sections: Section[] = [];
	const add = (file: string, body: string, where: Omit<Section, "file" | "first" | "last">) => {
		const lines = files.get(file) ?? [];
		const text = body.replace(/\n+$/, "").split("\n");
		sections.push({ file, first: lines.length + 1, last: lines.length + text.length, ...where });
		for (const line of text) lines.push(line);
		files.set(file, lines);
	};
	const git = async (args: string[], latin1 = false) => {
		const answer = await run("git", [...GIT_SAFE_ARGS, "-C", copy, ...args], { env: gitReadEnv(), ...(latin1 ? { latin1 } : {}) });
		if (answer.code !== 0) throw new Error(firstLine(answer.stderr) || `git exited with code ${answer.code}`);
		return answer.stdout;
	};

	const limit = typeof reach === "number" ? [`--max-count=${reach}`] : [];
	for (const record of (await git(["log", "--all", "--full-history", "--no-show-signature", "--encoding=none", ...limit, "--format=%x01%H %aI%x02%B%x00"])).split("\0")) {
		const found = /^\n?\x01([0-9a-f]{40,64}) (\S*)\x02([\s\S]*)$/.exec(record);
		if (found) add("messages.txt", found[3]!, { name: "commit message", commit: found[1]!, date: found[2]! });
	}
	if (reach === "all") {
		const refs = await git(["for-each-ref", "--format=%(objecttype) %(objectname) %(*objecttype) %(*objectname) %(refname)", "refs/tags/", "refs/heads/", "refs/notes/"]);
		for (const line of refs.split("\n")) {
			const ref = /^(\w+) ([0-9a-f]{40,64}) (\w*) ([0-9a-f]*) (refs\/.+)$/.exec(line);
			if (!ref) continue;
			const [, type, id, peeledType, peeledId, refname] = ref as unknown as [string, string, string, string, string, string];
			const name = refname.replace(/^refs\/(?:tags|heads)\//, "");
			if (type === "tag") {
				const tag = await git(["cat-file", "tag", id]);
				const message = tag.slice(tag.indexOf("\n\n") + 2);
				if (tag.includes("\n\n") && message.trim() !== "") add("tags.txt", message, { name: `message of tag ${name}`, place: `tag ${name}` });
			}
			const [target, targetId] = type === "tag" ? [peeledType, peeledId] : [type, id];
			if (target === "tree") notCovered.push({ tool: "gitleaks", message: `${refname} points at a folder rather than a commit, which was not read` });
			if (target !== "blob") continue;
			const size = Number((await git(["cat-file", "-s", targetId])).trim());
			if (!(size <= MAX_TAGGED_BYTES)) {
				notCovered.push({ tool: "gitleaks", message: `${refname} points at a file larger than 5 MB rather than a commit, which was not read` });
				continue;
			}
			add(`tagged-${sections.length}.txt`, Buffer.from(await git(["cat-file", "blob", targetId], true), "latin1").toString("utf8"), { name: `file ${refname} points at`, place: `${refname}, a file rather than a commit` });
		}
	}
	if (sections.length === 0) return { rows: [], notCovered };

	const dir = await makeTemp("unseen");
	try {
		for (const [file, lines] of files) await writeFile(join(dir, file), `${lines.join("\n")}\n`, { mode: 0o600, flag: "wx" });
		// gitleaks' own rules alone: private data is looked for in files, not in messages.
		const rows = await folderRows(dir, repo, run, gitleaksConfig({ privateData: false }));
		return {
			notCovered,
			rows: rows.flatMap((row) => {
				const { StartLine } = (row ?? {}) as Record<string, unknown>;
				const section = sections.find((part) => part.file === fileOf(row) && typeof StartLine === "number" && StartLine >= part.first && StartLine <= part.last);
				if (!section || typeof StartLine !== "number") return [];
				return [{ ...(row as object), File: section.name, StartLine: StartLine - section.first + 1, Commit: section.commit ?? "", Date: section.date, Place: section.place }];
			}),
		};
	} finally {
		await removeTemp(dir);
	}
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
 * The regular files HEAD's own tree holds, by path, with the id of each: what is committed. Read with
 * `ls-tree`, which converts nothing. A repository with no commit yet has none.
 */
async function headFiles(repo: string, run: Runner): Promise<Map<string, string>> {
	const { code, stdout, stderr } = await run("git", [...GIT_SAFE_ARGS, "-C", repo, "ls-tree", "-r", "-z", "--full-tree", "HEAD"], { env: gitReadEnv() });
	const files = new Map<string, string>();
	if (code !== 0) {
		if (/not a valid object name|unknown revision|bad revision|does not have any commits/i.test(stderr)) return files;
		throw new Error(firstLine(stderr) || `git exited with code ${code}`);
	}
	for (const entry of stdout.split("\0")) {
		const match = /^(\d{6}) blob ([0-9a-f]{40,64})\t(.+)$/s.exec(entry);
		if (match && (match[1] === "100644" || match[1] === "100755" || match[1] === "100664")) files.set(match[3]!, match[2]!);
	}
	return files;
}

/**
 * The repository nested in this one that holds `file` (one of its folders has a `.git` of its own), by
 * its path inside this one; the outermost if there are several. null when there is none.
 */
async function nestedRepo(top: string, file: string, known: Map<string, boolean>): Promise<string | null> {
	const parts = file.split("/");
	for (let end = 1; end < parts.length; end++) {
		const folder = parts.slice(0, end).join("/");
		let found = known.get(folder);
		if (found === undefined) {
			found = await lstat(join(top, ...parts.slice(0, end), ".git")).then(
				() => true,
				() => false,
			);
			known.set(folder, found);
		}
		if (found) return folder;
	}
	return null;
}

/**
 * The regular files git tracks, by path, with the id of each as committed, and the paths of its
 * submodules. Read from git's index alone with `ls-files --stage`: nothing in the working tree is
 * compared or converted, so no filter or other program a repository's settings name can run
 * (invariant 14).
 */
async function trackedFiles(repo: string, run: Runner): Promise<{ files: Map<string, string>; submodules: string[] }> {
	const { code, stdout, stderr } = await run("git", [...GIT_SAFE_ARGS, "-C", repo, "ls-files", "--stage", "-z"], { env: gitReadEnv() });
	if (code !== 0) throw new Error(firstLine(stderr) || `git exited with code ${code}`);
	const files = new Map<string, string>();
	const submodules: string[] = [];
	for (const entry of stdout.split("\0")) {
		const match = /^(\d{6}) ([0-9a-f]{40,64}) (\d)\t(.+)$/s.exec(entry);
		if (!match) continue;
		const [, mode, id, stage, path] = match as unknown as [string, string, string, string, string];
		if (mode === "160000") submodules.push(path);
		// Symbolic links and submodules are not files to read; a file in a merge conflict has no one committed version.
		if (mode !== "100644" && mode !== "100755" && mode !== "100664") continue;
		files.set(path, stage === "0" ? id : "");
	}
	return { files, submodules };
}

/**
 * Copies the tracked files, as they are now, into a private temporary folder for gitleaks to read,
 * and notes which differ from what was committed (by git's own id for the content, worked out here).
 */
async function copyTracked(repo: string, tracked: Map<string, string>, head: Map<string, string>): Promise<{ dir: string; changed: Set<string>; unread: number }> {
	const dir = await makeTemp("files");
	const top = await realpath(repo);
	const changed = new Set<string>();
	let unread = 0;
	const queue = [...tracked.entries()];
	const worker = async () => {
		for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
			const [path] = next;
			const committed = head.get(path) ?? "";
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
	// Gone only when it is not there; a path too long to open, or a folder that cannot be read, is a file
	// that was not read, and is counted as one (S61).
	const parent = await realpath(dirname(source)).catch((err: NodeJS.ErrnoException) => (err.code === "ENOENT" || err.code === "ENOTDIR" ? null : "unread"));
	if (parent === null) return "gone";
	if (parent === "unread") return "unread";
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

/** Where a finding was made, in the order its rows are taken: history first, then the files as they are, then files git does not track. */
const SOURCE_ORDER: Record<SecretSource, number> = { history: 0, files: 1, local: 2 };

/**
 * gitleaks' rows in a fixed order: by where they were found, then the oldest commit first, then commit,
 * line and column. gitleaks reports matches in a different order on every run, and the first row of a
 * secret names the finding's commit, so without this one secret could name another commit each scan and
 * count as new and fixed every time (B20).
 */
function inOrder(located: Located[]): Located[] {
	const field = (row: unknown, name: string): unknown => (typeof row === "object" && row !== null ? (row as Record<string, unknown>)[name] : undefined);
	const text = (row: unknown, name: string) => String(field(row, name) ?? "");
	const number = (row: unknown, name: string) => (typeof field(row, name) === "number" ? (field(row, name) as number) : 0);
	return [...located].sort(
		(a, b) =>
			SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
			text(a.row, "Date").localeCompare(text(b.row, "Date"), "en") ||
			text(a.row, "Commit").localeCompare(text(b.row, "Commit"), "en") ||
			text(a.row, "File").localeCompare(text(b.row, "File"), "en") ||
			number(a.row, "StartLine") - number(b.row, "StartLine") ||
			number(a.row, "StartColumn") - number(b.row, "StartColumn"),
	);
}

function findingsOf(located: Located[]): Finding[] {
	// The same secret is reported again by each commit that rewrote its line; keep the first, in a
	// fixed order (inOrder). Which secret a match is cannot be told by its value (gitleaks runs with
	// --redact), but its entropy is a property of the value: equal for the same secret, all but never
	// for two others. It is used only to tell matches apart here and is never kept.
	const bySecret = new Map<string, Finding>();
	const details = new Set<string>();
	for (const { row, source, changed } of inOrder(located)) {
		if (typeof row !== "object" || row === null) continue;
		const { RuleID, Description, StartLine, StartColumn, Entropy, Commit, Date: date, Place } = row as Record<string, unknown>;
		const File = fileOf(row);
		if (typeof RuleID !== "string" || File === "") continue;
		const location = typeof StartLine === "number" ? `${File}:${StartLine}` : File;
		const key = `${RuleID}\n${location}\n${typeof Entropy === "number" ? Entropy : ""}`;
		if (bySecret.has(key)) continue;
		let detail =
			typeof Place === "string"
				? Place
				: source === "history"
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
	return grouped([...bySecret.values()]);
}

/** Secrets of one rule listed one by one in a file before the rest are counted in one finding. */
export const PER_FILE = 25;

/**
 * Past PER_FILE matches of one rule in one file and place, the rest are one finding with their
 * count (S60): a file of 100,000 tokens is a handful of findings, not a 20 MB report kept 50 times.
 * The grouped finding's identity does not change with the count, so it is not new each scan.
 */
function grouped(findings: Finding[]): Finding[] {
	const groups = new Map<string, Finding[]>();
	for (const finding of findings) {
		const key = `${finding.ruleId}\n${finding.location.replace(/:\d+$/, "")}\n${finding.source ?? ""}`;
		const group = groups.get(key);
		if (group) group.push(finding);
		else groups.set(key, [finding]);
	}
	const out: Finding[] = [];
	for (const group of groups.values()) {
		if (group.length <= PER_FILE) {
			for (const finding of group) out.push(finding);
			continue;
		}
		const shown = group.slice(0, PER_FILE - 1);
		const rest = group.slice(PER_FILE - 1);
		for (const finding of shown) out.push(finding);
		const first = rest[0]!;
		const file = first.location.replace(/:\d+$/, "");
		out.push({
			...first,
			title: `${rest.length.toLocaleString("en")} more: ${first.title}`,
			location: file,
			// A commit would change as matches are removed; where a match is on this computer, its words stay, as the roadmap reads them.
			detail: first.source === "history" || first.source === undefined ? "more matches in this file" : `${first.detail}, more matches in this file`,
			count: rest.length,
			severity: rest.reduce((worst, finding) => (severityRank(finding.severity) < severityRank(worst) ? finding.severity : worst), first.severity),
		});
	}
	return out;
}

function firstSentence(text: string): string {
	const end = text.indexOf(", ");
	return end > 0 ? text.slice(0, end) : text;
}
