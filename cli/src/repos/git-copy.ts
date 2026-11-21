/**
 * Reading a scanned repository with git, which is hostile input (invariant 14).
 *
 * gitleaks reads history by running `git log -p`, and that git obeys the repository's own .git: its
 * config can run programs (a submodule's diff.external, a partial clone's sshCommand or credential
 * helper) or hide history (color.ui, diff.noprefix, attributes, a commit-graph, grafts, replace refs).
 * Twenty rounds of looking found a new such setting each time (docs/AUDIT-PLAN-2026-11-20.md, "Stage 5,
 * design spike"), so history is not read in place: it is read from a copy Porchlight makes itself, which
 * holds the repository's objects and refs and none of its settings.
 *
 * The copy is an empty bare repository that fetches every ref except replace refs, plus each worktree's
 * HEAD, and is then checked ref by ref against the source. git's own checks make it complete, shallow
 * (which is said), or not made at all: index-pack verifies every object, and fetch checks that history
 * is connected.
 */
import { access, constants, statfs } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { GIT_SAFE_ARGS } from "../github/github.ts";
import { firstLine, safePath, ToolMissingError, type Runner } from "./exec.ts";
import { makeTemp, removeTemp } from "./temp.ts";

/**
 * The environment every git command on a scanned repository (and on its copy) runs with: no system or
 * user config (a developer's own `color.ui=always` or `diff.noprefix` would break the scan, and a
 * credential helper in it could start), no prompt, no lazy fetch from a promisor remote, and no
 * replace refs. `safe.directory` entries the container needs are given back through
 * PORCHLIGHT_GIT_SAFE_DIRECTORY (folders separated as in PATH), since NOSYSTEM drops the image's own.
 */
export function gitReadEnv(from: NodeJS.ProcessEnv = process.env): Record<string, string> {
	const env: Record<string, string> = {
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_TERMINAL_PROMPT: "0",
		GIT_ASKPASS: "",
		SSH_ASKPASS: "",
		GIT_OPTIONAL_LOCKS: "0",
		GIT_NO_LAZY_FETCH: "1",
		GIT_NO_REPLACE_OBJECTS: "1",
	};
	const safe = (from.PORCHLIGHT_GIT_SAFE_DIRECTORY ?? "").split(delimiter).filter((dir) => dir !== "");
	if (safe.length > 0) {
		env.GIT_CONFIG_COUNT = String(safe.length);
		safe.forEach((dir, index) => {
			env[`GIT_CONFIG_KEY_${index}`] = "safe.directory";
			env[`GIT_CONFIG_VALUE_${index}`] = dir;
		});
	}
	return env;
}

export interface HistoryCopy {
	/** The bare repository to read history from. */
	dir: string;
	/** The source's history is cut short (a shallow clone): older commits are not in it. */
	shallow: boolean;
	/** The source has no ref at all, so there is no history to read. */
	empty: boolean;
}

/** Settings for the copy's own git: nothing but local paths, no helper, no hook, no maintenance. */
const COPY_ARGS = [
	"protocol.allow=never",
	"protocol.file.allow=always",
	"credential.helper=",
	"core.hooksPath=/dev/null",
	"core.fsmonitor=false",
	"submodule.recurse=false",
	"gc.auto=0",
	"maintenance.auto=false",
	"fetch.writeCommitGraph=false",
].flatMap((setting) => ["-c", setting]);

/** A word for /bin/sh, in single quotes. */
function quoted(word: string): string {
	return `'${word.replace(/'/g, "'\\''")}'`;
}

/** The absolute path of a program on PATH (absolute entries only), as a shell needs it. */
async function onPath(name: string): Promise<string> {
	for (const dir of safePath(process.env.PATH).split(delimiter)) {
		const candidate = join(dir, name);
		try {
			await access(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Not here.
		}
	}
	throw new ToolMissingError(name);
}

/** Lines of `<object id> <ref name>`, as for-each-ref prints them. */
function refsOf(text: string): Map<string, string> {
	const refs = new Map<string, string>();
	for (const line of text.split("\n")) {
		const match = /^([0-9a-f]{40,64}) (refs\/\S.*)$/.exec(line);
		if (match) refs.set(match[2]!, match[1]!);
	}
	return refs;
}

async function git(run: Runner, args: string[], what: string): Promise<string> {
	const { code, stdout, stderr } = await run("git", [...GIT_SAFE_ARGS, ...args], { env: gitReadEnv() });
	if (code !== 0) throw new Error(firstLine(stderr) || `git ${what} exited with code ${code}`);
	return stdout;
}

/** Free space where temporary folders go, in bytes, or null when the system cannot say. */
async function freeSpace(): Promise<number | null> {
	try {
		const info = await statfs(tmpdir());
		return info.bavail * info.bsize;
	} catch {
		return null;
	}
}

/**
 * Makes the copy of `repo`'s history. The caller removes it with removeTemp(copy.dir). Throws when the
 * history cannot be copied whole, so a scan fails rather than reads part of it as all of it.
 */
export async function copyHistory(repo: string, run: Runner): Promise<HistoryCopy> {
	// A partial clone holds only part of its objects; reading the rest would mean fetching from a host its
	// config names. Not fetched, and said. git marks one with `remote.<name>.promisor` (older versions
	// with `extensions.partialClone`). Were this missed, the fetch below would still fail rather than fetch.
	const partial = await run("git", [...GIT_SAFE_ARGS, "-C", repo, "config", "--get-regexp", "^(extensions\\.partialclone|remote\\..*\\.promisor)$"], { env: gitReadEnv() });
	const marked = partial.code === 0 && partial.stdout.split("\n").some((line) => /^\S+ (?!false$)\S/i.test(line.trim()));
	if (marked) {
		throw new Error("This is a partial clone: part of its history is not on this computer, and Porchlight does not fetch it.");
	}
	const wanted = refsOf(await git(run, ["-C", repo, "for-each-ref", "--format=%(objectname) %(refname)"], "for-each-ref"));
	for (const ref of [...wanted.keys()]) if (ref.startsWith("refs/replace/") || ref.startsWith("refs/porchlight/")) wanted.delete(ref);
	const heads = [
		...new Set(
			(await git(run, ["-C", repo, "worktree", "list", "--porcelain"], "worktree list"))
				.split("\n")
				.map((line) => /^HEAD ([0-9a-f]{40,64})$/.exec(line)?.[1])
				.filter((id): id is string => id !== undefined && !/^0+$/.test(id)),
		),
	];

	const sizes = await git(run, ["-C", repo, "count-objects", "-v"], "count-objects");
	const kib = (name: string) => Number(new RegExp(`^${name}: (\\d+)$`, "m").exec(sizes)?.[1] ?? 0);
	const needed = (kib("size-pack") + kib("size")) * 1024;
	const free = await freeSpace();
	if (free !== null && free < needed * 1.1 + 64 * 1024 * 1024) {
		throw new Error(`There is not enough free space to copy its history for scanning (about ${Math.ceil(needed / 1024 / 1024)} MB is needed).`);
	}

	const dir = await makeTemp("copy");
	try {
		await git(run, ["init", "--bare", "-q", "--template=", dir], "init");
		if (wanted.size === 0 && heads.length === 0) return { dir, shallow: false, empty: true };
		const gitPath = await onPath("git");
		// upload-pack runs in the source and reads its config: these settings come last, so they win. They
		// show every ref, ignore a commit-graph and (through GIT_GRAFT_FILE, pointed at a file that does
		// not exist) grafts, and allow the worktree HEADs to be fetched by id. git runs this through a shell.
		const uploadPack = [
			`GIT_GRAFT_FILE=${quoted(join(dir, "no-grafts"))}`,
			quoted(gitPath),
			"-c core.commitGraph=false",
			"-c 'transfer.hideRefs=!refs/'",
			"-c 'uploadpack.hideRefs=!refs/'",
			"-c uploadpack.allowAnySHA1InWant=true",
			"upload-pack",
		].join(" ");
		await git(
			run,
			[
				"-C",
				dir,
				...COPY_ARGS,
				"fetch",
				"-q",
				"--update-shallow",
				"--no-tags",
				"--no-write-fetch-head",
				"--no-auto-maintenance",
				"--no-recurse-submodules",
				`--upload-pack=${uploadPack}`,
				"--",
				repo,
				"+refs/*:refs/*",
				"^refs/replace/*",
				"^refs/porchlight/*",
				...heads.map((id, index) => `+${id}:refs/porchlight/head-${index}`),
			],
			"fetch",
		);
		const copied = refsOf(await git(run, ["-C", dir, "for-each-ref", "--format=%(objectname) %(refname)"], "for-each-ref"));
		const missing = [...wanted].filter(([ref, id]) => copied.get(ref) !== id).length + heads.filter((id, index) => copied.get(`refs/porchlight/head-${index}`) !== id).length;
		if (missing > 0) throw new Error(`Its history could not be copied whole for scanning (${missing === 1 ? "1 ref" : `${missing} refs`} did not match), so it was not read.`);
		const shallow = (await git(run, ["-C", dir, "rev-parse", "--is-shallow-repository"], "rev-parse")).trim() === "true";
		return { dir, shallow, empty: false };
	} catch (err) {
		await removeTemp(dir);
		throw err;
	}
}
