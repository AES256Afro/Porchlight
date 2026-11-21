import { basename, resolve } from "node:path";
import { discoverRepos } from "./discover.ts";
import { run as defaultRun, ToolMissingError, type Runner } from "./exec.ts";
import { nameUnder } from "./report.ts";

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
	components: { type: "application"; "bom-ref": string; name: string; components: Component[] }[];
}

/**
 * Lockfiles read, nothing contacted, and no vulnerability matched: --offline alone still wants a local
 * vulnerability database, so the plugin that matches against one is switched off. That switch is one of
 * osv-scanner's experimental flags (2.x); a version without it is said to be unsupported, never ignored.
 */
const INVENTORY_ONLY = ["--offline", "--all-packages", "--x-disable-plugins=vulnmatch/osvlocal"];

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
		const { code, stdout, stderr } = await run("osv-scanner", ["scan", "source", "--recursive", ...INVENTORY_ONLY, "--format", "cyclonedx-1-5", path]);
		if (/flag provided but not defined/.test(stderr)) {
			throw new Error(`This osv-scanner (${version ?? "unknown version"}) cannot list packages without a vulnerability database. Porchlight is tested with 2.7.`);
		}
		if (!READ.has(code)) {
			missed.push({ name: "porchlight:not-covered", value: `${name}: ${stderr.trim().split("\n").at(-1)?.slice(0, 300) || `osv-scanner exited with code ${code}`}` });
			continue;
		}
		components.push({ type: "application", "bom-ref": `repository:${name}`, name, components: code === 128 ? [] : packagesOf(stdout, name) });
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
	return [...byRef.values()].sort((a, b) => a["bom-ref"].localeCompare(b["bom-ref"]));
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
