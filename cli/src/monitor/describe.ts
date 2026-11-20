/** A domain as the monitor's API lists it (monitor/src/api.ts, describeDomain). */
export interface MonitorDomain {
	name: string;
	verified: boolean;
	lastScanAt: string | null;
	lastScanStatus: "ok" | "unverified" | "error" | null;
	/** Scans that have failed in a row. Absent from a monitor deployed before it was added. */
	errorStreak?: number;
}

/** One line for `porchlight domains list` and `show`. */
export function describeDomain(domain: MonitorDomain): string {
	const state = domain.verified ? "verified" : "not verified";
	if (!domain.lastScanAt) return `${domain.name}: ${state}, never scanned`;
	const streak = domain.errorStreak ?? 0;
	let outcome: string;
	if (domain.lastScanStatus === "error" && streak > 1) outcome = `error, ${streak} failures in a row`;
	else outcome = domain.lastScanStatus ?? "verified again, scan due";
	return `${domain.name}: ${state}, last scan ${domain.lastScanAt} (${outcome})`;
}
