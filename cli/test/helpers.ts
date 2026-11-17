import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { ToolMissingError, type ExecResult, type Runner } from "../src/repos/exec.ts";

const exec = promisify(execFile);

export function tempDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "securityx-test-"));
}

/** Creates files (and their directories) under `root`. A path ending in `/` makes an empty directory. */
export async function makeTree(root: string, files: Record<string, string>): Promise<void> {
	for (const [path, content] of Object.entries(files)) {
		const full = join(root, path);
		if (path.endsWith("/")) {
			await mkdir(full, { recursive: true });
		} else {
			await mkdir(dirname(full), { recursive: true });
			await writeFile(full, content);
		}
	}
}

export async function git(cwd: string, ...args: string[]): Promise<void> {
	await exec("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args], { cwd });
}

export async function installed(command: string): Promise<boolean> {
	try {
		await exec(command, ["--version"]);
		return true;
	} catch (err) {
		return (err as NodeJS.ErrnoException).code !== "ENOENT";
	}
}

/**
 * A credential-shaped string for exercising the real scanner. Assembled at
 * run time so this repository's own secret scan has nothing to find.
 */
export function fakeAwsKeyId(): string {
	return ["AKIA", "Q3EGTZNX", "PL7VWK4D"].join("");
}

/** A scripted runner: maps a program name to its result, or to "missing". */
export function fakeRunner(
	programs: Record<string, "missing" | ((args: string[]) => Partial<ExecResult>)>,
): Runner & { calls: string[][] } {
	const calls: string[][] = [];
	const runner: Runner = async (command, args) => {
		calls.push([command, ...args]);
		const program = programs[command];
		if (program === undefined || program === "missing") throw new ToolMissingError(command);
		return { code: 0, stdout: "", stderr: "", ...program(args) };
	};
	return Object.assign(runner, { calls });
}
