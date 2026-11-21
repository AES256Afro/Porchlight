import { coverageNotes, rank } from "../repos/report.ts";
import { keyed, type Comparison } from "../repos/history.ts";
import { SEVERITIES, type ScanReport } from "../repos/types.ts";
import type { Notice } from "./format.ts";

// What the owner is told after a scan that ran on its own (PORCHLIGHT_SCAN_EVERY_HOURS): counts, what
// is new and what was fixed since the scan before, by title, repository and file. Never a secret's
// value or a commit's author, which no report holds, and nothing a model wrote.

/** New findings named in a notice before the rest are counted. */
const NEW_LISTED = 12;

export function scanNotice(report: ScanReport, change: Comparison | null): Notice {
	const findings = report.repos.flatMap((repo) => repo.findings);
	const counts = SEVERITIES.map((severity) => [severity, findings.filter((finding) => finding.severity === severity).length] as const);
	const total = findings.length;
	const title = `Porchlight: ${total === 1 ? "1 finding" : `${total} findings`} in ${report.repos.length === 1 ? "1 repository" : `${report.repos.length} repositories`}${
		change ? `, ${change.newCount} new and ${change.fixedCount} fixed since the last scan` : ""
	}`;
	const lines = [`By severity: ${counts.map(([severity, count]) => `${count} ${severity}`).join(", ")}.`];

	const notes = coverageNotes(report);
	if (notes.length > 0) lines.push("", "Not covered, so this is not a clean bill of health:", ...notes.map((note) => `  ${note}`));

	if (change && change.newCount > 0) {
		const all = keyed(report);
		const fresh = change.newKeys.map((key) => all.get(key)).filter((entry) => entry !== undefined);
		const ordered = rank(fresh.map((entry) => entry.finding)).map((finding) => fresh.find((entry) => entry.finding === finding)!);
		lines.push("", "New:");
		for (const { repo, finding } of ordered.slice(0, NEW_LISTED)) lines.push(`  [${finding.severity}] ${repo}: ${finding.title} (${finding.location})`);
		if (ordered.length > NEW_LISTED) lines.push(`  and ${ordered.length - NEW_LISTED} more`);
	}
	if (change && change.fixed.length > 0) {
		lines.push("", "Fixed:");
		for (const finding of change.fixed) lines.push(`  ${finding.repo}: ${finding.title} (${finding.location})`);
		if (change.fixedCount > change.fixed.length) lines.push(`  and ${change.fixedCount - change.fixed.length} more`);
	}
	if (change && change.uncheckedCount > 0) {
		lines.push("", `${change.uncheckedCount} ${change.uncheckedCount === 1 ? "finding" : "findings"} of the last scan could not be checked again, so ${change.uncheckedCount === 1 ? "it is" : "they are"} not counted as fixed.`);
	}
	lines.push("", "Open Porchlight to see each one and how to fix it.");

	const worstNew = change ? change.newKeys.map((key) => keyed(report).get(key)?.finding.severity) : [];
	return {
		title,
		lines,
		urgent: worstNew.some((severity) => severity === "critical" || severity === "high"),
		payload: { scannedAt: report.scannedAt, findings: Object.fromEntries(counts), ...(change ? { new: change.newCount, fixed: change.fixedCount } : {}) },
	};
}

/** A scheduled scan that did not finish. */
export function failedScanNotice(root: string, error: string): Notice {
	return { title: "Porchlight: the scheduled scan failed", lines: [`Folder: ${root}`, `Why: ${error}`, "", "The last scan is unchanged. The next one runs on schedule."], urgent: true, payload: { failed: true } };
}
