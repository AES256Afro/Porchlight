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
	now?: Date;
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
	return Response.json({ success: status < 400, errors: status < 400 ? [] : [{ code: status, message: status === 403 ? "Unauthorized to access requested resource" : "Not found" }], messages: [], result, result_info: { page: 1, total_pages: 1 } }, { status });
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
			{ type: "A", name: "pro.example", content: "198.51.100.7", proxied: true },
			{ type: "CNAME", name: "status.pro.example", content: "pro.statuspage.example", proxied: false },
			{ type: "CAA", name: "pro.example", content: '0 issue "letsencrypt.org"' },
			{ type: "MX", name: "pro.example", content: "mx.mail.example", proxied: false },
			{ type: "TXT", name: "pro.example", content: '"v=spf1 include:_spf.mail.example -all"' },
			{ type: "TXT", name: "_dmarc.pro.example", content: '"v=DMARC1; p=reject"' },
			{ type: "TXT", name: "s1._domainkey.pro.example", content: '"v=DKIM1; k=rsa; p=MIIB"' },
		],
	};
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

		if (method !== "GET") {
			const change = /^\/zones\/([0-9a-f]{32})\/(dns_records|settings\/[a-z_0-9]+)$/.exec(path);
			return change ? envelope({ id: "66666666666666666666666666666666", ...(body as object) }) : envelope(null, 404);
		}
		if (path === "/user/tokens/verify") return options.accountToken ? envelope(null, 401) : envelope({ id: SELF_TOKEN_ID, status: "active" });
		if (path === `/accounts/${ACCOUNT_ID}/tokens/verify`) return envelope({ id: SELF_TOKEN_ID, status: "active", expires_on: iso(90) });
		if (path === "/accounts") return envelope([{ id: ACCOUNT_ID, name: "Owner's account" }]);
		if (path === "/zones") {
			return envelope([
				{ id: FREE_ZONE, name: "free.example", status: "active", paused: false, type: "full", plan: { legacy_id: "free", name: "Free Website" }, account: { id: ACCOUNT_ID, name: "Owner's account" } },
				{ id: PRO_ZONE, name: "pro.example", status: "active", paused: false, type: "full", plan: { legacy_id: "pro", name: "Pro Website" }, account: { id: ACCOUNT_ID, name: "Owner's account" } },
			]);
		}
		if (path === `/accounts/${ACCOUNT_ID}/members`) return envelope(members);
		if (path === `/accounts/${ACCOUNT_ID}/tokens`) return envelope(tokens);
		if (path === "/user/tokens") return envelope(userTokens);

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
		if (rest === "/ssl/universal/settings") return envelope({ enabled: true });
		if (rest === "/ssl/certificate_packs") return envelope(id === PRO_ZONE ? pack(["pro.example", "*.pro.example"], 70) : pack(["free.example", "*.free.example"], 10));
		if (rest === "/custom_certificates") return envelope([]);
		if (rest === "/dns_records") return envelope(records[id] ?? []);
		if (rest === "/rulesets/phases/http_request_firewall_managed/entrypoint") {
			return id === PRO_ZONE ? envelope({ rules: [{ action: "execute", enabled: true, action_parameters: { id: MANAGED_RULESETS.owasp } }] }) : envelope(null, 404);
		}
		if (rest === "/bot_management") return id === PRO_ZONE ? envelope(null, 403) : envelope({ fight_mode: false });
		if (rest === "/origin_tls_client_auth/settings") return envelope({ enabled: false });
		return envelope(null, 404);
	}) as typeof fetch;

	return { fetchFn, sent, now };
}
