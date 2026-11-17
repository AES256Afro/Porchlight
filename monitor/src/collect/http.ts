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
	  }
	| { ok: false; error: string };

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
		const probe: HttpProbe = {
			ok: true,
			status: res.status,
			html: (res.headers.get("content-type") ?? "").toLowerCase().includes("text/html"),
			present: SECURITY_HEADERS.filter((header) => res.headers.has(header)),
			frameAncestors: /(^|;)\s*frame-ancestors\s/i.test(
				res.headers.get("content-security-policy") ?? "",
			),
		};
		await res.body?.cancel();
		return probe;
	} catch (err) {
		return { ok: false, error: errorMessage(err) };
	}
}
