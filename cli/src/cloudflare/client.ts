/**
 * Cloudflare's API, reached only at the fixed address `CLOUDFLARE_API`. The owner's token travels as
 * the Authorization header and nowhere else: never in an address, a log, a report or a message, and
 * any error text is scrubbed of it. Paths are built here from fixed templates and IDs that match
 * Cloudflare's 32-hex-digit form; nothing from a request becomes an address.
 */

export const CLOUDFLARE_API = "https://api.cloudflare.com/client/v4";
const API_ORIGIN = "https://api.cloudflare.com";
const API_PATH = "/client/v4/";
const ID = /^[0-9a-f]{32}$/;
/** Cloudflare's token formats: `cfut_`/`cfat_` and 40 characters and a checksum, or 40 characters before 2026. */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{30,200}$/;
const TIMEOUT_MS = 15_000;
/** Pages read from one list at most, so a huge account cannot keep an audit running for ever. */
const MAX_PAGES = 40;

export type CfAnswer<T> =
	| { ok: true; result: T }
	| {
			ok: false;
			status: number;
			/** The token may not read or change this (401 or 403). */
			denied: boolean;
			/** Cloudflare has nothing there (404). */
			missing: boolean;
			message: string;
	  };

/** What a token is, as Cloudflare said when asked. */
export interface TokenCheck {
	ok: boolean;
	id?: string;
	status?: string;
	expiresOn?: string;
	kind: "user" | "account";
	message?: string;
}

/** Whether a string is shaped like a Cloudflare API token. It says nothing about whether it works. */
export function tokenShapeProblem(token: string): string | null {
	if (!TOKEN_SHAPE.test(token)) return "That is not a Cloudflare API token: it is 40 or more letters, digits, dashes or underscores, with no spaces";
	return null;
}

export function isCloudflareId(value: unknown): value is string {
	return typeof value === "string" && ID.test(value);
}

/** A path under one zone. The zone ID must be Cloudflare's own form; the rest is a fixed string from this code. */
export function zonePath(zoneId: string, rest: string): string {
	if (!ID.test(zoneId)) throw new Error("Not a Cloudflare zone ID");
	return `/zones/${zoneId}${rest}`;
}

/** A path under one account, built the same way. */
export function accountPath(accountId: string, rest: string): string {
	if (!ID.test(accountId)) throw new Error("Not a Cloudflare account ID");
	return `/accounts/${accountId}${rest}`;
}

export class CfClient {
	readonly #token: string;
	readonly #fetch: typeof fetch;
	readonly #timeoutMs: number;
	/** Every request made, as method and path: for tests and for the audit's own record. Never the token. */
	readonly requests: string[] = [];

	constructor(token: string, fetchFn: typeof fetch = fetch, timeoutMs = TIMEOUT_MS) {
		const problem = tokenShapeProblem(token);
		if (problem) throw new Error(problem);
		this.#token = token;
		this.#fetch = fetchFn;
		this.#timeoutMs = timeoutMs;
	}

	/** The full address of a path, always under the fixed API address. */
	static url(path: string, query: Record<string, string> = {}): URL {
		if (!/^\/[A-Za-z0-9_./-]+$/.test(path) || path.includes("..") || path.includes("//")) throw new Error("Not an API path");
		const url = new URL(`${CLOUDFLARE_API}${path}`);
		if (url.origin !== API_ORIGIN || !url.pathname.startsWith(API_PATH)) throw new Error("Not Cloudflare's API");
		for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
		return url;
	}

	get<T>(path: string, query: Record<string, string> = {}): Promise<CfAnswer<T>> {
		return this.#call<T>("GET", path, query, undefined);
	}

	/** A change. Only `apply.ts` calls this, and only once the owner has approved the exact request. */
	send<T>(method: "POST" | "PATCH" | "PUT", path: string, body: unknown): Promise<CfAnswer<T>> {
		return this.#call<T>(method, path, {}, body);
	}

	/** Every page of a list, up to MAX_PAGES. A failed page fails the whole list: half a list is not a list. */
	async list<T>(path: string, query: Record<string, string> = {}, perPage = 50): Promise<CfAnswer<T[]>> {
		const all: T[] = [];
		for (let page = 1; page <= MAX_PAGES; page++) {
			const answer = await this.#call<T[]>("GET", path, { ...query, page: String(page), per_page: String(perPage) }, undefined, true);
			if (!answer.ok) return answer;
			const { items, totalPages } = answer.result as unknown as { items: T[]; totalPages: number };
			all.push(...items);
			if (page >= totalPages || items.length === 0) break;
		}
		return { ok: true, result: all };
	}

	/**
	 * Asks Cloudflare what this token is. A user token answers at /user/tokens/verify; an account
	 * token only under its account, so each account the token can see is asked in turn.
	 */
	async verify(): Promise<TokenCheck> {
		const user = await this.get<{ id?: string; status?: string; expires_on?: string }>("/user/tokens/verify");
		if (user.ok) return { ok: user.result.status === "active", id: user.result.id, status: user.result.status, expiresOn: user.result.expires_on, kind: "user" };
		const accounts = await this.list<{ id?: unknown }>("/accounts");
		if (accounts.ok) {
			for (const account of accounts.result) {
				if (!isCloudflareId(account.id)) continue;
				const answer = await this.get<{ id?: string; status?: string; expires_on?: string }>(accountPath(account.id, "/tokens/verify"));
				if (answer.ok) return { ok: answer.result.status === "active", id: answer.result.id, status: answer.result.status, expiresOn: answer.result.expires_on, kind: "account" };
			}
		}
		return { ok: false, kind: "user", message: user.denied ? "Cloudflare did not accept this token. Check that it was copied whole and has not expired or been deleted." : user.message };
	}

	async #call<T>(method: string, path: string, query: Record<string, string>, body: unknown, paged = false): Promise<CfAnswer<T>> {
		const url = CfClient.url(path, query);
		this.requests.push(`${method} ${url.pathname.slice(API_PATH.length - 1)}${url.search}`);
		let response: Response;
		try {
			response = await this.#fetch(url, {
				method,
				headers: {
					authorization: `Bearer ${this.#token}`,
					accept: "application/json",
					...(body === undefined ? {} : { "content-type": "application/json" }),
				},
				...(body === undefined ? {} : { body: JSON.stringify(body) }),
				redirect: "error",
				signal: AbortSignal.timeout(this.#timeoutMs),
			});
		} catch (err) {
			return { ok: false, status: 0, denied: false, missing: false, message: this.#scrub(`Could not reach Cloudflare: ${err instanceof Error ? err.message : String(err)}`) };
		}
		let data: { success?: unknown; result?: unknown; errors?: unknown; result_info?: { total_pages?: unknown } } = {};
		try {
			data = (await response.json()) as typeof data;
		} catch {
			// Reported by its status below.
		}
		if (!response.ok || data.success !== true) {
			const errors = Array.isArray(data.errors) ? (data.errors as { message?: unknown }[]) : [];
			const said = errors.map((error) => (typeof error?.message === "string" ? error.message : "")).filter(Boolean).join("; ");
			return {
				ok: false,
				status: response.status,
				denied: response.status === 401 || response.status === 403,
				missing: response.status === 404,
				message: this.#scrub(`Cloudflare answered HTTP ${response.status}${said ? `: ${said.slice(0, 300)}` : ""}`),
			};
		}
		if (paged) {
			const items = Array.isArray(data.result) ? data.result : [];
			const total = typeof data.result_info?.total_pages === "number" ? data.result_info.total_pages : 1;
			return { ok: true, result: { items, totalPages: total } as unknown as T };
		}
		return { ok: true, result: data.result as T };
	}

	#scrub(text: string): string {
		return text.split(this.#token).join("[token]");
	}
}
