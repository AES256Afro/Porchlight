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
			/**
			 * Where a redirect pointed, as its scheme and host alone (a path or query can carry a token).
			 * Read from the response's Location header and never followed (invariant 2). Absent: the
			 * response was not a redirect, named no place, or an older snapshot.
			 */
			redirect?: RedirectTarget;
			/** Headers that name the server software with a version, as sent (cut short). Absent: none. */
			revealing?: RevealingHeader[];
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

export interface RedirectTarget {
	scheme: string;
	/** Lower case; "" when the Location header named no host it could be read for. */
	host: string;
}

/** Response headers that can name the software behind a site, and its version. */
export const REVEALING_HEADERS = [
	"server",
	"x-powered-by",
	"x-aspnet-version",
	"x-aspnetmvc-version",
	"x-generator",
] as const;

export interface RevealingHeader {
	header: (typeof REVEALING_HEADERS)[number];
	value: string;
}

/** The most of a header value kept: enough for "Apache/2.4.41 (Ubuntu) OpenSSL/1.1.1f". */
const MAX_HEADER_VALUE = 80;

/** A value that names a version: digits with a dot, such as nginx/1.18.0 or PHP/8.1.2. */
const VERSION = /\d+\.\d+/;

/** The header's value if it names a version, cut short and reduced to printable characters; else null. */
export function revealingValue(value: string | null): string | null {
	if (value === null) return null;
	const printable = value
		.replace(/[^\x20-\x7e]/g, "")
		.trim()
		.slice(0, MAX_HEADER_VALUE);
	return VERSION.test(printable) ? printable : null;
}

/** A Location header as a scheme and host only, read against the page it came from. */
export function redirectTarget(location: string, host: string): RedirectTarget | null {
	try {
		const url = new URL(location.trim(), `https://${host}/`);
		return {
			scheme: url.protocol.replace(/:$/, "").toLowerCase(),
			host: url.hostname.toLowerCase(),
		};
	} catch {
		return null;
	}
}

/**
 * Whether a failed probe failed at TLS itself (the certificate or the handshake), as opposed to a
 * timeout or a refused connection, which say nothing about the certificate (invariant 5).
 */
export function tlsFailure(error: string): boolean {
	if (/timed? ?out|timeout|abort/i.test(error)) return false;
	return /certificate|\bssl\b|\btls\b|handshake/i.test(error);
}

/**
 * Cloudflare's answers when it could not make a secure connection onward: 525, the TLS handshake
 * failed; 526, the certificate is not valid. A Worker's own fetch answers these too when the site's
 * certificate or handshake fails, so they are definite, unlike a timeout.
 */
export const TLS_FAILURE_STATUS: Record<number, string> = {
	525: "the TLS handshake failed",
	526: "the certificate is not valid",
};

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
		const location = res.headers.get("location");
		if (res.status >= 300 && res.status < 400 && location) {
			const target = redirectTarget(location, host);
			if (target) probe.redirect = target;
		}
		const revealing = REVEALING_HEADERS.flatMap((header) => {
			const value = revealingValue(res.headers.get(header));
			return value === null ? [] : [{ header, value }];
		});
		if (revealing.length > 0) probe.revealing = revealing;
		await res.body?.cancel();
		return probe;
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}
}
