import { availableParallelism } from "node:os";
import { resolve } from "node:path";
import { findRepos, type NotSearched } from "./discover.ts";
import { CancelledError, quotedValuesOut, run as defaultRun, ToolMissingError, type Runner } from "./exec.ts";
import { standardChoices } from "../../ui/scan-choices.js";
import { scanSecrets } from "./gitleaks.ts";
import type { HistoryReuse } from "./history-reuse.ts";
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
	scan: (repo: string, run: Runner, settings: ScannerSettings) => Promise<{ findings: Finding[]; unreadFiles?: number; notCovered?: NotCovered[]; settingFiles?: string[]; reusedFrom?: string }>;
}

const TOOLS: Tool[] = [
	{
		name: "gitleaks",
		versionArgs: ["version"],
		installHint: "brew install gitleaks",
		// One gitleaks pass finds secrets and, with Porchlight's rules beside its own, private data.
		chosen: (choices) => choices.secrets || choices.privateData === true,
		scan: (repo, run, { choices, scanned, notSearched, historyReuse }) =>
			scanSecrets(repo, run, { history: choices.history, localFiles: choices.localFiles, secrets: choices.secrets, privateData: choices.privateData === true, scanned, notSearched }, historyReuse),
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
	/**
	 * Further folders to scan in the same report: each looked through to its own depth, or, for the
	 * repositories fetched from GitHub, exactly the repositories listed (S50).
	 */
	also?: ({ root: string; depth: number } | { root: string; repos: string[] })[];
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
	/** Where readings of history are kept, so an unchanged repository's is not read again (OP-1). Absent: always read. */
	historyReuse?: HistoryReuse;
}

/** What the scanners are told beyond the repository. */
interface ScannerSettings {
	osvDatabase?: string;
	choices: ScanChoices;
	/** Every repository the scan found, by path: a repository nested in another that is not among them is named under "Not covered" (B30). */
	scanned: Set<string>;
	/** Where a scanner adds folders it found that the scan did not cover. */
	notSearched: NotSearched[];
	historyReuse?: HistoryReuse;
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
	const others = options.also ?? [];
	const found: { repos: string[]; notSearched: NotSearched[] }[] = await Promise.all(
		[{ root, depth: options.depth }, ...others].map((place) =>
			"repos" in place ? { repos: place.repos.map((repo) => resolve(repo)), notSearched: [] } : findRepos(resolve(place.root), place.depth),
		),
	);
	const otherRoots = others.map((other) => resolve(other.root));
	const nameOf = (path: string) => nameUnder(root, otherRoots.length > 0 ? otherRoots : undefined, path);
	// A folder inside another is found twice; it is scanned once. One the choices name is left out, by its name.
	const named = [...new Set(found.flatMap((place) => place.repos))].map((path) => ({ path, name: nameOf(path) }));
	const skipped = named.filter(({ name }) => choices.skip.includes(name)).map(({ name }) => name);
	const paths = named.filter(({ name }) => !choices.skip.includes(name)).map(({ path }) => path);
	const passedOver: NotSearched[] = found.flatMap((place) => place.notSearched);
	const settings: ScannerSettings = {
		choices,
		scanned: new Set(named.map(({ path }) => path)),
		notSearched: passedOver,
		...(options.osvDatabase ? { osvDatabase: options.osvDatabase } : {}),
		...(options.historyReuse ? { historyReuse: options.historyReuse } : {}),
	};

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
	// In code-unit order, so a report does not depend on the language the computer is set to (B61).
	repos.sort((a, b) => byText(a.path, b.path));
	// What the search and the scanners passed over, each folder once, named as repositories are.
	const notSearched = [...new Map(passedOver.map((entry) => [entry.path, { name: nameOf(entry.path), reason: entry.reason }])).values()];

	return {
		format: REPORT_FORMAT,
		root,
		...(otherRoots.length > 0 ? { otherRoots } : {}),
		scannedAt: now().toISOString(),
		tools,
		repos,
		choices,
		...(skipped.length > 0 ? { skipped: skipped.sort() } : {}),
		...(notSearched.length > 0 ? { notSearched: notSearched.sort((a, b) => byText(a.name, b.name)) } : {}),
	};
}

/** Text in code-unit order: the same on every computer, whatever language it is set to. */
export function byText(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** The scanners that are installed and that the choices ask for. */
function usable(tools: ToolStatus[], choices: ScanChoices): Tool[] {
	return TOOLS.filter((tool) => tool.chosen(choices) && tools.some((status) => status.tool === tool.name && status.status === "ok"));
}

/**
 * Scans one repository again with the scanners installed now, as a full scan would. For the
 * interface's "Scan this repository again"; the caller puts the result in place of the old one.
 */
export async function rescanRepo(
	path: string,
	options: Pick<ScanOptions, "run" | "settingFiles" | "signal" | "osvDatabase" | "choices"> & {
		/** The report's other repositories, by path, so one nested in this one is not named as unscanned. */
		scanned?: string[];
	} = {},
): Promise<{ repo: RepoResult; tools: ToolStatus[] }> {
	const { signal } = options;
	const baseRun = options.run ?? defaultRun;
	const run: Runner = signal ? (command, args, runOptions) => baseRun(command, args, { ...runOptions, signal }) : baseRun;
	const choices = options.choices ?? standardChoices();
	const tools = await Promise.all(TOOLS.map((tool) => detect(tool, run)));
	const available = usable(tools, choices);
	const scanned = new Set([resolve(path), ...(options.scanned ?? []).map((other) => resolve(other))]);
	const repo = await scanRepo(resolve(path), available, run, options.settingFiles ?? scannerSettingFiles, { choices, scanned, notSearched: [], ...(options.osvDatabase ? { osvDatabase: options.osvDatabase } : {}) });
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
				return { error: { tool: tool.name, message: quotedValuesOut(err instanceof Error ? err.message : String(err)) } };
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
		if (outcome.reusedFrom) result.historyReusedFrom = outcome.reusedFrom;
		if (outcome.notCovered?.length) result.notCovered = [...(result.notCovered ?? []), ...outcome.notCovered];
		// What a scanner reports it applied, wherever it was: the search for setting files skips some folders.
		const applied = (outcome.settingFiles ?? []).filter((file) => !result.settingFiles?.includes(file));
		if (applied.length > 0) result.settingFiles = [...(result.settingFiles ?? []), ...applied];
	}
	return result;
}
