import { execFile } from "node:child_process";

export interface ExecResult {
	code: number;
	stdout: string;
	stderr: string;
}

/** Runs a program and resolves with its exit code and output, whatever the code. */
export type Runner = (command: string, args: string[]) => Promise<ExecResult>;

export class ToolMissingError extends Error {
	constructor(command: string) {
		super(`${command} is not installed`);
		this.name = "ToolMissingError";
	}
}

const TIMEOUT_MS = 10 * 60_000;
const MAX_OUTPUT_BYTES = 256 * 1024 * 1024;

/**
 * Arguments are passed as an array and no shell is involved, so repository
 * paths cannot be interpreted as commands.
 */
export const run: Runner = (command, args) =>
	new Promise((resolve, reject) => {
		execFile(command, args, { timeout: TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout, stderr) => {
			if (!error) return resolve({ code: 0, stdout, stderr });
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
