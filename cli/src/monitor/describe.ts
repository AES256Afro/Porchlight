import type { DomainView } from "../../../monitor/src/types.ts";

/** The parts of a domain, as the monitor lists it, that a line describes. A monitor deployed before the error streak was added sends none. */
export type MonitorDomain = Pick<DomainView, "name" | "verified" | "lastScanAt" | "lastScanStatus"> & { errorStreak?: number };

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
