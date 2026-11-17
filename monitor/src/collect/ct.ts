import { isWithin, normalizeDomain } from "../domain.ts";
import { USER_AGENT, type FetchFn } from "../env.ts";

/** Validity window of a certificate, as ISO timestamps. */
export interface CertWindow {
	notBefore: string;
	notAfter: string;
}

export interface CtCert extends CertWindow {
	/** Names on the certificate that fall under the monitored domain. May include `*.` wildcards. */
	names: string[];
}

/**
 * Unexpired certificates logged to Certificate Transparency for the domain and
 * its subdomains, via crt.sh. Passive: this reads a public log and sends
 * nothing to the domain itself.
 *
 * Throws if the subdomain query fails. The apex-only query is best effort: it
 * only adds certificates issued for the bare domain with no other names.
 */
export async function fetchCtCerts(domain: string, fetchFn: FetchFn): Promise<CtCert[]> {
	const [subdomains, apex] = await Promise.allSettled([
		queryCrtSh(`%.${domain}`, fetchFn),
		queryCrtSh(domain, fetchFn),
	]);
	if (subdomains.status === "rejected") throw subdomains.reason;
	const rows =
		apex.status === "fulfilled" ? [...subdomains.value, ...apex.value] : subdomains.value;
	return parseCtRows(rows, domain);
}

async function queryCrtSh(identity: string, fetchFn: FetchFn): Promise<unknown[]> {
	const url = new URL("https://crt.sh/");
	url.searchParams.set("q", identity);
	url.searchParams.set("output", "json");
	url.searchParams.set("exclude", "expired");
	const res = await fetchFn(url, {
		headers: { "user-agent": USER_AGENT },
		signal: AbortSignal.timeout(25_000),
	});
	if (!res.ok) throw new Error(`crt.sh: HTTP ${res.status}`);
	const rows: unknown = await res.json();
	if (!Array.isArray(rows)) throw new Error("crt.sh: unexpected response shape");
	return rows;
}

export function parseCtRows(rows: unknown[], domain: string): CtCert[] {
	const certs: CtCert[] = [];
	for (const row of rows) {
		if (typeof row !== "object" || row === null) continue;
		const { name_value, not_before, not_after } = row as Record<string, unknown>;
		if (typeof name_value !== "string") continue;
		const notBefore = toIso(not_before);
		const notAfter = toIso(not_after);
		if (!notBefore || !notAfter) continue;
		const names = new Set<string>();
		for (const raw of name_value.split("\n")) {
			const name = cleanCertName(raw);
			if (name && isWithin(name.replace(/^\*\./, ""), domain)) names.add(name);
		}
		if (names.size > 0) certs.push({ names: [...names], notBefore, notAfter });
	}
	return certs;
}

function cleanCertName(raw: string): string | null {
	const name = raw.trim().toLowerCase();
	if (name.startsWith("*.")) {
		const rest = normalizeDomain(name.slice(2));
		return rest ? `*.${rest}` : null;
	}
	return normalizeDomain(name);
}

/** crt.sh timestamps are UTC without a zone suffix. */
function toIso(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const date = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value}Z`);
	return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Concrete hostnames named on the certificates. A wildcard contributes its parent name. */
export function hostsFromCerts(certs: CtCert[]): Set<string> {
	const hosts = new Set<string>();
	for (const cert of certs) {
		for (const name of cert.names) hosts.add(name.replace(/^\*\./, ""));
	}
	return hosts;
}

/** The latest-expiring certificate that covers `host`, directly or by a one-level wildcard. */
export function latestCertFor(host: string, certs: CtCert[]): CertWindow | null {
	const wildcard = `*.${host.slice(host.indexOf(".") + 1)}`;
	let best: CertWindow | null = null;
	for (const cert of certs) {
		if (!cert.names.includes(host) && !cert.names.includes(wildcard)) continue;
		if (!best || cert.notAfter > best.notAfter) {
			best = { notBefore: cert.notBefore, notAfter: cert.notAfter };
		}
	}
	return best;
}
