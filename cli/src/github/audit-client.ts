/**
 * GitHub's API for the settings audit (invariant 24). Every address comes from `auditAddress` in
 * github.ts; this file only sends GET requests to them, with the token as the Authorization header and
 * nowhere else. GitHub's own words in an error are scrubbed of the token and cut short.
 *
 * GitHub's rate limit answers 429, or 403 with `x-ratelimit-remaining: 0` or `retry-after`. A read is
 * asked again after the wait GitHub names, at most `MAX_RETRIES` times and never longer than
 * `MAX_WAIT_MS` a time; past that, and for every later read of the same audit, the answer is "limited",
 * which the rules show as Could not check (invariant 5).
 */
import { apiHeaders } from "./github.ts";

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 2;
export const MAX_WAIT_MS = 60_000;
const DEFAULT_WAIT_MS = 10_000;
/** Pages read from one list at most: 1,000 items at 100 a page. */
export const MAX_PAGES = 10;
export const PER_PAGE = 100;

/**
 * - `denied`: the token may not read it (403, or 404 where GitHub hides what a token cannot see).
 * - `missing`: GitHub has nothing there (404). What that means depends on the read.
 * - `unavailable`: GitHub does not offer it for this repository (its plan says so).
 * - `limited`: the rate limit stopped it.
 * - `refused`: GitHub refused the token itself (401).
 * - `failed`: no answer, or one that was not understood.
 */
export type GhFailure = "denied" | "missing" | "unavailable" | "limited" | "refused" | "failed";

/** `nextAfter`: the cursor of the next page, where GitHub pages a list by cursor (its Link header), checked to stay on the same address. */
export type GhAnswer<T> = { ok: true; status: number; value: T; truncated?: boolean; nextAfter?: string } | { ok: false; status: number; kind: GhFailure; message: string };

export class GhClient {
	readonly #token: string;
	readonly #fetch: typeof fetch;
	readonly #sleep: Sleep;
	readonly #now: () => number;
	#limited = false;
	/** Every request made, as its path and query: for tests and the audit's own record. Never the token. */
	readonly requests: string[] = [];

	constructor(token: string, fetchFn: typeof fetch = fetch, sleep: Sleep = realSleep, now: () => number = Date.now) {
		this.#token = token;
		this.#fetch = fetchFn;
		this.#sleep = sleep;
		this.#now = now;
	}

	/** Whether the rate limit stopped a read in this audit. */
	get limited(): boolean {
		return this.#limited;
	}

	async get<T>(url: URL): Promise<GhAnswer<T>> {
		for (let attempt = 0; ; attempt++) {
			if (this.#limited) return { ok: false, status: 429, kind: "limited", message: "GitHub's rate limit was reached; audit again later" };
			const { wait, ...answer } = await this.#once<T>(url);
			if (wait === undefined) return answer as GhAnswer<T>;
			// A wait longer than the bound, or one asked once too often, ends the audit's reading.
			if (wait > MAX_WAIT_MS || attempt >= MAX_RETRIES) {
				this.#limited = true;
				continue;
			}
			await this.#sleep(wait);
		}
	}

	/**
	 * Every page of a list, up to MAX_PAGES. A failed page fails the whole list: half a list is not the
	 * list. One longer than that comes back marked `truncated`, never as if it were whole.
	 */
	async list<T>(page: (n: number) => URL): Promise<GhAnswer<T[]>> {
		const all: T[] = [];
		for (let n = 1; n <= MAX_PAGES; n++) {
			const answer = await this.get<unknown>(page(n));
			if (!answer.ok) return answer;
			// A list that is not a list was not understood: it is never read as an empty one (invariant 5).
			if (!Array.isArray(answer.value)) return { ok: false, status: answer.status, kind: "failed", message: "GitHub's answer was not a list" };
			all.push(...(answer.value as T[]));
			if (answer.value.length < PER_PAGE) return { ok: true, status: answer.status, value: all };
		}
		return { ok: true, status: 200, value: all, truncated: true };
	}

	/**
	 * Every page of a list GitHub pages by cursor rather than by number (Dependabot alerts refuse `page`),
	 * up to MAX_PAGES, with the same rules as `list`: a failed page fails the whole list.
	 */
	async cursorList<T>(page: (after: string | null) => URL): Promise<GhAnswer<T[]>> {
		const all: T[] = [];
		let after: string | null = null;
		for (let n = 1; n <= MAX_PAGES; n++) {
			const answer: GhAnswer<unknown> = await this.get<unknown>(page(after));
			if (!answer.ok) return answer;
			if (!Array.isArray(answer.value)) return { ok: false, status: answer.status, kind: "failed", message: "GitHub's answer was not a list" };
			all.push(...(answer.value as T[]));
			if (!answer.nextAfter) return { ok: true, status: answer.status, value: all };
			after = answer.nextAfter;
		}
		return { ok: true, status: 200, value: all, truncated: true };
	}

	async #once<T>(url: URL): Promise<GhAnswer<T> & { wait?: number }> {
		this.requests.push(`GET ${url.pathname}${url.search}`);
		let response: Response;
		try {
			response = await this.#fetch(url, { method: "GET", headers: apiHeaders(this.#token), redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
		} catch (err) {
			return { ok: false, status: 0, kind: "failed", message: this.#scrub(`Could not reach GitHub: ${err instanceof Error ? err.message : String(err)}`) };
		}
		const text = await response.text().catch(() => "");
		let data: unknown = null;
		try {
			data = text === "" ? null : JSON.parse(text);
		} catch {
			if (response.ok) return { ok: false, status: response.status, kind: "failed", message: "GitHub's answer was not JSON" };
		}
		if (response.ok) {
			// The next page's cursor, only from a link to this same address: nothing else in the answer becomes a request.
			const next = /<([^>]+)>\s*;\s*rel="next"/.exec(response.headers.get("link") ?? "")?.[1];
			let nextAfter: string | undefined;
			try {
				const link = next ? new URL(next) : null;
				const cursor = link?.searchParams.get("after");
				if (link && link.origin === url.origin && link.pathname === url.pathname && cursor) nextAfter = cursor;
			} catch {
				// A link that is not an address is not followed.
			}
			return { ok: true, status: response.status, value: data as T, ...(nextAfter ? { nextAfter } : {}) };
		}

		const said = typeof (data as { message?: unknown } | null)?.message === "string" ? this.#scrub((data as { message: string }).message) : "";
		const message = `GitHub answered HTTP ${response.status}${said ? `: ${said}` : ""}`;
		const retryAfter = response.headers.get("retry-after");
		const remaining = response.headers.get("x-ratelimit-remaining");
		if (response.status === 429 || (response.status === 403 && (remaining === "0" || retryAfter !== null || /rate limit/i.test(said)))) {
			return { ok: false, status: response.status, kind: "limited", message, wait: this.#waitFor(retryAfter, remaining === "0" ? response.headers.get("x-ratelimit-reset") : null) };
		}
		if (response.status === 401) return { ok: false, status: 401, kind: "refused", message: "GitHub refused the token. It may have expired or been revoked: make a new one and replace it." };
		if (response.status === 403 && /upgrade to github pro|make this repository public|advanced security|not available for this repository|plan does not/i.test(said)) {
			return { ok: false, status: 403, kind: "unavailable", message };
		}
		if (response.status === 403) return { ok: false, status: 403, kind: "denied", message };
		if (response.status === 404) return { ok: false, status: 404, kind: "missing", message };
		return { ok: false, status: response.status, kind: "failed", message };
	}

	/** How long GitHub asks to wait: Retry-After in seconds, else until the limit resets. */
	#waitFor(retryAfter: string | null, reset: string | null): number {
		if (retryAfter !== null && /^\d{1,6}$/.test(retryAfter.trim())) return Number(retryAfter.trim()) * 1000;
		if (reset !== null && /^\d{1,12}$/.test(reset.trim())) return Math.max(0, Number(reset.trim()) * 1000 - this.#now());
		return DEFAULT_WAIT_MS;
	}

	/** GitHub never echoes a token, but nothing that might hold it is passed on; control characters go too. */
	#scrub(text: string): string {
		return text
			.split(this.#token)
			.join("[token]")
			.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
			.slice(0, 200);
	}
}
