import { fetchCtCerts, hostsFromCerts, latestCertFor, type CertWindow } from "./collect/ct.ts";
import { lookupApex, lookupHost, resolves, type ApexRecords, type HostDns } from "./collect/dns.ts";
import { probeHttps, type HttpProbe } from "./collect/http.ts";
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
	apex: ApexRecords;
	/** Whether the domain's DNS answers are signed. Absent: not observed, or an older snapshot. */
	dnssec?: boolean;
	hosts: Record<string, HostState>;
	/**
	 * Names the certificate log still lists but DNS showed gone, with when that
	 * was seen. They are not in the inventory, and wait at the back of the
	 * probe queue so they cannot take the slots of hosts that exist.
	 */
	gone?: Record<string, string>;
}

const PROBE_CONCURRENCY = 4;

export async function collectSnapshot(
	domain: string,
	prev: Snapshot | null,
	settings: Settings,
	deps: Deps,
): Promise<Snapshot> {
	const [certs, { records: apex, dnssec }] = await Promise.all([
		fetchCtCerts(domain, deps.fetch).catch(() => null),
		lookupApex(domain, deps.fetch),
	]);

	const checkedAt = deps.now().toISOString();
	const logged = certs ? hostsFromCerts(certs) : null;
	// A gone name is forgotten once the log stops listing it (its certificates
	// expired). While the log cannot be read, the list is kept as it was.
	const prevGone = Object.entries(prev?.gone ?? {}).filter(([name]) => !logged || logged.has(name));
	const goneSince = new Map(prevGone);

	// The inventory accumulates: names leave it only when DNS shows they are
	// gone, never because the certificate log was unavailable for a day.
	const known = new Set<string>([
		domain,
		...(logged ?? []),
		...Object.keys(prev?.hosts ?? {}),
		...goneSince.keys(),
	]);
	const lastChecked = (host: string) => prev?.hosts[host]?.checkedAt ?? goneSince.get(host) ?? "";
	const ordered = orderHosts(known, domain, lastChecked);
	const certFor = (host: string) =>
		latestCertFor(host, certs ?? []) ?? prev?.hosts[host]?.cert ?? null;

	const hosts: Record<string, HostState> = {};
	const gone: Record<string, string> = {};
	const toProbe = ordered.slice(0, settings.maxHosts);
	for (let i = 0; i < toProbe.length; i += PROBE_CONCURRENCY) {
		await Promise.all(
			toProbe.slice(i, i + PROBE_CONCURRENCY).map(async (host) => {
				const state = await probeHost(host, host === domain, certFor(host), deps);
				if (state) hosts[host] = { ...state, checkedAt };
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
		apex,
		...(dnssec !== undefined ? { dnssec } : {}),
		hosts,
		...(Object.keys(gone).length > 0 ? { gone } : {}),
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
