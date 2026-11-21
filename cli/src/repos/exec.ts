import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute } from "node:path";
import { makeTempSync } from "./temp.ts";

export interface ExecResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface RunOptions {
	/** Added to the child's environment (see childEnv) for the one command. */
	env?: Record<string, string>;
	/** Stop the command after this long (default 10 minutes). */
	timeoutMs?: number;
	/** Stops the command when aborted; the run then rejects with a CancelledError. */
	signal?: AbortSignal;
	/** The folder the command runs in (default: a private empty folder of Porchlight's own, see runFolder). */
	cwd?: string;
	/** Read the output byte for byte, one character a byte, for content that is not text: `Buffer.from(stdout, "latin1")` gives the bytes back. */
	latin1?: boolean;
	/** Written to the program's standard input, which is then closed: object ids for `git cat-file --batch`, say. */
	input?: string;
}

/** Runs a program and resolves with its exit code and output, whatever the code. */
export type Runner = (command: string, args: string[], options?: RunOptions) => Promise<ExecResult>;

export class ToolMissingError extends Error {
	constructor(command: string) {
		super(`${command} is not installed`);
		this.name = "ToolMissingError";
	}
}

/** A run stopped because its owner cancelled it: not a failure of the program or of what it was reading. */
export class CancelledError extends Error {
	constructor() {
		super("Cancelled");
		this.name = "CancelledError";
	}
}

const TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

/**
 * What a child process inherits from this one: what tools need to run, find their files and reach
 * the network through the owner's proxy. Never Porchlight's own keys and tokens (the admin token, model,
 * GitHub and Cloudflare keys, the UI key, the notice address): a scanner or a tool the host check runs
 * has no use for them, and code a repository manages to run must not find them.
 */
const PASSED_ON = [
	"HOME",
	"USER",
	"LOGNAME",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"LC_MESSAGES",
	"TZ",
	"TMPDIR",
	"TMP",
	"TEMP",
	"SYSTEMROOT",
	"DEVELOPER_DIR",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"XDG_CACHE_HOME",
	"XDG_CONFIG_HOME",
	"XDG_DATA_HOME",
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"NO_PROXY",
	"ALL_PROXY",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"all_proxy",
];

/**
 * PATH with only its absolute entries. An empty entry or "." means the folder a command runs in, so a
 * repository holding a program named like a scanner could otherwise be run in its place.
 */
export function safePath(path: string | undefined): string {
	return (path ?? "")
		.split(delimiter)
		.filter((dir) => dir !== "" && isAbsolute(dir))
		.join(delimiter);
}

/**
 * The environment every child process starts from, before a caller's own additions.
 * PYTHONSAFEPATH keeps Python from putting the folder it runs in first on its import path (`python3 -m
 * pip` would otherwise run a repository's own `pip/`), and npm's update notifier, which asks the npm
 * registry about npm itself, stays off.
 */
export function childEnv(extra: Record<string, string> = {}, from: NodeJS.ProcessEnv = process.env): Record<string, string> {
	const env: Record<string, string> = {};
	for (const name of PASSED_ON) {
		const value = from[name];
		if (value !== undefined) env[name] = value;
	}
	env.PATH = safePath(from.PATH);
	env.PYTHONSAFEPATH = "1";
	env.NPM_CONFIG_UPDATE_NOTIFIER = "false";
	return { ...env, ...extra };
}

let folder: string | undefined;

/**
 * An empty folder only this user can open, where a command runs unless it names its own: never the
 * folder Porchlight was started in, which may be a repository it is about to scan. Made again if a
 * clean-up removed it.
 */
export function runFolder(): string {
	if (folder === undefined || !existsSync(folder)) folder = makeTempSync("run");
	return folder;
}

/**
 * Arguments are passed as an array and no shell is involved, so repository
 * paths cannot be interpreted as commands. The program is looked up on the
 * child's PATH, which holds absolute folders only (see childEnv).
 */
export const run: Runner = (command, args, options) =>
	new Promise((resolve, reject) => {
		const env = childEnv(options?.env);
		if (options?.signal?.aborted) return reject(new CancelledError());
		const cwd = options?.cwd ?? runFolder();
		const child = execFile(command, args, { timeout: options?.timeoutMs ?? TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, env, signal: options?.signal, cwd, encoding: options?.latin1 ? "latin1" : "utf8" }, (error, stdout, stderr) => {
			if (!error) return resolve({ code: 0, stdout, stderr });
			if (error.name === "AbortError" || options?.signal?.aborted) return reject(new CancelledError());
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return reject(new ToolMissingError(command));
			if (typeof error.code === "number") return resolve({ code: error.code, stdout, stderr });
			reject(new Error(error.killed ? `${command} timed out` : error.message));
		});
		// A program that stops reading early closes its end; that is its business, not an error here.
		child.stdin?.on("error", () => {});
		child.stdin?.end(options?.input ?? "");
	});

/**
 * A scanner's error line with what it quotes from a repository's own settings put in fixed words
 * (S58): git quotes a bad value as it is ('run: curl … | sh'), and the page would show it in
 * Porchlight's voice. A quoted path or a setting's name is kept.
 */
export function quotedValuesOut(line: string): string {
	return line.replace(/'([^'\n]*)'|"([^"\n]*)"/g, (whole, single: string | undefined, double: string | undefined) => {
		const inner = single ?? double ?? "";
		// A path, a setting's name, or an address without spaces (osv-scanner quotes the one it could not reach).
		return /^(?:\/[^|;&$`<>\\]*|[A-Za-z0-9_.-]{1,60}|https?:\/\/[^\s|;&$`<>\\]+)$/.test(inner) ? whole : "(a value from the repository)";
	});
}

export function firstLine(text: string): string {
	return text.trim().split("\n")[0]?.slice(0, 300) ?? "";
}

export function lastLine(text: string): string {
	return text.trim().split("\n").at(-1)?.slice(0, 300) ?? "";
}
