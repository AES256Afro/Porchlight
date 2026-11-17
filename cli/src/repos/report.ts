import { relative } from "node:path";
import { SEVERITIES, severityRank, type Finding, type RepoResult, type ScanReport, type Severity } from "./types.ts";

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
		throw new Error(`Not a SecurityX scan report: ${path}`);
	}
	return report;
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
			a.kind.localeCompare(b.kind) ||
			a.location.localeCompare(b.location) ||
			a.ruleId.localeCompare(b.ruleId),
	);
}

/** Repositories with the worst findings first, clean ones last. */
export function rankRepos(repos: RepoResult[]): RepoResult[] {
	const key = (repo: RepoResult) => SEVERITIES.map((severity) => countBySeverity(repo.findings)[severity]);
	return [...repos].sort((a, b) => {
		const [ka, kb] = [key(a), key(b)];
		for (let i = 0; i < ka.length; i++) {
			if (ka[i] !== kb[i]) return kb[i]! - ka[i]!;
		}
		return a.path.localeCompare(b.path);
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
	const notes: string[] = [];
	for (const tool of report.tools) {
		if (tool.status !== "missing") continue;
		const skipped = tool.tool === "gitleaks" ? "Secrets were not checked" : "Dependencies were not checked";
		notes.push(`${skipped}: ${tool.tool} is not installed (${tool.installHint}).`);
	}
	for (const repo of report.repos) {
		for (const error of repo.errors) {
			notes.push(`${error.tool} failed on ${name(report, repo)}: ${error.message}`);
		}
	}
	return notes;
}

export function renderMarkdown(report: ScanReport): string {
	const all = report.repos.flatMap((repo) => repo.findings);
	const totals = countBySeverity(all);
	const lines = [
		"# SecurityX repository scan",
		"",
		`Scanned ${repoCount(report)} under \`${report.root}\` on ${report.scannedAt.slice(0, 10)}: ` +
			`${all.length === 1 ? "1 finding" : `${all.length} findings`} ` +
			`(${SEVERITIES.map((severity) => `${totals[severity]} ${severity}`).join(", ")}).`,
		"",
	];

	const notes = coverageNotes(report);
	if (notes.length > 0) {
		lines.push("## Not covered", "", ...notes.map((note) => `- ${note}`), "");
	}

	const ranked = rankRepos(report.repos);
	lines.push("## Summary", "", "| Repository | Critical | High | Medium | Low |", "| --- | ---: | ---: | ---: | ---: |");
	for (const repo of ranked) {
		const counts = countBySeverity(repo.findings);
		lines.push(`| ${name(report, repo)} | ${SEVERITIES.map((severity) => counts[severity]).join(" | ")} |`);
	}
	lines.push("");

	for (const repo of ranked) {
		if (repo.findings.length === 0) continue;
		lines.push(`## ${name(report, repo)}`, "");
		for (const finding of rank(repo.findings)) {
			lines.push(
				`- **${finding.severity}** ${finding.kind} \`${finding.ruleId}\` in \`${finding.location}\` ` +
					`(${finding.detail}): ${finding.title}${finding.note ? `. ${finding.note}` : ""}`,
			);
		}
		lines.push("");
	}
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
	];
	for (const note of coverageNotes(report)) lines.push(`Not covered: ${note}`);
	return lines.join("\n");
}

function repoCount(report: ScanReport): string {
	return report.repos.length === 1 ? "1 repository" : `${report.repos.length} repositories`;
}

function name(report: ScanReport, repo: RepoResult): string {
	return relative(report.root, repo.path) || ".";
}
