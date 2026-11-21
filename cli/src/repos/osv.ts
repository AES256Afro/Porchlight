import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { GIT_SAFE_ARGS } from "../github/github.ts";
import { compareVersions, highestVersion } from "../roadmap/versions.ts";
import { lastLine, type Runner } from "./exec.ts";
import { gitReadEnv } from "./git-copy.ts";
import type { Finding, NotCovered, Severity } from "./types.ts";

/**
 * What osv-scanner is kept from doing, in every run (scans, the SBOM, the host check): working out
 * packages a manifest pulls in indirectly (that sends their names to deps.dev, and follows registries a
 * repository's pom.xml names), running a language's toolchain inside the repository to see which code is
 * reached (`go list` can download whatever modules a go.mod names), and sending hashes of vendored
 * files to OSV.dev. What it does instead is read the lockfiles and ask OSV.dev about the packages in
 * them, or nothing at all offline (S19).
 */
export const OSV_LIMITS = ["--no-resolve", "--no-call-analysis=all", "--x-disable-plugins=filesystem/vendored"];

/**
 * osv-scanner's exit codes. Anything else is a failure, notably 127 when the
 * vulnerability database cannot be reached: it then still prints a report
 * with no results, which must not be read as "no vulnerabilities".
 */
const VULNERABILITIES_FOUND = 1;
const NO_PACKAGES_FOUND = 128;

export interface OsvOptions {
	/**
	 * A folder for OSV's databases. With one, osv-scanner downloads each ecosystem's whole database
	 * there (and brings it up to date) and compares against it, so the names and versions of a
	 * repository's packages are never sent to api.osv.dev. Without, each package is looked up there.
	 */
	database?: string;
}

/** Checks the dependencies named in a repository's lockfiles against the OSV database. */
export async function runOsvScanner(repo: string, run: Runner, options: OsvOptions = {}): Promise<Finding[]> {
	return (await osvScan(repo, run, options)).findings;
}

async function osvScan(repo: string, run: Runner, options: OsvOptions): Promise<{ findings: Finding[]; stderr: string }> {
	const offline = options.database ? ["--offline-vulnerabilities", "--download-offline-databases"] : [];
	const { code, stdout, stderr } = await run(
		"osv-scanner",
		["scan", "source", "--recursive", ...OSV_LIMITS, ...offline, "--format", "json", repo],
		options.database ? { env: { OSV_SCANNER_LOCAL_DB_CACHE_DIRECTORY: options.database } } : undefined,
	);
	if (code === NO_PACKAGES_FOUND) return { findings: [], stderr };
	if (code !== 0 && code !== VULNERABILITIES_FOUND) {
		// Progress lines come first on stderr; the reason for the failure is last.
		throw new Error(lastLine(stderr) || `osv-scanner exited with code ${code}`);
	}
	return { findings: parseOsv(stdout, repo), stderr };
}

/** Manifests whose indirect dependencies only resolution (which is off, see OSV_LIMITS) would work out. */
const UNRESOLVED = /^(?:requirements.*\.txt|pom\.xml)$/;

/** The lockfiles and manifests osv-scanner reads, by name: a tracked one it did not read is said. */
const LOCKFILES = [
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
	"requirements*.txt",
];

/** Paths osv-scanner names on stderr after `prefix`, as paths inside the repository. */
function namedPaths(stderr: string, prefix: RegExp, repo: string, top: string): string[] {
	const paths: string[] = [];
	for (const line of stderr.split("\n")) {
		const path = prefix.exec(line.trim())?.[1];
		if (!path) continue;
		const inside = [repo, top].map((base) => relative(base, path)).find((rel) => rel !== "" && !rel.startsWith("..") && !isAbsolute(rel));
		if (inside !== undefined) paths.push(inside.split(sep).join("/"));
	}
	return paths;
}

/**
 * A repository's packages checked against OSV, and what that left out (S17, S18, S19):
 * - an osv-scanner.toml it applied, wherever it was (a filter hides findings, so it is named);
 * - a lockfile git tracks that it did not read: a repository's .gitignore can hide one from it;
 * - the packages a requirements.txt or pom.xml pulls in indirectly, which were not worked out.
 */
export async function scanDependencies(repo: string, run: Runner, options: OsvOptions = {}): Promise<{ findings: Finding[]; notCovered: NotCovered[]; settingFiles: string[] }> {
	const { findings, stderr } = await osvScan(repo, run, options);
	const top = await realpath(repo).catch(() => repo);
	const settingFiles = [...new Set(namedPaths(stderr, /^Loaded filter from: (.+)$/, repo, top))].sort();
	const read = new Set(namedPaths(stderr, /^Scanned (.+) file and found \d+ packages?$/, repo, top));
	const listed = await run("git", [...GIT_SAFE_ARGS, "-C", repo, "ls-files", "-z", "--", ...LOCKFILES.map((name) => `:(glob)**/${name}`)], { env: gitReadEnv() }).catch(() => null);
	// Third-party code committed with the project carries lockfiles of its own, which are not the project's.
	const tracked = listed && listed.code === 0 ? listed.stdout.split("\0").filter((path) => path !== "" && !path.split("/").includes("node_modules")) : [];
	const notCovered: NotCovered[] = [];
	const missed = tracked.filter((path) => !read.has(path));
	if (missed.length > 0) {
		const shown = missed.slice(0, 3).join(", ") + (missed.length > 3 ? ` and ${missed.length - 3} more` : "");
		notCovered.push({ tool: "osv-scanner", message: `${missed.length === 1 ? "a lockfile git tracks was" : `${missed.length} lockfiles git tracks were`} not read (${shown}), most likely because the repository's .gitignore covers ${missed.length === 1 ? "it" : "them"}` });
	}
	const manifests = tracked.filter((path) => UNRESOLVED.test(path.split("/").at(-1) ?? ""));
	if (manifests.length > 0) {
		const names = [...new Set(manifests.map((path) => path.split("/").at(-1)))].sort().join(" and ");
		notCovered.push({ tool: "osv-scanner", message: `packages its ${names} ${manifests.length === 1 ? "file pulls" : "files pull"} in indirectly were not worked out: that would send their names to deps.dev` });
	}
	return { findings, notCovered, settingFiles };
}

interface OsvAffected {
	package?: { name?: string; ecosystem?: string };
	ranges?: { type?: string; events?: { fixed?: string }[] }[];
}

interface OsvVulnerability {
	id?: string;
	summary?: string;
	affected?: OsvAffected[];
}

interface OsvPackage {
	package?: { name?: string; version?: string; ecosystem?: string };
	vulnerabilities?: OsvVulnerability[];
	groups?: { ids?: string[]; aliases?: string[]; max_severity?: string }[];
}

export function parseOsv(output: string, repo: string): Finding[] {
	const start = output.indexOf("{");
	if (start < 0) return [];
	const report = JSON.parse(output.slice(start)) as { results?: { source?: { path?: string }; packages?: OsvPackage[] }[] };

	// osv-scanner can list one package twice for the same lockfile; an advisory
	// for a package version in a file is one finding however often it is listed.
	const findings = new Map<string, Finding>();
	for (const result of report.results ?? []) {
		const lockfile = result.source?.path ? relative(repo, result.source.path) : "unknown lockfile";
		for (const entry of result.packages ?? []) {
			const name = entry.package?.name ?? "unknown package";
			const version = entry.package?.version ?? "?";
			const ecosystem = entry.package?.ecosystem ?? "";
			const summaries = new Map((entry.vulnerabilities ?? []).map((vuln) => [vuln.id, vuln.summary]));
			// A group is one underlying flaw, which may be listed under several IDs.
			for (const group of entry.groups ?? []) {
				const id = group.ids?.[0];
				if (!id) continue;
				const summary = group.ids!.map((alias) => summaries.get(alias)).find(Boolean);
				const detail = `${name}@${version}`;
				const key = `${id}\n${lockfile}\n${detail}`;
				if (findings.has(key)) continue;
				// The records in a group describe one flaw; where they disagree
				// on the fix, the higher version is the one that satisfies all.
				const records = (entry.vulnerabilities ?? []).filter((vuln) => vuln.id && [...group.ids!, ...(group.aliases ?? [])].includes(vuln.id));
				const fixedIn = highestVersion(records.map((vuln) => fixedVersion(vuln, name, ecosystem, version)).filter((fix) => fix !== undefined));
				findings.set(key, {
					tool: "osv-scanner",
					kind: "vulnerability",
					severity: severityFromCvss(group.max_severity),
					ruleId: id,
					title: summary ?? `Known vulnerability in ${name}`,
					location: lockfile,
					detail,
					...(fixedIn ? { fixedIn } : {}),
				});
			}
		}
	}
	return [...findings.values()];
}

/**
 * The lowest release above `current` that an advisory lists as fixed for this
 * package. An advisory covers several packages and several release lines, so
 * both the package and "above the installed version" have to match.
 */
export function fixedVersion(vuln: OsvVulnerability, name: string, ecosystem: string, current: string): string | undefined {
	const fixes = (vuln.affected ?? [])
		.filter((affected) => samePackage(affected.package, name, ecosystem))
		.flatMap((affected) => affected.ranges ?? [])
		.filter((range) => range.type !== "GIT") // commit hashes, not versions
		.flatMap((range) => (range.events ?? []).map((event) => event.fixed))
		.filter((fix): fix is string => typeof fix === "string" && compareVersions(fix, current) > 0);
	return fixes.sort(compareVersions)[0];
}

function samePackage(candidate: OsvAffected["package"], name: string, ecosystem: string): boolean {
	// PyPI treats case and the separators - _ . as equivalent; nothing else relies on them differing.
	const normal = (value: string | undefined) => (value ?? "").toLowerCase().replace(/[-_.]+/g, "-");
	const family = (value: string | undefined) => (value ?? "").toLowerCase().split(":")[0];
	return normal(candidate?.name) === normal(name) && family(candidate?.ecosystem) === family(ecosystem);
}

/** CVSS base score to the usual bands. An advisory with no score is treated as medium, not ignored. */
export function severityFromCvss(score: string | undefined): Severity {
	const value = Number.parseFloat(score ?? "");
	if (!Number.isFinite(value) || value <= 0) return "medium";
	if (value >= 9) return "critical";
	if (value >= 7) return "high";
	if (value >= 4) return "medium";
	return "low";
}
