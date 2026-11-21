import type { Change, Finding, ScanReport } from "./types.ts";

export type { ScanReport };

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
			`Porchlight: first scan of ${report.domain}: ${counted(report.hostCount, "host")}, ${counted(report.findings.length, "finding")}`,
		);
	} else {
		lines.push(`Porchlight: ${report.domain}: ${summary(report)}`);
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

const SEVERITIES = ["high", "medium", "low"] as const;

/**
 * What the alert is about, as a phone shows it: only what happened, counted in words that agree
 * with the number, with the worst new finding's severity first, such as "1 new high finding, 2 changes".
 */
function summary(report: ScanReport): string {
	const parts: string[] = [];
	const added = report.newFindings;
	if (added.length > 0) {
		const worst = SEVERITIES.find((severity) => added.some((f) => f.severity === severity));
		parts.push(
			added.length === 1
				? `1 new ${worst} finding`
				: `${added.length} new findings, the worst ${worst}`,
		);
	}
	if (report.changes.length > 0) parts.push(counted(report.changes.length, "change"));
	if (report.resolvedFindings.length > 0) parts.push(`${report.resolvedFindings.length} resolved`);
	return parts.length > 0 ? parts.join(", ") : "nothing new";
}

function counted(n: number, noun: string): string {
	return `${n} ${noun}${n === 1 ? "" : "s"}`;
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
