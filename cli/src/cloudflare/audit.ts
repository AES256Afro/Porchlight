/**
 * Reads the owner's Cloudflare account through their token, then runs the built-in rules on what it
 * read. Every request goes to Cloudflare's API (`client.ts`) and only reads, apart from one kind of
 * network lookup: for a zone whose `_porchlight-challenge` record proves it in this audit
 * (`checkOwnership`, invariant 1), the names its CNAME records point at outside the account are
 * looked up over DNS, to find records left pointing at services that are gone.
 */
import { checkOwnership, resolveDoh } from "../investigate/ownership.ts";
import { accountPath, CfClient, isCloudflareId, zonePath, type CfAnswer } from "./client.ts";
import {
	dnsChecks,
	emailChecks,
	firewallChecks,
	maskEmail,
	memberChecks,
	ownershipCheck,
	PERMISSIONS,
	PATHS,
	tlsChecks,
	tokenChecks,
	type AccountContext,
	type ApiToken,
	type BotSettings,
	type CertificatePack,
	type CustomCertificate,
	type DnsRecord,
	type LookupResult,
	type Member,
	type Read,
	type RulesetRule,
	type ZoneData,
} from "./rules.ts";
import { CF_AREAS, CF_PLANS, type CfAccountReport, type CfCheck, type CfPermissionState, type CfPlan, type CfProgress, type CfReport, type CfZoneReport } from "./types.ts";

/** The zone settings the rules read, each with its own request (the batch endpoint is deprecated). */
export const SETTING_IDS = ["ssl", "ssl_automatic_mode", "always_use_https", "min_tls_version", "tls_1_3", "security_header", "automatic_https_rewrites", "security_level", "browser_check", "tls_client_auth"] as const;
/** Zones audited in one run, so an account of thousands does not run for an hour. */
export const MAX_ZONES = 200;
/** Names one zone may have looked up over DNS. */
const MAX_LOOKUPS = 40;

/** What the audit asks the token for, in the words of Cloudflare's token page, and why. */
export const READ_PERMISSIONS: { name: string; scope: "Zone" | "Account" | "User"; purpose: string }[] = [
	{ name: PERMISSIONS.zone, scope: "Zone", purpose: "the list of your domains and their plans" },
	{ name: PERMISSIONS.settings, scope: "Zone", purpose: "SSL/TLS mode, HTTPS, TLS versions, HSTS, Under Attack mode, Browser Integrity Check" },
	{ name: PERMISSIONS.dns, scope: "Zone", purpose: "DNS records (CAA, SPF, DKIM, DMARC, proxied or not) and DNSSEC" },
	{ name: PERMISSIONS.ssl, scope: "Zone", purpose: "Universal SSL, certificates and their expiry, authenticated origin pulls" },
	{ name: PERMISSIONS.waf, scope: "Zone", purpose: "which WAF managed rulesets are deployed" },
	{ name: PERMISSIONS.bots, scope: "Zone", purpose: "Bot Fight Mode and Super Bot Fight Mode" },
	{ name: PERMISSIONS.members, scope: "Account", purpose: "account members, their roles and two-factor authentication" },
	{ name: PERMISSIONS.accountTokens, scope: "Account", purpose: "account-owned API tokens and how broad they are" },
	{ name: PERMISSIONS.userTokens, scope: "User", purpose: "your own API tokens and how broad they are" },
];

/** Permissions that let Porchlight make a change, each only after you approve the exact request. Optional. */
export const WRITE_PERMISSIONS: { name: string; scope: "Zone"; purpose: string }[] = [
	{ name: "DNS Write", scope: "Zone", purpose: "add Porchlight's _porchlight-challenge ownership record, a DMARC record that only reports, and turn on DNSSEC" },
	{ name: "Bot Management Write", scope: "Zone", purpose: "turn on Bot Fight Mode" },
	{ name: "Zone Settings Write", scope: "Zone", purpose: "turn on Always Use HTTPS, TLS 1.3, Automatic HTTPS Rewrites, Browser Integrity Check and HSTS, set the minimum TLS version to 1.2, and set the encryption mode to Full (strict)" },
];

/**
 * A link that opens Cloudflare's "Create token" page with the read permissions already ticked. It is
 * built here from fixed keys, never from a request. Cloudflare drops keys it does not know without
 * saying so, so the page lists every permission in words as well.
 */
export const TOKEN_TEMPLATE_URL = `https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=${encodeURIComponent(
	JSON.stringify(["zone", "zone_settings", "dns", "ssl_and_certificates", "firewall_services", "account_settings", "account_api_tokens"].map((key) => ({ key, type: "read" }))),
)}&accountId=*&zoneId=all&name=${encodeURIComponent("Porchlight audit (read only)")}`;

export interface AuditOptions {
	token: string;
	fetchFn?: typeof fetch;
	/** Look up where CNAME records point, for zones whose ownership record proves them in this audit. */
	lookups: boolean;
	/** The token this computer keeps for each domain's ownership record (investigate-domains.json). */
	ownershipTokens: Record<string, string>;
	onProgress?: (progress: CfProgress) => void;
	now?: () => Date;
	maxZones?: number;
}

export class CloudflareAuditError extends Error {}

interface RawZone {
	id?: unknown;
	name?: unknown;
	status?: unknown;
	paused?: unknown;
	type?: unknown;
	plan?: { legacy_id?: unknown; name?: unknown };
	account?: { id?: unknown; name?: unknown };
}

const NAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function planOf(zone: RawZone): CfPlan {
	const id = typeof zone.plan?.legacy_id === "string" ? zone.plan.legacy_id.toLowerCase() : "";
	if ((CF_PLANS as readonly string[]).includes(id)) return id as CfPlan;
	const name = typeof zone.plan?.name === "string" ? zone.plan.name.toLowerCase() : "";
	return CF_PLANS.find((plan) => name.startsWith(plan)) ?? "unknown";
}

export async function auditCloudflare(options: AuditOptions): Promise<CfReport> {
	const fetchFn = options.fetchFn ?? fetch;
	const now = options.now ?? (() => new Date());
	const client = new CfClient(options.token, fetchFn);
	const evidence = new Map<string, boolean>();
	const note = (permission: string, answer: CfAnswer<unknown>) => {
		if (answer.ok || answer.missing) evidence.set(permission, true);
		else if (answer.denied && !evidence.get(permission)) evidence.set(permission, false);
	};
	const read = <T>(permission: string, answer: CfAnswer<T>, missingAs?: T): Read<T> => {
		note(permission, answer);
		if (answer.ok) return { ok: true, value: answer.result };
		if (answer.missing && missingAs !== undefined) return { ok: true, value: missingAs };
		return { ok: false, denied: answer.denied, message: answer.message };
	};

	const verified = await client.verify();
	if (!verified.ok) throw new CloudflareAuditError(verified.message ?? `Cloudflare says this token is ${verified.status ?? "not active"}`);

	const notCovered: string[] = [
		"The Global API Key and how members sign in (single sign-on, passkeys): Cloudflare's API does not show them.",
		"Firewall custom rules, rate limiting rules, Page Rules and configuration rules: Porchlight reads which managed rules are deployed, not your own rules.",
		"Workers, Pages, R2, Zero Trust and Tunnel settings.",
		"Your origin servers themselves. Porchlight reads Cloudflare's settings; it does not connect to your sites.",
		"DNS at providers other than Cloudflare, and your registrar's settings (registrar lock, contact details).",
	];

	const zoneList = await client.list<RawZone>("/zones", {}, 50);
	note(PERMISSIONS.zone, zoneList);
	if (!zoneList.ok) notCovered.unshift(zoneList.denied ? `Every domain: this token may not list zones. Give it "${PERMISSIONS.zone}".` : `Every domain: Cloudflare did not list the zones (${zoneList.message}).`);
	const rawZones = (zoneList.ok ? zoneList.result : []).filter((zone) => isCloudflareId(zone.id) && typeof zone.name === "string" && NAME.test(zone.name.toLowerCase()));
	const limit = options.maxZones ?? MAX_ZONES;
	const audited = rawZones.slice(0, limit);
	if (rawZones.length > limit) notCovered.unshift(`${rawZones.length - limit} of your ${rawZones.length} zones: an audit covers the first ${limit}.`);

	const total = audited.length + 1;
	const datas: { raw: RawZone; data: ZoneData }[] = [];
	for (const [index, raw] of audited.entries()) {
		const id = raw.id as string;
		const name = (raw.name as string).toLowerCase();
		options.onProgress?.({ done: index, total, current: name });
		const settingReads = await Promise.all(SETTING_IDS.map((setting) => client.get<{ value?: unknown }>(zonePath(id, `/settings/${setting}`))));
		const [dnssec, universal, packs, customs, records, waf, bots, zoneAop] = await Promise.all([
			client.get<{ status?: string }>(zonePath(id, "/dnssec")),
			client.get<{ enabled?: boolean }>(zonePath(id, "/ssl/universal/settings")),
			client.get<CertificatePack[]>(zonePath(id, "/ssl/certificate_packs"), { status: "all" }),
			client.list<CustomCertificate>(zonePath(id, "/custom_certificates"), {}, 50),
			client.list<DnsRecord>(zonePath(id, "/dns_records"), {}, 100),
			client.get<{ rules?: RulesetRule[] }>(zonePath(id, "/rulesets/phases/http_request_firewall_managed/entrypoint")),
			client.get<BotSettings>(zonePath(id, "/bot_management")),
			client.get<{ enabled?: boolean }>(zonePath(id, "/origin_tls_client_auth/settings")),
		]);
		const settings: ZoneData["settings"] = {};
		for (const [i, setting] of SETTING_IDS.entries()) {
			const answer = settingReads[i]!;
			// A setting the zone does not have yet (Automatic SSL/TLS before its roll-out) is simply not there.
			if (!answer.ok && answer.missing) {
				note(PERMISSIONS.settings, answer);
				continue;
			}
			const value = read(PERMISSIONS.settings, answer);
			settings[setting] = value.ok ? { ok: true, value: (value.value as { value?: unknown } | null)?.value } : value;
		}
		const wafRead = read(PERMISSIONS.waf, waf, { rules: [] });
		datas.push({
			raw,
			data: {
				id,
				name,
				plan: planOf(raw),
				type: typeof raw.type === "string" ? raw.type : "full",
				settings,
				dnssec: read(PERMISSIONS.dns, dnssec),
				universalSsl: read(PERMISSIONS.ssl, universal),
				certificatePacks: read(PERMISSIONS.ssl, packs),
				customCertificates: read(PERMISSIONS.ssl, customs, []),
				records: read(PERMISSIONS.dns, records),
				waf: wafRead.ok ? { ok: true, value: Array.isArray(wafRead.value.rules) ? wafRead.value.rules : [] } : wafRead,
				bots: read(PERMISSIONS.bots, bots),
				zoneAop: read(PERMISSIONS.ssl, zoneAop),
				ownershipToken: options.ownershipTokens[name] ?? null,
				lookups: { state: options.lookups ? "not-proven" : "off" },
			},
		});
	}

	const context: AccountContext = {
		zoneNames: new Set(rawZones.map((zone) => (zone.name as string).toLowerCase())),
		zoneRecords: new Map(datas.filter(({ data }) => data.records.ok).map(({ data }) => [data.name, new Set((data.records as { ok: true; value: DnsRecord[] }).value.map((record) => record.name.toLowerCase()))])),
		now: now(),
	};

	if (options.lookups) {
		for (const { data } of datas) data.lookups = await lookUpTargets(data, context, fetchFn);
	}

	const zones: CfZoneReport[] = datas.map(({ raw, data }) => ({
		id: data.id,
		name: data.name,
		plan: data.plan,
		planName: typeof raw.plan?.name === "string" ? raw.plan.name.slice(0, 60) : data.plan,
		status: typeof raw.status === "string" ? raw.status : "unknown",
		paused: raw.paused === true,
		accountId: isCloudflareId(raw.account?.id) ? raw.account.id : "",
		checks: sortChecks([...tlsChecks(data, context), ...dnsChecks(data, context), ...emailChecks(data), ...firewallChecks(data), ownershipCheck(data)]),
	}));

	options.onProgress?.({ done: audited.length, total, current: "account members and API tokens" });
	const accountList = await client.list<{ id?: unknown; name?: unknown }>("/accounts", {}, 50);
	const accountsSeen = new Map<string, string>();
	// Cloudflare names a personal account "<email>'s Account": the email is masked as a member's is (S35).
	const accountName = (name: unknown) => (typeof name === "string" ? name.slice(0, 100).replace(/[^\s@'"<>(),;:]+@[^\s@'"<>(),;:]+\.[a-z]{2,}/gi, (email) => maskEmail(email)) : "Account");
	if (accountList.ok) for (const account of accountList.result) if (isCloudflareId(account.id)) accountsSeen.set(account.id, accountName(account.name));
	for (const raw of rawZones) if (isCloudflareId(raw.account?.id) && !accountsSeen.has(raw.account.id)) accountsSeen.set(raw.account.id, accountName(raw.account.name));

	const accounts: CfAccountReport[] = [];
	for (const [id, name] of accountsSeen) {
		const members = read(PERMISSIONS.members, await client.list<Member>(accountPath(id, "/members"), {}, 50));
		const tokens = read(PERMISSIONS.accountTokens, await client.list<ApiToken>(accountPath(id, "/tokens"), {}, 50));
		accounts.push({
			id,
			name,
			checks: sortChecks([...memberChecks(members), tokenChecks("account-tokens", "Account API tokens", tokens, PERMISSIONS.accountTokens, PATHS.accountTokens, context.now, verified.id)]),
		});
	}
	const userChecks: CfCheck[] = [];
	if (verified.kind === "user") {
		const tokens = read(PERMISSIONS.userTokens, await client.list<ApiToken>("/user/tokens", {}, 50));
		userChecks.push(tokenChecks("user-tokens", "Your API tokens", tokens, PERMISSIONS.userTokens, PATHS.userTokens, context.now, verified.id));
	}
	options.onProgress?.({ done: total, total, current: "" });

	const permissions: CfPermissionState[] = READ_PERMISSIONS.filter((permission) => permission.scope !== "User" || verified.kind === "user").map((permission) => ({
		...permission,
		granted: evidence.has(permission.name) ? (evidence.get(permission.name) as boolean) : null,
	}));
	if (!options.lookups) notCovered.push("Where CNAME records outside your zones point: looking them up was turned off for this audit.");

	return {
		checkedAt: now().toISOString(),
		token: { status: verified.status ?? "active", kind: verified.kind, ...(verified.expiresOn ? { expiresOn: verified.expiresOn } : {}) },
		permissions,
		accounts,
		userChecks,
		zones,
		zonesSkipped: Math.max(0, rawZones.length - audited.length),
		notCovered,
		lookups: options.lookups,
	};
}

/**
 * Looks up, over DNS, the names a zone's CNAME records point at outside the account. Only once the
 * zone's ownership record proves it in this audit (invariant 1); a lookup of that record that fails
 * proves nothing, and nothing else is looked up.
 */
async function lookUpTargets(zone: ZoneData, context: AccountContext, fetchFn: typeof fetch): Promise<LookupResult> {
	if (!zone.records.ok || !zone.ownershipToken) return { state: "not-proven" };
	let proven = false;
	try {
		proven = await checkOwnership(zone.name, zone.ownershipToken, fetchFn);
	} catch {
		proven = false;
	}
	if (!proven) return { state: "not-proven" };
	const targets = new Map<string, string[]>();
	for (const record of zone.records.value) {
		if (record.type !== "CNAME" || record.name.toLowerCase().includes("_domainkey")) continue;
		const target = record.content.toLowerCase().replace(/\.$/, "");
		if (!NAME.test(target) || [...context.zoneNames].some((name) => target === name || target.endsWith(`.${name}`))) continue;
		targets.set(target, [...(targets.get(target) ?? []), record.name]);
	}
	const missing: string[] = [];
	const failed: string[] = [];
	let checked = 0;
	for (const [target, names] of [...targets].slice(0, MAX_LOOKUPS)) {
		checked++;
		try {
			const answer = await resolveDoh(target, "A", fetchFn);
			if (answer.status === 3) missing.push(`${names.join(", ")} → ${target} (no such name)`);
		} catch (err) {
			failed.push(`${target}: ${err instanceof Error ? err.message.slice(0, 120) : "lookup failed"}`);
		}
	}
	if (targets.size > MAX_LOOKUPS) failed.push(`${targets.size - MAX_LOOKUPS} more names were not looked up (the limit is ${MAX_LOOKUPS} a zone)`);
	return { state: "done", checked, missing, failed };
}

const STATUS_ORDER = { failed: 0, unknown: 1, unavailable: 2, passed: 3 };
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

/** Problems first, worst first; then what could not be checked; then the rest, by area. */
export function sortChecks(checks: CfCheck[]): CfCheck[] {
	return [...checks].sort(
		(a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || CF_AREAS.indexOf(a.area) - CF_AREAS.indexOf(b.area),
	);
}

/** Every check of a report: zones, then accounts, then the user's. */
export function allChecks(report: CfReport): CfCheck[] {
	return [...report.zones.flatMap((zone) => zone.checks), ...report.accounts.flatMap((account) => account.checks), ...report.userChecks];
}

export function cfCounts(checks: CfCheck[]): { failed: number; unknown: number; passed: number; unavailable: number; bySeverity: Record<string, number> } {
	const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
	let failed = 0;
	let unknown = 0;
	let passed = 0;
	let unavailable = 0;
	for (const item of checks) {
		if (item.status === "failed") {
			failed++;
			bySeverity[item.severity] = (bySeverity[item.severity] ?? 0) + 1;
		} else if (item.status === "unknown") unknown++;
		else if (item.status === "passed") passed++;
		else unavailable++;
	}
	return { failed, unknown, passed, unavailable, bySeverity };
}
