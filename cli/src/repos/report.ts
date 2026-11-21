import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, isAbsolute, relative } from "node:path";
import { mdCode, mdText } from "../roadmap/escape.ts";
import { footLine, scanKindOf } from "../roadmap/style.ts";
import { choiceGaps, describeChoices, standardChoices } from "../../ui/scan-choices.js";
import { REPORT_FORMAT, SEVERITIES, severityRank, type Finding, type RepoResult, type ScanReport, type Severity, type ToolName } from "./types.ts";

export type Counts = Record<Severity, number>;

/** Reads a report written by `repos scan --json` or by the web interface. Throws if the text is something else. */
export function parseScanReport(text: string, path: string): ScanReport {
	let report: ScanReport;
	try {
		report = JSON.parse(text) as ScanReport;
	} catch {
		throw new Error(`Not valid JSON: ${path}`);
	}
	if (!Array.isArray(report?.repos) || !Array.isArray(report?.tools) || typeof report.root !== "string") {
		throw new Error(`Not a Porchlight scan report: ${path}`);
	}
	// A newer report can say a scan was incomplete in ways this version cannot read: refused, never misread as complete.
	if (typeof report.format === "number" && report.format > REPORT_FORMAT) {
		throw new Error(`This report was written by a newer Porchlight (report format ${report.format}; this one reads ${REPORT_FORMAT} and older). Update Porchlight to read it: ${path}`);
	}
	return report;
}

/**
 * What a report holds, as a short stamp: its scan time and each repository scanned again since, by
 * when. A mural or a discussion made from one report is out of date once the stamp changes, though
 * "Scan this repository again" keeps the report's scan time (B38).
 */
export function reportStamp(report: Pick<ScanReport, "scannedAt" | "repos">): string {
	const rescans = report.repos.filter((repo) => repo.rescannedAt).map((repo) => `${repo.path}\n${repo.rescannedAt}`).sort();
	return createHash("sha256").update(JSON.stringify([report.scannedAt, rescans])).digest("hex").slice(0, 16);
}

export function countBySeverity(findings: Finding[]): Counts {
	const counts: Counts = { critical: 0, high: 0, medium: 0, low: 0 };
	for (const finding of findings) counts[finding.severity]++;
	return counts;
}

/** Most severe first; secrets ahead of vulnerabilities at the same severity. */
export function rank(findings: Finding[]): Finding[] {
	return [...findings].sort(
		(a, b) =>
			severityRank(a.severity) - severityRank(b.severity) ||
			a.kind.localeCompare(b.kind, "en") ||
			a.location.localeCompare(b.location, "en") ||
			a.ruleId.localeCompare(b.ruleId, "en"),
	);
}

/** Repositories with the worst findings first, clean ones last. */
export function rankRepos(repos: RepoResult[]): RepoResult[] {
	// Counted once for each repository, not again at every comparison (R6O-1).
	const keys = new Map(repos.map((repo) => [repo, SEVERITIES.map((severity) => countBySeverity(repo.findings)[severity])]));
	return [...repos].sort((a, b) => {
		const [ka, kb] = [keys.get(a)!, keys.get(b)!];
		for (let i = 0; i < ka.length; i++) {
			if (ka[i] !== kb[i]) return kb[i]! - ka[i]!;
		}
		return a.path.localeCompare(b.path, "en");
	});
}

/** True when any finding is at or above `threshold`. */
export function exceeds(report: ScanReport, threshold: Severity): boolean {
	return report.repos.some((repo) =>
		repo.findings.some((finding) => severityRank(finding.severity) <= severityRank(threshold)),
	);
}

/**
 * Process exit code for a scan. With a `--fail-on` threshold the scan acts as
 * a gate, and a gate must not pass when a check did not run: findings at or
 * above the threshold give 2, and otherwise an incomplete scan gives 1.
 */
export function exitCode(report: ScanReport, failOn: Severity | undefined): 0 | 1 | 2 {
	if (failOn === undefined) return 0;
	if (exceeds(report, failOn)) return 2;
	return coverageNotes(report).length > 0 ? 1 : 0;
}

/** Statements about what the scan did not cover, so a clean result is not over-read. */
export function coverageNotes(report: ScanReport): string[] {
	const choices = report.choices ?? standardChoices();
	// A check switched off is said once, by choiceGaps, not again as a scanner that is missing.
	const checks = (tool: ToolName) =>
		tool === "gitleaks" ? [choices.secrets ? "Secrets were not checked" : null, choices.privateData ? "Private data was not checked" : null] : [choices.dependencies ? "Dependencies were not checked" : null];
	const notes: string[] = [...choiceGaps(choices, report.skipped)];
	for (const folder of report.notSearched ?? []) notes.push(`${folder.name} was not scanned: ${folder.reason}.`);
	for (const tool of report.tools) {
		if (tool.status !== "missing") continue;
		for (const skipped of checks(tool.tool)) if (skipped) notes.push(`${skipped}: ${tool.tool} is not installed (${tool.installHint}).`);
	}
	for (const repo of report.repos) {
		for (const error of repo.errors) {
			notes.push(`${error.tool} failed on ${repoName(report, repo)}: ${withoutPaths(report, error.message)}`);
		}
		for (const note of repo.notCovered ?? []) notes.push(`${note.tool} on ${repoName(report, repo)}: ${note.message}.`);
		if (repo.unreadFiles) {
			notes.push(
				`${repo.unreadFiles === 1 ? "1 tracked file" : `${repo.unreadFiles} tracked files`} in ${repoName(report, repo)} ${repo.unreadFiles === 1 ? "was" : "were"} not read: larger than ${UNREAD_LIMIT_WORDS}, or not a file that could be opened.`,
			);
		}
	}
	return notes;
}

/** How large a tracked file the scan of the current files reads, in words; gitleaks.ts holds the number. */
const UNREAD_LIMIT_WORDS = "50 MB";

/**
 * What each repository told a scanner to leave out. These do not make the scan
 * incomplete (an owner silences a false match this way), but whatever they
 * hide is not in the report, so the report says where to look.
 */
export function settingNotes(report: ScanReport): string[] {
	const notes: string[] = [];
	for (const repo of report.repos) {
		for (const file of repo.settingFiles ?? []) {
			const base = file.split("/").at(-1);
			const effect =
				base === ".gitleaks.toml"
					? "Porchlight ignored it and used gitleaks' built-in rules"
					: base === ".gitleaksignore"
						? "secrets it lists are not in this report"
						: "vulnerabilities or packages it ignores are not in this report";
			notes.push(`${repoName(report, repo)} has ${file}: ${effect}.`);
		}
	}
	return notes;
}

/**
 * The scan as Markdown, for `repos scan` and its --out file. Names, paths and
 * titles come from the scanned repositories and from advisories, so each goes
 * through the Markdown escaping in escape.ts (invariant 11).
 */
export function renderMarkdown(report: ScanReport): string {
	const all = report.repos.flatMap((repo) => repo.findings);
	const totals = countBySeverity(all);
	const lines = [
		"# Porchlight repository scan",
		"",
		`Scanned ${repoCount(report)} under ${mdCode(folderName(report.root))} on ${report.scannedAt.slice(0, 10)}: ` +
			`${all.length === 1 ? "1 finding" : `${all.length} findings`} ` +
			`(${SEVERITIES.map((severity) => `${totals[severity]} ${severity}`).join(", ")}).`,
		"",
		`Scan: ${mdText(describeChoices(report.choices))}.`,
		"",
	];

	const notes = coverageNotes(report);
	if (notes.length > 0) {
		lines.push("## Not covered", "", ...notes.map((note) => `- ${mdText(note)}`), "");
	}
	const settings = settingNotes(report);
	if (settings.length > 0) {
		lines.push("## Left out by repository settings", "", ...settings.map((note) => `- ${mdText(note)}`), "");
	}

	const ranked = rankRepos(report.repos);
	lines.push("## Summary", "", "| Repository | Critical | High | Medium | Low |", "| --- | ---: | ---: | ---: | ---: |");
	for (const repo of ranked) {
		const counts = countBySeverity(repo.findings);
		lines.push(`| ${mdText(repoName(report, repo))} | ${SEVERITIES.map((severity) => counts[severity]).join(" | ")} |`);
	}
	lines.push("");

	for (const repo of ranked) {
		if (repo.findings.length === 0) continue;
		lines.push(`## ${mdText(repoName(report, repo))}`, "");
		for (const finding of rank(repo.findings)) {
			lines.push(
				`- **${finding.severity}** ${finding.kind} ${mdCode(finding.ruleId)} in ${mdCode(finding.location)} ` +
					`(${mdText(finding.detail)}): ${mdText(finding.title)}${finding.note ? `. ${mdText(finding.note)}` : ""}`,
			);
		}
		lines.push("");
	}
	// Which Porchlight made it, the kind of scan and when, in UTC (R6Q-4, R6V-2).
	lines.push("---", "", `*${mdText(footLine(scanKindOf(report), report.scannedAt))}*`, "");
	return lines.join("\n");
}

/** Names, paths and titles come from the repositories: no control character reaches the terminal. */
function plain(text: string): string {
	return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028-\u202e\u2066-\u2069]/g, "");
}

const KIND_WORDS: Record<Finding["kind"], string> = { secret: "secret", vulnerability: "vulnerability", "private-data": "private data" };

/** "GHSA-bi62" before "GHSA-bi610": numbers in an ID compared as numbers. */
function naturally(a: string, b: string): number {
	return a.localeCompare(b, "en", { numeric: true });
}

/**
 * The scan as plain text, for a terminal (RD-15): no Markdown escapes or code marks, the type in words,
 * and a package's advisories under one line for the package, ordered as numbers. Markdown stays for
 * --out, a pipe and the exports.
 */
export function renderText(report: ScanReport): string {
	const all = report.repos.flatMap((repo) => repo.findings);
	const totals = countBySeverity(all);
	const lines = [
		`Porchlight repository scan: ${repoCount(report)} under ${plain(folderName(report.root))} on ${report.scannedAt.slice(0, 10)}`,
		`${all.length === 1 ? "1 finding" : `${all.length} findings`}: ${SEVERITIES.map((severity) => `${totals[severity]} ${severity}`).join(", ")}`,
		`Scan: ${describeChoices(report.choices)}`,
		"",
	];
	const notes = coverageNotes(report);
	if (notes.length > 0) lines.push("Not covered:", ...notes.map((note) => `  ${plain(note)}`), "");
	const settings = settingNotes(report);
	if (settings.length > 0) lines.push("Left out by repository settings:", ...settings.map((note) => `  ${plain(note)}`), "");
	for (const repo of rankRepos(report.repos)) {
		if (repo.findings.length === 0) continue;
		const counts = countBySeverity(repo.findings);
		lines.push(`${plain(repoName(report, repo))}: ${SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => `${counts[severity]} ${severity}`).join(", ")}`);
		const packages = new Map<string, Finding[]>();
		for (const finding of rank(repo.findings)) {
			if (finding.kind !== "vulnerability") {
				lines.push(`  [${finding.severity}] ${KIND_WORDS[finding.kind]} ${plain(finding.ruleId)} in ${plain(finding.location)}: ${plain(finding.title)}${finding.detail ? ` (${plain(finding.detail)})` : ""}${finding.note ? `. ${plain(finding.note)}` : ""}`);
				continue;
			}
			const key = `${finding.detail}\n${finding.location}`;
			packages.set(key, [...(packages.get(key) ?? []), finding]);
		}
		for (const advisories of packages.values()) {
			const first = advisories[0]!;
			lines.push(`  [${first.severity}] vulnerable package ${plain(first.detail)} in ${plain(first.location)}: ${advisories.length === 1 ? "1 advisory" : `${advisories.length} advisories`}`);
			for (const advisory of [...advisories].sort((a, b) => naturally(a.ruleId, b.ruleId))) lines.push(`      ${plain(advisory.ruleId)} (${advisory.severity}): ${plain(advisory.title)}`);
		}
		lines.push("");
	}
	lines.push(footLine(scanKindOf(report), report.scannedAt), "");
	return lines.join("\n");
}

/** A short terminal summary for when the full report goes to a file. */
export function renderSummary(report: ScanReport): string {
	const all = report.repos.flatMap((repo) => repo.findings);
	const totals = countBySeverity(all);
	const affected = report.repos.filter((repo) => repo.findings.length > 0).length;
	const lines = [
		`${repoCount(report)} scanned, ${affected} with findings: ` +
			SEVERITIES.map((severity) => `${totals[severity]} ${severity}`).join(", "),
		`Scan: ${describeChoices(report.choices)}`,
	];
	for (const note of coverageNotes(report)) lines.push(`Not covered: ${note}`);
	for (const note of settingNotes(report)) lines.push(`Left out by repository settings: ${note}`);
	return lines.join("\n");
}

function repoCount(report: ScanReport): string {
	return report.repos.length === 1 ? "1 repository" : `${report.repos.length} repositories`;
}

/**
 * A scanned folder by its own name, never its path: an export, a prompt or a notice leaves this
 * computer, and a path names the owner (`/Users/<name>/…`) (S35).
 */
export function folderName(path: string): string {
	return basename(path) || path;
}

/**
 * An error line with the paths it names put as Porchlight names them: each repository by its name, a
 * scanned folder by its own name, and the home folder as ~ (S35). Longest first, so a repository
 * inside the folder is named as the repository.
 */
export function withoutPaths(report: Pick<ScanReport, "root" | "otherRoots" | "repos">, text: string): string {
	const named: [string, string][] = [
		...report.repos.map((repo): [string, string] => [repo.path, nameUnder(report.root, report.otherRoots, repo.path)]),
		...[report.root, ...(report.otherRoots ?? [])].map((root): [string, string] => [root, folderName(root)]),
	];
	const home = homedir();
	if (home && home !== "/") named.push([home, "~"]);
	let out = text;
	for (const [path, name] of named.filter(([path]) => path.length > 1).sort((a, b) => b[0].length - a[0].length)) out = out.split(path).join(name);
	return out;
}

/**
 * How a repository is named everywhere: its path under the scanned folder, or
 * the folder's own name when the folder is itself the repository. The page,
 * the filters, the exports and the model all use this one name, so a filter
 * picked on the page matches the same repositories on the server.
 */
export function repoName(report: ScanReport, repo: RepoResult): string {
	return nameUnder(report.root, report.otherRoots, repo.path);
}

/**
 * A repository in one of the further folders is named under that folder's own name
 * (`github/owner/repository`), so it cannot be taken for one in the main folder.
 */
export function nameUnder(root: string, otherRoots: string[] | undefined, path: string): string {
	for (const other of otherRoots ?? []) {
		const inside = relative(other, path);
		if (inside !== "" && !inside.startsWith("..") && !isAbsolute(inside)) return `${basename(other)}/${inside}`;
	}
	return relative(root, path) || basename(root) || ".";
}
