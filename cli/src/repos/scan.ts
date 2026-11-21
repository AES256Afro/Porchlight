import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { discoverRepos } from "./discover.ts";
import { CancelledError, run as defaultRun, ToolMissingError, type Runner } from "./exec.ts";
import { standardChoices } from "../../ui/scan-choices.js";
import { scanSecrets } from "./gitleaks.ts";
import { scanDependencies } from "./osv.ts";
import { nameUnder } from "./report.ts";
import { scannerSettingFiles } from "./settings.ts";
import { REPORT_FORMAT, type Finding, type NotCovered, type RepoResult, type ScanChoices, type ScanReport, type ToolName, type ToolStatus } from "./types.ts";

interface Tool {
	name: ToolName;
	versionArgs: string[];
	installHint: string;
	/** Whether the choices ask for this scanner's check. */
	chosen: (choices: ScanChoices) => boolean;
	scan: (repo: string, run: Runner, settings: ScannerSettings) => Promise<{ findings: Finding[]; unreadFiles?: number; notCovered?: NotCovered[]; settingFiles?: string[] }>;
}

const TOOLS: Tool[] = [
	{
		name: "gitleaks",
		versionArgs: ["version"],
		installHint: "brew install gitleaks",
		// One gitleaks pass finds secrets and, with Porchlight's rules beside its own, private data.
		chosen: (choices) => choices.secrets || choices.privateData === true,
		scan: (repo, run, { choices }) =>
			scanSecrets(repo, run, { history: choices.history, localFiles: choices.localFiles, secrets: choices.secrets, privateData: choices.privateData === true }),
	},
	{
		name: "osv-scanner",
		versionArgs: ["--version"],
		installHint: "brew install osv-scanner",
		chosen: (choices) => choices.dependencies,
		scan: (repo, run, settings) => scanDependencies(repo, run, { database: settings.osvDatabase }),
	},
];

/**
 * Repositories scanned at once. Each runs both scanners together, and gitleaks uses several cores
 * itself, so half the machine's cores, never fewer than two or more than eight.
 */
export function repoConcurrency(cores: number = availableParallelism()): number {
	return Math.max(2, Math.min(8, Math.floor(cores / 2)));
}

export interface ScanProgress {
	/** Repositories finished so far. */
	done: number;
	total: number;
	/** The repository whose scan just started. */
	path: string;
}

/** A repository whose scan has just ended. */
export interface RepoDone {
	/** Repositories finished, this one included. */
	done: number;
	total: number;
	path: string;
	/** How long its scanners took. */
	ms: number;
	findings: number;
	/** Scanners that failed on it. */
	errors: number;
}

export interface ScanOptions {
	root: string;
	depth: number;
	/** Further folders to scan in the same report, each looked through to its own depth. */
	also?: { root: string; depth: number }[];
	run?: Runner;
	now?: () => Date;
	/** Lists a repository's scanner setting files; tests replace it. */
	settingFiles?: (repo: string) => Promise<string[]>;
	onProgress?: (progress: ScanProgress) => void;
	onRepoDone?: (done: RepoDone) => void;
	/** Stops the scan when aborted: running scanners are stopped and scanRepos rejects with a CancelledError. */
	signal?: AbortSignal;
	/** Repositories scanned at once (default: by the machine's cores). */
	concurrency?: number;
	/** A folder for OSV's offline databases; see runOsvScanner. Absent: packages are looked up online. */
	osvDatabase?: string;
	/** What to look at (default: Standard, everything a scan looked at before there were choices). Saved with the report. */
	choices?: ScanChoices;
}

/** What the scanners are told beyond the repository. */
interface ScannerSettings {
	osvDatabase?: string;
	choices: ScanChoices;
}

export async function scanRepos(options: ScanOptions): Promise<ScanReport> {
	const { signal } = options;
	const baseRun = options.run ?? defaultRun;
	// Every program the scan starts can be stopped with it.
	const run: Runner = signal ? (command, args, runOptions) => baseRun(command, args, { ...runOptions, signal }) : baseRun;
	const now = options.now ?? (() => new Date());
	const root = resolve(options.root);
	const choices = options.choices ?? standardChoices();
	const tools = await Promise.all(TOOLS.map((tool) => detect(tool, run)));
	const available = usable(tools, choices);
	const others = (options.also ?? []).map((other) => ({ root: resolve(other.root), depth: other.depth }));
	const found = await Promise.all([{ root, depth: options.depth }, ...others].map((place) => discoverRepos(place.root, place.depth)));
	const otherRoots = others.map((other) => other.root);
	// A folder inside another is found twice; it is scanned once. One the choices name is left out, by its name.
	const named = [...new Set(found.flat())].map((path) => ({ path, name: nameUnder(root, otherRoots.length > 0 ? otherRoots : undefined, path) }));
	const skipped = named.filter(({ name }) => choices.skip.includes(name)).map(({ name }) => name);
	const paths = named.filter(({ name }) => !choices.skip.includes(name)).map(({ path }) => path);
	const settings: ScannerSettings = { choices, ...(options.osvDatabase ? { osvDatabase: options.osvDatabase } : {}) };

	const repos: RepoResult[] = [];
	const queue = [...paths];
	const worker = async () => {
		for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
			if (signal?.aborted) throw new CancelledError();
			options.onProgress?.({ done: repos.length, total: paths.length, path });
			const started = now().getTime();
			const result = await scanRepo(path, available, run, options.settingFiles ?? scannerSettingFiles, settings);
			// A scanner stopped half way has not looked: its repository is not reported at all.
			if (signal?.aborted) throw new CancelledError();
			repos.push(result);
			options.onRepoDone?.({ done: repos.length, total: paths.length, path, ms: now().getTime() - started, findings: result.findings.length, errors: result.errors.length });
		}
	};
	await Promise.all(Array.from({ length: Math.max(1, options.concurrency ?? repoConcurrency()) }, worker));
	repos.sort((a, b) => a.path.localeCompare(b.path));

	return { format: REPORT_FORMAT, root, ...(otherRoots.length > 0 ? { otherRoots } : {}), scannedAt: now().toISOString(), tools, repos, choices, ...(skipped.length > 0 ? { skipped: skipped.sort() } : {}) };
}

/** The scanners that are installed and that the choices ask for. */
function usable(tools: ToolStatus[], choices: ScanChoices): Tool[] {
	return TOOLS.filter((tool) => tool.chosen(choices) && tools.some((status) => status.tool === tool.name && status.status === "ok"));
}

/**
 * Scans one repository again with the scanners installed now, as a full scan would. For the
 * interface's "Scan this repository again"; the caller puts the result in place of the old one.
 */
export async function rescanRepo(path: string, options: Pick<ScanOptions, "run" | "settingFiles" | "signal" | "osvDatabase" | "choices"> = {}): Promise<{ repo: RepoResult; tools: ToolStatus[] }> {
	const { signal } = options;
	const baseRun = options.run ?? defaultRun;
	const run: Runner = signal ? (command, args, runOptions) => baseRun(command, args, { ...runOptions, signal }) : baseRun;
	const choices = options.choices ?? standardChoices();
	const tools = await Promise.all(TOOLS.map((tool) => detect(tool, run)));
	const available = usable(tools, choices);
	const repo = await scanRepo(resolve(path), available, run, options.settingFiles ?? scannerSettingFiles, { choices, ...(options.osvDatabase ? { osvDatabase: options.osvDatabase } : {}) });
	if (signal?.aborted) throw new CancelledError();
	return { repo, tools };
}

async function detect(tool: Tool, run: Runner): Promise<ToolStatus> {
	try {
		const { stdout } = await run(tool.name, tool.versionArgs);
		const version = stdout.match(/\d+\.\d+\.\d+/)?.[0];
		return { tool: tool.name, status: "ok", version, installHint: tool.installHint };
	} catch (err) {
		if (err instanceof ToolMissingError) return { tool: tool.name, status: "missing", installHint: tool.installHint };
		throw err;
	}
}

/** One scanner failing on a repository is recorded against it; the others still run. */
async function scanRepo(path: string, tools: Tool[], run: Runner, settingFiles: (repo: string) => Promise<string[]>, settings: ScannerSettings): Promise<RepoResult> {
	const result: RepoResult = { path, findings: [], errors: [] };
	const files = await settingFiles(path);
	if (files.length > 0) result.settingFiles = files;
	// The scanners read the same files and write nothing, so they run together; their results are
	// put in the scanners' own order, so a report does not depend on which finished first.
	const outcomes = await Promise.all(
		tools.map(async (tool) => {
			try {
				return await tool.scan(path, run, settings);
			} catch (err) {
				return { error: { tool: tool.name, message: err instanceof Error ? err.message : String(err) } };
			}
		}),
	);
	for (const outcome of outcomes) {
		if ("error" in outcome) {
			result.errors.push(outcome.error);
			continue;
		}
		result.findings.push(...outcome.findings);
		if (outcome.unreadFiles) result.unreadFiles = outcome.unreadFiles;
		if (outcome.notCovered?.length) result.notCovered = [...(result.notCovered ?? []), ...outcome.notCovered];
		// What a scanner reports it applied, wherever it was: the search for setting files skips some folders.
		const applied = (outcome.settingFiles ?? []).filter((file) => !result.settingFiles?.includes(file));
		if (applied.length > 0) result.settingFiles = [...(result.settingFiles ?? []), ...applied];
	}
	return result;
}
