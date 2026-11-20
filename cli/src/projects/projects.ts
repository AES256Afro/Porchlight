/**
 * Projects: a name and a folder the owner chooses, so exports, discussions and a daily log of what
 * Porchlight did land in one place they know.
 *
 * The folder is the owner's. Porchlight writes only inside a `Porchlight` folder within it, never
 * through a symbolic link, never over a file it did not write, and only under names from a fixed list
 * with the date and time (`FILE_TITLES`). Nothing from a scan or a model's answer ever names a file,
 * so a hostile repository or answer cannot choose where anything is written (invariant 11). Folders
 * Porchlight makes are 0700 and files 0600, like everything else it keeps.
 *
 * The list of projects is kept beside the report (`projects.json`, 0600). Only the page on this
 * computer, or a service's own page, chooses or changes a folder; a service's folders stay inside
 * its data folder.
 */
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { writePrivate } from "../investigate/ownership.ts";

/** The one folder Porchlight writes in, inside the folder the owner chose. */
export const OWN_FOLDER = "Porchlight";
/** What it keeps there. */
export const PARTS = ["Exports", "Discussions", "Log"] as const;
export type Part = (typeof PARTS)[number];

/** Every name a file in a project can take, before the date, the time and the extension. */
export const FILE_TITLES = {
	roadmap: "Repair roadmap",
	findings: "Findings",
	"roadmap-partial": "Repair roadmap (partial)",
	"findings-partial": "Findings (partial)",
	"domain-roadmap": "Domain repair roadmap",
	"domain-findings": "Domain findings",
	investigation: "Investigation",
	"discussion-finding": "Explain a finding",
	"discussion-roadmap": "What to fix first",
	"discussion-domain": "Explain a domain",
	"discussion-ask": "Question about the scan",
	"discussion-send": "Sent to a model",
	"discussion-cloudflare": "Cloudflare analysis",
	cloudflare: "Cloudflare audit",
} as const;
export type FileTitle = keyof typeof FILE_TITLES;

const EXTENSIONS = new Set(["md", "html", "csv", "json", "txt"]);
/** A name Porchlight gave a file: "2026-11-19 15.30 Repair roadmap.md", or "… Repair roadmap 2.md". */
const OWN_NAME = new RegExp(
	`^\\d{4}-\\d{2}-\\d{2} \\d{2}\\.\\d{2} (?:${Object.values(FILE_TITLES)
		.map((title) => title.replace(/[()]/g, "\\$&"))
		.join("|")})(?: \\d{1,2})?\\.(?:${[...EXTENSIONS].join("|")})$`,
);

export const MAX_PROJECTS = 50;
export const MAX_NAME = 60;
const MAX_FOLDER = 1024;
const PROJECT_ID = /^prj_[0-9a-f]{16}$/;

export interface Project {
	id: string;
	/** The owner's words, shown on the page and in the log. Never a file name. */
	name: string;
	/** The folder chosen, as a whole path with links resolved. */
	folder: string;
	createdAt: string;
}

export interface ProjectsFile {
	version: 1;
	current: string | null;
	projects: Project[];
}

/** A file Porchlight wrote in a project. */
export interface Saved {
	project: string;
	part: Part;
	/** The file's name, one of Porchlight's own. */
	name: string;
	/** The whole path, for "Show in Finder". */
	path: string;
}

export function isProjectId(value: unknown): value is string {
	return typeof value === "string" && PROJECT_ID.test(value);
}

export function isOwnName(value: unknown): value is string {
	return typeof value === "string" && OWN_NAME.test(value);
}

/** The owner's name for a project, tidied, or null when there is nothing usable. */
export function cleanName(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const name = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
	return name.length >= 1 && name.length <= MAX_NAME ? name : null;
}

/** One line of text for the log: no line breaks or control characters, so nothing can forge a line. */
export function oneLine(text: string, max = 300): string {
	const line = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** The day and the time on this computer's clock, as file names and the log use them. */
export function stamp(date: Date): { day: string; minute: string; second: string } {
	const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	return { day, minute: `${pad(date.getHours())}.${pad(date.getMinutes())}`, second: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}` };
}

/** "2026-11-19 15.30 Repair roadmap.md", or with " 2" before the extension for the second that minute. */
export function fileName(title: FileTitle, extension: string, date: Date, copy = 1): string {
	if (!EXTENSIONS.has(extension)) throw new Error(`not a file type Porchlight writes: ${extension}`);
	const { day, minute } = stamp(date);
	return `${day} ${minute} ${FILE_TITLES[title]}${copy > 1 ? ` ${copy}` : ""}.${extension}`;
}

/** What choosing a folder would do, shown before anything is saved. */
export interface FolderCheck {
	/** The folder as it would be kept: a whole path, links resolved where it exists. */
	folder: string;
	/** Folders Porchlight would make, in order. */
	creates: string[];
	/** Reasons to think again, such as a folder inside a git repository. Never a refusal. */
	warnings: string[];
	/** Why this folder cannot be used. */
	error?: string;
}

export interface CheckOptions {
	home: string;
	/** A service keeps its project folders inside this folder (`projects` in its data folder). */
	within?: string;
	/** Folders Porchlight scans, so the owner hears that a scan would read the exports too. */
	scanRoots?: string[];
}

/**
 * Says what using a folder as a project would do. It only looks: nothing is made until the owner
 * saves the project. A folder that does not exist yet is made, if the folder above it exists.
 */
export async function checkFolder(input: unknown, options: CheckOptions): Promise<FolderCheck> {
	const typed = typeof input === "string" ? input.trim() : "";
	const fail = (error: string, folder = typed): FolderCheck => ({ folder, creates: [], warnings: [], error });
	if (typed === "") return fail("Type the folder, such as ~/Projects/acme-audit");
	if (typed.length > MAX_FOLDER || /[\u0000-\u001f\u007f]/.test(typed)) return fail("That is not a folder Porchlight can use");
	const expanded = typed === "~" ? options.home : typed.startsWith("~/") ? join(options.home, typed.slice(2)) : typed;
	if (!isAbsolute(expanded)) return fail("Type the whole path, such as ~/Projects/acme-audit");
	let folder = resolve(expanded);
	if (folder === sep || folder === resolve(options.home)) return fail("Choose a folder of its own, not the whole disk or your home folder");
	// A service's folders stay inside its own: said before anything outside it is looked at, and again once links are resolved.
	const base = options.within ? await realpath(options.within).catch(() => resolve(options.within as string)) : null;
	const outside = (path: string) => base !== null && !strictlyInside(path, base) && !strictlyInside(path, resolve(options.within as string));
	if (outside(folder)) return fail(`Here, project folders are kept in Porchlight's data folder. Choose one inside ${base}.`, folder);

	const creates: string[] = [];
	const info = await stat(folder).catch(() => null);
	if (info) {
		if (!info.isDirectory()) return fail("That is a file, not a folder", folder);
		folder = await realpath(folder);
	} else {
		const parent = await stat(dirname(folder)).catch(() => null);
		if (!parent?.isDirectory()) return fail(`${dirname(folder)} does not exist. Make it first, or choose another folder.`, folder);
		folder = join(await realpath(dirname(folder)), basename(folder));
		creates.push(folder);
	}
	if (base !== null && !strictlyInside(folder, base)) return fail(`Here, project folders are kept in Porchlight's data folder. Choose one inside ${base}.`, folder);

	const own = join(folder, OWN_FOLDER);
	const problem = await notOwnFolder(own);
	if (problem) return fail(problem, folder);
	if (!(await lstat(own).catch(() => null))) creates.push(own);
	for (const part of PARTS) {
		const path = join(own, part);
		const partProblem = await notOwnFolder(path);
		if (partProblem) return fail(partProblem, folder);
		if (!(await lstat(path).catch(() => null))) creates.push(path);
	}

	const warnings: string[] = [];
	const repository = await gitRepositoryAbove(folder);
	if (repository) {
		warnings.push(
			`This folder is inside a git repository (${repository}). Exports name the files where secrets were found, so add ${OWN_FOLDER}/ to its .gitignore, or choose a folder outside it.`,
		);
	}
	for (const root of options.scanRoots ?? []) {
		const base = await realpath(root).catch(() => resolve(root));
		if (inside(folder, base)) {
			warnings.push(`This folder is inside ${base}, which Porchlight scans. A scan there would read these exports too.`);
			break;
		}
	}
	return { folder, creates, warnings };
}

/** Whether `path` is `base` or inside it. */
function inside(path: string, base: string): boolean {
	const between = relative(base, path);
	return between === "" || (!between.startsWith("..") && !isAbsolute(between));
}

/** Whether `path` is inside `base`, and not `base` itself. */
function strictlyInside(path: string, base: string): boolean {
	return path !== base && inside(path, base);
}

/** Why a path cannot be one of Porchlight's own folders (a link or a file), or null when it can. */
async function notOwnFolder(path: string): Promise<string | null> {
	const info = await lstat(path).catch(() => null);
	if (!info) return null;
	if (info.isSymbolicLink()) return `${path} is a link. Porchlight writes only into folders of its own: remove the link, or choose another folder.`;
	if (!info.isDirectory()) return `${path} is a file. Porchlight writes only into folders of its own: move the file, or choose another folder.`;
	return null;
}

async function gitRepositoryAbove(folder: string): Promise<string | null> {
	let at = folder;
	for (;;) {
		if (await lstat(join(at, ".git")).catch(() => null)) return at;
		const up = dirname(at);
		if (up === at) return null;
		at = up;
	}
}

/**
 * The folder for one part of a project, made if missing. Refuses a link or a file where a folder of
 * Porchlight's own should be, checked again on every write, since the folder may have changed. The
 * folder chosen is made only when the project is added (`makeChosen`): one that has gone since was
 * moved or deleted by its owner, and is not made again behind their back.
 */
async function partFolder(project: Project, part: Part, makeChosen = false): Promise<string> {
	const top = await stat(project.folder).catch(() => null);
	if (!top?.isDirectory()) {
		const parent = await stat(dirname(project.folder)).catch(() => null);
		if (!makeChosen || !parent?.isDirectory()) {
			throw new ProjectError(`The folder of ${project.name}, ${project.folder}, is not there any more. Put it back, or add the project again under Settings → Projects.`);
		}
		await mkdir(project.folder, { mode: 0o700 });
	}
	for (const path of [join(project.folder, OWN_FOLDER), join(project.folder, OWN_FOLDER, part)]) {
		const problem = await notOwnFolder(path);
		if (problem) throw new ProjectError(problem);
		await mkdir(path, { mode: 0o700 }).catch((err: NodeJS.ErrnoException) => {
			if (err.code !== "EEXIST") throw err;
		});
		const problemAfter = await notOwnFolder(path);
		if (problemAfter) throw new ProjectError(problemAfter);
	}
	return join(project.folder, OWN_FOLDER, part);
}

/** Makes a new project's folders at once, so the owner can find them before anything is saved. */
export function prepareProject(project: Project): Promise<void> {
	return inProject(project, async () => {
		for (const part of PARTS) await partFolder(project, part, true);
	});
}

/** A project folder that cannot be written. The message is meant for the owner. */
export class ProjectError extends Error {}

/** Runs a write in a project, saying a failure of the disk in the owner's terms rather than as an error code. */
async function inProject<T>(project: Project, work: () => Promise<T>): Promise<T> {
	try {
		return await work();
	} catch (err) {
		if (err instanceof ProjectError) throw err;
		const code = (err as NodeJS.ErrnoException).code;
		const why =
			code === "EACCES" || code === "EPERM"
				? "it is not a folder you can write to"
				: code === "ENOSPC"
					? "the disk is full"
					: code === "ELOOP"
						? "there is a link where Porchlight's own file should be"
						: err instanceof Error
							? err.message
							: String(err);
		throw new ProjectError(`Porchlight could not write in ${join(project.folder, OWN_FOLDER)}: ${why}.`);
	}
}

const NEW_FILE = constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

/**
 * Writes a new file into a project, never over one that is there: a second file in the same minute
 * gets " 2" before its extension, and so on.
 */
export function saveFile(project: Project, part: Part, title: FileTitle, extension: string, body: string | Uint8Array, date = new Date()): Promise<Saved> {
	return inProject(project, () => writeNew(project, part, title, extension, body, date));
}

async function writeNew(project: Project, part: Part, title: FileTitle, extension: string, body: string | Uint8Array, date: Date): Promise<Saved> {
	const folder = await partFolder(project, part);
	for (let copy = 1; copy <= 99; copy++) {
		const name = fileName(title, extension, date, copy);
		const path = join(folder, name);
		let handle: Awaited<ReturnType<typeof open>>;
		try {
			handle = await open(path, NEW_FILE, 0o600);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
			throw err;
		}
		try {
			await handle.writeFile(body);
		} finally {
			await handle.close();
		}
		return { project: project.id, part, name, path };
	}
	throw new ProjectError("There are already 99 files of this kind from this minute. Try again in a minute.");
}

/**
 * Writes a file Porchlight wrote before over again, such as a discussion's transcript after a new
 * answer: through a new temporary file renamed over it, so a link where the file was is replaced, not
 * followed. Only one of Porchlight's own names can be rewritten.
 */
export function rewriteFile(project: Project, part: Part, name: string, body: string): Promise<Saved> {
	if (!isOwnName(name)) return Promise.reject(new ProjectError("That is not a file Porchlight wrote"));
	return inProject(project, () => writeAgain(project, part, name, body));
}

async function writeAgain(project: Project, part: Part, name: string, body: string): Promise<Saved> {
	const folder = await partFolder(project, part);
	const path = join(folder, name);
	const temporary = join(folder, `.${name}.${randomBytes(4).toString("hex")}.tmp`);
	const handle = await open(temporary, NEW_FILE, 0o600);
	try {
		await handle.writeFile(body);
	} finally {
		await handle.close();
	}
	try {
		await rename(temporary, path);
	} catch (err) {
		await rm(temporary, { force: true });
		throw err;
	}
	return { project: project.id, part, name, path };
}

/** Adds a line to the project's log for today: "15:30:02  Scan finished: …". */
export function appendLog(project: Project, text: string, date = new Date()): Promise<void> {
	return inProject(project, async () => {
		const folder = await partFolder(project, "Log");
		const { day, second } = stamp(date);
		const handle = await open(join(folder, `${day}.log`), constants.O_WRONLY | constants.O_APPEND | constants.O_CREAT | constants.O_NOFOLLOW, 0o600);
		try {
			await handle.writeFile(`${second}  ${oneLine(text)}\n`);
		} finally {
			await handle.close();
		}
	});
}

/** The list of projects and the one in use, kept beside the report. */
export class ProjectStore {
	readonly path: string;
	/** One change at a time, so two quick changes never lose one. */
	private chain: Promise<unknown> = Promise.resolve();

	constructor(path: string) {
		this.path = path;
	}

	async read(): Promise<ProjectsFile> {
		try {
			return parseProjects(JSON.parse(await readFile(this.path, "utf8")));
		} catch {
			return { version: 1, current: null, projects: [] };
		}
	}

	async current(): Promise<Project | null> {
		const file = await this.read();
		return file.projects.find((project) => project.id === file.current) ?? null;
	}

	async get(id: unknown): Promise<Project | null> {
		if (!isProjectId(id)) return null;
		return (await this.read()).projects.find((project) => project.id === id) ?? null;
	}

	/** Adds a project and starts using it. `folder` is one `checkFolder` passed. */
	add(name: string, folder: string): Promise<Project> {
		return this.change((file) => {
			if (file.projects.length >= MAX_PROJECTS) throw new ProjectError(`Porchlight keeps up to ${MAX_PROJECTS} projects. Remove one first.`);
			if (file.projects.some((project) => project.name.toLowerCase() === name.toLowerCase())) throw new ProjectError(`There is already a project called ${name}`);
			const project: Project = { id: `prj_${randomBytes(8).toString("hex")}`, name, folder, createdAt: new Date().toISOString() };
			file.projects.push(project);
			file.current = project.id;
			return project;
		});
	}

	/** Starts using a project, or none. */
	use(id: string | null): Promise<Project | null> {
		return this.change((file) => {
			if (id === null) {
				file.current = null;
				return null;
			}
			const project = file.projects.find((candidate) => candidate.id === id);
			if (!project) throw new ProjectError("There is no such project");
			file.current = project.id;
			return project;
		});
	}

	/** Takes a project off the list. Its folder and the files in it are left as they are. */
	remove(id: string): Promise<Project> {
		return this.change((file) => {
			const project = file.projects.find((candidate) => candidate.id === id);
			if (!project) throw new ProjectError("There is no such project");
			file.projects = file.projects.filter((candidate) => candidate.id !== id);
			if (file.current === id) file.current = null;
			return project;
		});
	}

	private change<T>(edit: (file: ProjectsFile) => T): Promise<T> {
		const next = this.chain.then(async () => {
			const file = await this.read();
			const result = edit(file);
			await writePrivate(this.path, `${JSON.stringify(file, null, "\t")}\n`);
			return result;
		});
		this.chain = next.catch(() => {});
		return next;
	}
}

function parseProjects(value: unknown): ProjectsFile {
	const file: ProjectsFile = { version: 1, current: null, projects: [] };
	if (!value || typeof value !== "object") return file;
	const raw = value as Record<string, unknown>;
	if (Array.isArray(raw.projects)) {
		for (const entry of raw.projects.slice(0, MAX_PROJECTS)) {
			if (!entry || typeof entry !== "object") continue;
			const { id, name, folder, createdAt } = entry as Record<string, unknown>;
			const clean = cleanName(name);
			if (!isProjectId(id) || !clean || typeof folder !== "string" || !isAbsolute(folder) || typeof createdAt !== "string") continue;
			if (file.projects.some((project) => project.id === id)) continue;
			file.projects.push({ id, name: clean, folder, createdAt });
		}
	}
	if (isProjectId(raw.current) && file.projects.some((project) => project.id === raw.current)) file.current = raw.current;
	return file;
}
