import { basename, resolve } from "node:path";
import { discoverRepos } from "./discover.ts";
import { run as defaultRun, ToolMissingError, type Runner } from "./exec.ts";
import { outsideWords, readsOutside } from "./includes.ts";
import { OSV_LIMITS } from "./osv.ts";
import { nameUnder } from "./report.ts";
import { classifyLicences, LICENCE_WORDS, licenceCounts, licenceSummary, REVIEW_CLASSES, type LicenceClass } from "./licences.ts";
import { confusionIn, ecosystemOfPurl, lookalikes, type PackageAdvice } from "./lookalike.ts";

// A software bill of materials: every package the repositories' lockfiles name, as CycloneDX 1.5.
// osv-scanner reads the lockfiles with --offline, so nothing is sent anywhere: no package name, no
// version. Only what a bill of materials is for is kept from its output (name, version, package URL,
// licences when it knows them): no file path from this computer, which a shared SBOM would expose.

export interface SbomOptions {
	root: string;
	depth: number;
	run?: Runner;
	now?: () => Date;
	/** These repositories, by their paths and the names a report gives them, instead of looking under `root`. */
	repositories?: { path: string; name: string }[];
	/** Called as each repository is read. */
	onProgress?: (done: number, total: number, repo: string) => void;
}

/** One package, as a CycloneDX component. */
interface Component {
	"bom-ref": string;
	type: "library";
	name: string;
	version?: string;
	purl?: string;
	licenses?: { license: { id?: string; name?: string } }[];
	/**
	 * Porchlight's notes on the package, when it has any: `porchlight:licence-risk` (FT-6) and
	 * `porchlight:advice` (FT-7). Advice beside the package, never a finding.
	 */
	properties?: { name: string; value: string }[];
}

/** One repository's packages, with Porchlight's licence counts and advice on its packages and settings. */
interface RepoComponent {
	type: "application";
	"bom-ref": string;
	name: string;
	components: Component[];
	properties?: { name: string; value: string }[];
}

export interface Sbom {
	bomFormat: "CycloneDX";
	specVersion: "1.5";
	version: 1;
	metadata: {
		timestamp: string;
		tools: { components: { type: "application"; name: string; version?: string }[] };
		component: { type: "application"; "bom-ref": string; name: string };
		/** Repositories that could not be read, so an incomplete SBOM is never taken for a whole one. */
		properties?: { name: string; value: string }[];
	};
	/** One per repository, each holding its packages. */
	components: RepoComponent[];
}

/**
 * Lockfiles read, nothing contacted, and no vulnerability matched: --offline alone still wants a local
 * vulnerability database, so the plugin that matches against one is switched off. That switch is one of
 * osv-scanner's experimental flags (2.x); a version without it is said to be unsupported, never ignored.
 */
const INVENTORY_ONLY = ["--offline", "--all-packages", "--x-disable-plugins=vulnmatch/osvlocal", ...OSV_LIMITS];

/** osv-scanner's exit codes that still carry an inventory: 0 found none to flag, 1 found some, 128 no lockfiles. */
const READ = new Set([0, 1, 128]);

export async function buildSbom(options: SbomOptions): Promise<Sbom> {
	const run = options.run ?? defaultRun;
	const root = resolve(options.root);
	let version: string | undefined;
	try {
		version = (await run("osv-scanner", ["--version"])).stdout.match(/\d+\.\d+\.\d+/)?.[0];
	} catch (err) {
		if (err instanceof ToolMissingError) throw new Error("osv-scanner is not installed, and it reads the lockfiles: brew install osv-scanner");
		throw err;
	}
	const repos = options.repositories ?? (await discoverRepos(root, options.depth)).map((path) => ({ path, name: nameUnder(root, undefined, path) }));
	if (repos.length === 0) throw new Error(`No git repositories found under ${root}`);

	const components: Sbom["components"] = [];
	const missed: { name: string; value: string }[] = [];
	for (const [index, { path, name }] of repos.entries()) {
		options.onProgress?.(index, repos.length, name);
		// A manifest that would read a file outside the repository keeps osv-scanner away from it (S56).
		const outside = await readsOutside(path);
		if (outside.found.length > 0) {
			missed.push({ name: "porchlight:not-covered", value: `${name}: ${outsideWords(outside.found)}` });
			continue;
		}
		const { code, stdout, stderr } = await run("osv-scanner", ["scan", "source", "--recursive", ...INVENTORY_ONLY, "--format", "cyclonedx-1-5", path]);
		if (/flag provided but not defined/.test(stderr)) {
			throw new Error(`This osv-scanner (${version ?? "unknown version"}) cannot list packages without a vulnerability database. Porchlight is tested with 2.7.`);
		}
		if (!READ.has(code)) {
			// Fixed words and the exit code, never osv-scanner's own: its last line can quote a lockfile's
			// address, token and all, or a path on this computer (S49).
			missed.push({ name: "porchlight:not-covered", value: `${name}: osv-scanner could not read its lockfiles (exit code ${code})` });
			continue;
		}
		const packages = code === 128 ? [] : packagesOf(stdout, name);
		components.push(await withAdvice({ type: "application", "bom-ref": `repository:${name}`, name, components: packages }, path));
	}
	return {
		bomFormat: "CycloneDX",
		specVersion: "1.5",
		version: 1,
		metadata: {
			timestamp: (options.now?.() ?? new Date()).toISOString(),
			tools: { components: [{ type: "application", name: "porchlight" }, { type: "application", name: "osv-scanner", ...(version ? { version } : {}) }] },
			component: { type: "application", "bom-ref": "porchlight:root", name: basename(root) || root },
			...(missed.length > 0 ? { properties: missed } : {}),
		},
		components,
	};
}

/**
 * A repository's packages with Porchlight's notes: each package's licence class when it is one to
 * review (FT-6), a name one letter from a popular package's (FT-7), and, on the repository, its licence
 * counts and any dependency-confusion advice from its own top-level files. Read offline; nothing is
 * looked up. Exported for tests.
 */
export async function withAdvice(repo: RepoComponent, path: string): Promise<RepoComponent> {
	const kinds: LicenceClass[] = [];
	const known: { ecosystem: "npm" | "PyPI"; name: string }[] = [];
	for (const component of repo.components) {
		const kind = classifyLicences(component.licenses);
		kinds.push(kind);
		if (REVIEW_CLASSES.includes(kind)) note(component, "porchlight:licence-risk", `${kind}: ${LICENCE_WORDS[kind]}`);
		const ecosystem = ecosystemOfPurl(component.purl);
		if (ecosystem) known.push({ ecosystem, name: component.name });
	}
	const byName = new Map(repo.components.map((component) => [`${ecosystemOfPurl(component.purl)}\n${component.name}`, component]));
	const confusion = await confusionIn(path);
	const advice: PackageAdvice[] = [...lookalikes(known), ...confusion.advice];
	const repoNotes: { name: string; value: string }[] = [{ name: "porchlight:licences", value: licenceSummary(licenceCounts(kinds)) }];
	for (const item of advice) {
		const target = item.name ? byName.get(`${item.ecosystem}\n${item.name}`) : undefined;
		const value = `${item.level}: ${item.reason}`;
		if (target) note(target, "porchlight:advice", value);
		else repoNotes.push({ name: "porchlight:advice", value: item.name ? `${item.level}: ${item.name}: ${item.reason}` : value });
	}
	for (const file of confusion.unread) repoNotes.push({ name: "porchlight:advice-not-covered", value: `${file} was not read for dependency confusion` });
	return { ...repo, properties: repoNotes };
}

function note(component: Component, name: string, value: string): void {
	component.properties = [...(component.properties ?? []), { name, value }];
}

/** Each piece of advice in an SBOM, with its repository, most serious first: for the command line. */
export function sbomAdvice(sbom: Sbom): { repo: string; level: string; text: string }[] {
	const found: { repo: string; level: string; text: string }[] = [];
	for (const repo of sbom.components) {
		for (const property of repo.properties ?? []) if (property.name === "porchlight:advice") found.push({ repo: repo.name, level: property.value.split(":")[0]!, text: property.value.slice(property.value.indexOf(":") + 2) });
		for (const component of repo.components) {
			for (const property of component.properties ?? []) {
				if (property.name === "porchlight:advice") found.push({ repo: repo.name, level: property.value.split(":")[0]!, text: `${component.name}: ${property.value.slice(property.value.indexOf(":") + 2)}` });
			}
		}
	}
	return found.sort((a, b) => (a.level === b.level ? 0 : a.level === "medium" ? -1 : 1));
}

/** How many packages of each licence class to review, over the whole SBOM. */
export function sbomLicenceReview(sbom: Sbom): Partial<Record<LicenceClass, number>> {
	const kinds: LicenceClass[] = [];
	for (const repo of sbom.components) for (const component of repo.components) kinds.push(classifyLicences(component.licenses));
	const counts = licenceCounts(kinds);
	return Object.fromEntries(Object.entries(counts).filter(([kind]) => REVIEW_CLASSES.includes(kind as LicenceClass)));
}

/** The packages of one repository's inventory, each once, by package URL, sorted so two SBOMs compare. */
export function packagesOf(output: string, repo: string): Component[] {
	const start = output.indexOf("{");
	if (start < 0) return [];
	const document = JSON.parse(output.slice(start)) as { components?: unknown[] };
	const byRef = new Map<string, Component>();
	for (const raw of document.components ?? []) {
		if (typeof raw !== "object" || raw === null) continue;
		const { name, version, purl, licenses } = raw as Record<string, unknown>;
		if (typeof name !== "string" || name === "") continue;
		// A package named by a path on this computer (a go.mod `replace` to /Users/<name>/…) is not a
		// package anyone else can look up, and the path names the owner (S49).
		if (localPath(name) || (typeof purl === "string" && localPath(decodeURIComponentSafe(purl.replace(/^pkg:[^/]+\//, ""))))) continue;
		const id = typeof purl === "string" && purl.startsWith("pkg:") ? purl : `${name}@${typeof version === "string" ? version : ""}`;
		// The reference is unique across the whole document: the same package can be in several repositories.
		const component: Component = {
			"bom-ref": `${repo}:${id}`,
			type: "library",
			name,
			...(typeof version === "string" && version ? { version } : {}),
			...(typeof purl === "string" && purl.startsWith("pkg:") ? { purl } : {}),
		};
		const known = licenseList(licenses);
		if (known.length > 0) component.licenses = known;
		byRef.set(component["bom-ref"], component);
	}
	return [...byRef.values()].sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"], "en"));
}

/** Whether a name is a path on a computer rather than a package's name. */
function localPath(text: string): boolean {
	return /^(?:\/|~|\.\.?[\\/]|[A-Za-z]:[\\/]|file:)/.test(text);
}

function decodeURIComponentSafe(text: string): string {
	try {
		return decodeURIComponent(text);
	} catch {
		return text;
	}
}

/** The licences osv-scanner gave, as SPDX ids or names; anything else is left out. */
function licenseList(value: unknown): { license: { id?: string; name?: string } }[] {
	if (!Array.isArray(value)) return [];
	const list: { license: { id?: string; name?: string } }[] = [];
	for (const entry of value) {
		const license = (entry as { license?: { id?: unknown; name?: unknown } } | null)?.license;
		if (typeof license?.id === "string" && /^[\w.+-]{1,100}$/.test(license.id)) list.push({ license: { id: license.id } });
		else if (typeof license?.name === "string" && license.name.length <= 200) list.push({ license: { name: license.name } });
	}
	return list;
}
