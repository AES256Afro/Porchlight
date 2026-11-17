import { fetchCtCerts, hostsFromCerts, latestCertFor, type CertWindow } from "./collect/ct.ts";
import { lookupApex, lookupHost, resolves, type ApexRecords, type HostDns } from "./collect/dns.ts";
import { probeHttps, type HttpProbe } from "./collect/http.ts";
import type { Deps, Settings } from "./env.ts";

export interface HostState {
	/** False when the host is known but fell beyond MAX_HOSTS this run. */
	probed: boolean;
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
	hosts: Record<string, HostState>;
}

const PROBE_CONCURRENCY = 4;

export async function collectSnapshot(
	domain: string,
	prev: Snapshot | null,
	settings: Settings,
	deps: Deps,
): Promise<Snapshot> {
	const [certs, apex] = await Promise.all([
		fetchCtCerts(domain, deps.fetch).catch(() => null),
		lookupApex(domain, deps.fetch),
	]);

	// The inventory accumulates: names leave it only when DNS shows they are
	// gone, never because the certificate log was unavailable for a day.
	const known = new Set<string>([
		domain,
		...hostsFromCerts(certs ?? []),
		...Object.keys(prev?.hosts ?? {}),
	]);
	const ordered = orderHosts(known, domain);
	const certFor = (host: string) =>
		latestCertFor(host, certs ?? []) ?? prev?.hosts[host]?.cert ?? null;

	const hosts: Record<string, HostState> = {};
	const toProbe = ordered.slice(0, settings.maxHosts);
	for (let i = 0; i < toProbe.length; i += PROBE_CONCURRENCY) {
		await Promise.all(
			toProbe.slice(i, i + PROBE_CONCURRENCY).map(async (host) => {
				const state = await probeHost(host, host === domain, certFor(host), deps);
				if (state) hosts[host] = state;
			}),
		);
	}
	for (const host of ordered.slice(settings.maxHosts)) {
		hosts[host] = { probed: false, dns: null, cert: certFor(host), http: null };
	}

	return {
		version: 1,
		domain,
		takenAt: deps.now().toISOString(),
		ctOk: certs !== null,
		apex,
		hosts,
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

/** Apex first, then `www`, then alphabetical, so which hosts fit under the cap is stable. */
function orderHosts(hosts: Set<string>, domain: string): string[] {
	const rank = (host: string) => (host === domain ? 0 : host === `www.${domain}` ? 1 : 2);
	return [...hosts].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}
