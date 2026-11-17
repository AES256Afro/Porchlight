import { recordsOf, resolve } from "./doh.ts";
import type { FetchFn } from "./env.ts";

/**
 * Ownership is proven by publishing a TXT record only the domain's DNS
 * administrator can create. Nothing is fetched from, or about, a domain until
 * this check passes, and it is repeated before every scan.
 */
export const CHALLENGE_LABEL = "_securityx-challenge";

export function challengeName(domain: string): string {
	return `${CHALLENGE_LABEL}.${domain}`;
}

export function challengeValue(token: string): string {
	return `securityx-verify=${token}`;
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
	const answers = await resolve(challengeName(domain), "TXT", fetchFn);
	return recordsOf(answers, "TXT").includes(challengeValue(token));
}
