// Who may issue certificates for a domain (its CAA record, RFC 8659), against who did (the issuers
// the certificate log already lists for it, FT-3). Nothing here makes a request: both come from
// lookups every scan makes anyway, so the ownership gate's request list is unchanged (invariants 1, 2).

import type { CtCert } from "./collect/ct.ts";

/** A certificate authority the log named for the domain, with what its certificates covered. */
export interface IssuerSeen {
	/** The issuing organisation as the log gives it, such as "Let's Encrypt". */
	issuer: string;
	/** Whether any of its certificates names a host directly, and whether any names a `*.` wildcard. */
	plain: boolean;
	wildcard: boolean;
	/** A few names its certificates cover, to say which certificate is meant. */
	names: string[];
}

/** Names kept per issuer: enough to find the certificate, little room in the snapshot. */
const NAMES_KEPT = 3;
/** Issuers kept per scan; a domain served by more is unusual, and the rest are left out. */
export const ISSUERS_KEPT = 20;

/** The log's certificates by issuer, in a fixed order. Certificates whose issuer is not given are left out. */
export function issuersSeen(certs: CtCert[]): IssuerSeen[] {
	const byIssuer = new Map<string, IssuerSeen>();
	for (const cert of certs) {
		if (!cert.issuer) continue;
		const seen = byIssuer.get(cert.issuer) ?? {
			issuer: cert.issuer,
			plain: false,
			wildcard: false,
			names: [],
		};
		for (const name of cert.names) {
			if (name.startsWith("*.")) seen.wildcard = true;
			else seen.plain = true;
			if (seen.names.length < NAMES_KEPT && !seen.names.includes(name)) seen.names.push(name);
		}
		byIssuer.set(cert.issuer, seen);
	}
	return [...byIssuer.values()]
		.sort((a, b) => a.issuer.localeCompare(b.issuer))
		.slice(0, ISSUERS_KEPT)
		.map((seen) => ({ ...seen, names: [...seen.names].sort() }));
}

/**
 * Certificate authorities by the organisation their certificates name, with the identifiers a CAA
 * record uses to allow them (each CA's own documentation). An issuer not in this table is not
 * judged: Porchlight cannot say which CAA identifier it answers to.
 */
const AUTHORITIES: { organisation: RegExp; identifiers: string[] }[] = [
	{ organisation: /^let'?s encrypt$/i, identifiers: ["letsencrypt.org"] },
	{ organisation: /^google trust services/i, identifiers: ["pki.goog"] },
	{
		organisation: /^(digicert|geotrust|rapidssl|thawte|symantec)/i,
		identifiers: ["digicert.com", "symantec.com", "geotrust.com", "rapidssl.com", "thawte.com"],
	},
	{
		organisation: /^(sectigo|comodo|usertrust|the usertrust network)/i,
		identifiers: [
			"sectigo.com",
			"comodoca.com",
			"comodo.com",
			"usertrust.com",
			"trust-provider.com",
		],
	},
	// ZeroSSL's certificates are issued by Sectigo, and its own documentation asks for sectigo.com.
	{ organisation: /^zerossl$/i, identifiers: ["sectigo.com"] },
	{
		organisation: /^amazon$/i,
		identifiers: ["amazon.com", "amazontrust.com", "awstrust.com", "amazonaws.com"],
	},
	{ organisation: /^globalsign/i, identifiers: ["globalsign.com"] },
	{ organisation: /^entrust/i, identifiers: ["entrust.net"] },
	{
		organisation: /^(godaddy\.com|starfield technologies)/i,
		identifiers: ["godaddy.com", "starfieldtech.com"],
	},
	{ organisation: /^ssl corporation$/i, identifiers: ["ssl.com"] },
	{ organisation: /^buypass/i, identifiers: ["buypass.com", "buypass.no"] },
	{ organisation: /^certainly$/i, identifiers: ["certainly.com"] },
	{ organisation: /^actalis/i, identifiers: ["actalis.it"] },
	{ organisation: /^harica|hellenic academic/i, identifiers: ["harica.gr"] },
];

/** The CAA identifiers an issuer answers to, or null when it is not one Porchlight knows. */
export function identifiersOf(issuer: string): string[] | null {
	return AUTHORITIES.find((authority) => authority.organisation.test(issuer))?.identifiers ?? null;
}

/** What the CAA records allow: identifiers for any certificate, and for wildcard ones; null where no record of that tag is set. */
export interface CaaPolicy {
	issue: string[] | null;
	issuewild: string[] | null;
}

/**
 * CAA records as DNS gives them (`0 issue "letsencrypt.org; validationmethods=dns-01"`, or the
 * generic `\# 22 00 05 69 73 …` form) as what they allow. null when no record says who may issue
 * (only `iodef`, say): then any authority may, and nothing is judged.
 */
export function parseCaa(records: string[]): CaaPolicy | null {
	const policy: CaaPolicy = { issue: null, issuewild: null };
	for (const record of records) {
		const parsed = presentation(record) ?? generic(record);
		if (!parsed) continue;
		const tag = parsed.tag.toLowerCase();
		if (tag !== "issue" && tag !== "issuewild") continue;
		// "letsencrypt.org; accounturi=…" names letsencrypt.org; ";" alone names no one.
		const identifier = parsed.value.split(";")[0]!.trim().toLowerCase().replace(/\.$/, "");
		const list = (policy[tag] ??= []);
		if (identifier !== "" && !list.includes(identifier)) list.push(identifier);
	}
	return policy.issue === null && policy.issuewild === null ? null : policy;
}

function presentation(record: string): { tag: string; value: string } | null {
	const match = /^\s*\d+\s+([a-z0-9]+)\s+(?:"((?:[^"\\]|\\.)*)"|(\S*))\s*$/i.exec(record);
	return match
		? { tag: match[1]!, value: (match[2] ?? match[3] ?? "").replace(/\\(.)/g, "$1") }
		: null;
}

/** RFC 3597's form: `\# <length> <hex…>`, holding flags, the tag's length, the tag and the value. */
function generic(record: string): { tag: string; value: string } | null {
	const match = /^\s*\\#\s+\d+\s+([0-9a-f\s]+)$/i.exec(record);
	if (!match) return null;
	const hex = match[1]!.replace(/\s+/g, "");
	if (hex.length % 2 !== 0) return null;
	const bytes = hex.match(/../g)!.map((pair) => Number.parseInt(pair, 16));
	const length = bytes[1];
	if (length === undefined || bytes.length < 2 + length) return null;
	const text = (part: number[]) => String.fromCharCode(...part);
	return { tag: text(bytes.slice(2, 2 + length)), value: text(bytes.slice(2 + length)) };
}

/**
 * The issuers the CAA records do not allow, for the certificates each issued: wildcard certificates
 * against `issuewild` where one is set, the rest against `issue`. An issuer not in the table is
 * left out, since which identifier it answers to is not known.
 */
export function unlistedIssuers(
	policy: CaaPolicy,
	issuers: IssuerSeen[],
): { seen: IssuerSeen; identifier: string }[] {
	const out: { seen: IssuerSeen; identifier: string }[] = [];
	for (const seen of issuers) {
		const identifiers = identifiersOf(seen.issuer);
		if (!identifiers) continue;
		const allowedBy = (list: string[] | null) =>
			list !== null && identifiers.some((identifier) => list.includes(identifier));
		// With no issue tag, only issuewild limits anything, and only wildcard certificates.
		const plainOk = !seen.plain || policy.issue === null || allowedBy(policy.issue);
		const wildList = policy.issuewild ?? policy.issue;
		const wildOk = !seen.wildcard || wildList === null || allowedBy(wildList);
		if (!plainOk || !wildOk) out.push({ seen, identifier: identifiers[0]! });
	}
	return out;
}
