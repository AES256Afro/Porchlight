import { APEX_TYPES } from "./collect/dns.ts";
import type { HostState, Snapshot } from "./snapshot.ts";

export type Change =
	| { kind: "host_added"; host: string }
	| { kind: "host_removed"; host: string }
	| { kind: "dns_changed"; host: string; record: string; before: string[]; after: string[] }
	| { kind: "https_changed"; host: string; before: string; after: string };

/**
 * What changed between two scans. Only compares things both scans actually
 * observed, so a failed lookup is never reported as a record disappearing.
 */
export function diffSnapshots(prev: Snapshot | null, curr: Snapshot): Change[] {
	if (!prev) return [];
	const changes: Change[] = [];

	for (const host of Object.keys(curr.hosts).sort()) {
		const before = prev.hosts[host];
		const after = curr.hosts[host]!;
		if (!before) {
			changes.push({ kind: "host_added", host });
			continue;
		}
		changes.push(...diffHost(host, before, after));
	}
	for (const host of Object.keys(prev.hosts).sort()) {
		if (!curr.hosts[host]) changes.push({ kind: "host_removed", host });
	}

	for (const type of APEX_TYPES) {
		const before = prev.apex[type];
		const after = curr.apex[type];
		if (before && after && !sameSet(before, after)) {
			changes.push({ kind: "dns_changed", host: curr.domain, record: type, before, after });
		}
	}
	return changes;
}

function diffHost(host: string, before: HostState, after: HostState): Change[] {
	const changes: Change[] = [];
	if (before.dns && after.dns) {
		if (!sameSet(before.dns.cname, after.dns.cname)) {
			changes.push({
				kind: "dns_changed",
				host,
				record: "CNAME",
				before: before.dns.cname,
				after: after.dns.cname,
			});
		} else if (after.dns.cname.length === 0) {
			// Addresses behind an alias belong to whoever runs the target and
			// rotate freely; only directly published addresses are compared.
			if (!sameSet(before.dns.a, after.dns.a)) {
				changes.push({
					kind: "dns_changed",
					host,
					record: "A",
					before: before.dns.a,
					after: after.dns.a,
				});
			}
			// AAAA is only looked up when a host has no A records.
			const bothV6Only = before.dns.a.length === 0 && after.dns.a.length === 0;
			if (bothV6Only && !sameSet(before.dns.aaaa, after.dns.aaaa)) {
				changes.push({
					kind: "dns_changed",
					host,
					record: "AAAA",
					before: before.dns.aaaa,
					after: after.dns.aaaa,
				});
			}
		}
	}
	if (before.http && after.http && before.http.ok !== after.http.ok) {
		const describe = (probe: NonNullable<HostState["http"]>) =>
			probe.ok ? `HTTP ${probe.status}` : "unreachable";
		changes.push({
			kind: "https_changed",
			host,
			before: describe(before.http),
			after: describe(after.http),
		});
	}
	return changes;
}

/** Order does not matter: older snapshots hold an alias chain sorted, newer ones in chain order. */
function sameSet(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false;
	const sortedB = [...b].sort();
	return [...a].sort().every((value, i) => value === sortedB[i]);
}
