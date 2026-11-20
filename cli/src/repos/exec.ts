import { execFile } from "node:child_process";

export interface ExecResult {
	code: number;
	stdout: string;
	stderr: string;
}

export interface RunOptions {
	/** Added to this process's environment for the one command. */
	env?: Record<string, string>;
	/** Stop the command after this long (default 10 minutes). */
	timeoutMs?: number;
	/** Stops the command when aborted; the run then rejects with a CancelledError. */
	signal?: AbortSignal;
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
 * Arguments are passed as an array and no shell is involved, so repository
 * paths cannot be interpreted as commands.
 */
export const run: Runner = (command, args, options) =>
	new Promise((resolve, reject) => {
		const env = options?.env ? { ...process.env, ...options.env } : undefined;
		if (options?.signal?.aborted) return reject(new CancelledError());
		execFile(command, args, { timeout: options?.timeoutMs ?? TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, env, signal: options?.signal }, (error, stdout, stderr) => {
			if (!error) return resolve({ code: 0, stdout, stderr });
			if (error.name === "AbortError" || options?.signal?.aborted) return reject(new CancelledError());
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return reject(new ToolMissingError(command));
			if (typeof error.code === "number") return resolve({ code: error.code, stdout, stderr });
			reject(new Error(error.killed ? `${command} timed out` : error.message));
		});
	});

export function firstLine(text: string): string {
	return text.trim().split("\n")[0]?.slice(0, 300) ?? "";
}

export function lastLine(text: string): string {
	return text.trim().split("\n").at(-1)?.slice(0, 300) ?? "";
}
