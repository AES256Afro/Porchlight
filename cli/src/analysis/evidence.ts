import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, isAbsolute, join, relative, sep } from "node:path";

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
	/**
	 * How imports were looked for, by the manifest's ecosystem. `reliable` is false where a package is
	 * imported by another name than it is installed by (a Maven artifact, a PHP package, a Python
	 * package not in the list of known names), so finding none says nothing (B39). Missing from
	 * judgements made before.
	 */
	searched?: { ecosystem: string; reliable: boolean };
}

/** The ecosystem a lock or manifest file belongs to, by its name. */
function ecosystemOf(manifest: string): string {
	const file = manifest.replace(/:\d+$/, "").split("/").at(-1) ?? "";
	if (/^(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?)$/.test(file)) return "npm";
	if (/^(?:requirements.*\.(?:txt|in)|poetry\.lock|Pipfile\.lock|uv\.lock|pdm\.lock|pyproject\.toml)$/.test(file)) return "PyPI";
	if (file === "go.mod" || file === "go.sum") return "Go";
	if (file === "Cargo.lock" || file === "Cargo.toml") return "crates.io";
	if (file === "Gemfile.lock" || file === "gems.locked") return "RubyGems";
	if (file === "composer.lock") return "Packagist";
	if (file === "pom.xml" || /gradle\.lockfile$/.test(file)) return "Maven";
	if (file === "packages.lock.json" || /\.csproj$/.test(file)) return "NuGet";
	return "unknown";
}

/** Python packages whose import name is not their own, by their name on PyPI, lower case. */
const PYTHON_IMPORTS: Record<string, string[]> = {
	pyyaml: ["yaml"],
	pillow: ["PIL"],
	beautifulsoup4: ["bs4"],
	"python-dateutil": ["dateutil"],
	"scikit-learn": ["sklearn"],
	"opencv-python": ["cv2"],
	"opencv-python-headless": ["cv2"],
	protobuf: ["google.protobuf"],
	attrs: ["attr", "attrs"],
	"python-jose": ["jose"],
	pyjwt: ["jwt"],
	"python-multipart": ["multipart"],
	pycryptodome: ["Crypto"],
	pycryptodomex: ["Cryptodome"],
	"pyopenssl": ["OpenSSL"],
	"python-dotenv": ["dotenv"],
	"msgpack-python": ["msgpack"],
	pymysql: ["pymysql"],
	"mysql-connector-python": ["mysql.connector"],
	"psycopg2-binary": ["psycopg2"],
	setuptools: ["setuptools", "pkg_resources"],
	"google-cloud-storage": ["google.cloud.storage"],
	"azure-storage-blob": ["azure.storage.blob"],
	gitpython: ["git"],
	"jinja2": ["jinja2"],
	markupsafe: ["markupsafe"],
};

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
	const ecosystem = ecosystemOf(manifest);
	const { pattern: mention, reliable } = importPattern(name, ecosystem);
	const evidence: Evidence = { declared: await declaredAs(repo, manifest, name), uses: [], usedInFiles: 0, onlyInTests: false, filesRead: 0, complete: true, searched: { ecosystem, reliable } };
	let testFiles = 0;

	const queue = [repo];
	while (queue.length > 0) {
		const dir = queue.shift() as string;
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
		for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, "en"))) {
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
			if (evidence.uses.length < MAX_USES) evidence.uses.push({ file, line: importNames(name, ecosystem).map((alias) => [alias, importText(line, alias)]).find(([alias, text]) => text !== alias)?.[1] ?? name });
		}
	}
	evidence.onlyInTests = evidence.usedInFiles > 0 && testFiles === evidence.usedInFiles;
	return evidence;
}

/**
 * An import, require or use of the package, by its ecosystem (B39): quoted in JavaScript, Go and Ruby;
 * a module in Python, by the names it is known to be imported as; `use` and `crate::` in Rust; a
 * namespace in C#; a Maven group's packages in Java and Kotlin. `reliable` says whether finding none
 * means the package is not imported.
 */
export function importPattern(name: string, ecosystem = "unknown"): { pattern: RegExp; reliable: boolean } {
	const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const escaped = escape(name);
	const quoted = `['"\`]${escaped}(?:/[^'"\`]*)?['"\`]`;
	if (ecosystem === "PyPI") {
		const known = PYTHON_IMPORTS[name.toLowerCase()];
		const modules = (known ?? [name.replace(/-/g, "_")]).map((module) => escape(module).replace(/_/g, "[-_]"));
		const pattern = new RegExp(`^\\s*(?:import|from)\\s+(?:${modules.join("|")})\\b`, known ? "" : "i");
		// A package installed under one name and imported under another, not in the list, is not found by name.
		return { pattern, reliable: known !== undefined || /^[a-z0-9_]+$/i.test(name) };
	}
	if (ecosystem === "crates.io") {
		const crate = escape(name.replace(/-/g, "_"));
		return { pattern: new RegExp(`\\b(?:use|extern\\s+crate)\\s+${crate}\\b|\\b${crate}::`), reliable: true };
	}
	if (ecosystem === "NuGet") return { pattern: new RegExp(`^\\s*(?:global\\s+)?using\\s+(?:static\\s+)?${escaped}\\b`), reliable: false };
	if (ecosystem === "Maven") {
		const group = name.includes(":") ? name.slice(0, name.indexOf(":")) : name;
		return { pattern: new RegExp(`^\\s*import\\s+(?:static\\s+)?${escape(group)}\\.`), reliable: false };
	}
	if (ecosystem === "Packagist") return { pattern: new RegExp(quoted), reliable: false };
	const python = escaped.replace(/-/g, "[-_]");
	return { pattern: new RegExp(`${quoted}|^\\s*(?:import|from)\\s+${python}\\b`), reliable: ecosystem !== "unknown" };
}

/** The names a package is imported by in its ecosystem, for `importText`. */
function importNames(name: string, ecosystem: string): string[] {
	if (ecosystem === "PyPI") return PYTHON_IMPORTS[name.toLowerCase()] ?? [name];
	if (ecosystem === "crates.io") return [name.replace(/-/g, "_")];
	if (ecosystem === "Maven") return [name.includes(":") ? name.slice(0, name.indexOf(":")) : name];
	return [name];
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
		// Rust: use p::a::{b, c}; extern crate p
		`^\\s*(?:pub\\s+)?use\\s+${escaped}(?:::[\\w:{}, *]{0,120})?|^\\s*extern\\s+crate\\s+${escaped}\\b`,
		// Java and Kotlin: import (static) p.a.B; C#: using (static) P.A
		`^\\s*import\\s+(?:static\\s+)?${escaped}[\\w.*]*|^\\s*(?:global\\s+)?using\\s+(?:static\\s+)?${escaped}[\\w.]*`,
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
	// The lock file's own folder only, and only inside the repository, where it really is: a folder on the
	// way that is a link would lead the read outside (S39).
	if (relative(repo, folder).startsWith("..")) return "unknown";
	const [top, real] = await Promise.all([realpath(repo).catch(() => null), realpath(folder).catch(() => null)]);
	if (!top || !real) return "unknown";
	const inside = relative(top, real);
	if (inside.startsWith("..") || isAbsolute(inside)) return "unknown";
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
