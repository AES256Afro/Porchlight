import { issuersSeen, type IssuerSeen } from "./caa.ts";
import { fetchCtCerts, hostsFromCerts, latestCertFor, type CertWindow } from "./collect/ct.ts";
import { lookupApex, lookupHost, resolves, type ApexRecords, type HostDns } from "./collect/dns.ts";
import { probeHttps, type HttpProbe } from "./collect/http.ts";
import { isWithin } from "./domain.ts";
import type { Deps, Settings } from "./env.ts";

export interface HostState {
	/** False when the host is known but fell beyond MAX_HOSTS this run. */
	probed: boolean;
	/** When the host was last probed; kept while it waits for its turn. Absent: never, or an older snapshot. */
	checkedAt?: string;
	/** null means the lookup failed or the host was not probed: "not observed". */
	dns: HostDns | null;
	/** Latest certificate seen in CT logs, carried over when the log is unreachable. */
	cert: CertWindow | null;
	/** null when the host has no address to connect to, or was not observed. */
	http: HttpProbe | null;
}

/** Everything observed about a domain in one scan. */
export interface Snapshot {
	version: 1;
	domain: string;
	takenAt: string;
	/** False when the certificate log could not be read; the host list was then carried over. */
	ctOk: boolean;
	/**
	 * False when the log was read but its query for the bare domain failed, so the bare domain's
	 * certificate was not observed. Absent: it was, or an older snapshot.
	 */
	ctApexOk?: false;
	apex: ApexRecords;
	/** Whether the domain's DNS answers are signed. Absent: not observed, or an older snapshot. */
	dnssec?: boolean;
	/**
	 * The certificate authorities the log lists for the domain's unexpired certificates, read from the
	 * rows already fetched (FT-3). Absent: the log, or its query for the bare domain, could not be
	 * read, or an older snapshot.
	 */
	issuers?: IssuerSeen[];
	hosts: Record<string, HostState>;
	/**
	 * Names the certificate log still lists but DNS showed gone, with when that
	 * was seen. They are not in the inventory, and wait at the back of the
	 * probe queue so they cannot take the slots of hosts that exist.
	 */
	gone?: Record<string, string>;
	/**
	 * When an idle tick last probed hosts that were waiting their turn (`continueSnapshot`, OP-11).
	 * Absent: none has since this scan.
	 */
	continuedAt?: string;
	/**
	 * Names the certificate log listed that were not added to the inventory, because it holds
	 * MAX_KNOWN_HOSTS already (OP-12). Said in the report's notes. Absent: none.
	 */
	leftOut?: number;
}

const PROBE_CONCURRENCY = 4;

/**
 * The most names a domain's inventory holds. Each costs room in the snapshot's row, and D1 refuses a
 * row over 2 MB, after which no scan could be saved (MON-B8). Names already known stay; new ones past
 * this are left out, and the report says how many.
 */
export const MAX_KNOWN_HOSTS = 12_000;
/** And at most this much room for them, for long names: well under the row's 2 MB, leaving the report its share. */
const MAX_INVENTORY_BYTES = 1_400_000;

/** About the room a waiting name takes in a stored snapshot (store.ts): the name, two dates and a time. */
function keptBytes(name: string): number {
	return name.length + 84;
}

export async function collectSnapshot(
	domain: string,
	previous: Snapshot | null,
	settings: Settings,
	deps: Deps,
): Promise<Snapshot> {
	// Only names within this domain are carried from the previous scan, and only
	// from a scan of this same domain: a carried name is probed without a
	// certificate log entry of its own, so it must be one the ownership check covers.
	const prev = carriedFrom(previous, domain);
	const [ct, { records: apex, dnssec }] = await Promise.all([
		fetchCtCerts(domain, deps.fetch).catch(() => null),
		lookupApex(domain, deps.fetch),
	]);

	const certs = ct?.certs ?? null;
	const checkedAt = deps.now().toISOString();
	const logged = certs ? hostsFromCerts(certs) : null;
	// A gone name is forgotten once the log stops listing it (its certificates
	// expired). While the log cannot be read, the list is kept as it was.
	const prevGone = Object.entries(prev?.gone ?? {}).filter(([name]) => !logged || logged.has(name));
	const goneSince = new Map(prevGone);

	// The inventory accumulates: names leave it only when DNS shows they are
	// gone, never because the certificate log was unavailable for a day.
	const www = `www.${domain}`;
	const known = new Set<string>([
		domain,
		...(logged?.has(www) ? [www] : []),
		...Object.keys(prev?.hosts ?? {}),
		...goneSince.keys(),
	]);
	let leftOut = 0;
	let room = MAX_INVENTORY_BYTES - [...known].reduce((sum, name) => sum + keptBytes(name), 0);
	// New names in a fixed order, so the same ones are kept each scan while the log lists more than fit.
	for (const name of [...(logged ?? [])].sort()) {
		if (known.has(name)) continue;
		if (known.size < MAX_KNOWN_HOSTS && room >= keptBytes(name)) {
			known.add(name);
			room -= keptBytes(name);
		} else leftOut++;
	}
	const lastChecked = (host: string) => prev?.hosts[host]?.checkedAt ?? goneSince.get(host) ?? "";
	const ordered = orderHosts(known, domain, lastChecked);
	const certFor = (host: string) => {
		const carried = prev?.hosts[host]?.cert ?? null;
		const seen = latestCertFor(host, certs ?? []);
		// Without the bare-domain query, a certificate naming only the bare domain is missing, and an
		// older one that also names other hosts would stand in for it: the later of the two is kept.
		if (host === domain && ct && !ct.apexOk) return later(seen, carried);
		return seen ?? carried;
	};

	const hosts: Record<string, HostState> = {};
	const gone: Record<string, string> = {};
	const toProbe = ordered.slice(0, settings.maxHosts);
	for (let i = 0; i < toProbe.length; i += PROBE_CONCURRENCY) {
		await Promise.all(
			toProbe.slice(i, i + PROBE_CONCURRENCY).map(async (host) => {
				const state = await probeHost(host, host === domain, certFor(host), deps);
				const since = goneSince.get(host);
				if (state?.dns === null && since !== undefined && !prev?.hosts[host]) {
					// Found gone before, and its lookup failed this time: nothing was observed, so it
					// stays gone as it was rather than coming back as a new host (invariant 5).
					gone[host] = since;
				} else if (state) hosts[host] = { ...state, checkedAt };
				else gone[host] = checkedAt;
			}),
		);
	}
	for (const host of ordered.slice(settings.maxHosts)) {
		const since = goneSince.get(host);
		if (since !== undefined && !prev?.hosts[host]) {
			gone[host] = since; // Still gone as far as anyone has looked; it waits its turn.
			continue;
		}
		const waiting: HostState = { probed: false, dns: null, cert: certFor(host), http: null };
		const last = prev?.hosts[host]?.checkedAt;
		hosts[host] = last ? { ...waiting, checkedAt: last } : waiting;
	}

	return {
		version: 1,
		domain,
		takenAt: deps.now().toISOString(),
		ctOk: certs !== null,
		...(ct && !ct.apexOk ? { ctApexOk: false as const } : {}),
		apex,
		...(dnssec !== undefined ? { dnssec } : {}),
		// Only from a whole reading: without the bare-domain query a certificate naming it alone is missing.
		...(ct?.apexOk ? { issuers: issuersSeen(ct.certs) } : {}),
		hosts,
		...(Object.keys(gone).length > 0 ? { gone } : {}),
		...(leftOut > 0 ? { leftOut } : {}),
	};
}

/**
 * A pass over the hosts the last scan left waiting their turn, on a tick with no scan due (OP-11): up
 * to MAX_HOSTS of them, the longest waiting first, each probed as a scan probes it (one DNS lookup and
 * one `GET /`, invariant 2). Everything else is the last scan's, so apex records and the certificate
 * log are not asked again. The caller checks ownership first (invariant 1). Returns null when none waits.
 */
export async function continueSnapshot(
	previous: Snapshot,
	settings: Settings,
	deps: Deps,
): Promise<{ snapshot: Snapshot; probed: string[] } | null> {
	const domain = previous.domain;
	// Waiting: not probed by the scan, nor by a pass since it (which leaves a later check time).
	const waiting = Object.entries(previous.hosts)
		.filter(
			([host, state]) =>
				!state.probed && !checkedSince(state, previous.takenAt) && isWithin(host, domain),
		)
		.map(([host]) => host);
	if (waiting.length === 0) return null;
	const lastChecked = (host: string) => previous.hosts[host]?.checkedAt ?? "";
	const turn = orderHosts(new Set(waiting), domain, lastChecked).slice(0, settings.maxHosts);
	const checkedAt = deps.now().toISOString();
	const hosts: Record<string, HostState> = { ...previous.hosts };
	const gone: Record<string, string> = { ...previous.gone };
	for (let i = 0; i < turn.length; i += PROBE_CONCURRENCY) {
		await Promise.all(
			turn.slice(i, i + PROBE_CONCURRENCY).map(async (host) => {
				const state = await probeHost(
					host,
					host === domain,
					previous.hosts[host]?.cert ?? null,
					deps,
				);
				if (state) hosts[host] = { ...state, checkedAt };
				else {
					delete hosts[host];
					gone[host] = checkedAt;
				}
			}),
		);
	}
	return {
		snapshot: {
			...previous,
			hosts,
			...(Object.keys(gone).length > 0 ? { gone } : {}),
			continuedAt: checkedAt,
		},
		probed: turn,
	};
}

/** Whether a host waiting in a snapshot was probed after it was taken, by a pass over waiting hosts. */
export function checkedSince(state: HostState, takenAt: string): boolean {
	return state.checkedAt !== undefined && state.checkedAt >= takenAt;
}

/**
 * The snapshot a pass leaves stored: the hosts it probed kept as waiting ones are, with their check
 * time (OP-12), so a row does not grow by a whole observation for every name the passes reach. What
 * they showed is in the pass's report; the next scan finds them not observed, as it finds any host
 * that waited, and carries their findings (invariant 5).
 */
export function settled(snapshot: Snapshot, probed: string[]): Snapshot {
	const hosts = { ...snapshot.hosts };
	for (const host of probed) {
		const state = hosts[host];
		if (state)
			hosts[host] = {
				probed: false,
				dns: null,
				cert: state.cert,
				http: null,
				...(state.checkedAt ? { checkedAt: state.checkedAt } : {}),
			};
	}
	return { ...snapshot, hosts };
}

/** Whichever certificate runs later; either may be missing. */
function later(a: CertWindow | null, b: CertWindow | null): CertWindow | null {
	if (!a || !b) return a ?? b;
	return a.notAfter >= b.notAfter ? a : b;
}

/** The previous snapshot cut to what may be carried into a scan of `domain`, or null if it was of another domain. */
function carriedFrom(prev: Snapshot | null, domain: string): Snapshot | null {
	if (!prev || prev.domain !== domain) return null;
	const within = <T>(record: Record<string, T> | undefined) =>
		Object.fromEntries(Object.entries(record ?? {}).filter(([host]) => isWithin(host, domain)));
	return {
		...prev,
		hosts: within(prev.hosts),
		...(prev.gone ? { gone: within(prev.gone) } : {}),
	};
}

/** Returns null when the name no longer exists in DNS and should leave the inventory. */
async function probeHost(
	host: string,
	isApex: boolean,
	cert: CertWindow | null,
	deps: Deps,
): Promise<HostState | null> {
	let dns: HostDns;
	try {
		dns = await lookupHost(host, deps.fetch);
	} catch {
		return { probed: true, dns: null, cert, http: null };
	}
	if (!resolves(dns)) {
		// An alias with no address behind it is kept: that is a finding.
		// A name with neither is gone, or only ever existed on a certificate.
		const keep = isApex || dns.cname.length > 0;
		return keep ? { probed: true, dns, cert, http: null } : null;
	}
	return { probed: true, dns, cert, http: await probeHttps(host, deps.fetch) };
}

/**
 * Apex first, then `www`, then the rest by when each was last probed: names
 * never probed (new in the certificate log) first, then the longest waiting.
 * Under MAX_HOSTS every known name gets a turn, and a name found gone goes to
 * the back of the queue instead of taking the same slot every scan.
 */
function orderHosts(
	hosts: Set<string>,
	domain: string,
	lastChecked: (host: string) => string,
): string[] {
	const rank = (host: string) => (host === domain ? 0 : host === `www.${domain}` ? 1 : 2);
	return [...hosts].sort(
		(a, b) =>
			rank(a) - rank(b) || lastChecked(a).localeCompare(lastChecked(b)) || a.localeCompare(b),
	);
}
