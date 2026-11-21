/**
 * What an investigation may touch, and how fast.
 *
 * The scope is one domain the owner has proven they control (`ownership.ts`) and its subdomains.
 * Nothing else is in it: no IP address, no other domain, no third-party service the site uses. Every
 * action names its target by host name and is checked here before it runs.
 */
import { domainToASCII } from "node:url";

/** A lowercase host name: labels of letters, digits, hyphens and underscores (as in `_dmarc`). */
const HOST_NAME = /^(?=.{1,253}$)(?:[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
/** A domain as the owner types it: no underscores, at least two labels. */
const DOMAIN_NAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

export class ScopeError extends Error {}

/** A domain the owner typed, lowercased without a trailing dot, or null when it is not one. */
export function parseDomain(value: unknown): string | null {
	if (typeof value !== "string") return null;
	// A name written in its own script (münchen.de) is taken in the ASCII form DNS uses
	// (xn--mnchen-3ya.de), and checked as that (B58). One that has no such form is refused.
	const domain = asciiDomain(value.trim().toLowerCase().replace(/\.$/, ""));
	return domain !== "" && DOMAIN_NAME.test(domain) ? domain : null;
}

/** A domain name in the ASCII form DNS uses: unchanged when it is ASCII already, empty when it has none. */
export function asciiDomain(name: string): string {
	return /^[\x00-\x7f]*$/.test(name) ? name : domainToASCII(name);
}

/**
 * A bare host name from what a model wrote. Only a host name is taken: an IP address, a port, a
 * user name or anything with a space or a shell character is refused, never cleaned up.
 */
export function normalizeHost(value: unknown): string {
	if (typeof value !== "string") throw new ScopeError("host must be a host name");
	const host = value.trim().toLowerCase().replace(/\.$/, "");
	if (host === "") throw new ScopeError("host is empty");
	if (/^[\d.]+$/.test(host) || host.includes(":")) throw new ScopeError("addresses are not in scope: name a host under the verified domain");
	if (!HOST_NAME.test(host)) throw new ScopeError(`not a host name: ${JSON.stringify(value.slice(0, 80))}`);
	return host;
}

export class Scope {
	readonly domain: string;

	constructor(domain: string) {
		const parsed = parseDomain(domain);
		if (!parsed) throw new ScopeError(`not a domain: ${domain}`);
		this.domain = parsed;
	}

	/** Whether `host` is the domain or one of its subdomains. `example.com.evil.net` and `evilexample.com` are not. */
	allows(host: string): boolean {
		return host === this.domain || host.endsWith(`.${this.domain}`);
	}

	/** The normalised host, or a ScopeError saying why it is refused. */
	check(value: unknown): string {
		const host = normalizeHost(value);
		if (!this.allows(host)) throw new ScopeError(`${host} is out of scope: only ${this.domain} and its subdomains are`);
		return host;
	}

	describe(): string[] {
		return [this.domain, `*.${this.domain}`];
	}
}

/**
 * The noise governor: at most one action per `minGapMs` for each host. Waiting can be cut short by
 * a stop. The clock and the wait are injected so tests take no time.
 */
export class RateLimiter {
	private readonly last = new Map<string, number>();
	readonly minGapMs: number;
	private readonly now: () => number;
	private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;

	constructor(minGapMs: number, now: () => number = Date.now, sleep: (ms: number, signal?: AbortSignal) => Promise<void> = abortableSleep) {
		this.minGapMs = Math.max(0, minGapMs);
		this.now = now;
		this.sleep = sleep;
	}

	/** Waits until `host` may be contacted again; returns how long it waited. */
	async wait(host: string, signal?: AbortSignal): Promise<number> {
		const now = this.now();
		const ready = (this.last.get(host) ?? -Infinity) + this.minGapMs;
		const delay = Math.max(0, ready - now);
		this.last.set(host, now + delay);
		if (delay > 0) await this.sleep(delay, signal);
		return delay;
	}
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve) => {
		if (signal?.aborted) return resolve();
		const timer = setTimeout(done, ms);
		function done() {
			clearTimeout(timer);
			signal?.removeEventListener("abort", done);
			resolve();
		}
		signal?.addEventListener("abort", done, { once: true });
	});
}
