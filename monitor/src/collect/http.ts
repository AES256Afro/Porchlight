import { errorMessage, USER_AGENT, type FetchFn } from "../env.ts";

export const SECURITY_HEADERS = [
	"strict-transport-security",
	"content-security-policy",
	"x-content-type-options",
	"x-frame-options",
	"referrer-policy",
	"permissions-policy",
] as const;
export type SecurityHeader = (typeof SECURITY_HEADERS)[number];

export type HttpProbe =
	| {
			ok: true;
			status: number;
			/** Whether the response declared an HTML body; decides which headers are expected. */
			html: boolean;
			present: SecurityHeader[];
			/** CSP `frame-ancestors` does the job of X-Frame-Options. */
			frameAncestors: boolean;
			/** What the Strict-Transport-Security header said, when it was sent. Absent from older snapshots. */
			hsts?: HstsPolicy;
			/** The cookies the response set: names and flags, never a value. Absent from older snapshots. */
			cookies?: CookieFlags[];
	  }
	| { ok: false; error: string };

export interface HstsPolicy {
	/** Seconds browsers remember to use HTTPS; null when the header gave none it could read. */
	maxAge: number | null;
	includeSubDomains: boolean;
}

export interface CookieFlags {
	name: string;
	secure: boolean;
	httpOnly: boolean;
}

/** Cookies kept from one response; a site that sets more than this is summarised by the first ones. */
const MAX_COOKIES = 20;

/** `max-age=63072000; includeSubDomains` as its settings. */
export function parseHsts(header: string): HstsPolicy {
	const maxAge = /(?:^|;)\s*max-age\s*=\s*"?(\d{1,12})"?\s*(?:;|$)/i.exec(header)?.[1];
	return {
		maxAge: maxAge === undefined ? null : Number(maxAge),
		includeSubDomains: /(?:^|;)\s*includeSubDomains\s*(?:;|$)/i.test(header),
	};
}

/** The name and flags of one Set-Cookie header. The value is read past and never kept. */
export function parseCookie(header: string): CookieFlags | null {
	const [pair = "", ...attributes] = header.split(";");
	const name = pair.slice(0, Math.max(0, pair.indexOf("="))).trim();
	// A cookie name is a token of printable characters; anything else is not one to report.
	if (!/^[\x21-\x7e]{1,64}$/.test(name)) return null;
	const flags = attributes.map((attribute) => attribute.trim().toLowerCase());
	return { name, secure: flags.includes("secure"), httpOnly: flags.includes("httponly") };
}

/**
 * One GET of the host's front page, as any browser would make. Redirects are
 * not followed, so the probe never leaves the verified domain.
 */
export async function probeHttps(host: string, fetchFn: FetchFn): Promise<HttpProbe> {
	try {
		const res = await fetchFn(`https://${host}/`, {
			redirect: "manual",
			headers: { "user-agent": USER_AGENT },
			signal: AbortSignal.timeout(10_000),
		});
		const probe: Extract<HttpProbe, { ok: true }> = {
			ok: true,
			status: res.status,
			html: (res.headers.get("content-type") ?? "").toLowerCase().includes("text/html"),
			present: SECURITY_HEADERS.filter((header) => res.headers.has(header)),
			frameAncestors: /(^|;)\s*frame-ancestors\s/i.test(
				res.headers.get("content-security-policy") ?? "",
			),
		};
		// Read from the same response: no further request is made for either.
		const hsts = res.headers.get("strict-transport-security");
		if (hsts !== null) probe.hsts = parseHsts(hsts);
		const cookies = res.headers
			.getSetCookie()
			.slice(0, MAX_COOKIES)
			.map(parseCookie)
			.filter((cookie) => cookie !== null);
		if (cookies.length > 0) probe.cookies = cookies;
		await res.body?.cancel();
		return probe;
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}
}
