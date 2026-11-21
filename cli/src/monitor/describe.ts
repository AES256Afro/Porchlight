import type { DomainView, HistoryEntry } from "../../../monitor/src/types.ts";

/** The parts of a domain, as the monitor lists it, that a line describes. A monitor deployed before the error streak was added sends none. */
export type MonitorDomain = Pick<DomainView, "name" | "verified" | "lastScanAt" | "lastScanStatus"> & { errorStreak?: number; openFindings?: DomainView["openFindings"] };

/** One line for `porchlight domains list` and `show`. */
export function describeDomain(domain: MonitorDomain): string {
	const state = domain.verified ? "verified" : "not verified";
	if (!domain.lastScanAt) return `${domain.name}: ${state}, never scanned`;
	const streak = domain.errorStreak ?? 0;
	let outcome: string;
	if (domain.lastScanStatus === "error" && streak > 1) outcome = `error, ${streak} failures in a row`;
	else outcome = domain.lastScanStatus ?? "verified again, scan due";
	return `${domain.name}: ${state}, last scan ${domain.lastScanAt} (${outcome})${openWords(domain.openFindings)}`;
}

/** ", 3 open findings (1 high)", or nothing from a monitor that does not count them or a domain not scanned. */
function openWords(open: DomainView["openFindings"] | undefined): string {
	if (!open) return "";
	const total = open.high + open.medium + open.low;
	if (total === 0) return ", no open findings";
	return `, ${total === 1 ? "1 open finding" : `${total} open findings`}${open.high > 0 ? ` (${open.high} high)` : ""}`;
}

type Entry = HistoryEntry;

/**
 * A domain's kept scans, newest first, one line each with what changed beneath it: for
 * `porchlight domains history`. Hosts, records and titles are the monitor's; the caller prints them
 * through the terminal filter.
 */
export function describeHistory(domain: string, history: Entry[]): string {
	if (history.length === 0) return `${domain} has not been scanned yet.`;
	const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
	const lines: string[] = [];
	for (const entry of history) {
		const open = entry.openFindings.high + entry.openFindings.medium + entry.openFindings.low;
		const what = entry.baseline
			? `first scan, ${count(entry.hostCount, "host", "hosts")}`
			: [count(entry.changes.length, "change", "changes"), count(entry.newFindings.length, "new finding", "new findings"), `${entry.resolvedFindings.length} resolved`].join(", ");
		lines.push(`${entry.takenAt.slice(0, 16).replace("T", " ")}  ${what}; ${open} open`);
		for (const change of entry.changes) {
			if (change.kind === "host_added") lines.push(`    + new host ${change.host}`);
			else if (change.kind === "host_removed") lines.push(`    - host gone ${change.host}`);
			else if (change.kind === "dns_changed") lines.push(`    ~ ${change.record} for ${change.host} changed`);
			else if (change.kind === "issuer_added") lines.push(`    + new certificate authority ${change.issuer}`);
			else lines.push(`    ~ HTTPS on ${change.host}: ${change.before} -> ${change.after}`);
		}
		if (!entry.baseline) for (const finding of entry.newFindings) lines.push(`    ! [${finding.severity}] ${finding.host}: ${finding.title}`);
		for (const finding of entry.resolvedFindings) lines.push(`    ✓ ${finding.host}: ${finding.title}`);
		for (const note of entry.notes) lines.push(`    (${note})`);
	}
	return lines.join("\n");
}
