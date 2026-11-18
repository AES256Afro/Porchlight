import { resolve } from "node:path";
import { discoverRepos } from "./discover.ts";
import { run as defaultRun, ToolMissingError, type Runner } from "./exec.ts";
import { runGitleaks } from "./gitleaks.ts";
import { runOsvScanner } from "./osv.ts";
import { scannerSettingFiles } from "./settings.ts";
import type { Finding, RepoResult, ScanReport, ToolName, ToolStatus } from "./types.ts";

interface Tool {
	name: ToolName;
	versionArgs: string[];
	installHint: string;
	scan: (repo: string, run: Runner) => Promise<Finding[]>;
}

const TOOLS: Tool[] = [
	{ name: "gitleaks", versionArgs: ["version"], installHint: "brew install gitleaks", scan: runGitleaks },
	{ name: "osv-scanner", versionArgs: ["--version"], installHint: "brew install osv-scanner", scan: runOsvScanner },
];

const REPO_CONCURRENCY = 4;

export interface ScanProgress {
	/** Repositories finished so far. */
	done: number;
	total: number;
	/** The repository whose scan just started. */
	path: string;
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
}

export async function scanRepos(options: ScanOptions): Promise<ScanReport> {
	const run = options.run ?? defaultRun;
	const root = resolve(options.root);
	const tools = await Promise.all(TOOLS.map((tool) => detect(tool, run)));
	const available = TOOLS.filter((tool) => tools.some((status) => status.tool === tool.name && status.status === "ok"));
	const others = (options.also ?? []).map((other) => ({ root: resolve(other.root), depth: other.depth }));
	const found = await Promise.all([{ root, depth: options.depth }, ...others].map((place) => discoverRepos(place.root, place.depth)));
	// A folder inside another is found twice; it is scanned once.
	const paths = [...new Set(found.flat())];

	const repos: RepoResult[] = [];
	const queue = [...paths];
	const worker = async () => {
		for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
			options.onProgress?.({ done: repos.length, total: paths.length, path });
			repos.push(await scanRepo(path, available, run, options.settingFiles ?? scannerSettingFiles));
		}
	};
	await Promise.all(Array.from({ length: REPO_CONCURRENCY }, worker));
	repos.sort((a, b) => a.path.localeCompare(b.path));

	const otherRoots = others.map((other) => other.root);
	return { root, ...(otherRoots.length > 0 ? { otherRoots } : {}), scannedAt: (options.now?.() ?? new Date()).toISOString(), tools, repos };
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
async function scanRepo(path: string, tools: Tool[], run: Runner, settingFiles: (repo: string) => Promise<string[]>): Promise<RepoResult> {
	const result: RepoResult = { path, findings: [], errors: [] };
	const files = await settingFiles(path);
	if (files.length > 0) result.settingFiles = files;
	for (const tool of tools) {
		try {
			result.findings.push(...(await tool.scan(path, run)));
		} catch (err) {
			result.errors.push({ tool: tool.name, message: err instanceof Error ? err.message : String(err) });
		}
	}
	return result;
}
