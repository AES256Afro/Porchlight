/**
 * A fake Cloudflare account for tests: Cloudflare's API and its DNS-over-HTTPS resolver, answering
 * from fixed data. Nothing touches the network. Secret-shaped values are assembled at run time, so
 * this repository's own secret scan has nothing to find.
 */
import { MANAGED_RULESETS } from "../src/cloudflare/rules.ts";

/** A Cloudflare user token's shape: a prefix, 40 characters and a checksum. */
export function fakeCloudflareToken(): string {
	return ["cfut", "_", "Q9xR2mT7vL4pZ8nB", "3kW6cY1hF5jD0sA9", "gE2uN7qX", "4mPd"].join("");
}

export const ACCOUNT_ID = "0a1b2c3d4e5f60718293a4b5c6d7e8f9";
export const FREE_ZONE = "11111111111111111111111111111111";
export const PRO_ZONE = "22222222222222222222222222222222";
export const SELF_TOKEN_ID = "33333333333333333333333333333333";
/** The token this computer keeps for free.example's ownership record. */
const HEX = ["abcdef", "0123456789"].join("");
export const OWNERSHIP_TOKEN = HEX.repeat(3);
export const HOSTILE = "<script>alert(1)</script>";

const DAY = 86_400_000;

export interface FakeOptions {
	/** Answer 403 to every zone-settings read, as for a token without "Zone Settings Read". */
	denySettings?: boolean;
	/** Answer 401 at /user/tokens/verify, as for an account-owned token. */
	accountToken?: boolean;
	/** Whether free.example's challenge record holds the ownership token. */
	owned?: boolean;
	/** Answer 403 to every change of a zone setting, as for a token without "Zone Settings Write". */
	denySettingWrites?: boolean;
	/** The account's name, as Cloudflare gives it: "<email>'s Account" for a personal one. */
	accountName?: string;
	now?: Date;
	/** Adds this many A records to free.example, so its record list runs to many pages. */
	manyRecords?: number;
	/** Lists answer without `result_info.total_pages`, as some of Cloudflare's lists do. */
	noTotalPages?: boolean;
	/** Answer HTTP 429 to the first `times` requests for this API path (after /client/v4), with this Retry-After. */
	rateLimit?: { path: string; times: number; retryAfter?: string };
	/** Answer HTTP 500 to the list of uploaded certificates. */
	failCustomCertificates?: boolean;
	/** pro.example is a CNAME (partial) setup: its DNS is served by another provider. */
	partialPro?: boolean;
	/** Answer HTTP 403 to /accounts. */
	denyAccounts?: boolean;
	/** Answer HTTP 403 to free.example's DNS records, and give pro.example a CNAME into free.example. */
	crossZoneUnread?: boolean;
	/** free.example's CNAMEs outside the account point at these names instead. */
	outsideTargets?: string[];
	/** pro.example's DMARC record is a CNAME to a reporting service. */
	dmarcByCname?: boolean;
	/** free.example has a wildcard and a CNAME to a name only the wildcard answers for. */
	wildcard?: boolean;
	/** One answer in an unexpected shape: Universal SSL's settings as null, or a DNS record without a name. */
	malformed?: "universal" | "record";
}

export interface Sent {
	method: string;
	host: string;
	path: string;
	query: string;
	authorization: string | null;
	body: unknown;
}

function envelope(result: unknown, status = 200): Response {
	return Response.json({ success: status < 400, errors: status < 400 ? [] : [{ code: status, message: status === 403 ? "Unauthorized to access requested resource" : status === 429 ? "Rate limited" : "Not found" }], messages: [], result, result_info: { page: 1, total_pages: 1 } }, { status });
}

/** One page of a list, as Cloudflare pages it: `page` and `per_page` in the query, `total_pages` in the answer. */
function paged(items: unknown[], url: URL, totalPages = true): Response {
	const perPage = Number(url.searchParams.get("per_page") ?? "20");
	const page = Number(url.searchParams.get("page") ?? "1");
	const total = Math.max(1, Math.ceil(items.length / perPage));
	const info = totalPages ? { page, per_page: perPage, total_pages: total, total_count: items.length } : { page, per_page: perPage };
	return Response.json({ success: true, errors: [], messages: [], result: items.slice((page - 1) * perPage, page * perPage), result_info: info });
}

export function fakeCloudflare(options: FakeOptions = {}) {
	const now = options.now ?? new Date("2026-11-19T12:00:00Z");
	const iso = (days: number) => new Date(now.getTime() + days * DAY).toISOString();
	const sent: Sent[] = [];
	const settings: Record<string, Record<string, unknown>> = {
		[FREE_ZONE]: {
			ssl: "flexible",
			always_use_https: "off",
			min_tls_version: "1.0",
			tls_1_3: "on",
			security_header: { strict_transport_security: { enabled: false, max_age: 0 } },
			automatic_https_rewrites: "on",
			security_level: "medium",
			browser_check: "on",
			tls_client_auth: "off",
		},
		[PRO_ZONE]: {
			ssl: "strict",
			ssl_automatic_mode: "custom",
			always_use_https: "on",
			min_tls_version: "1.2",
			tls_1_3: "zrt",
			security_header: { strict_transport_security: { enabled: true, max_age: 31_536_000, include_subdomains: true, preload: false } },
			automatic_https_rewrites: "on",
			security_level: "medium",
			browser_check: "on",
			tls_client_auth: "on",
		},
	};
	const records: Record<string, unknown[]> = {
		[FREE_ZONE]: [
			{ type: "A", name: "free.example", content: "203.0.113.10", proxied: true },
			{ type: "A", name: "direct.free.example", content: "203.0.113.10", proxied: false },
			{ type: "A", name: "nas.free.example", content: "10.0.0.5", proxied: false },
			{ type: "CNAME", name: "old.free.example", content: "gone-shop.herokuapp.com", proxied: false },
			{ type: "CNAME", name: "docs.free.example", content: "free-docs.readthedocs.io", proxied: true },
			{ type: "CNAME", name: "www.free.example", content: "missing.free.example", proxied: true },
			{ type: "MX", name: "free.example", content: "mx.mail.example", proxied: false },
			{ type: "TXT", name: "free.example", content: '"v=spf1 include:_spf.mail.example ~all"' },
			{ type: "TXT", name: "_dmarc.free.example", content: `"v=DMARC1; p=none; rua=mailto:${HOSTILE}@free.example"` },
			{ type: "TXT", name: "_porchlight-challenge.free.example", content: `"porchlight-verify=${OWNERSHIP_TOKEN}"` },
		],
		[PRO_ZONE]: [
			...(options.crossZoneUnread ? [{ type: "CNAME", name: "shop.pro.example", content: "shop.free.example", proxied: true }] : []),
			{ type: "A", name: "pro.example", content: "198.51.100.7", proxied: true },
			{ type: "CNAME", name: "status.pro.example", content: "pro.statuspage.example", proxied: false },
			{ type: "CAA", name: "pro.example", content: '0 issue "letsencrypt.org"' },
			{ type: "MX", name: "pro.example", content: "mx.mail.example", proxied: false },
			{ type: "TXT", name: "pro.example", content: '"v=spf1 include:_spf.mail.example -all"' },
			options.dmarcByCname ? { type: "CNAME", name: "_dmarc.pro.example", content: "pro-example.dmarc.reports.example", proxied: false } : { type: "TXT", name: "_dmarc.pro.example", content: '"v=DMARC1; p=reject"' },
			{ type: "TXT", name: "s1._domainkey.pro.example", content: '"v=DKIM1; k=rsa; p=MIIB"' },
		],
	};
	const free = records[FREE_ZONE]!;
	if (options.outsideTargets) {
		records[FREE_ZONE] = free.filter((record) => !["old.free.example", "docs.free.example"].includes((record as { name: string }).name));
		for (const [i, target] of options.outsideTargets.entries()) records[FREE_ZONE].push({ type: "CNAME", name: `t${i}.free.example`, content: target, proxied: false });
	}
	if (options.wildcard) records[FREE_ZONE]!.push({ type: "A", name: "*.free.example", content: "203.0.113.10", proxied: true }, { type: "CNAME", name: "app.free.example", content: "a.b.free.example", proxied: true });
	for (let i = 0; i < (options.manyRecords ?? 0); i++) records[FREE_ZONE]!.push({ type: "A", name: `host${i}.free.example`, content: "203.0.113.10", proxied: true });
	if (options.malformed === "record") records[FREE_ZONE]!.push({ type: "A", content: "203.0.113.11", proxied: true });
	let rateLimited = 0;
	const list = (items: unknown[], url: URL) => paged(items, url, !options.noTotalPages);
	const tokens = [
		{
			id: "44444444444444444444444444444444",
			name: "ci deploy",
			status: "active",
			issued_on: iso(-400),
			last_used_on: iso(-2),
			policies: [{ effect: "allow", resources: { "com.cloudflare.api.account.zone.*": "*" }, permission_groups: [{ name: "Zone Settings Write" }, { name: "DNS Write" }] }],
		},
		{ id: "55555555555555555555555555555555", name: "old script", status: "active", issued_on: iso(-500), last_used_on: iso(-300), expires_on: iso(30), policies: [{ effect: "allow", resources: { [`com.cloudflare.api.account.zone.${PRO_ZONE}`]: "*" }, permission_groups: [{ name: "DNS Read" }] }] },
	];
	const userTokens = [{ id: SELF_TOKEN_ID, name: "Porchlight audit", status: "active", issued_on: iso(-900), policies: [{ effect: "allow", resources: { "com.cloudflare.api.account.zone.*": "*" }, permission_groups: [{ name: "Zone Read" }] }] }];
	const members = [
		{ status: "accepted", user: { email: "alex@example.com", two_factor_authentication_enabled: false }, roles: [{ name: "Super Administrator - All Privileges" }] },
		{ status: "accepted", user: { email: "sam@example.com", two_factor_authentication_enabled: true }, roles: [{ name: "Administrator" }] },
	];
	// As a real account answers with status=all: the certificate in use, the backup Cloudflare keeps beside every
	// Universal one (issued, not deployed), and an old pack on its way out. Only the first is what visitors get.
	const pack = (hosts: string[], days: number) => [
		{ type: "universal", status: "backup_issued", hosts, certificates: [{ expires_on: iso(5), status: "backup_issued" }] },
		{ type: "universal", status: "active", hosts, certificates: [{ expires_on: iso(days), status: "active" }] },
		{ type: "universal", status: "pending_deletion", hosts, certificates: [{ expires_on: iso(-9), status: "expired" }] },
	];

	const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(String(input instanceof Request ? input.url : input));
		const headers = new Headers(init?.headers);
		const method = init?.method ?? "GET";
		const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
		sent.push({ method, host: url.host, path: url.pathname, query: url.search, authorization: headers.get("authorization"), body });

		if (url.host === "cloudflare-dns.com") {
			const name = url.searchParams.get("name") ?? "";
			if (name === "_porchlight-challenge.free.example") {
				return Response.json({ Status: 0, Answer: options.owned === false ? [] : [{ name, type: 16, data: `"porchlight-verify=${OWNERSHIP_TOKEN}"` }] });
			}
			if (name.startsWith("_")) return Response.json({ Status: 3 });
			if (name === "gone-shop.herokuapp.com") return Response.json({ Status: 3 });
			return Response.json({ Status: 0, Answer: [{ name, type: 1, data: "192.0.2.1" }] });
		}
		if (url.host !== "api.cloudflare.com" || !url.pathname.startsWith("/client/v4/")) return new Response("refused", { status: 599 });
		const path = url.pathname.slice("/client/v4".length);
		if (options.rateLimit && path === options.rateLimit.path && rateLimited < options.rateLimit.times) {
			rateLimited++;
			const response = envelope(null, 429);
			if (options.rateLimit.retryAfter !== undefined) response.headers.set("retry-after", options.rateLimit.retryAfter);
			return response;
		}

		if (method !== "GET") {
			const change = /^\/zones\/([0-9a-f]{32})\/(dns_records|settings\/[a-z_0-9]+|bot_management|dnssec)$/.exec(path);
			if (change && options.denySettingWrites && change[2]?.startsWith("settings/")) return envelope(null, 403);
			return change ? envelope({ id: "66666666666666666666666666666666", ...(body as object) }) : envelope(null, 404);
		}
		if (path === "/user/tokens/verify") return options.accountToken ? envelope(null, 401) : envelope({ id: SELF_TOKEN_ID, status: "active" });
		if (path === `/accounts/${ACCOUNT_ID}/tokens/verify`) return envelope({ id: SELF_TOKEN_ID, status: "active", expires_on: iso(90) });
		if (path === "/accounts") return options.denyAccounts ? envelope(null, 403) : list([{ id: ACCOUNT_ID, name: options.accountName ?? "Owner's account" }], url);
		if (path === "/zones") {
			return list(
				[
					{ id: FREE_ZONE, name: "free.example", status: "active", paused: false, type: "full", plan: { legacy_id: "free", name: "Free Website" }, account: { id: ACCOUNT_ID, name: "Owner's account" } },
					{ id: PRO_ZONE, name: "pro.example", status: "active", paused: false, type: options.partialPro ? "partial" : "full", plan: { legacy_id: "pro", name: "Pro Website" }, account: { id: ACCOUNT_ID, name: "Owner's account" } },
				],
				url,
			);
		}
		if (path === `/accounts/${ACCOUNT_ID}/members`) return list(members, url);
		if (path === `/accounts/${ACCOUNT_ID}/tokens`) return list(tokens, url);
		if (path === "/user/tokens") return list(userTokens, url);

		const zone = /^\/zones\/([0-9a-f]{32})(\/.*)$/.exec(path);
		if (!zone) return envelope(null, 404);
		const [, id, rest] = zone as unknown as [string, string, string];
		const setting = /^\/settings\/([a-z_0-9]+)$/.exec(rest);
		if (setting) {
			if (options.denySettings) return envelope(null, 403);
			const value = settings[id]?.[setting[1]!];
			return value === undefined ? envelope(null, 404) : envelope({ id: setting[1], value });
		}
		if (rest === "/dnssec") return envelope({ status: id === PRO_ZONE ? "active" : "disabled" });
		if (rest === "/ssl/universal/settings") return envelope(options.malformed === "universal" ? null : { enabled: true });
		if (rest === "/ssl/certificate_packs") return envelope(id === PRO_ZONE ? pack(["pro.example", "*.pro.example"], 70) : pack(["free.example", "*.free.example"], 10));
		if (rest === "/custom_certificates") return options.failCustomCertificates ? envelope(null, 500) : list([], url);
		if (rest === "/dns_records") return options.crossZoneUnread && id === FREE_ZONE ? envelope(null, 403) : list(records[id] ?? [], url);
		if (rest === "/rulesets/phases/http_request_firewall_managed/entrypoint") {
			return id === PRO_ZONE ? envelope({ rules: [{ action: "execute", enabled: true, action_parameters: { id: MANAGED_RULESETS.owasp } }] }) : envelope(null, 404);
		}
		if (rest === "/bot_management") return id === PRO_ZONE ? envelope(null, 403) : envelope({ fight_mode: false });
		if (rest === "/origin_tls_client_auth/settings") return envelope({ enabled: false });
		return envelope(null, 404);
	}) as typeof fetch;

	// `settings` is live: a test changes a value as the owner would in Cloudflare's dashboard.
	return { fetchFn, sent, now, settings };
}
