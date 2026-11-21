/**
 * How strong a zone's DKIM keys are (FT-5), read from the DNS records the audit already fetched: no
 * lookup is made, and no selector is guessed (that would be guessing names, invariant 2). Plain
 * code, no model. A key Porchlight cannot read is said, never passed (invariant 5).
 */
import { createPublicKey } from "node:crypto";
import type { CfCheck } from "./types.ts";

/** A record under `_domainkey`, with a TXT record's value already unquoted. */
export interface DkimRecord {
	name: string;
	type: string;
	value: string;
}

export type DkimKey =
	| { state: "rsa"; bits: number; testing: boolean }
	| { state: "ed25519"; testing: boolean }
	| { state: "revoked" }
	| { state: "unreadable"; reason: string };

/** The tags of a DKIM record (`v=DKIM1; k=rsa; p=MIIB…`), by lower-case name. */
function tags(value: string): Map<string, string> {
	const out = new Map<string, string>();
	for (const part of value.split(";")) {
		const at = part.indexOf("=");
		if (at < 0) continue;
		out.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).replace(/\s+/g, ""));
	}
	return out;
}

/** What a DKIM record's key is: its type and size, whether it is in test mode (`t=y`), or revoked (an empty `p=`). */
export function dkimKey(value: string): DkimKey {
	const found = tags(value);
	const key = found.get("p");
	if (key === undefined) return { state: "unreadable", reason: "it has no p= tag" };
	if (key === "") return { state: "revoked" };
	const testing = (found.get("t") ?? "").split(":").includes("y");
	const kind = (found.get("k") ?? "rsa").toLowerCase();
	if (!/^[A-Za-z0-9+/]+={0,2}$/.test(key)) return { state: "unreadable", reason: "its key is not base64" };
	const der = Buffer.from(key, "base64");
	if (kind === "ed25519") return der.length === 32 ? { state: "ed25519", testing } : { state: "unreadable", reason: "its Ed25519 key is not 32 bytes" };
	if (kind !== "rsa") return { state: "unreadable", reason: `its key type ${kind.slice(0, 20)} is not one DKIM defines` };
	// A public key in SubjectPublicKeyInfo form, as RFC 6376 asks; some publish the bare RSA key instead.
	for (const type of ["spki", "pkcs1"] as const) {
		try {
			const bits = createPublicKey({ key: der, format: "der", type }).asymmetricKeyDetails?.modulusLength;
			if (typeof bits === "number") return { state: "rsa", bits, testing };
		} catch {
			// Tried in the other form next.
		}
	}
	return { state: "unreadable", reason: "its RSA key could not be read" };
}

const WHY = "A DKIM key signs the mail you send. A 1024-bit RSA key can be broken by a well-funded attacker, who could then sign mail as you; receivers and RFC 8301 ask for 2048 bits. A key in test mode (t=y) asks receivers to treat failures as if the mail were unsigned.";

/**
 * The strength of the zone's DKIM keys, or null when it publishes none. Keys behind a CNAME are
 * published by the mail provider the CNAME names, which the audit does not read: said, not judged.
 */
export function dkimStrengthCheck(records: DkimRecord[]): CfCheck | null {
	if (records.length === 0) return null;
	const delegated = records.filter((record) => record.type === "CNAME");
	const keys = records.filter((record) => record.type === "TXT").map((record) => ({ name: record.name.toLowerCase(), key: dkimKey(record.value) }));
	const weak = keys.filter(({ key }) => key.state === "rsa" && key.bits < 2048);
	const testing = keys.filter(({ key }) => (key.state === "rsa" || key.state === "ed25519") && key.testing);
	const unreadable = keys.filter(({ key }) => key.state === "unreadable");
	const revoked = keys.filter(({ key }) => key.state === "revoked");
	const describe = ({ name, key }: { name: string; key: DkimKey }) => {
		if (key.state === "rsa") return `${name}: RSA ${key.bits} bits${key.testing ? ", test mode (t=y)" : ""}`;
		if (key.state === "ed25519") return `${name}: Ed25519${key.testing ? ", test mode (t=y)" : ""}`;
		if (key.state === "revoked") return `${name}: revoked (empty p=)`;
		return `${name}: could not be read, ${key.reason}`;
	};
	const items = [...keys.map(describe), ...delegated.map((record) => `${record.name.toLowerCase()}: a CNAME, so the key is published by the provider it names and was not read`)].slice(0, 20);
	const base = { id: "dkim-keys", area: "email" as const, title: "DKIM key strength", why: WHY, items };
	const problems = [...new Set([...weak, ...testing, ...unreadable])];
	if (problems.length > 0) {
		const tiny = weak.some(({ key }) => key.state === "rsa" && key.bits < 1024);
		const parts = [
			weak.length > 0 ? `${weak.length} RSA key${weak.length === 1 ? " is" : "s are"} shorter than 2048 bits` : "",
			testing.length > 0 ? `${testing.length} ${testing.length === 1 ? "key is" : "keys are"} in test mode (t=y)` : "",
			unreadable.length > 0 ? `${unreadable.length} ${unreadable.length === 1 ? "key" : "keys"} could not be read` : "",
		].filter((part) => part !== "");
		return {
			...base,
			status: "failed",
			severity: tiny ? "high" : weak.length > 0 ? "medium" : "low",
			detail: `${parts.join("; ")}.`,
			fix: [
				"At your mail provider, create a new 2048-bit DKIM key under a new selector and add the record it gives you in Cloudflare → DNS → Records. Once mail is signed with it, empty the old key's p= value to revoke it.",
				...(testing.length > 0 ? ["Remove t=y from the record once mail passes DKIM."] : []),
			],
		};
	}
	if (keys.length === revoked.length) {
		return {
			...base,
			status: "unknown",
			severity: "medium",
			detail: keys.length === 0 ? "Every DKIM record is a CNAME to the mail provider, which publishes the keys; Porchlight does not look them up." : "Every DKIM key published here is revoked; any key in use is published elsewhere (by a CNAME, or another zone), which Porchlight does not read.",
		};
	}
	const strong = keys.length - revoked.length;
	return {
		...base,
		status: "passed",
		severity: "medium",
		detail: `${strong} DKIM key${strong === 1 ? " is" : "s are"} 2048-bit RSA or Ed25519, none in test mode.${delegated.length > 0 ? ` ${delegated.length} behind a CNAME ${delegated.length === 1 ? "was" : "were"} not read.` : ""}`,
	};
}
