/**
 * Packages installed on this computer rather than in a repository: npm's global packages, the
 * Python packages of the python3 on PATH, and Homebrew. npm and Python packages are written into
 * lockfiles in a temporary folder and looked up with osv-scanner, which sends their names and
 * versions to OSV.dev, as a repository scan does. Homebrew has no advisory database, so it is
 * checked for updates only, from what Homebrew already knows.
 */
import { access, constants, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { runOsvScanner } from "../repos/osv.ts";
import { ToolMissingError, type Runner } from "../repos/exec.ts";
import { highestVersion } from "../roadmap/versions.ts";
import { severityRank, type Finding, type Severity } from "../repos/types.ts";
import { output, unknown } from "./macos.ts";
import type { HostCheck } from "./types.ts";

const NPM_DIR = "npm-global";
const PYTHON_DIR = "python3";
/** Outdated Homebrew packages named; the rest are counted. */
const MAX_LISTED = 40;

interface NpmNode {
	version?: string;
	dependencies?: Record<string, NpmNode>;
}

/** A package somewhere in npm's global tree, and the package installed globally that brings it. */
export interface NpmEntry {
	path: string;
	name: string;
	version: string;
	topLevel: string;
}

/** `npm ls -g --all --json` as lockfile entries ("node_modules/a/node_modules/b"). */
export function flattenNpm(tree: NpmNode): NpmEntry[] {
	const entries: NpmEntry[] = [];
	const walk = (dependencies: Record<string, NpmNode> | undefined, prefix: string, topLevel: string | null) => {
		for (const [name, node] of Object.entries(dependencies ?? {})) {
			if (typeof node?.version !== "string") continue;
			const path = `${prefix}node_modules/${name}`;
			entries.push({ path, name, version: node.version, topLevel: topLevel ?? name });
			walk(node.dependencies, `${path}/`, topLevel ?? name);
		}
	};
	walk(tree.dependencies, "", null);
	return entries;
}

export function npmLockfile(entries: NpmEntry[]): string {
	const packages: Record<string, unknown> = { "": { name: "global" } };
	for (const entry of entries) packages[entry.path] = { version: entry.version };
	return `${JSON.stringify({ name: "global", lockfileVersion: 3, requires: true, packages }, null, 2)}\n`;
}

/** `pip list --format=json` as a requirements file pinning each version. */
export function requirementsFile(packages: { name?: unknown; version?: unknown }[]): string {
	return packages
		.filter((pkg): pkg is { name: string; version: string } => typeof pkg.name === "string" && typeof pkg.version === "string" && /^[\w.-]+$/.test(pkg.name))
		.map((pkg) => `${pkg.name}==${pkg.version}\n`)
		.join("");
}

/** The first executable of this name on PATH, as a shell would find it. */
export async function findOnPath(name: string, pathEnv: string | undefined): Promise<string | null> {
	for (const dir of (pathEnv ?? "").split(delimiter)) {
		if (!dir) continue;
		const candidate = join(dir, name);
		try {
			await access(candidate, constants.X_OK);
			return candidate;
		} catch {
			// Not here.
		}
	}
	return null;
}

export interface PackageOptions {
	run: Runner;
	/** Look npm and Python packages up on OSV.dev. Off: they are listed only. */
	lookUp: boolean;
	pathEnv?: string;
	mac: boolean;
}

/** What was collected from one source, or why it could not be. */
interface Source {
	label: string;
	count: number;
	error?: string;
}

async function collectNpm(run: Runner, dir: string): Promise<{ source: Source | null; entries: NpmEntry[] }> {
	const result = await output(run, "npm", ["ls", "-g", "--all", "--json"]);
	if (!result) return { source: null, entries: [] };
	// npm ls exits 1 when the tree has problems, and still prints it.
	let tree: NpmNode;
	try {
		tree = JSON.parse(result.stdout) as NpmNode;
	} catch {
		return { source: { label: "npm (global)", count: 0, error: `npm ls failed${result.code ? ` with code ${result.code}` : ""}` }, entries: [] };
	}
	const entries = flattenNpm(tree);
	await mkdir(join(dir, NPM_DIR), { recursive: true });
	await writeFile(join(dir, NPM_DIR, "package-lock.json"), npmLockfile(entries));
	return { source: { label: "npm (global)", count: entries.length }, entries };
}

async function collectPython(run: Runner, dir: string, pathEnv: string | undefined, mac: boolean): Promise<Source | null> {
	const python = await findOnPath("python3", pathEnv);
	if (!python) return null;
	// Apple's /usr/bin/python3 is a stand-in that offers to install the developer tools when they are
	// missing, which would put a dialog in front of the owner. It runs only when they are installed.
	if (mac && python === "/usr/bin/python3") {
		const tools = await output(run, "xcode-select", ["-p"]).catch(() => null);
		if (!tools || tools.code !== 0) return { label: "Python (python3)", count: 0, error: "The Xcode command line tools are not installed, so Apple's python3 was not run" };
	}
	const result = await output(run, python, ["-m", "pip", "list", "--format=json", "--disable-pip-version-check"]);
	if (!result || result.code !== 0) return { label: `Python (${python})`, count: 0, error: "pip could not list the installed packages" };
	let list: { name?: unknown; version?: unknown }[];
	try {
		list = JSON.parse(result.stdout);
		if (!Array.isArray(list)) throw new Error("not a list");
	} catch {
		return { label: `Python (${python})`, count: 0, error: "pip's list was not understood" };
	}
	const text = requirementsFile(list);
	await mkdir(join(dir, PYTHON_DIR), { recursive: true });
	await writeFile(join(dir, PYTHON_DIR, "requirements.txt"), text);
	return { label: `Python (${python})`, count: text.split("\n").filter(Boolean).length };
}

/** One check per vulnerable package, with its advisories and the command that repairs it. */
export function packageChecks(findings: Finding[], npmEntries: NpmEntry[], pythonLabel: string): HostCheck[] {
	const groups = new Map<string, Finding[]>();
	for (const finding of findings) {
		const key = `${finding.location}\n${finding.detail}`;
		groups.set(key, [...(groups.get(key) ?? []), finding]);
	}
	const checks: HostCheck[] = [];
	for (const group of groups.values()) {
		const first = group[0]!;
		const at = first.detail.lastIndexOf("@");
		const name = first.detail.slice(0, at);
		const version = first.detail.slice(at + 1);
		const npm = first.location.startsWith(`${NPM_DIR}/`);
		const severity = group.map((finding) => finding.severity).sort((a, b) => severityRank(a) - severityRank(b))[0] as Severity;
		const fixedIn = highestVersion(group.map((finding) => finding.fixedIn).filter((fix): fix is string => fix !== undefined));
		const owners = npm ? [...new Set(npmEntries.filter((entry) => entry.name === name && entry.version === version).map((entry) => entry.topLevel))] : [];
		const direct = owners.length === 0 || owners.includes(name);
		const fix = npm
			? direct
				? [`\`npm install -g ${name}@${fixedIn ?? "latest"}\``]
				: [
						`It comes with ${owners.join(", ")}, installed globally. Update ${owners.length === 1 ? "it" : "them"}: \`npm install -g ${owners.map((owner) => `${owner}@latest`).join(" ")}\``,
						"If that does not bring a fixed version, the package's maintainers have not released one yet.",
					]
			: [`\`python3 -m pip install --upgrade "${name}${fixedIn ? `>=${fixedIn}` : ""}"\``];
		const specs = npm ? (direct ? [`${name}@${fixedIn ?? "latest"}`] : owners.map((owner) => `${owner}@latest`)) : [fixedIn ? `${name}>=${fixedIn}` : name];
		checks.push({
			id: `package:${npm ? "npm" : "python"}:${name}`,
			area: "packages",
			title: `${name} ${version} (${npm ? "npm, installed globally" : pythonLabel})`,
			severity,
			status: "failed",
			detail: `${group.length === 1 ? "1 known vulnerability" : `${group.length} known vulnerabilities`}${fixedIn ? `, fixed in ${fixedIn}` : ", with no fixed version named yet"}.`,
			items: group.map((finding) => `${finding.ruleId}: ${finding.title}`),
			fix,
			commands: specs.map((spec) => ({ kind: npm ? ("npm-global" as const) : ("pip" as const), spec })),
		});
	}
	return checks.sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || a.title.localeCompare(b.title));
}

interface BrewOutdated {
	formulae?: { name?: string; installed_versions?: string[]; current_version?: string }[];
	casks?: { name?: string; installed_versions?: string[] | string; current_version?: string }[];
}

export function parseBrewOutdated(text: string): string[] | null {
	let parsed: BrewOutdated;
	try {
		parsed = JSON.parse(text) as BrewOutdated;
	} catch {
		return null;
	}
	const line = (item: { name?: string; installed_versions?: string[] | string; current_version?: string }) => {
		const installed = Array.isArray(item.installed_versions) ? item.installed_versions.at(-1) : item.installed_versions;
		return `${item.name ?? "?"} ${installed ?? "?"} → ${item.current_version ?? "?"}`;
	};
	return [...(parsed.formulae ?? []).map(line), ...(parsed.casks ?? []).map(line)];
}

async function brewCheck(run: Runner): Promise<HostCheck | null> {
	const base = { id: "homebrew", area: "packages", title: "Homebrew packages", severity: "low" } as const;
	let result;
	try {
		// Only what Homebrew already knows: no update of its own lists, nothing installed.
		result = await run("brew", ["outdated", "--json=v2"], { env: { HOMEBREW_NO_AUTO_UPDATE: "1", HOMEBREW_NO_ENV_HINTS: "1" } });
	} catch (err) {
		if (err instanceof ToolMissingError) return null;
		return unknown(base, err instanceof Error ? err.message : String(err));
	}
	const outdated = result.code === 0 ? parseBrewOutdated(result.stdout) : null;
	if (!outdated) return unknown(base, `brew outdated failed${result.code ? ` with code ${result.code}` : ""}`);
	const note = "As of Homebrew's last `brew update`. Homebrew has no advisory database, so these are updates, not known vulnerabilities; some updates fix security problems.";
	if (outdated.length === 0) return { ...base, status: "passed", detail: `Everything installed with Homebrew is up to date. ${note}` };
	return {
		...base,
		status: "failed",
		detail: `${outdated.length === 1 ? "1 package has" : `${outdated.length} packages have`} a newer version. ${note}`,
		items: outdated.length > MAX_LISTED ? [...outdated.slice(0, MAX_LISTED), `and ${outdated.length - MAX_LISTED} more`] : outdated,
		fix: ["`brew update && brew upgrade`"],
		commands: [{ kind: "line", line: "brew update && brew upgrade" }],
	};
}

export async function packageChecksFor(options: PackageOptions): Promise<HostCheck[]> {
	const checks: HostCheck[] = [];
	const base = { id: "packages", area: "packages", title: "Installed npm and Python packages", severity: "high" } as const;
	const dir = await mkdtemp(join(tmpdir(), "porchlight-host-"));
	try {
		const npm = await collectNpm(options.run, dir);
		const python = await collectPython(options.run, dir, options.pathEnv, options.mac);
		const sources = [npm.source, python].filter((source): source is Source => source !== null);
		for (const source of sources.filter((source) => source.error)) {
			checks.push(unknown({ ...base, id: `packages:${source.label}`, title: source.label }, source.error!));
		}
		const listed = sources.filter((source) => !source.error && source.count > 0);
		const counted = listed.map((source) => `${source.count.toLocaleString("en")} from ${source.label}`).join(" and ");
		if (listed.length > 0 && options.lookUp) {
			let findings: Finding[] | null = null;
			try {
				findings = await runOsvScanner(dir, options.run);
			} catch (err) {
				checks.push(unknown(base, err instanceof ToolMissingError ? "osv-scanner is not installed, so packages were not looked up" : `osv-scanner failed: ${err instanceof Error ? err.message : String(err)}`));
			}
			if (findings) {
				const vulnerable = packageChecks(findings, npm.entries, python?.label ?? "Python");
				checks.push(...vulnerable);
				if (vulnerable.length === 0) checks.push({ ...base, status: "passed", detail: `No known vulnerabilities in ${counted} packages, looked up on OSV.dev just now.` });
			}
		}
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
	const brew = await brewCheck(options.run);
	if (brew) checks.push(brew);
	return checks;
}
