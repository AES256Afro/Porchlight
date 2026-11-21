/**
 * Moving settings between computers (FT-17): `porchlight settings export <file>` and
 * `porchlight settings import <file>`, from the command line only, so no key ever reaches a page.
 *
 * What moves: the look and where answers appear, projects (each folder checked again on import), the
 * owner's statuses and notes on findings (by `findingKey`), due dates, the model chosen and the model
 * for each task. Keys and tokens (model keys, the monitor's admin token, the Cloudflare token, the
 * ownership tokens of investigated domains) move only with `--include-keys`, and then the whole file is
 * encrypted with a passphrase: scrypt and AES-256-GCM from node:crypto. A key is never written in
 * plain text. The access key for other devices never moves: it belongs to one computer.
 *
 * Files are written 0600 (private-files.ts). An export never writes over a file that is there. An
 * import reads every file it would change first: one that is there but cannot be read stops the import
 * before anything is written (invariant 5). A setting already here is kept unless `--replace` is given;
 * notes and projects are merged, and what is here wins.
 */
import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, type ScryptOptions } from "node:crypto";
import { open, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { readPrivateJson, UnreadableFileError, writePrivateJson } from "./private-files.ts";
import { tokenShapeProblem } from "./cloudflare/client.ts";
import { parseMonitorSettings } from "./monitor/settings.ts";
import { checkFolder } from "./projects/projects.ts";
import { parseDomain } from "./investigate/scope.ts";
import { isAnswerPlace, isLook } from "../ui/looks.js";
import { modelChoice } from "../ui/models.js";
import { duePolicyOf } from "../ui/due.js";
import { isStatus } from "../ui/tracking.js";

export const SETTINGS_FORMAT = 1;
/** The shortest passphrase taken: the file holds every key, and may be copied anywhere. */
export const MIN_PASSPHRASE = 12;
/** scrypt's cost: 2^17 rounds, about a quarter of a second and 128 MB on a laptop. */
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 } as const;
const HEADER = "porchlight-settings-v1";

/** The files of the data folder that move, without their keys. */
const PLAIN_FILES = ["ui-settings.json", "projects.json", "due-dates.json", "model-tasks.json", "model-settings.json"] as const;
/** The files that are keys and tokens, moved whole and only encrypted. */
const KEY_FILES = ["monitor-settings.json", "cloudflare-settings.json", "investigate-domains.json"] as const;
const NOTES = "finding-notes.json";

type Bundle = { files: Record<string, unknown>; keys?: Record<string, unknown> };

export interface SettingsFile {
	porchlight: "settings";
	version: number;
	exportedAt: string;
	/** Present when the file holds no key. */
	files?: Record<string, unknown>;
	/** Present when it does: everything, encrypted. */
	encrypted?: { kdf: "scrypt"; N: number; r: number; p: number; salt: string; iv: string; tag: string; data: string };
}

export interface TransferDeps {
	dataDir: string;
	/** The report beside which the notes are kept (default: repo-scan.json in the data folder). */
	reportPath?: string;
	/** Asks for the passphrase: PORCHLIGHT_SETTINGS_PASSPHRASE, or the terminal with nothing echoed. */
	passphrase: (confirm: boolean) => Promise<string>;
	home?: string;
	now?: () => Date;
}

function scrypt(passphrase: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
	return new Promise((done, fail) => scryptCallback(passphrase.normalize("NFC"), salt, 32, options, (err, key) => (err ? fail(err) : done(key))));
}

export async function encrypt(plain: string, passphrase: string): Promise<NonNullable<SettingsFile["encrypted"]>> {
	const salt = randomBytes(16);
	const iv = randomBytes(12);
	const key = await scrypt(passphrase, salt, SCRYPT);
	const cipher = createCipheriv("aes-256-gcm", key, iv);
	cipher.setAAD(Buffer.from(HEADER));
	const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
	return { kdf: "scrypt", N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, salt: salt.toString("base64"), iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"), data: data.toString("base64") };
}

export async function decrypt(sealed: NonNullable<SettingsFile["encrypted"]>, passphrase: string): Promise<string> {
	if (sealed.kdf !== "scrypt" || ![2 ** 15, 2 ** 16, 2 ** 17, 2 ** 18].includes(sealed.N) || sealed.r !== 8 || sealed.p !== 1) throw new Error("This settings file was not made by a Porchlight that this one can read");
	const key = await scrypt(passphrase, Buffer.from(sealed.salt, "base64"), { N: sealed.N, r: sealed.r, p: sealed.p, maxmem: SCRYPT.maxmem * 2 });
	try {
		const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
		decipher.setAAD(Buffer.from(HEADER));
		decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
		return Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8");
	} catch {
		throw new Error("That passphrase does not open this file, or the file was changed after it was made");
	}
}

/** A kept file's value, nothing when it is not there, and a refusal when it cannot be read. */
async function kept(path: string, what: string): Promise<unknown> {
	const read = await readPrivateJson(path);
	if (read.state === "unreadable") throw new UnreadableFileError(what, read.reason);
	return read.state === "read" ? read.value : undefined;
}

function notesPathOf(deps: TransferDeps): string {
	return join(dirname(deps.reportPath ?? join(deps.dataDir, "repo-scan.json")), NOTES);
}

/** What an export holds, before it is written. Keys only when asked for. */
export async function gather(deps: TransferDeps, includeKeys: boolean): Promise<Bundle> {
	const files: Record<string, unknown> = {};
	const keys: Record<string, unknown> = {};
	for (const name of PLAIN_FILES) {
		const value = await kept(join(deps.dataDir, name), name);
		if (value === undefined) continue;
		if (name === "model-settings.json" && typeof value === "object" && value !== null) {
			const { keys: modelKeys, ...rest } = value as Record<string, unknown>;
			files[name] = rest;
			if (includeKeys && modelKeys !== undefined) keys["model-keys"] = modelKeys;
		} else files[name] = value;
	}
	const notes = await kept(notesPathOf(deps), NOTES);
	if (notes !== undefined) files[NOTES] = notes;
	if (includeKeys) {
		for (const name of KEY_FILES) {
			const value = await kept(join(deps.dataDir, name), name);
			if (value !== undefined) keys[name] = value;
		}
	}
	return includeKeys ? { files, keys } : { files };
}

/** Writes the export: plain JSON without keys, or the whole of it encrypted with them. Never over a file that is there. */
export async function exportSettings(out: string, deps: TransferDeps, includeKeys: boolean): Promise<{ files: string[]; keys: string[] }> {
	const bundle = await gather(deps, includeKeys);
	const exportedAt = (deps.now?.() ?? new Date()).toISOString();
	let document: SettingsFile;
	if (includeKeys) {
		const passphrase = await deps.passphrase(true);
		if (passphrase.length < MIN_PASSPHRASE) throw new Error(`Choose a passphrase of at least ${MIN_PASSPHRASE} characters: the file holds your keys`);
		document = { porchlight: "settings", version: SETTINGS_FORMAT, exportedAt, encrypted: await encrypt(JSON.stringify(bundle), passphrase) };
	} else {
		document = { porchlight: "settings", version: SETTINGS_FORMAT, exportedAt, files: bundle.files };
	}
	let handle;
	try {
		handle = await open(out, "wx", 0o600);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${out} is already there. Choose a new name: an export never writes over a file`);
		throw err;
	}
	try {
		await handle.writeFile(`${JSON.stringify(document, null, "\t")}\n`);
	} finally {
		await handle.close();
	}
	return { files: Object.keys(bundle.files), keys: Object.keys(bundle.keys ?? {}) };
}

/** Reads an export, asking for the passphrase when it is encrypted. */
export async function openSettings(text: string, deps: Pick<TransferDeps, "passphrase">): Promise<Bundle> {
	let document: SettingsFile;
	try {
		document = JSON.parse(text) as SettingsFile;
	} catch {
		throw new Error("This is not a Porchlight settings file");
	}
	if (document?.porchlight !== "settings" || typeof document.version !== "number") throw new Error("This is not a Porchlight settings file");
	if (document.version > SETTINGS_FORMAT) throw new Error("This settings file was made by a newer Porchlight. Update this one first");
	if (document.encrypted) {
		const bundle = JSON.parse(await decrypt(document.encrypted, await deps.passphrase(false))) as Bundle;
		if (typeof bundle?.files !== "object" || bundle.files === null) throw new Error("This settings file is not complete");
		return bundle;
	}
	if (typeof document.files !== "object" || document.files === null) throw new Error("This settings file is not complete");
	return { files: document.files };
}

/** What an import did, in lines for the terminal. Never a key or a token. */
export interface ImportResult {
	lines: string[];
}

function object(value: unknown): Record<string, unknown> | null {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * Brings settings in. Every file it would change is read first; one that cannot be read stops it before
 * anything is written. Each value is checked as the page or the command would check it.
 */
export async function importSettings(bundle: Bundle, deps: TransferDeps, replace: boolean): Promise<ImportResult> {
	const lines: string[] = [];
	const writes: { path: string; value: unknown }[] = [];
	const home = deps.home ?? homedir();
	const here = async (name: string) => kept(join(deps.dataDir, name), name);

	// Every file it would change is read before anything is written.
	const current: Record<string, unknown> = {};
	for (const name of [...PLAIN_FILES, ...KEY_FILES]) current[name] = await here(name);
	const notesPath = notesPathOf(deps);
	current[NOTES] = await kept(notesPath, NOTES);

	const whole = (name: string, value: unknown, valid: boolean, words: string) => {
		if (value === undefined) return;
		if (!valid) return lines.push(`${words}: not brought in, it is not in a form this Porchlight takes`);
		if (current[name] !== undefined && !replace) return lines.push(`${words}: kept yours (--replace brings this one in)`);
		writes.push({ path: join(deps.dataDir, name), value });
		lines.push(`${words}: brought in`);
	};

	const files = bundle.files;
	const ui = object(files["ui-settings.json"]);
	whole("ui-settings.json", ui ? { ...(isLook(ui.appearance) ? { appearance: ui.appearance } : {}), ...(isAnswerPlace(ui.answers) ? { answers: ui.answers } : {}) } : files["ui-settings.json"], ui !== null, "Appearance");
	const due = duePolicyOf(files["due-dates.json"]);
	whole("due-dates.json", files["due-dates.json"] === undefined ? undefined : due, due !== null, "Due dates");
	const tasks = object(object(files["model-tasks.json"])?.tasks);
	whole("model-tasks.json", files["model-tasks.json"], tasks !== null && Object.values(tasks).every((id) => typeof id === "string" && /^[\w-]{1,60}$/.test(id)), "Model for each task");

	// The model chosen, with its keys when the file carried them.
	const model = object(files["model-settings.json"]);
	if (model) {
		const keys = object(bundle.keys?.["model-keys"]);
		whole("model-settings.json", { ...model, ...(keys ? { keys } : {}) }, modelChoice(model.choice) !== null, keys ? "Model, with its keys" : "Model (no keys: export with --include-keys to bring them)");
	}

	// Keys and tokens, each checked as Settings would check it.
	const monitor = object(bundle.keys?.["monitor-settings.json"]);
	if (monitor) {
		let valid = true;
		try {
			parseMonitorSettings(monitor.url, monitor.token);
		} catch {
			valid = false;
		}
		whole("monitor-settings.json", monitor, valid, "Monitor and its admin token");
	}
	const cloudflare = object(bundle.keys?.["cloudflare-settings.json"]);
	if (cloudflare) whole("cloudflare-settings.json", cloudflare, typeof cloudflare.token === "string" && !tokenShapeProblem(cloudflare.token), "Cloudflare token");
	const domains = object(object(bundle.keys?.["investigate-domains.json"])?.domains);
	if (domains) {
		const valid = Object.entries(domains).every(([name, entry]) => parseDomain(name) === name && typeof object(entry)?.token === "string");
		whole("investigate-domains.json", { domains }, valid, "Ownership tokens of investigated domains");
	}

	// Notes: merged by finding, what is here wins.
	const incomingNotes = object(files[NOTES]);
	if (incomingNotes) {
		const mine = object(current[NOTES]) ?? {};
		const added = Object.entries(incomingNotes).filter(([key, note]) => !(key in mine) && isStatus(object(note)?.status) && typeof object(note)?.note === "string");
		if (added.length > 0) writes.push({ path: notesPath, value: { ...mine, ...Object.fromEntries(added) } });
		lines.push(`Finding notes: ${added.length} brought in${Object.keys(incomingNotes).length > added.length ? `, ${Object.keys(incomingNotes).length - added.length} already here or not understood` : ""}`);
	}

	// Projects: merged, and each folder checked again on this computer.
	const incomingProjects = object(files["projects.json"]);
	if (incomingProjects && Array.isArray(incomingProjects.projects)) {
		const mine = object(current["projects.json"]);
		const list = Array.isArray(mine?.projects) ? [...(mine!.projects as Record<string, unknown>[])] : [];
		let added = 0;
		for (const raw of incomingProjects.projects) {
			const project = object(raw);
			if (!project || typeof project.id !== "string" || typeof project.name !== "string") continue;
			if (list.some((entry) => entry.id === project.id || entry.folder === project.folder)) continue;
			const check = await checkFolder(project.folder, { home });
			if (check.error) {
				lines.push(`Project ${String(project.name).slice(0, 60)}: not brought in (${check.error})`);
				continue;
			}
			list.push({ id: project.id, name: project.name, folder: check.folder, createdAt: typeof project.createdAt === "string" ? project.createdAt : (deps.now?.() ?? new Date()).toISOString() });
			added++;
		}
		if (added > 0) writes.push({ path: join(deps.dataDir, "projects.json"), value: { version: 1, current: typeof mine?.current === "string" ? mine.current : null, projects: list } });
		lines.push(`Projects: ${added} brought in`);
	}

	for (const write of writes) await writePrivateJson(write.path, write.value);
	return { lines };
}

/** Reads a passphrase from the terminal with nothing echoed, or from PORCHLIGHT_SETTINGS_PASSPHRASE. */
export function passphraseFrom(env: Record<string, string | undefined>, input: NodeJS.ReadStream = process.stdin, output: NodeJS.WriteStream = process.stderr): (confirm: boolean) => Promise<string> {
	return async (confirm) => {
		const fromEnv = env.PORCHLIGHT_SETTINGS_PASSPHRASE;
		if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
		if (!input.isTTY) throw new Error("Give the passphrase in PORCHLIGHT_SETTINGS_PASSPHRASE, or run this in a terminal to type it");
		const first = await hiddenLine("Passphrase: ", input, output);
		if (!confirm) return first;
		const second = await hiddenLine("The same passphrase again: ", input, output);
		if (first !== second) throw new Error("The two passphrases differ");
		return first;
	};
}

function hiddenLine(prompt: string, input: NodeJS.ReadStream, output: NodeJS.WriteStream): Promise<string> {
	return new Promise((done, fail) => {
		output.write(prompt);
		let text = "";
		input.setRawMode(true);
		input.resume();
		input.setEncoding("utf8");
		const finish = (error?: Error) => {
			input.setRawMode(false);
			input.pause();
			input.off("data", onData);
			output.write("\n");
			if (error) fail(error);
			else done(text);
		};
		const onData = (chunk: string) => {
			for (const char of chunk) {
				if (char === "\r" || char === "\n") return finish();
				if (char === "\u0003") return finish(new Error("Stopped"));
				if (char === "\u007f" || char === "\b") text = text.slice(0, -1);
				else if (char >= " ") text += char;
			}
		};
		input.on("data", onData);
	});
}

/** `porchlight settings export <file> [--include-keys]` and `porchlight settings import <file> [--replace]`. */
export async function settingsCommand(command: string | undefined, args: string[], io: { say: (text: string) => void; warn: (text: string) => void }, defaults: { dataDir: string; env?: Record<string, string | undefined> }): Promise<number> {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: { "include-keys": { type: "boolean", default: false }, replace: { type: "boolean", default: false }, data: { type: "string" }, report: { type: "string" } },
	});
	if (positionals.length !== 1) throw new Error(`Name one file: porchlight settings ${command === "import" ? "import" : "export"} <file>`);
	const dataDir = resolve(values.data ?? defaults.dataDir);
	const deps: TransferDeps = { dataDir, ...(values.report ? { reportPath: resolve(values.report) } : {}), passphrase: passphraseFrom(defaults.env ?? process.env) };
	const file = resolve(positionals[0]!);
	if (command === "export") {
		const done = await exportSettings(file, deps, values["include-keys"]);
		io.say(`Settings written to ${file}: ${done.files.length === 0 ? "nothing was set yet" : done.files.join(", ")}${done.keys.length > 0 ? `; keys and tokens, encrypted: ${done.keys.join(", ")}` : ""}`);
		if (!values["include-keys"]) io.say("No key or token is in it. Export again with --include-keys to move them too, encrypted with a passphrase.");
		return 0;
	}
	if (command === "import") {
		const bundle = await openSettings(await readFile(file, "utf8"), deps);
		const result = await importSettings(bundle, deps, values.replace);
		for (const line of result.lines) io.say(line);
		return 0;
	}
	throw new Error("Use porchlight settings export <file>, or porchlight settings import <file>");
}
