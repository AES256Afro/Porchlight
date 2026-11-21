import { coverageNotes, rank } from "../repos/report.ts";
import { keyed, type HistoryEntry, type NotesFile } from "../repos/history.ts";
import { SEVERITIES, type ScanReport, type Severity } from "../repos/types.ts";
import { dueState, type DuePolicy } from "../../ui/due.js";
import type { Notice } from "./format.ts";

// The weekly digest (FT-13): what a week of scheduled scans found, sent once a week by the schedule
// alone, and only when the owner asks for it (PORCHLIGHT_NOTIFY_DIGEST=weekly). It is formatted by
// format.ts like every notice, so in every format its data is shown as text. It holds counts, titles,
// repositories and files: never a secret's value, an author, a model's words or a path of this computer.

/** How often a digest is sent. */
export const DIGEST_EVERY_MS = 7 * 86_400_000;
/** Titles listed under each heading before the rest are counted. */
const LISTED = 8;

export interface DigestInput {
	now: Date;
	/** The latest scan, or null when there is none yet. */
	report: ScanReport | null;
	/** The kept scans' summaries, oldest first. */
	history: HistoryEntry[];
	notes: NotesFile;
	/** When each finding of the latest scan was first seen, by its key. */
	seen: Record<string, { first: string }>;
	policy: DuePolicy;
	/** The last check of this computer, when there is one. */
	host?: { checkedAt: string; failed: number; unknown: number } | null;
}

/** Whether a digest is due: none sent yet, or the last one a week ago or more. */
export function digestDue(lastSentAt: string | null | undefined, now: Date): boolean {
	if (!lastSentAt) return true;
	const last = Date.parse(lastSentAt);
	return Number.isNaN(last) || now.getTime() - last >= DIGEST_EVERY_MS;
}

function plural(count: number, one: string, many: string): string {
	return `${count} ${count === 1 ? one : many}`;
}

export function digestNotice(input: DigestInput): Notice {
	const { now, report } = input;
	const since = new Date(now.getTime() - DIGEST_EVERY_MS).toISOString();
	const week = input.history.filter((entry) => entry.scannedAt > since);
	const compared = week.filter((entry) => typeof entry.newCount === "number" && typeof entry.fixedCount === "number");
	const newCount = compared.reduce((sum, entry) => sum + (entry.newCount ?? 0), 0);
	const fixedCount = compared.reduce((sum, entry) => sum + (entry.fixedCount ?? 0), 0);
	const lines: string[] = [];

	lines.push(
		week.length === 0
			? "No scan finished in the last 7 days."
			: `${plural(week.length, "scan", "scans")} in the last 7 days: ${newCount} new and ${fixedCount} fixed${compared.length < week.length ? ` (${plural(week.length - compared.length, "scan", "scans")} could not be compared with the one before)` : ""}.`,
	);

	let overdueUrgent = false;
	const payload: Record<string, unknown> = { digest: true, scans: week.length, new: newCount, fixed: fixedCount };
	if (report) {
		const all = [...keyed(report).entries()];
		const findings = all.map(([, entry]) => entry.finding);
		const counts = SEVERITIES.map((severity) => [severity, findings.filter((finding) => finding.severity === severity).length] as const);
		const notes = coverageNotes(report);
		lines.push("", `Latest scan, ${report.scannedAt.slice(0, 10)}: ${plural(findings.length, "finding", "findings")} in ${plural(report.repos.length, "repository", "repositories")}: ${counts.map(([severity, count]) => `${count} ${severity}`).join(", ")}.`);
		if (notes.length > 0) lines.push(`It did not cover everything (${plural(notes.length, "line", "lines")} under "Not covered"), so it is incomplete.`);
		payload.findings = Object.fromEntries(counts);
		payload.complete = notes.length === 0;

		// Overdue by the owner's due dates, most overdue first.
		const overdue = all
			.map(([key, entry]) => ({ key, ...entry, state: dueState(input.seen[key]?.first, entry.finding.severity as Severity, input.policy, now) }))
			.filter((item) => item.state?.overdue)
			.sort((a, b) => a.state!.daysLeft - b.state!.daysLeft);
		payload.overdue = overdue.length;
		if (overdue.length > 0) {
			overdueUrgent = overdue.some((item) => item.finding.severity === "critical" || item.finding.severity === "high");
			lines.push("", `Overdue by your due dates: ${overdue.length}`);
			for (const item of overdue.slice(0, LISTED)) {
				const status = input.notes[item.key]?.status;
				lines.push(`  [${item.finding.severity}] ${item.repo}: ${item.finding.title} (${item.finding.location}), ${-item.state!.daysLeft} days overdue${status && status !== "open" ? `, marked ${status}` : ""}`);
			}
			if (overdue.length > LISTED) lines.push(`  and ${overdue.length - LISTED} more`);
		}

		// Accepted risks whose end day falls within the next week, or has passed.
		const today = now.toISOString().slice(0, 10);
		const nextWeek = new Date(now.getTime() + DIGEST_EVERY_MS).toISOString().slice(0, 10);
		const accepted = all.filter(([key]) => input.notes[key]?.status === "accepted" && input.notes[key]?.until !== undefined);
		const ending = accepted.filter(([key]) => input.notes[key]!.until! >= today && input.notes[key]!.until! <= nextWeek);
		const ended = accepted.filter(([key]) => input.notes[key]!.until! < today);
		if (ending.length > 0) {
			lines.push("", `Accepted risks ending within 7 days: ${ending.length}`);
			for (const [key, item] of ending.slice(0, LISTED)) lines.push(`  ${item.repo}: ${item.finding.title} (${item.finding.location}), until ${input.notes[key]!.until}`);
			if (ending.length > LISTED) lines.push(`  and ${ending.length - LISTED} more`);
		}
		if (ended.length > 0) lines.push("", `Accepted risks whose end day has passed: ${ended.length}. Look at them again.`);
		payload.acceptedEnding = ending.length;
		payload.acceptedEnded = ended.length;

		const worst = rank(findings.filter((finding) => finding.severity === "critical" || finding.severity === "high"));
		if (worst.length > 0) {
			lines.push("", "Most severe:");
			for (const finding of worst.slice(0, LISTED)) {
				const entry = all.find(([, item]) => item.finding === finding)!;
				lines.push(`  [${finding.severity}] ${entry[1].repo}: ${finding.title} (${finding.location})`);
			}
			if (worst.length > LISTED) lines.push(`  and ${worst.length - LISTED} more`);
		}
	} else {
		lines.push("", "There is no scan yet.");
	}

	if (input.host) {
		lines.push("", `This computer, checked ${input.host.checkedAt.slice(0, 10)}: ${plural(input.host.failed, "problem", "problems")}${input.host.unknown > 0 ? `, ${input.host.unknown} could not be checked` : ""}.`);
		payload.host = { failed: input.host.failed, couldNotCheck: input.host.unknown };
	}
	lines.push("", "Open Porchlight to see each one and how to fix it.");
	return {
		title: `Porchlight weekly digest: ${newCount} new, ${fixedCount} fixed${report ? `, ${plural(report.repos.reduce((sum, repo) => sum + repo.findings.length, 0), "finding", "findings")} in the latest scan` : ""}`,
		lines,
		urgent: overdueUrgent,
		payload,
	};
}
