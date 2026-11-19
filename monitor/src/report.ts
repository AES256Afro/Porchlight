import type { Change } from "./diff.ts";
import type { Finding } from "./findings.ts";

/** What one scan concluded. Stored with its snapshot and sent as the alert payload. */
export interface ScanReport {
	domain: string;
	takenAt: string;
	/** True for the first scan of a domain: there is nothing to compare against. */
	baseline: boolean;
	changes: Change[];
	newFindings: Finding[];
	resolvedFindings: Finding[];
	/** All open findings, including ones first reported by earlier scans. */
	findings: Finding[];
	hostCount: number;
	/** Limits on what this scan could see, so an empty report is not mistaken for a clean one. */
	notes: string[];
}

export function hasNews(report: ScanReport): boolean {
	return (
		report.baseline ||
		report.changes.length + report.newFindings.length + report.resolvedFindings.length > 0
	);
}

export function formatReport(report: ScanReport): string {
	const lines: string[] = [];
	if (report.baseline) {
		lines.push(
			`Porchlight: first scan of ${report.domain}: ${report.hostCount} hosts, ${report.findings.length} findings`,
		);
	} else {
		lines.push(
			`Porchlight: ${report.domain}: ${report.changes.length} changes, ` +
				`${report.newFindings.length} new findings, ${report.resolvedFindings.length} resolved`,
		);
	}
	if (report.changes.length > 0) {
		lines.push("", "Changes");
		for (const change of report.changes) lines.push(`  ${describeChange(change)}`);
	}
	if (report.newFindings.length > 0) {
		lines.push("", report.baseline ? "Findings" : "New findings");
		for (const finding of report.newFindings) lines.push(`  ${describeFinding(finding)}`);
	}
	if (report.resolvedFindings.length > 0) {
		lines.push("", "Resolved");
		for (const finding of report.resolvedFindings) lines.push(`  ${describeFinding(finding)}`);
	}
	if (report.notes.length > 0) {
		lines.push("", "Notes");
		for (const note of report.notes) lines.push(`  ${note}`);
	}
	return lines.join("\n");
}

function describeChange(change: Change): string {
	switch (change.kind) {
		case "host_added":
			return `+ new host ${change.host}`;
		case "host_removed":
			return `- host gone ${change.host}`;
		case "dns_changed":
			return `~ ${change.record} for ${change.host}: ${list(change.before)} -> ${list(change.after)}`;
		case "https_changed":
			return `~ HTTPS on ${change.host}: ${change.before} -> ${change.after}`;
	}
}

function describeFinding(finding: Finding): string {
	return `[${finding.severity}] ${finding.host}: ${finding.title}`;
}

function list(values: string[]): string {
	return values.length > 0 ? values.join(", ") : "(none)";
}
