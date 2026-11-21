/**
 * `porchlight status` (FT-16): what Porchlight last found, from the files it keeps, for a script or a
 * status bar. It only reads: nothing is contacted (not the monitor, not Cloudflare, not a model), and
 * nothing is written. It carries counts, times and what a scan did not cover; never a finding's
 * place, a value, a key, a token, the monitor's address beyond its host, or a path of this computer.
 * A file that is there but cannot be read is said, never taken for "nothing found" (invariant 5).
 */
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { jsonText } from "./roadmap/escape.ts";
import { readPrivateJson } from "./private-files.ts";
import { History } from "./repos/history.ts";
import { countBySeverity, coverageNotes, type Counts } from "./repos/report.ts";
import { REPORT_FORMAT, type ScanReport, type Severity } from "./repos/types.ts";
import type { HostReport } from "./host/types.ts";
import type { CfReport } from "./cloudflare/types.ts";
import { readSavedMonitor } from "./monitor/settings.ts";
import { monitorConfig } from "./monitor/client.ts";

/** A kept file as status reads it: never there, there but not readable (with why), or read. */
type Part<T> = { state: "none" } | { state: "unreadable"; reason: string } | ({ state: "read" } & T);

export interface Status {
	repos: Part<{ scannedAt: string; repositories: number; findings: number; bySeverity: Counts; complete: boolean; notCovered: string[]; keptScans: number | null }>;
	host: Part<{ checkedAt: string; failed: number; couldNotCheck: number; failedBySeverity: Counts }>;
	cloudflare: Part<{ checkedAt: string; zones: number; failed: number; couldNotCheck: number; failedBySeverity: Counts }>;
	/** Whether a monitor is set, and its host; it is not asked anything. */
	monitor: { connected: boolean; host?: string };
}

function bySeverity(items: { severity: Severity }[]): Counts {
	const counts: Counts = { critical: 0, high: 0, medium: 0, low: 0 };
	for (const item of items) if (item.severity in counts) counts[item.severity]++;
	return counts;
}

async function readPart<T>(path: string, valid: (value: unknown) => boolean, describe: (value: never) => T): Promise<Part<T>> {
	const read = await readPrivateJson(path);
	if (read.state === "missing") return { state: "none" };
	if (read.state === "unreadable") return { state: "unreadable", reason: read.reason };
	if (!valid(read.value)) return { state: "unreadable", reason: "it is not what Porchlight writes there" };
	return { state: "read", ...describe(read.value as never) };
}

function countFailed(checks: { status: string; severity: Severity }[]): { failed: number; couldNotCheck: number; failedBySeverity: Counts } {
	const failed = checks.filter((check) => check.status === "failed");
	return { failed: failed.length, couldNotCheck: checks.filter((check) => check.status === "unknown").length, failedBySeverity: bySeverity(failed) };
}

/** Reads the status from `dataDir` (settings, the host check, the audit) and `reportPath` (the latest scan and its history beside it). */
export async function readStatus(dataDir: string, reportPath: string, env: Record<string, string | undefined> = process.env): Promise<Status> {
	const repos = await readPart(
		reportPath,
		(value) => Array.isArray((value as ScanReport | null)?.repos) && Array.isArray((value as ScanReport).tools) && !(((value as ScanReport).format ?? 0) > REPORT_FORMAT),
		(report: ScanReport) => {
			const all = report.repos.flatMap((repo) => repo.findings);
			const notCovered = coverageNotes(report);
			return { scannedAt: report.scannedAt, repositories: report.repos.length, findings: all.length, bySeverity: countBySeverity(all), complete: notCovered.length === 0, notCovered, keptScans: null as number | null };
		},
	);
	if (repos.state === "read") {
		// The history is kept beside the report; one that cannot be read is not counted as empty.
		repos.keptScans = await new History(dirname(reportPath)).list().then(
			(entries) => entries.length,
			() => null,
		);
	}
	const host = await readPart(
		join(dataDir, "host-check.json"),
		(value) => Array.isArray((value as HostReport | null)?.checks),
		(report: HostReport) => ({ checkedAt: report.checkedAt, ...countFailed(report.checks) }),
	);
	const cloudflare = await readPart(
		join(dataDir, "cloudflare-audit.json"),
		(value) => Array.isArray((value as CfReport | null)?.zones),
		(report: CfReport) => ({
			checkedAt: report.checkedAt,
			zones: report.zones.length,
			...countFailed([...report.userChecks, ...report.accounts.flatMap((account) => account.checks), ...report.zones.flatMap((zone) => zone.checks)]),
		}),
	);
	let monitor: Status["monitor"] = { connected: false };
	try {
		const config = env.PORCHLIGHT_MONITOR_URL || env.PORCHLIGHT_ADMIN_TOKEN ? monitorConfig(env) : (await readSavedMonitor(join(dataDir, "monitor-settings.json")))?.config;
		if (config) monitor = { connected: true, host: config.url.host };
	} catch {
		// A setting that cannot be used is not a connection.
	}
	return { repos, host, cloudflare, monitor };
}

const SEVERITY_WORDS: Severity[] = ["critical", "high", "medium", "low"];

function counted(counts: Counts): string {
	const parts = SEVERITY_WORDS.filter((severity) => counts[severity] > 0).map((severity) => `${counts[severity]} ${severity}`);
	return parts.length > 0 ? ` (${parts.join(", ")})` : "";
}

function partLine<T>(name: string, part: Part<T>, never: string, read: (value: T) => string): string {
	if (part.state === "none") return `${name}: ${never}`;
	if (part.state === "unreadable") return `${name}: the kept file could not be read (${part.reason})`;
	return `${name}: ${read(part as T)}`;
}

/** The status as a few lines for a terminal. */
export function renderStatus(status: Status): string {
	const lines = [
		partLine("Repositories", status.repos, "not scanned yet (porchlight repos scan <folder> --save)", (repos) => {
			const first = `${repos.findings} finding${repos.findings === 1 ? "" : "s"}${counted(repos.bySeverity)} in ${repos.repositories} repositor${repos.repositories === 1 ? "y" : "ies"}, scanned ${repos.scannedAt}`;
			return repos.complete ? first : `${first}. Incomplete: ${repos.notCovered.length} line${repos.notCovered.length === 1 ? "" : "s"} under "Not covered"`;
		}),
		partLine("This computer", status.host, "not checked yet (porchlight host check)", (host) => `${host.failed} problem${host.failed === 1 ? "" : "s"}${counted(host.failedBySeverity)}${host.couldNotCheck > 0 ? `, ${host.couldNotCheck} could not be checked` : ""}, checked ${host.checkedAt}`),
		partLine("Cloudflare", status.cloudflare, "not audited yet (porchlight cloudflare audit, or the interface)", (cf) => `${cf.failed} problem${cf.failed === 1 ? "" : "s"}${counted(cf.failedBySeverity)} in ${cf.zones} zone${cf.zones === 1 ? "" : "s"}${cf.couldNotCheck > 0 ? `, ${cf.couldNotCheck} could not be checked` : ""}, audited ${cf.checkedAt}`),
		status.monitor.connected ? `Monitor: ${status.monitor.host} (not asked; porchlight domains list asks it)` : "Monitor: not connected",
	];
	if (status.repos.state === "read" && !status.repos.complete) lines.push("", "Not covered:", ...status.repos.notCovered.map((note) => `  ${note}`));
	return `${lines.join("\n")}\n`;
}

/** Exit status for a script: 1 when a kept file could not be read, so a broken file is not read as all clear. */
export function statusExit(status: Status): number {
	return [status.repos, status.host, status.cloudflare].some((part) => part.state === "unreadable") ? 1 : 0;
}

/** The command: `porchlight status [--json] [--data <dir>] [--report <file>]`. */
export async function statusCommand(args: string[], print: (text: string) => void, defaults: { dataDir: string; env?: Record<string, string | undefined> }): Promise<number> {
	const { values } = parseArgs({ args, options: { json: { type: "boolean", default: false }, data: { type: "string" }, report: { type: "string" } } });
	const dataDir = resolve(values.data ?? defaults.dataDir);
	const status = await readStatus(dataDir, resolve(values.report ?? join(dataDir, "repo-scan.json")), defaults.env ?? process.env);
	print(values.json ? jsonText(status) : renderStatus(status));
	return statusExit(status);
}
