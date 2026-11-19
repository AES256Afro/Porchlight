import { recordsOf, resolve } from "./doh.ts";
import type { FetchFn } from "./env.ts";

/**
 * Ownership is proven by publishing a TXT record only the domain's DNS
 * administrator can create. Nothing is fetched from, or about, a domain until
 * this check passes, and it is repeated before every scan.
 */
export const CHALLENGE_LABEL = "_porchlight-challenge";
/**
 * The label and value prefix records were published under before the rename.
 * Such a record still proves ownership, so no domain has to be verified again.
 */
export const OLD_CHALLENGE_LABEL = "_securityx-challenge";
const OLD_VALUE_PREFIX = "securityx-verify=";

export function challengeName(domain: string): string {
	return `${CHALLENGE_LABEL}.${domain}`;
}

export function challengeValue(token: string): string {
	return `porchlight-verify=${token}`;
}

export function newChallengeToken(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(24));
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Throws if DNS could not be queried; returns false if the record is absent or wrong. */
export async function checkOwnership(
	domain: string,
	token: string,
	fetchFn: FetchFn,
): Promise<boolean> {
	const values = [challengeValue(token), `${OLD_VALUE_PREFIX}${token}`];
	// The current record first; the earlier one only when the current one does not prove it.
	for (const label of [CHALLENGE_LABEL, OLD_CHALLENGE_LABEL]) {
		const answers = await resolve(`${label}.${domain}`, "TXT", fetchFn);
		if (recordsOf(answers, "TXT").some((value) => values.includes(value))) return true;
	}
	return false;
}
