import type { FetchFn } from "./env.ts";

export type RecordType = "A" | "AAAA" | "CNAME" | "NS" | "MX" | "TXT" | "CAA";

const TYPE_CODE: Record<RecordType, number> = {
	A: 1,
	NS: 2,
	CNAME: 5,
	MX: 15,
	TXT: 16,
	AAAA: 28,
	CAA: 257,
};

export interface DnsAnswer {
	name: string;
	type: number;
	data: string;
}

/** DNS response codes that are answers: NOERROR (records or none) and NXDOMAIN (no such name). */
const ANSWERED = new Set([0, 3]);

/**
 * Resolves `name` over DNS-over-HTTPS. Throws when no answer came back, never
 * on an empty answer. A resolver that could not get an answer (SERVFAIL,
 * REFUSED: a broken delegation, a DNSSEC failure, an upstream timeout) still
 * replies with HTTP 200 and no records, so the DNS status is checked too:
 * reading that as "no records" would report hosts gone and findings resolved.
 */
export async function resolve(
	name: string,
	type: RecordType,
	fetchFn: FetchFn,
): Promise<DnsAnswer[]> {
	const url = new URL("https://cloudflare-dns.com/dns-query");
	url.searchParams.set("name", name);
	url.searchParams.set("type", type);
	const res = await fetchFn(url, {
		headers: { accept: "application/dns-json" },
		signal: AbortSignal.timeout(8_000),
	});
	if (!res.ok) throw new Error(`DNS lookup ${type} ${name}: HTTP ${res.status}`);
	const body = (await res.json()) as { Status?: unknown; Answer?: DnsAnswer[] };
	if (typeof body.Status !== "number" || !ANSWERED.has(body.Status)) {
		throw new Error(`DNS lookup ${type} ${name}: no answer (DNS status ${String(body.Status)})`);
	}
	return Array.isArray(body.Answer) ? body.Answer : [];
}

/** The values of one record type from an answer, normalised and sorted so they compare stably. */
export function recordsOf(answers: DnsAnswer[], type: RecordType): string[] {
	const values = answers
		.filter((answer) => answer.type === TYPE_CODE[type] && typeof answer.data === "string")
		.map((answer) => normalizeData(type, answer.data));
	return [...new Set(values)].sort();
}

function normalizeData(type: RecordType, data: string): string {
	switch (type) {
		case "TXT":
			return unquoteTxt(data);
		case "CNAME":
		case "NS":
		case "MX":
			return data.toLowerCase().replace(/\.$/, "");
		default:
			return data;
	}
}

/** TXT data arrives as one or more quoted chunks: `"abc" "def"` means `abcdef`. */
export function unquoteTxt(data: string): string {
	const chunks = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
	if (chunks.length === 0) return data;
	return chunks.map((chunk) => chunk[1]!.replace(/\\(.)/g, "$1")).join("");
}
