import { recordsOf, resolve, resolveSigned, TYPE_CODE, type DnsAnswer } from "../doh.ts";
import type { FetchFn } from "../env.ts";

export interface HostDns {
	a: string[];
	/** Only looked up when there are no A records, to tell "IPv6 only" from "gone". */
	aaaa: string[];
	/**
	 * The alias chain in order, from the host's own alias to the last hop.
	 * Older snapshots hold it sorted instead, so compare it as a set.
	 */
	cname: string[];
}

export async function lookupHost(host: string, fetchFn: FetchFn): Promise<HostDns> {
	const answers = await resolve(host, "A", fetchFn);
	const a = recordsOf(answers, "A");
	const cname = cnameChain(answers, host);
	const aaaa = a.length > 0 ? [] : recordsOf(await resolve(host, "AAAA", fetchFn), "AAAA");
	return { a, aaaa, cname };
}

/**
 * The aliases from `host` onward, following each record from the name that
 * owns it, so the last entry is the last hop whatever order the answer used.
 * Hops that cannot be placed in the chain are kept after it, so none is lost.
 */
export function cnameChain(answers: DnsAnswer[], host: string): string[] {
	const bare = (name: string) => name.toLowerCase().replace(/\.$/, "");
	const links = new Map<string, string>();
	const targets: string[] = [];
	for (const answer of answers) {
		if (answer.type !== TYPE_CODE.CNAME || typeof answer.data !== "string") continue;
		const target = bare(answer.data);
		if (typeof answer.name === "string" && !links.has(bare(answer.name))) {
			links.set(bare(answer.name), target);
		}
		targets.push(target);
	}
	const chain: string[] = [];
	const seen = new Set([bare(host)]);
	for (let at = bare(host), next = links.get(at); next !== undefined; next = links.get(at)) {
		chain.push(next);
		if (seen.has(next)) break; // A loop: the resolver gave up here too.
		seen.add(next);
		at = next;
	}
	for (const target of targets) if (!chain.includes(target)) chain.push(target);
	return chain;
}

/**
 * Whether the name leads to an address. Deliberately not based on the DNS
 * response code: DNSSEC-signed zones on some providers answer NOERROR for
 * names that do not exist, so "no address records" is the only reliable sign.
 */
export function resolves(dns: HostDns): boolean {
	return dns.a.length + dns.aaaa.length > 0;
}

/** Apex record types tracked for change. The apex A record is tracked with the hosts. */
export const APEX_TYPES = ["AAAA", "NS", "MX", "TXT", "CAA"] as const;
export type ApexType = (typeof APEX_TYPES)[number];

/** A missing key means that lookup failed this run: "not observed", never "no records". */
export type ApexRecords = Partial<Record<ApexType, string[]>>;

export interface ApexLookup {
	records: ApexRecords;
	/**
	 * Whether the domain's answers are signed with DNSSEC, read from the lookups above: no further
	 * request is made for it. Undefined when no lookup said, or when they disagreed: "not observed".
	 */
	dnssec?: boolean;
}

export async function lookupApex(domain: string, fetchFn: FetchFn): Promise<ApexLookup> {
	const records: ApexRecords = {};
	const validated: boolean[] = [];
	await Promise.all(
		APEX_TYPES.map(async (type) => {
			try {
				const { answers, authenticated } = await resolveSigned(domain, type, fetchFn);
				records[type] = recordsOf(answers, type);
				if (authenticated !== undefined) validated.push(authenticated);
			} catch {
				// Left unset so the diff skips this type instead of reporting it emptied.
			}
		}),
	);
	const agree = validated.length > 0 && validated.every((value) => value === validated[0]);
	return { records, ...(agree ? { dnssec: validated[0]! } : {}) };
}
