/**
 * `porchlight hook` (FT-10): a pre-commit check of the staged files with Porchlight's own rules,
 * gitleaks' built-in ones and the private-data ones (invariant 14: never the repository's
 * `.gitleaks.toml`). It reads the staged content from git's object store with `cat-file --batch`,
 * which converts nothing, into a private temporary folder, and runs gitleaks there with `--redact`
 * (invariant 3). It prints a match's kind, rule, file and line, never a value. Porchlight never
 * writes into a repository: `porchlight hook print` prints the hook for the owner to install.
 */
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { GIT_SAFE_ARGS } from "../github/github.ts";
import { firstLine, type Runner } from "./exec.ts";
import { gitReadEnv } from "./git-copy.ts";
import { folderRows, headFiles, MAX_FILE_BYTES, readBlobs } from "./gitleaks.ts";
import { isPrivateRule } from "./private.ts";
import { gitleaksConfig } from "./rules.ts";
import { makeTemp, removeTemp } from "./temp.ts";

export interface HookMatch {
	kind: "secret" | "private data";
	rule: string;
	file: string;
	line?: number;
}

export interface HookResult {
	matches: HookMatch[];
	/** Files whose staged content differs from HEAD's: what was read. */
	staged: number;
	/** Staged files not read: larger than MAX_FILE_BYTES, or a path that cannot be a file here. */
	unread: string[];
	/** The repository has a .gitleaksignore, which hides what it lists (honoured, and said). */
	ignoreFile: boolean;
}

/** One path part that cannot be written as a file under the temporary folder. */
function unsafePart(part: string): boolean {
	return part === "" || part === "." || part === ".." || part.toLowerCase() === ".git";
}

/**
 * The environment git reads the index in. git runs a hook with GIT_INDEX_FILE naming the index the
 * commit is made from (a temporary one for `git commit <file>`), so that one is read; nothing else of
 * the caller's environment is passed on, and none of the user's or the system's git settings apply.
 */
function indexEnv(top: string, from: NodeJS.ProcessEnv): Record<string, string> {
	const env = gitReadEnv(from);
	const index = from.GIT_INDEX_FILE;
	if (index && !index.includes("\0")) env.GIT_INDEX_FILE = isAbsolute(index) ? index : resolve(top, index);
	return env;
}

/** The staged regular files, by path, with the id of the content staged; a file in a merge conflict has none and is left out. */
async function stagedEntries(top: string, run: Runner, env: Record<string, string>): Promise<Map<string, string>> {
	const { code, stdout, stderr } = await run("git", [...GIT_SAFE_ARGS, "-C", top, "ls-files", "--stage", "-z"], { env });
	if (code !== 0) throw new Error(firstLine(stderr) || `git exited with code ${code}`);
	const files = new Map<string, string>();
	for (const entry of stdout.split("\0")) {
		const match = /^(\d{6}) ([0-9a-f]{40,64}) 0\t(.+)$/s.exec(entry);
		if (match && (match[1] === "100644" || match[1] === "100755" || match[1] === "100664")) files.set(match[3]!, match[2]!);
	}
	return files;
}

/** Checks what is staged in the repository that holds `cwd`. Throws when git or gitleaks cannot run: an unchecked commit is never called clean. */
export async function checkStaged(cwd: string, run: Runner, from: NodeJS.ProcessEnv = process.env): Promise<HookResult> {
	const top = await run("git", [...GIT_SAFE_ARGS, "-C", cwd, "rev-parse", "--show-toplevel"], { env: gitReadEnv(from) });
	if (top.code !== 0) throw new Error(`Not inside a git repository: ${firstLine(top.stderr) || cwd}`);
	const repo = top.stdout.trim();
	const env = indexEnv(repo, from);
	const [index, head] = await Promise.all([stagedEntries(repo, run, env), headFiles(repo, run)]);
	const changed = [...index].filter(([path, id]) => head.get(path) !== id);
	const unread: string[] = [];
	const wanted = changed.filter(([path]) => {
		const unsafe = path.split("/").some(unsafePart);
		if (unsafe) unread.push(path);
		return !unsafe;
	});
	const blobs = await readBlobs(repo, [...new Set(wanted.map(([, id]) => id))], run);
	const ignoreFile = await lstat(join(repo, ".gitleaksignore")).then(
		() => true,
		() => false,
	);
	const dir = await makeTemp("files");
	try {
		for (const [path, id] of wanted) {
			const content = blobs.get(id);
			// readBlobs leaves out a blob past MAX_FILE_BYTES, or one git could not give.
			if (!content || content.length > MAX_FILE_BYTES) {
				unread.push(path);
				continue;
			}
			const target = join(dir, ...path.split("/"));
			await mkdir(dirname(target), { recursive: true, mode: 0o700 });
			await writeFile(target, content, { mode: 0o600, flag: "wx" });
		}
		const rows = changed.length === 0 ? [] : await folderRows(dir, repo, run, gitleaksConfig({ privateData: true }));
		const matches = rows.flatMap((row): HookMatch[] => {
			const { RuleID, File, StartLine } = (row ?? {}) as Record<string, unknown>;
			if (typeof RuleID !== "string" || typeof File !== "string") return [];
			return [{ kind: isPrivateRule(RuleID) ? "private data" : "secret", rule: RuleID, file: File.replace(/^\.\//, ""), ...(typeof StartLine === "number" ? { line: StartLine } : {}) }];
		});
		matches.sort((a, b) => a.file.localeCompare(b.file, "en") || (a.line ?? 0) - (b.line ?? 0) || a.rule.localeCompare(b.rule, "en"));
		return { matches, staged: changed.length, unread: unread.sort(), ignoreFile };
	} finally {
		await removeTemp(dir);
	}
}

/** What the hook prints: each match by kind, rule and place, never a value, and what was not read. */
export function renderHook(result: HookResult): string {
	const lines: string[] = [];
	if (result.matches.length > 0) {
		lines.push(`Porchlight found ${result.matches.length === 1 ? "1 match" : `${result.matches.length} matches`} in the staged files:`);
		for (const match of result.matches) lines.push(`  ${match.kind}  ${match.rule}  ${match.file}${match.line !== undefined ? `:${match.line}` : ""}`);
		lines.push("", "Remove them from the files (and rotate any real secret), stage the files again, then commit.", "To commit without this check once: git commit --no-verify");
	} else {
		lines.push(`Porchlight: nothing found in ${result.staged === 1 ? "1 staged file" : `${result.staged} staged files`}.`);
	}
	if (result.unread.length > 0) lines.push(`Not read (larger than 50 MB, or not a file that could be written here): ${result.unread.slice(0, 10).join(", ")}${result.unread.length > 10 ? ` and ${result.unread.length - 10} more` : ""}`);
	if (result.ignoreFile) lines.push("This repository has a .gitleaksignore: secrets it lists are not reported.");
	return `${lines.join("\n")}\n`;
}

/** A word as sh reads it: as it is when it holds only safe characters, otherwise in single quotes. */
function shellWord(word: string): string {
	return /^[\w.@%+=:,/-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

/**
 * The pre-commit hook, for the owner to install: it runs this copy of Porchlight with this Node.
 * Porchlight never writes it into a repository itself.
 */
export function hookScript(nodePath: string, porchlightPath: string): string {
	if (/[\0\n\r]/.test(nodePath + porchlightPath)) throw new Error("A path with a line break cannot be written into a hook");
	return [
		"#!/bin/sh",
		"# Porchlight's pre-commit check: secrets and private data in the staged files, with",
		"# Porchlight's own rules. It prints kind, rule, file and line, never a value.",
		"# To commit without it once: git commit --no-verify",
		`exec ${shellWord(nodePath)} ${shellWord(porchlightPath)} hook`,
		"",
	].join("\n");
}

/** How to install the hook, said on the error stream so the script itself can be redirected into place. */
export const HOOK_INSTALL = `To install it in a repository:
  porchlight hook print > .git/hooks/pre-commit && chmod +x .git/hooks/pre-commit
Or, where the repository sets core.hooksPath, into that folder instead. Porchlight writes nothing there itself.`;

/** The command: `porchlight hook` checks what is staged; `porchlight hook print` prints the hook. */
export async function hookCommand(
	command: string | undefined,
	io: { print: (text: string) => void; warn: (text: string) => void },
	options: { run: Runner; cwd?: string; env?: NodeJS.ProcessEnv; node?: string; porchlight?: string },
): Promise<number> {
	if (command === "print") {
		io.print(hookScript(options.node ?? process.execPath, options.porchlight ?? fileURLToPath(new URL("../../bin/porchlight.js", import.meta.url))));
		io.warn(HOOK_INSTALL);
		return 0;
	}
	if (command !== undefined && command !== "check") throw new Error("Usage: porchlight hook [check|print]");
	let result: HookResult;
	try {
		result = await checkStaged(options.cwd ?? process.cwd(), options.run, options.env ?? process.env);
	} catch (err) {
		// Not checked is never clean: the commit stops, and the owner is told how to go past it once.
		io.warn(`porchlight: the staged files were not checked: ${err instanceof Error ? err.message : String(err)}. To commit without the check once: git commit --no-verify`);
		return 1;
	}
	// Matches go to the error stream, where git shows a hook's refusal.
	if (result.matches.length > 0) io.warn(renderHook(result).trimEnd());
	else io.print(renderHook(result));
	return result.matches.length > 0 ? 1 : 0;
}
