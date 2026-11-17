import { resolve } from "node:path";
import { discoverRepos } from "./discover.ts";
import { run as defaultRun, ToolMissingError, type Runner } from "./exec.ts";
import { runGitleaks } from "./gitleaks.ts";
import { runOsvScanner } from "./osv.ts";
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
	run?: Runner;
	now?: () => Date;
	onProgress?: (progress: ScanProgress) => void;
}

export async function scanRepos(options: ScanOptions): Promise<ScanReport> {
	const run = options.run ?? defaultRun;
	const root = resolve(options.root);
	const tools = await Promise.all(TOOLS.map((tool) => detect(tool, run)));
	const available = TOOLS.filter((tool) => tools.some((status) => status.tool === tool.name && status.status === "ok"));
	const paths = await discoverRepos(root, options.depth);

	const repos: RepoResult[] = [];
	const queue = [...paths];
	const worker = async () => {
		for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
			options.onProgress?.({ done: repos.length, total: paths.length, path });
			repos.push(await scanRepo(path, available, run));
		}
	};
	await Promise.all(Array.from({ length: REPO_CONCURRENCY }, worker));
	repos.sort((a, b) => a.path.localeCompare(b.path));

	return { root, scannedAt: (options.now?.() ?? new Date()).toISOString(), tools, repos };
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
async function scanRepo(path: string, tools: Tool[], run: Runner): Promise<RepoResult> {
	const result: RepoResult = { path, findings: [], errors: [] };
	for (const tool of tools) {
		try {
			result.findings.push(...(await tool.scan(path, run)));
		} catch (err) {
			result.errors.push({ tool: tool.name, message: err instanceof Error ? err.message : String(err) });
		}
	}
	return result;
}
