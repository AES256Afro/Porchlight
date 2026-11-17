import { recordsOf, resolve } from "../doh.ts";
import type { FetchFn } from "../env.ts";

export interface HostDns {
	a: string[];
	/** Only looked up when there are no A records, to tell "IPv6 only" from "gone". */
	aaaa: string[];
	cname: string[];
}

export async function lookupHost(host: string, fetchFn: FetchFn): Promise<HostDns> {
	const answers = await resolve(host, "A", fetchFn);
	const a = recordsOf(answers, "A");
	const cname = recordsOf(answers, "CNAME");
	const aaaa = a.length > 0 ? [] : recordsOf(await resolve(host, "AAAA", fetchFn), "AAAA");
	return { a, aaaa, cname };
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

export async function lookupApex(domain: string, fetchFn: FetchFn): Promise<ApexRecords> {
	const records: ApexRecords = {};
	await Promise.all(
		APEX_TYPES.map(async (type) => {
			try {
				records[type] = recordsOf(await resolve(domain, type, fetchFn), type);
			} catch {
				// Left unset so the diff skips this type instead of reporting it emptied.
			}
		}),
	);
	return records;
}
