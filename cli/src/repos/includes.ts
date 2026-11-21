import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

// osv-scanner follows what a manifest includes: a requirements file's `-r` and `-c` lines, and a
// pom.xml's parent. Out of the repository, that reads someone else's file as a list of packages, and
// sends whatever it holds to OSV.dev as their names (`-r ../.env` became `secret-token@<value>`) and
// into the SBOM (S56). So before osv-scanner runs, every include is resolved here. A manifest at the
// repository's top that would read an existing file outside it keeps the whole repository from
// osv-scanner; one in a subfolder keeps that folder out (`outsidePlan`, `excludeArgs`) and the rest is
// read. Either way it is said under "Not covered", with why. Nothing outside the repository is opened.

/** Entries looked at before the search stops; past it, the check is said to be incomplete. */
const MAX_ENTRIES = 500_000;
/** The largest manifest read; osv-scanner's own parsers would make little of a larger one. */
const MAX_BYTES = 1024 * 1024;
/** Includes followed one inside another before the search stops. */
const MAX_DEPTH = 10;

/** Files osv-scanner reads as requirements: requirements.txt, requirements-dev.txt, dev-requirements.in. */
const REQUIREMENTS = /requirements.*\.(?:txt|in)$/i;
/** Every other manifest or lockfile it reads, by name: one that is a link out of the repository is followed by it too. */
const MANIFESTS = new Set([
	"package-lock.json",
	"npm-shrinkwrap.json",
	"yarn.lock",
	"pnpm-lock.yaml",
	"bun.lock",
	"Cargo.lock",
	"go.mod",
	"Gemfile.lock",
	"gems.locked",
	"composer.lock",
	"poetry.lock",
	"Pipfile.lock",
	"pdm.lock",
	"uv.lock",
	"pubspec.lock",
	"mix.lock",
	"packages.lock.json",
	"gradle.lockfile",
	"conan.lock",
	"renv.lock",
	"pom.xml",
]);

/** A manifest that would make osv-scanner read a file outside the repository, by its path inside it. */
export interface ReadOutside {
	file: string;
	reason: string;
}

/**
 * Where osv-scanner, reading this repository's manifests, would read an existing file outside it.
 * `complete` is false when the repository held more entries than are looked at.
 */
export async function readsOutside(repo: string): Promise<{ found: ReadOutside[]; complete: boolean }> {
	const top = await realpath(repo).catch(() => null);
	// A folder that is not there holds nothing to follow; osv-scanner says so itself.
	if (top === null) return { found: [], complete: true };
	const found: ReadOutside[] = [];
	const inside = (path: string) => {
		const rel = relative(top, path);
		return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
	};
	const name = (path: string) => relative(top, path).split(sep).join("/");
	/** Where a path really leads, or null when nothing is there. */
	const target = (path: string) => realpath(path).catch(() => null);

	const requirements = new Set<string>();
	const poms: string[] = [];
	let entries = 0;
	let complete = true;
	const walk = async (dir: string): Promise<void> => {
		const list = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of list) {
			if (++entries > MAX_ENTRIES) {
				complete = false;
				return;
			}
			if (entry.name === ".git") continue;
			const path = join(dir, entry.name);
			const manifest = REQUIREMENTS.test(entry.name) || MANIFESTS.has(entry.name);
			if (entry.isSymbolicLink()) {
				if (!manifest) continue;
				const real = await target(path);
				if (real && !inside(real)) found.push({ file: name(path), reason: "it is a link to a file outside the repository" });
				else if (real && REQUIREMENTS.test(entry.name)) requirements.add(real);
				continue;
			}
			if (entry.isDirectory()) await walk(path);
			else if (entry.isFile() && REQUIREMENTS.test(entry.name)) requirements.add(path);
			else if (entry.isFile() && entry.name === "pom.xml") poms.push(path);
			if (!complete) return;
		}
	};
	await walk(top);

	// Requirements files and what they include, followed while they stay inside. Each is followed on its
	// own, so every file osv-scanner would start from that reaches outside is named, not only the first
	// one that got there: a folder is left out of the scan by the file found in it.
	let seen = new Set<string>();
	const follow = async (file: string, from: string, depth: number): Promise<void> => {
		if (seen.has(file) || depth > MAX_DEPTH) return;
		seen.add(file);
		const text = await readSmall(file);
		if (text === null) return;
		for (const line of text.split(/\r?\n/)) {
			const include = /^\s*(?:--requirement|--constraint|-r|-c)\s*=?\s*(\S+)/.exec(line.replace(/(?:^|\s)#.*$/, ""))?.[1];
			// An address is not a file osv-scanner reads.
			if (!include || /^[a-z][a-z0-9+.-]*:\/\//i.test(include)) continue;
			const real = await target(resolve(dirname(file), include));
			if (real === null) continue;
			if (!inside(real)) found.push({ file: from, reason: `it includes ${clip(include)}, a file outside the repository` });
			else await follow(real, from, depth + 1);
		}
	};
	for (const file of requirements) {
		seen = new Set<string>();
		await follow(file, name(file), 0);
	}

	// A pom.xml's parent, where the repository names one with <relativePath>. Maven's default, ../pom.xml,
	// is a parent folder's own project, which is the owner's layout rather than the repository's choice.
	for (const pom of poms) {
		const text = await readSmall(pom);
		const parent = text === null ? null : /<parent>([\s\S]*?)<\/parent>/.exec(text)?.[1];
		const relativePath = parent ? /<relativePath>\s*([^<]*?)\s*<\/relativePath>/.exec(parent)?.[1] : undefined;
		if (!relativePath) continue;
		let real = await target(resolve(dirname(pom), relativePath));
		if (real && (await stat(real).catch(() => null))?.isDirectory()) real = await target(join(real, "pom.xml"));
		if (real && !inside(real)) found.push({ file: name(pom), reason: `its parent is ${clip(relativePath)}, a file outside the repository` });
	}
	const unique = new Map(found.map((entry) => [`${entry.file}\0${entry.reason}`, entry]));
	return { found: [...unique.values()].sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0)), complete };
}

/** A repository's own words, kept short where Porchlight quotes them. */
function clip(text: string): string {
	return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

async function readSmall(path: string): Promise<string | null> {
	const info = await stat(path).catch(() => null);
	if (!info?.isFile() || info.size > MAX_BYTES) return null;
	return readFile(path, "utf8").catch(() => null);
}

/** The words for "Not covered" and the SBOM: which manifest, and why its repository's packages were not read. */
export function outsideWords(found: ReadOutside[]): string {
	const first = found[0]!;
	return `dependencies were not checked, because ${first.file} would have osv-scanner read a file outside the repository (${first.reason})${found.length > 1 ? `, as would ${found.length - 1} more` : ""}: what that file holds would be sent to OSV.dev as package names`;
}

/**
 * What to do about manifests that would read outside the repository. One at the repository's top
 * keeps osv-scanner from the whole repository (`skip`). Ones only in subfolders leave out just those
 * folders, each with all it holds, and the rest of the repository is scanned.
 */
export function outsidePlan(found: ReadOutside[]): { skip: boolean; folders: string[] } {
	if (found.length === 0) return { skip: false, folders: [] };
	const folders = [...new Set(found.map((entry) => entry.file.split("/").slice(0, -1).join("/")))];
	if (folders.includes("")) return { skip: true, folders: [] };
	// A folder inside another that is left out goes with it.
	const outer = folders.filter((folder) => !folders.some((other) => other !== folder && folder.startsWith(`${other}/`)));
	return { skip: false, folders: outer.sort() };
}

/**
 * osv-scanner's arguments that leave out these folders of `repo`. It matches a regular expression
 * against each folder's whole path, written without its leading slash, so the pattern names this
 * repository's own folder exactly (with or without that slash) and nothing else with the same name.
 */
export function excludeArgs(repo: string, folders: string[]): string[] {
	const top = resolve(repo).split(sep).join("/").replace(/^\/+/, "");
	return folders.map((folder) => `--x-exclude=r:^/?${escapeRegExp(`${top}/${folder}`)}$`);
}

/** RE2 and JavaScript agree on these escapes. */
function escapeRegExp(text: string): string {
	return text.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}

/** The words for "Not covered" when folders were left out of the dependency check and the rest was scanned. */
export function excludedWords(found: ReadOutside[], folders: string[]): string {
	const shown = folders.slice(0, 3).join(", ") + (folders.length > 3 ? ` and ${folders.length - 3} more` : "");
	const first = found[0]!;
	return `dependencies in ${folders.length === 1 ? "the folder" : "the folders"} ${shown} were not checked, because ${first.file} would have osv-scanner read a file outside the repository (${first.reason})${found.length > 1 ? `, as would ${found.length - 1} more` : ""}: what that file holds would be sent to OSV.dev as package names. The rest of the repository was checked`;
}
