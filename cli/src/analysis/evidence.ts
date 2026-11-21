import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { dirname, extname, join, relative, sep } from "node:path";

/**
 * Facts about how a repository uses a vulnerable package, read from its files. They are what the
 * model is given to judge a finding, and the page shows them beside its judgement.
 *
 * Reading is all this does: nothing in the repository runs, git is never called, symbolic links
 * are not followed, and only lines that name the package are kept, each cut short. A secret
 * finding gets no file content at all: the lines around a secret may hold the secret.
 */
export interface Evidence {
	/** How the package comes to be installed, when a `package.json` beside the lock file says. */
	declared: "runtime dependency" | "development dependency" | "not named in package.json: pulled in by another package" | "unknown";
	/** Lines of the repository's own code that import the package: the first few. */
	uses: { file: string; line: string }[];
	/** How many files import it in all. */
	usedInFiles: number;
	/** Whether every one of those files is test code. */
	onlyInTests: boolean;
	/** Source files looked through; `false` for `complete` means the repository was too large to finish. */
	filesRead: number;
	complete: boolean;
}

const SOURCE = new Set([".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx", ".mts", ".cts", ".py", ".go", ".rs", ".rb", ".php", ".java", ".kt", ".cs", ".vue", ".svelte"]);
const SKIP = new Set([".git", "node_modules", "vendor", "target", "dist", "build", "out", ".next", ".venv", "venv", "__pycache__", "coverage"]);
const MAX_FILES = 4000;
const MAX_FILE_BYTES = 300_000;
const MAX_USES = 8;
const MAX_LINE = 160;
const TEST_PATH = /(^|\/)(tests?|__tests__|spec|e2e|fixtures?|examples?)(\/|$)|\.(test|spec)\.[a-z]+$/i;

/** `sharp@0.35.2` or `@scope/name@1.0.0` as its name. */
export function packageName(detail: string): string {
	const at = detail.lastIndexOf("@");
	return at > 0 ? detail.slice(0, at) : detail;
}

/**
 * @param repo the repository's folder
 * @param manifest the finding's location: the lock or manifest file, relative to `repo`
 * @param name the package
 */
export async function gatherEvidence(repo: string, manifest: string, name: string): Promise<Evidence> {
	const evidence: Evidence = { declared: await declaredAs(repo, manifest, name), uses: [], usedInFiles: 0, onlyInTests: false, filesRead: 0, complete: true };
	const mention = importPattern(name);
	let testFiles = 0;

	const queue = [repo];
	while (queue.length > 0) {
		const dir = queue.shift() as string;
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
			const full = join(dir, entry.name);
			// `isDirectory` and `isFile` are false for a symbolic link, so none is followed.
			if (entry.isDirectory()) {
				if (!SKIP.has(entry.name)) queue.push(full);
				continue;
			}
			if (!entry.isFile() || !SOURCE.has(extname(entry.name).toLowerCase())) continue;
			if (evidence.filesRead >= MAX_FILES) {
				evidence.complete = false;
				queue.length = 0;
				break;
			}
			const info = await stat(full).catch(() => null);
			if (!info || info.size > MAX_FILE_BYTES) continue;
			evidence.filesRead++;
			const text = await readFile(full, "utf8").catch(() => "");
			const line = text.split("\n").find((candidate) => mention.test(candidate));
			if (line === undefined) continue;
			const file = relative(repo, full).split(sep).join("/");
			evidence.usedInFiles++;
			if (TEST_PATH.test(file)) testFiles++;
			if (evidence.uses.length < MAX_USES) evidence.uses.push({ file, line: importText(line, name) });
		}
	}
	evidence.onlyInTests = evidence.usedInFiles > 0 && testFiles === evidence.usedInFiles;
	return evidence;
}

/** An import, require or use of the package by name: quoted in JavaScript and most others, bare in Python and Go paths. */
function importPattern(name: string): RegExp {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const python = escaped.replace(/-/g, "[-_]");
	return new RegExp(`['"\`]${escaped}(?:/[^'"\`]*)?['"\`]|^\\s*(?:import|from)\\s+${python}\\b`);
}

/**
 * The import itself, out of a line that names the package: its keywords, the names it binds and the
 * package's path, and nothing else from the line. A line can hold more than its import (a key passed
 * straight to the package, `require("stripe")("sk_live_…")`, or a whole minified bundle), and that more
 * can be a secret, so nothing quoted is kept but the package's own path (S11, invariants 3 and 16).
 */
export function importText(line: string, name: string): string {
	const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const python = escaped.replace(/-/g, "[-_]");
	const quote = "[\"'`]";
	const path = `${quote}${escaped}(?:/[\\w@./-]{0,120})?${quote}`;
	const forms = [
		// import x from "p"; import { a, b } from "p"; import * as x from "p"; import "p"
		`\\bimport\\s+(?:type\\s+)?(?:[\\w$*{}\\s,]+?\\s+from\\s+)?${path}`,
		// import("p")
		`\\bimport\\s*\\(\\s*${path}\\s*\\)`,
		// const x = require("p"), with the names it binds; or require("p") alone
		`(?:\\b(?:const|let|var)\\s+[\\w$\\s{},:]+?=\\s*)?\\brequire\\s*\\(\\s*${path}\\s*\\)`,
		// from p import a, b
		`^\\s*from\\s+${python}[\\w.]*\\s+import\\s+[\\w\\s,.*()]+`,
		// import p, import p.sub as q
		`^\\s*import\\s+${python}[\\w.]*(?:\\s+as\\s+\\w+)?`,
		// Anything else that names it (a Go import path, say): the quoted path alone.
		path,
	];
	for (const form of forms) {
		const found = new RegExp(form).exec(line)?.[0];
		if (found) return found.trim().slice(0, MAX_LINE);
	}
	return name;
}

async function declaredAs(repo: string, manifest: string, name: string): Promise<Evidence["declared"]> {
	const folder = join(repo, dirname(manifest.replace(/:\d+$/, "")));
	// The lock file's own folder only, and only inside the repository.
	if (relative(repo, folder).startsWith("..")) return "unknown";
	let manifestJson: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown>; optionalDependencies?: Record<string, unknown> };
	try {
		// Not a link: a link could point at any file on the machine.
		const info = await lstat(join(folder, "package.json"));
		if (!info.isFile() || info.size > MAX_FILE_BYTES) return "unknown";
		manifestJson = JSON.parse(await readFile(join(folder, "package.json"), "utf8"));
	} catch {
		return "unknown";
	}
	const has = (section: Record<string, unknown> | undefined) => typeof section === "object" && section !== null && Object.hasOwn(section, name);
	if (has(manifestJson.dependencies) || has(manifestJson.optionalDependencies)) return "runtime dependency";
	if (has(manifestJson.devDependencies)) return "development dependency";
	return "not named in package.json: pulled in by another package";
}
