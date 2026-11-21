import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { ToolMissingError, type ExecResult, type Runner } from "../src/repos/exec.ts";

const exec = promisify(execFile);

export function tempDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "porchlight-test-"));
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
): Runner & { calls: string[][]; envs: (Record<string, string> | undefined)[] } {
	const calls: string[][] = [];
	/** The environment each call was given, in the same order as `calls`. */
	const envs: (Record<string, string> | undefined)[] = [];
	const runner: Runner = async (command, args, options) => {
		calls.push([command, ...args]);
		envs.push(options?.env);
		const program = programs[command];
		if (program === undefined || program === "missing") throw new ToolMissingError(command);
		return { code: 0, stdout: "", stderr: "", ...program(args) };
	};
	return Object.assign(runner, { calls, envs });
}

/** A JPEG holding only EXIF data, with a GPS position unless both are zero. */
export function photoWithGps(latitude: [number, number, number], longitude: [number, number, number], bigEndian = false): Buffer {
	const t = Buffer.alloc(104);
	const u16 = (value: number, at: number) => (bigEndian ? t.writeUInt16BE(value, at) : t.writeUInt16LE(value, at));
	const u32 = (value: number, at: number) => (bigEndian ? t.writeUInt32BE(value, at) : t.writeUInt32LE(value, at));
	t.write(bigEndian ? "MM" : "II", 0, "latin1");
	u16(42, 2);
	u32(8, 4);
	// IFD0: one entry, the GPS IFD's place.
	u16(1, 8);
	u16(0x8825, 10);
	u16(4, 12);
	u32(1, 14);
	u32(26, 18);
	u32(0, 22);
	// GPS IFD: latitude (2) and longitude (4), three rationals each.
	u16(2, 26);
	for (const [index, tag, at] of [
		[0, 2, 56],
		[1, 4, 80],
	] as const) {
		u16(tag, 28 + index * 12);
		u16(5, 30 + index * 12);
		u32(3, 32 + index * 12);
		u32(at, 36 + index * 12);
	}
	u32(0, 52);
	for (const [at, values] of [
		[56, latitude],
		[80, longitude],
	] as const) {
		values.forEach((value, part) => {
			u32(value, at + part * 8);
			u32(part === 2 ? 100 : 1, at + part * 8 + 4);
		});
	}
	const exif = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), t]);
	const app1 = Buffer.alloc(4);
	app1.writeUInt16BE(0xffe1, 0);
	app1.writeUInt16BE(exif.length + 2, 2);
	return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, exif, Buffer.from([0xff, 0xd9])]);
}
