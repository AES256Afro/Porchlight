/**
 * The built-in rules: what is weak in a zone or an account, and how to repair it. Plain code, no
 * model, no network: they read what `audit.ts` fetched and nothing else. Each rule knows the zone's
 * plan, so a Free zone is never told to turn on a paid feature as if it were a fault. A value the
 * token could not read makes its rule `unknown`, never `passed` (invariant 5).
 *
 * Severities, reasons and fixes are set from Cloudflare's own documentation (November 2026); the
 * table in docs/CLOUDFLARE-AUDIT.md lists them with their sources.
 */
import type { Severity } from "../repos/types.ts";
import type { CfArea, CfChangeId, CfCheck, CfPlan, CfStatus } from "./types.ts";

/** A value read from Cloudflare, or why it could not be. */
export type Read<T> = { ok: true; value: T } | { ok: false; denied: boolean; message: string };

export interface DnsRecord {
	type: string;
	name: string;
	content: string;
	proxied?: boolean;
}

export interface CertificatePack {
	type?: string;
	status?: string;
	hosts?: string[];
	certificates?: { expires_on?: string; status?: string }[];
}

export interface CustomCertificate {
	status?: string;
	expires_on?: string;
	hosts?: string[];
}

export interface RulesetRule {
	action?: string;
	enabled?: boolean;
	action_parameters?: { id?: string };
}

export interface BotSettings {
	fight_mode?: boolean;
	sbfm_definitely_automated?: string;
	using_latest_model?: boolean;
}

export interface ZoneData {
	id: string;
	name: string;
	plan: CfPlan;
	/** "full" for a zone on Cloudflare's nameservers, "partial" for a CNAME setup, and so on. */
	type: string;
	settings: Record<string, Read<unknown>>;
	dnssec: Read<{ status?: string }>;
	universalSsl: Read<{ enabled?: boolean }>;
	certificatePacks: Read<CertificatePack[]>;
	customCertificates: Read<CustomCertificate[]>;
	records: Read<DnsRecord[]>;
	/** The managed-rules entry point's rules; an empty list when the zone has none. */
	waf: Read<RulesetRule[]>;
	bots: Read<BotSettings>;
	/** Zone-level authenticated origin pulls. */
	zoneAop: Read<{ enabled?: boolean }>;
	/** Porchlight's ownership record: the token this computer keeps for the zone, if any. */
	ownershipToken: string | null;
	/** CNAME targets looked up over DNS, only for a zone whose ownership record proved it in this audit. */
	lookups: LookupResult;
}

export type LookupResult =
	| { state: "done"; checked: number; missing: string[]; failed: string[] }
	| { state: "off" }
	| { state: "not-proven" };

/** What the rules know about the rest of the account: the names in its other zones. */
export interface AccountContext {
	/** Zone name → the record names in it, for zones whose records were read. */
	zoneRecords: Map<string, Set<string>>;
	/** Every zone name in the account, read or not. */
	zoneNames: Set<string>;
	now: Date;
}

/** The click paths the fixes name. Each is listed in cli/ui/paths.js with its fixed address. */
export const PATHS = {
	sslOverview: "Cloudflare → SSL/TLS → Overview",
	edgeCertificates: "Cloudflare → SSL/TLS → Edge Certificates",
	originServer: "Cloudflare → SSL/TLS → Origin Server",
	dnsRecords: "Cloudflare → DNS → Records",
	dnsSettings: "Cloudflare → DNS → Settings",
	securitySettings: "Cloudflare → Security → Settings",
	members: "Cloudflare → Manage Account → Members",
	accountTokens: "Cloudflare → Manage Account → Account API Tokens",
	userTokens: "Cloudflare → My Profile → API Tokens",
} as const;

/** The permission each kind of read needs, as Cloudflare names it when a token is made. */
export const PERMISSIONS = {
	zone: "Zone Read",
	settings: "Zone Settings Read",
	dns: "DNS Read",
	ssl: "SSL and Certificates Read",
	waf: "Zone WAF Read",
	bots: "Bot Management Read",
	members: "Account Settings Read",
	accountTokens: "Account API Tokens Read",
	userTokens: "API Tokens Read",
} as const;

/** Cloudflare's managed WAF rulesets, by the ID an execute rule names. */
export const MANAGED_RULESETS = {
	cloudflare: "efb7b8c949ac4650a09736fc376e9aee",
	owasp: "4814384a9e5d4991b9815dcfc25d2f1f",
	free: "77454fe2d30c4220b5701f6fdfb893ba",
} as const;

/** Six months: the shortest HSTS max-age worth having, and Cloudflare's own first step. */
const HSTS_MIN_AGE = 15_552_000;
const DAY = 86_400_000;
/** Hosting services where a name left pointing at a deleted site can be claimed by someone else. */
const TAKEOVER_SUFFIXES = [
	"herokuapp.com",
	"herokudns.com",
	"github.io",
	"s3.amazonaws.com",
	"s3-website",
	"cloudfront.net",
	"azurewebsites.net",
	"cloudapp.net",
	"cloudapp.azure.com",
	"trafficmanager.net",
	"blob.core.windows.net",
	"azureedge.net",
	"azurestaticapps.net",
	"netlify.app",
	"netlify.com",
	"surge.sh",
	"bitbucket.io",
	"ghost.io",
	"pantheonsite.io",
	"myshopify.com",
	"readthedocs.io",
	"fly.dev",
	"elasticbeanstalk.com",
	"wpengine.com",
	"zendesk.com",
	"helpscoutdocs.com",
	"webflow.io",
];
/** Names that are meant to be reached directly, so a DNS-only record for them is not a leak. */
const DIRECT_NAMES = /^(mail|smtp|imap|pop3?|mx\d*|autodiscover|autoconfig|webmail|ftp|sftp|vpn|ns\d*|_[a-z0-9_-]+)(\.|$)/i;

function check(
	id: string,
	area: CfArea,
	title: string,
	status: CfStatus,
	severity: Severity,
	detail: string,
	why: string,
	extra: { fix?: string[]; api?: string; items?: string[]; change?: CfChangeId; permission?: string } = {},
): CfCheck {
	return {
		id,
		area,
		title,
		status,
		severity,
		detail,
		why,
		...(extra.fix && status !== "passed" ? { fix: extra.fix } : {}),
		...(extra.api && status !== "passed" ? { api: extra.api } : {}),
		...(extra.items && extra.items.length > 0 ? { items: extra.items } : {}),
		...(extra.change && status === "failed" ? { change: extra.change } : {}),
		...(extra.permission && status === "unknown" ? { permission: extra.permission } : {}),
	};
}

/** A rule that could not run, because the token may not read what it needs or Cloudflare did not answer. */
function couldNot(id: string, area: CfArea, title: string, severity: Severity, why: string, read: { denied: boolean; message: string }, permission: string): CfCheck {
	return check(
		id,
		area,
		title,
		"unknown",
		severity,
		read.denied ? `This token may not read it. Give the token "${permission}" to check it.` : `Cloudflare did not answer: ${read.message}`,
		why,
		{ permission },
	);
}

function setting(zone: ZoneData, id: string): Read<unknown> {
	return zone.settings[id] ?? { ok: false, denied: false, message: "not read" };
}

function apex(zone: ZoneData): string {
	return zone.name.toLowerCase();
}

function sameName(a: string, b: string): boolean {
	return a.toLowerCase().replace(/\.$/, "") === b.toLowerCase().replace(/\.$/, "");
}

function txtValue(content: string): string {
	// Cloudflare returns TXT content quoted, sometimes as several quoted strings.
	const parts = [...content.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1] ?? "");
	return parts.length > 0 ? parts.join("") : content;
}

// ---------------------------------------------------------------------------------------------
// SSL/TLS
// ---------------------------------------------------------------------------------------------

export function tlsChecks(zone: ZoneData, context: AccountContext): CfCheck[] {
	const out: CfCheck[] = [];
	const ssl = setting(zone, "ssl");
	const sslWhy = "The encryption mode decides whether the connection from Cloudflare to your server is encrypted and whether your server's certificate is checked. Anything below Full (strict) lets someone on the path between Cloudflare and your server read or change traffic.";
	if (!ssl.ok) out.push(couldNot("ssl-mode", "tls", "SSL/TLS encryption mode", "high", sslWhy, ssl, PERMISSIONS.settings));
	else {
		const mode = String(ssl.value);
		const auto = setting(zone, "ssl_automatic_mode");
		const automatic = auto.ok && auto.value === "auto";
		const note = automatic ? " Automatic SSL/TLS chose it; it moves up only once your server presents a valid certificate." : "";
		const fix = [
			"Install a certificate on your server that a browser would trust, or a free Cloudflare Origin CA certificate (Cloudflare → SSL/TLS → Origin Server).",
			"Then set the mode to Full (strict) in Cloudflare → SSL/TLS → Overview. Watch for 526 errors: they mean the server's certificate is not valid yet.",
		];
		const api = 'PATCH /zones/{zone_id}/settings/ssl with {"value":"strict"}';
		if (mode === "strict" || mode === "origin_pull") out.push(check("ssl-mode", "tls", "SSL/TLS encryption mode", "passed", "high", `Full (strict): Cloudflare encrypts to your server and checks its certificate.${note}`, sslWhy));
		// Offered from Full only: from Flexible or Off the server may not answer over HTTPS at all.
		else if (mode === "full") out.push(check("ssl-mode", "tls", "SSL/TLS encryption mode", "failed", "medium", `Full: Cloudflare encrypts to your server but accepts any certificate, even an expired or self-signed one.${note}`, sslWhy, { fix, api, change: "ssl-strict" }));
		else if (mode === "flexible") out.push(check("ssl-mode", "tls", "SSL/TLS encryption mode", "failed", "high", `Flexible: visitors connect to Cloudflare over HTTPS, but Cloudflare connects to your server over plain HTTP.${note}`, sslWhy, { fix, api }));
		else if (mode === "off") out.push(check("ssl-mode", "tls", "SSL/TLS encryption mode", "failed", "critical", "Off: no encryption at all, between visitors and Cloudflare or between Cloudflare and your server.", sslWhy, { fix, api }));
		else out.push(check("ssl-mode", "tls", "SSL/TLS encryption mode", "unknown", "high", `Cloudflare reported a mode Porchlight does not know: ${mode.slice(0, 40)}.`, sslWhy));
	}

	const https = setting(zone, "always_use_https");
	const httpsWhy = "Without it a visitor who types the address or follows an old http:// link stays on plain HTTP, where what they send can be read or changed.";
	if (!https.ok) out.push(couldNot("always-use-https", "tls", "Always Use HTTPS", "medium", httpsWhy, https, PERMISSIONS.settings));
	else if (https.value === "on") out.push(check("always-use-https", "tls", "Always Use HTTPS", "passed", "medium", "On: plain HTTP requests are redirected to HTTPS.", httpsWhy));
	else
		out.push(
			check("always-use-https", "tls", "Always Use HTTPS", "failed", "medium", "Off: pages are also served over plain HTTP.", httpsWhy, {
				fix: ["Turn on Always Use HTTPS in Cloudflare → SSL/TLS → Edge Certificates. It needs an encryption mode other than Off."],
				api: 'PATCH /zones/{zone_id}/settings/always_use_https with {"value":"on"}',
				change: "always-use-https",
			}),
		);

	const minTls = setting(zone, "min_tls_version");
	const minWhy = "TLS 1.0 and 1.1 are deprecated (RFC 8996) and fail PCI DSS; browsers no longer use them, so allowing them only helps an attacker force a weaker connection.";
	if (!minTls.ok) out.push(couldNot("min-tls", "tls", "Minimum TLS version", "medium", minWhy, minTls, PERMISSIONS.settings));
	else {
		const version = String(minTls.value);
		const good = version === "1.2" || version === "1.3";
		out.push(
			check("min-tls", "tls", "Minimum TLS version", good ? "passed" : "failed", "medium", good ? `TLS ${version} or newer.` : `TLS ${version.slice(0, 8)}: deprecated versions are still accepted.`, minWhy, {
				fix: ["Set Minimum TLS Version to TLS 1.2 in Cloudflare → SSL/TLS → Edge Certificates. Very old clients (Android 4.3, Internet Explorer 10) can no longer connect."],
				api: 'PATCH /zones/{zone_id}/settings/min_tls_version with {"value":"1.2"}',
				change: "min-tls-1.2",
			}),
		);
	}

	const tls13 = setting(zone, "tls_1_3");
	const tls13Why = "TLS 1.3 removes the weak options of older versions and is faster. Cloudflare offers it on every plan.";
	if (!tls13.ok) out.push(couldNot("tls-1-3", "tls", "TLS 1.3", "low", tls13Why, tls13, PERMISSIONS.settings));
	else {
		const on = tls13.value === "on" || tls13.value === "zrt";
		out.push(
			check("tls-1-3", "tls", "TLS 1.3", on ? "passed" : "failed", "low", on ? "On." : "Off.", tls13Why, {
				fix: ["Turn on TLS 1.3 in Cloudflare → SSL/TLS → Edge Certificates."],
				api: 'PATCH /zones/{zone_id}/settings/tls_1_3 with {"value":"on"}',
				change: "tls-1.3",
			}),
		);
	}

	const header = setting(zone, "security_header");
	const hstsWhy = "HSTS tells browsers to use HTTPS only, so the first request of a visit cannot be quietly downgraded to HTTP. It is hard to undo: turn it on once every hostname works over HTTPS.";
	if (!header.ok) out.push(couldNot("hsts", "tls", "HTTP Strict Transport Security (HSTS)", "medium", hstsWhy, header, PERMISSIONS.settings));
	else {
		const hsts = (header.value as { strict_transport_security?: { enabled?: unknown; max_age?: unknown; include_subdomains?: unknown; preload?: unknown } } | null)?.strict_transport_security;
		const fix = [
			"In Cloudflare → SSL/TLS → Edge Certificates, enable HSTS with a Max Age of 6 months, and raise it to 12 months once nothing breaks.",
			"Turn on includeSubDomains only when every subdomain works over HTTPS, and preload only after that, with 12 months.",
		];
		const api = 'PATCH /zones/{zone_id}/settings/security_header with {"value":{"strict_transport_security":{"enabled":true,"max_age":15552000,"include_subdomains":false,"preload":false,"nosniff":true}}}';
		if (!hsts || hsts.enabled !== true) out.push(check("hsts", "tls", "HTTP Strict Transport Security (HSTS)", "failed", "medium", "Off.", hstsWhy, { fix, api, change: "hsts" }));
		else {
			const age = typeof hsts.max_age === "number" ? hsts.max_age : 0;
			const extras = [hsts.include_subdomains === true ? "includeSubDomains" : null, hsts.preload === true ? "preload" : null].filter(Boolean).join(", ");
			const months = Math.round(age / 2_592_000);
			if (age < HSTS_MIN_AGE) out.push(check("hsts", "tls", "HTTP Strict Transport Security (HSTS)", "failed", "low", `On, but with a max-age of ${age} seconds (about ${months} months).`, hstsWhy, { fix, api }));
			else out.push(check("hsts", "tls", "HTTP Strict Transport Security (HSTS)", "passed", "medium", `On, max-age about ${months} months${extras ? `, ${extras}` : ""}.`, hstsWhy));
		}
	}

	const rewrites = setting(zone, "automatic_https_rewrites");
	const rewritesWhy = "It rewrites http:// links in your pages to https:// where that works, so pages do not load scripts or images over plain HTTP (mixed content).";
	if (!rewrites.ok) out.push(couldNot("https-rewrites", "tls", "Automatic HTTPS Rewrites", "low", rewritesWhy, rewrites, PERMISSIONS.settings));
	else
		out.push(
			check("https-rewrites", "tls", "Automatic HTTPS Rewrites", rewrites.value === "on" ? "passed" : "failed", "low", rewrites.value === "on" ? "On." : "Off.", rewritesWhy, {
				fix: ["Turn on Automatic HTTPS Rewrites in Cloudflare → SSL/TLS → Edge Certificates."],
				api: 'PATCH /zones/{zone_id}/settings/automatic_https_rewrites with {"value":"on"}',
				change: "automatic-https-rewrites",
			}),
		);

	out.push(universalSslCheck(zone), certificateCheck(zone, context.now), aopCheck(zone));
	return out;
}

function universalSslCheck(zone: ZoneData): CfCheck {
	const why = "Universal SSL is the free certificate that lets visitors reach your proxied hostnames over HTTPS. Without it, or a certificate of your own, HTTPS to the zone fails.";
	const read = zone.universalSsl;
	if (!read.ok) return couldNot("universal-ssl", "tls", "Universal SSL", "high", why, read, PERMISSIONS.ssl);
	if (read.value.enabled !== false) return check("universal-ssl", "tls", "Universal SSL", "passed", "high", "On.", why);
	const others = zone.certificatePacks.ok ? zone.certificatePacks.value.filter((pack) => pack.type !== "universal" && pack.status === "active").length : 0;
	const custom = zone.customCertificates.ok ? zone.customCertificates.value.filter((cert) => cert.status === "active").length : 0;
	if (others + custom > 0) return check("universal-ssl", "tls", "Universal SSL", "passed", "high", `Off, with ${others + custom} certificate${others + custom === 1 ? "" : "s"} of your own or advanced ones in its place.`, why);
	return check("universal-ssl", "tls", "Universal SSL", "failed", "high", "Off, and no other active certificate was found.", why, {
		fix: ["Re-enable Universal SSL in Cloudflare → SSL/TLS → Edge Certificates, or upload a certificate of your own."],
		api: 'PATCH /zones/{zone_id}/ssl/universal/settings with {"enabled":true}',
	});
}

function certificateCheck(zone: ZoneData, now: Date): CfCheck {
	const why = "An expired certificate makes browsers refuse the site. Certificates Cloudflare manages renew themselves about 30 days before they expire; one that gets close has failed to renew. Certificates you uploaded never renew themselves.";
	if (!zone.certificatePacks.ok) return couldNot("certificates", "tls", "Edge certificates", "high", why, zone.certificatePacks, PERMISSIONS.ssl);
	const problems: { severity: Severity; line: string }[] = [];
	let soonest: number | null = null;
	const days = (iso: string | undefined) => {
		const time = iso ? Date.parse(iso) : Number.NaN;
		return Number.isNaN(time) ? null : Math.floor((time - now.getTime()) / DAY);
	};
	for (const pack of zone.certificatePacks.value) {
		const hosts = (pack.hosts ?? []).slice(0, 3).join(", ") || "this zone";
		const serving = !pack.status || pack.status === "active";
		// Cloudflare keeps a backup certificate beside every Universal one, issued and not deployed: that is its healthy state.
		const waiting = pack.status === "backup_issued" || pack.status?.startsWith("pending") || pack.status === "initializing";
		if (!serving && !waiting) problems.push({ severity: "medium", line: `${pack.type ?? "certificate"} pack for ${hosts}: ${pack.status}` });
		// Only a pack that is serving decides what visitors get. A backup, or a pack on its way in or out, has dates that do not matter.
		if (!serving) continue;
		for (const cert of pack.certificates ?? []) {
			const left = days(cert.expires_on);
			if (left === null) continue;
			soonest = soonest === null ? left : Math.min(soonest, left);
			if (left < 0) problems.push({ severity: "critical", line: `${hosts}: expired ${-left} days ago` });
			else if (left < 14) problems.push({ severity: "high", line: `${hosts}: expires in ${left} days and has not renewed` });
		}
	}
	for (const cert of zone.customCertificates.ok ? zone.customCertificates.value : []) {
		const left = days(cert.expires_on);
		if (left === null) continue;
		const hosts = (cert.hosts ?? []).slice(0, 3).join(", ") || "this zone";
		soonest = soonest === null ? left : Math.min(soonest, left);
		if (left < 0) problems.push({ severity: "critical", line: `Uploaded certificate for ${hosts}: expired ${-left} days ago` });
		else if (left < 14) problems.push({ severity: "high", line: `Uploaded certificate for ${hosts}: expires in ${left} days` });
		else if (left < 30) problems.push({ severity: "medium", line: `Uploaded certificate for ${hosts}: expires in ${left} days` });
	}
	if (problems.length === 0) {
		const detail = soonest === null ? "No certificate with an expiry date was listed." : `The soonest expires in ${soonest} days.`;
		return check("certificates", "tls", "Edge certificates", "passed", "high", detail, why);
	}
	const order: Severity[] = ["critical", "high", "medium", "low"];
	const worst = order.find((severity) => problems.some((problem) => problem.severity === severity)) ?? "medium";
	return check("certificates", "tls", "Edge certificates", "failed", worst, `${problems.length} certificate${problems.length === 1 ? "" : "s"} expired, expiring or not active.`, why, {
		fix: [
			"Open Cloudflare → SSL/TLS → Edge Certificates and read the status of each certificate.",
			"For one Cloudflare manages, a renewal usually stalls on a CAA record that leaves out Cloudflare's certificate authorities, or on a hostname no longer pointing at Cloudflare.",
			"Replace an uploaded certificate before it expires.",
		],
		api: "GET /zones/{zone_id}/ssl/certificate_packs?status=all",
		items: problems.map((problem) => problem.line),
	});
}

function aopCheck(zone: ZoneData): CfCheck {
	const why = "Without authenticated origin pulls your server answers anyone who finds its address, so an attacker can skip Cloudflare's firewall and go straight to it. With them, your server only accepts connections that present Cloudflare's client certificate. Origins behind Cloudflare Tunnel are already protected this way.";
	const global = setting(zone, "tls_client_auth");
	const zoneLevel = zone.zoneAop;
	if (!global.ok && !zoneLevel.ok) return couldNot("origin-pulls", "tls", "Authenticated origin pulls", "low", why, zoneLevel, PERMISSIONS.ssl);
	const on = (global.ok && global.value === "on") || (zoneLevel.ok && zoneLevel.value.enabled === true);
	if (on) return check("origin-pulls", "tls", "Authenticated origin pulls", "passed", "low", "On.", why);
	if (!global.ok || !zoneLevel.ok) {
		const missing = !global.ok ? global : (zoneLevel as { ok: false; denied: boolean; message: string });
		return couldNot("origin-pulls", "tls", "Authenticated origin pulls", "low", why, missing, !global.ok ? PERMISSIONS.settings : PERMISSIONS.ssl);
	}
	const ssl = setting(zone, "ssl");
	const weakMode = ssl.ok && (ssl.value === "off" || ssl.value === "flexible");
	return check(
		"origin-pulls",
		"tls",
		"Authenticated origin pulls",
		"failed",
		"low",
		weakMode ? "Off. They also need the encryption mode at Full or Full (strict) first." : "Off: neither the global nor the zone-level setting is on.",
		why,
		{
			fix: [
				"Install Cloudflare's origin-pull certificate on your server and set it to require client certificates (nginx: ssl_verify_client on).",
				"Then turn on Authenticated Origin Pulls in Cloudflare → SSL/TLS → Origin Server. Turning it on before the server is ready changes nothing; requiring the certificate on the server before turning it on breaks the site.",
			],
			api: 'PATCH /zones/{zone_id}/settings/tls_client_auth with {"value":"on"}',
		},
	);
}

// ---------------------------------------------------------------------------------------------
// DNS
// ---------------------------------------------------------------------------------------------

export function dnsChecks(zone: ZoneData, context: AccountContext): CfCheck[] {
	const out: CfCheck[] = [dnssecCheck(zone)];
	const recordsWhy = "DNS records are public. A record can reveal the address of the server behind Cloudflare, publish an internal address, or keep pointing at a service you no longer use, which someone else can then claim.";
	if (!zone.records.ok) {
		for (const [id, title] of [
			["caa", "CAA records"],
			["origin-exposure", "Origin addresses behind proxied hosts"],
			["dns-only", "DNS-only records"],
			["internal-addresses", "Internal addresses in public DNS"],
			["dangling-internal", "Records pointing at names that do not exist in your zones"],
			["dangling-external", "Records pointing at services that may be gone"],
		] as const) {
			out.push(couldNot(id, "dns", title, id === "origin-exposure" || id === "dangling-external" ? "high" : "medium", recordsWhy, zone.records, PERMISSIONS.dns));
		}
		return out;
	}
	const records = zone.records.value;
	out.push(caaCheck(zone, records), originExposureCheck(records), dnsOnlyCheck(records), internalAddressCheck(records), ...danglingChecks(zone, records, context));
	return out;
}

function dnssecCheck(zone: ZoneData): CfCheck {
	const why = "DNSSEC signs your DNS records, so a resolver can tell a forged answer from a real one. Without it, a poisoned cache can send visitors and mail to someone else's server.";
	if (zone.type === "partial") return check("dnssec", "dns", "DNSSEC", "unavailable", "medium", "This zone uses a CNAME (partial) setup, so its DNS is served elsewhere: turn on DNSSEC at that provider.", why);
	if (!zone.dnssec.ok) return couldNot("dnssec", "dns", "DNSSEC", "medium", why, zone.dnssec, PERMISSIONS.dns);
	const status = zone.dnssec.value.status ?? "unknown";
	if (status === "active") return check("dnssec", "dns", "DNSSEC", "passed", "medium", "Active: the zone is signed and its DS record is at the registrar.", why);
	const pending = status === "pending";
	return check("dnssec", "dns", "DNSSEC", "failed", "medium", pending ? "Turned on in Cloudflare, but the DS record has not been added at your registrar yet, so it does not protect anything." : `Not on (${status.slice(0, 30)}).`, why, {
		fix: pending
			? ["Copy the DS record from Cloudflare → DNS → Settings and add it at your domain's registrar. Cloudflare Registrar adds it for you within a day or two."]
			: ["Select Enable DNSSEC in Cloudflare → DNS → Settings, then add the DS record it shows at your domain's registrar."],
		api: 'PATCH /zones/{zone_id}/dnssec with {"status":"active"}',
		// Already turned on and waiting for the registrar: there is nothing more to send to Cloudflare.
		...(pending ? {} : { change: "dnssec" as const }),
	});
}

function caaCheck(zone: ZoneData, records: DnsRecord[]): CfCheck {
	const why = "CAA records name the certificate authorities that may issue certificates for your domain. Without them any authority may, so a mistake or a fooled check at any one of them can produce a valid certificate for your site.";
	const caa = records.filter((record) => record.type === "CAA" && sameName(record.name, apex(zone)));
	if (caa.length > 0) {
		return check("caa", "dns", "CAA records", "passed", "low", `${caa.length} CAA record${caa.length === 1 ? "" : "s"} at ${zone.name}.`, why, { items: caa.map((record) => record.content.slice(0, 120)) });
	}
	return check("caa", "dns", "CAA records", "failed", "low", `No CAA record at ${zone.name}: any certificate authority may issue for it.`, why, {
		fix: [
			"Add CAA records in Cloudflare → DNS → Records for the authorities you use, such as `0 issue \"letsencrypt.org\"`.",
			"Once a zone has CAA records, Cloudflare adds the ones its own Universal SSL authorities need, so your edge certificates keep renewing.",
		],
		api: 'POST /zones/{zone_id}/dns_records with {"type":"CAA","name":"@","data":{"flags":0,"tag":"issue","value":"letsencrypt.org"}}',
	});
}

function isAddress(record: DnsRecord): boolean {
	return record.type === "A" || record.type === "AAAA";
}

function originExposureCheck(records: DnsRecord[]): CfCheck {
	const why = "Cloudflare hides the address of a proxied host. A DNS-only record with the same address publishes it anyway, and anyone can then reach the server directly, past Cloudflare's firewall and DDoS protection.";
	const proxiedAddresses = new Map<string, string>();
	for (const record of records) if (isAddress(record) && record.proxied === true) proxiedAddresses.set(record.content, record.name);
	const leaks = records.filter((record) => isAddress(record) && record.proxied === false && proxiedAddresses.has(record.content));
	if (leaks.length === 0) return check("origin-exposure", "dns", "Origin addresses behind proxied hosts", "passed", "high", "No DNS-only record shares an address with a proxied one.", why);
	return check("origin-exposure", "dns", "Origin addresses behind proxied hosts", "failed", "high", `${leaks.length} DNS-only record${leaks.length === 1 ? " publishes" : "s publish"} the address of a proxied host.`, why, {
		fix: [
			"Proxy these records too (orange cloud) in Cloudflare → DNS → Records, or move the service to another address.",
			"An address that has been public is known: once it is hidden, change it, or allow only Cloudflare's addresses to reach the server.",
		],
		items: leaks.map((record) => `${record.name} (${record.type} ${record.content}), the same address as proxied ${proxiedAddresses.get(record.content)}`),
	});
}

function dnsOnlyCheck(records: DnsRecord[]): CfCheck {
	const why = "A DNS-only (grey cloud) record sends visitors straight to the server, without Cloudflare's firewall, DDoS protection or HTTPS. That is right for mail and some other services, and a gap for a website.";
	const mailHosts = new Set(records.filter((record) => record.type === "MX").map((record) => record.content.toLowerCase().replace(/\.$/, "").replace(/^\d+\s+/, "")));
	const direct = records.filter(
		(record) =>
			(isAddress(record) || record.type === "CNAME") &&
			record.proxied === false &&
			!DIRECT_NAMES.test(record.name) &&
			!mailHosts.has(record.name.toLowerCase()) &&
			!(isAddress(record) && isInternal(record.content)),
	);
	if (direct.length === 0) return check("dns-only", "dns", "DNS-only records", "passed", "low", "Every A, AAAA and CNAME record for a website goes through Cloudflare's proxy, apart from mail and similar names.", why);
	return check("dns-only", "dns", "DNS-only records", "failed", "low", `${direct.length} record${direct.length === 1 ? " skips" : "s skip"} Cloudflare's proxy. Check that each one is meant to be reached directly.`, why, {
		fix: ["For a website or an API, proxy the record (orange cloud) in Cloudflare → DNS → Records. Leave mail, VPN and similar services DNS-only."],
		items: direct.slice(0, 50).map((record) => `${record.name} (${record.type} ${record.content})`),
	});
}

/** Private, loopback, link-local, carrier-grade NAT, documentation and unique-local addresses. */
export function isInternal(address: string): boolean {
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
	}
	const v6 = address.toLowerCase();
	return v6 === "::1" || v6 === "::" || /^f[cd][0-9a-f]{2}:/.test(v6) || /^fe[89ab][0-9a-f]:/.test(v6);
}

function internalAddressCheck(records: DnsRecord[]): CfCheck {
	const why = "A public record holding an internal address tells everyone how your private network is laid out, and a leftover one can point at whatever later takes that address on someone else's network.";
	const internal = records.filter((record) => isAddress(record) && isInternal(record.content));
	if (internal.length === 0) return check("internal-addresses", "dns", "Internal addresses in public DNS", "passed", "medium", "No record holds a private, loopback or link-local address.", why);
	return check("internal-addresses", "dns", "Internal addresses in public DNS", "failed", "medium", `${internal.length} record${internal.length === 1 ? " holds" : "s hold"} an internal address.`, why, {
		fix: ["Delete these records in Cloudflare → DNS → Records, or move them to private DNS (your router, Tailscale's MagicDNS, or a split-horizon zone)."],
		items: internal.map((record) => `${record.name} (${record.type} ${record.content})`),
	});
}

function cnameTarget(record: DnsRecord): string {
	return record.content.toLowerCase().replace(/\.$/, "");
}

/** The account zone a name falls under, if any. */
function zoneOf(name: string, zones: Set<string>): string | null {
	const labels = name.split(".");
	for (let i = 0; i < labels.length - 1; i++) {
		const candidate = labels.slice(i).join(".");
		if (zones.has(candidate)) return candidate;
	}
	return null;
}

function takeoverProne(target: string): boolean {
	return TAKEOVER_SUFFIXES.some((suffix) => target === suffix || target.endsWith(`.${suffix}`) || target.includes(`.${suffix}.`) || target.includes(`${suffix}.`));
}

function danglingChecks(zone: ZoneData, records: DnsRecord[], context: AccountContext): CfCheck[] {
	const cnames = records.filter((record) => record.type === "CNAME" && !record.name.toLowerCase().includes("_domainkey"));
	const inside: string[] = [];
	const outside: DnsRecord[] = [];
	for (const record of cnames) {
		const target = cnameTarget(record);
		const owner = zoneOf(target, context.zoneNames);
		if (owner) {
			const names = context.zoneRecords.get(owner);
			if (names && !names.has(target) && !names.has(`*.${target.split(".").slice(1).join(".")}`)) inside.push(`${record.name} → ${target}`);
		} else outside.push(record);
	}
	const insideWhy = "A CNAME that points at a name with no record of its own fails for every visitor, and if the name is created later by someone else's mistake it serves whatever they put there.";
	const internalCheck =
		inside.length === 0
			? check("dangling-internal", "dns", "Records pointing at names that do not exist in your zones", "passed", "medium", "Every CNAME into your own zones points at a name that has a record.", insideWhy)
			: check("dangling-internal", "dns", "Records pointing at names that do not exist in your zones", "failed", "medium", `${inside.length} CNAME record${inside.length === 1 ? " points" : "s point"} at a name in your zones that has no record.`, insideWhy, {
					fix: ["Delete these records in Cloudflare → DNS → Records, or create the names they point at."],
					items: inside,
				});

	const outsideWhy = "A CNAME left pointing at a hosting service after the site there was deleted can be claimed by anyone who creates a site with that name: they then serve content, and can obtain certificates, under your domain (subdomain takeover).";
	const lines = outside.map((record) => `${record.name} → ${cnameTarget(record)}${takeoverProne(cnameTarget(record)) ? " (a service where names can be claimed)" : ""}`);
	const sorted = [...lines].sort((a, b) => Number(b.includes("(a service")) - Number(a.includes("(a service")));
	let externalCheck: CfCheck;
	if (outside.length === 0) {
		externalCheck = check("dangling-external", "dns", "Records pointing at services that may be gone", "passed", "high", "No CNAME points outside your zones.", outsideWhy);
	} else if (zone.lookups.state === "done") {
		const missing = zone.lookups.missing;
		externalCheck =
			missing.length === 0
				? check("dangling-external", "dns", "Records pointing at services that may be gone", zone.lookups.failed.length > 0 ? "unknown" : "passed", "high", zone.lookups.failed.length > 0 ? `${zone.lookups.failed.length} of ${zone.lookups.checked} lookups failed, so those could not be checked.` : `All ${zone.lookups.checked} names outside your zones still exist.`, outsideWhy, { items: zone.lookups.failed })
				: check("dangling-external", "dns", "Records pointing at services that may be gone", "failed", "high", `${missing.length} CNAME record${missing.length === 1 ? " points" : "s point"} at a name that no longer exists.`, outsideWhy, {
						fix: ["Delete these records in Cloudflare → DNS → Records now, before someone claims the name they point at. Re-create a record only once the service is set up again."],
						items: missing,
					});
	} else {
		const reason =
			zone.lookups.state === "not-proven"
				? "Porchlight looks names up only for a zone whose ownership record it has checked (see Proof of ownership below)."
				: "Looking these names up was turned off for this audit.";
		externalCheck = check("dangling-external", "dns", "Records pointing at services that may be gone", "unknown", "high", `${outside.length} CNAME record${outside.length === 1 ? " points" : "s point"} outside your zones and ${outside.length === 1 ? "was" : "were"} not looked up. ${reason}`, outsideWhy, {
			fix: ["Check each one still points at a site you run, or delete it in Cloudflare → DNS → Records."],
			items: sorted.slice(0, 50),
		});
	}
	return [internalCheck, externalCheck];
}

// ---------------------------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------------------------

export function emailChecks(zone: ZoneData): CfCheck[] {
	const whySpf = "SPF lists the servers allowed to send mail for your domain. Without it, or with a lax one, anyone can send mail that claims to come from you.";
	const whyDmarc = "DMARC tells receiving mail servers what to do with mail that fails SPF and DKIM: deliver it, quarantine it or reject it. Without a policy, spoofed mail from your domain is delivered.";
	const whyDkim = "DKIM signs the mail you send, so receivers can tell it really came from you. DMARC relies on it.";
	if (!zone.records.ok) {
		return [
			couldNot("spf", "email", "SPF", "medium", whySpf, zone.records, PERMISSIONS.dns),
			couldNot("dmarc", "email", "DMARC", "medium", whyDmarc, zone.records, PERMISSIONS.dns),
			couldNot("dkim", "email", "DKIM", "medium", whyDkim, zone.records, PERMISSIONS.dns),
		];
	}
	const records = zone.records.value;
	const receivesMail = records.some((record) => record.type === "MX" && sameName(record.name, apex(zone)));
	const txt = (name: string) => records.filter((record) => record.type === "TXT" && sameName(record.name, name)).map((record) => txtValue(record.content));
	const out: CfCheck[] = [];

	const spf = txt(apex(zone)).filter((value) => /^v=spf1(\s|$)/i.test(value));
	const spfApi = 'POST /zones/{zone_id}/dns_records with {"type":"TXT","name":"@","content":"\\"v=spf1 -all\\""}';
	if (spf.length === 0) {
		out.push(
			check("spf", "email", "SPF", "failed", receivesMail ? "medium" : "low", receivesMail ? "No SPF record, though the domain receives mail." : "No SPF record. The domain receives no mail; a record that allows no sender stops others sending as it.", whySpf, {
				fix: receivesMail
					? ["Add a TXT record at the zone apex in Cloudflare → DNS → Records listing your mail provider, such as `v=spf1 include:_spf.google.com -all`. Your provider's help names the include."]
					: ["Add a TXT record at the zone apex in Cloudflare → DNS → Records: `v=spf1 -all`."],
				api: spfApi,
			}),
		);
	} else if (spf.length > 1) {
		out.push(check("spf", "email", "SPF", "failed", "medium", `${spf.length} SPF records: receivers treat that as an error and ignore them all.`, whySpf, { fix: ["Merge them into one TXT record in Cloudflare → DNS → Records."], items: spf }));
	} else {
		const value = spf[0] ?? "";
		const all = /(^|\s)([-~?+]?)all(\s|$)/i.exec(value)?.[2];
		if (all === "+" || (all === "" && /\sall(\s|$)/i.test(value))) out.push(check("spf", "email", "SPF", "failed", "high", "The SPF record ends in +all: it allows every server on the internet to send as you.", whySpf, { fix: ["Change `+all` to `-all` (or `~all` while you check) in Cloudflare → DNS → Records."], items: [value] }));
		else if (all === "?") out.push(check("spf", "email", "SPF", "failed", "medium", "The SPF record ends in ?all, which tells receivers nothing.", whySpf, { fix: ["Change `?all` to `~all`, then `-all` once mail flows as it should."], items: [value] }));
		else if (all === undefined) out.push(check("spf", "email", "SPF", "failed", "low", "The SPF record has no `all` at the end, so mail from other servers is not marked.", whySpf, { fix: ["End the record with `-all` or `~all`."], items: [value] }));
		else out.push(check("spf", "email", "SPF", "passed", "medium", `One SPF record, ending in ${all}all.`, whySpf, { items: [value] }));
	}

	const dmarc = txt(`_dmarc.${apex(zone)}`).filter((value) => /^v=DMARC1/i.test(value));
	const dmarcApi = 'POST /zones/{zone_id}/dns_records with {"type":"TXT","name":"_dmarc","content":"\\"v=DMARC1; p=reject\\""}';
	if (dmarc.length === 0) {
		out.push(
			check("dmarc", "email", "DMARC", "failed", "medium", "No DMARC record at _dmarc.", whyDmarc, {
				fix: [
					receivesMail
						? "Add a TXT record named _dmarc in Cloudflare → DNS → Records, starting with `v=DMARC1; p=none; rua=mailto:you@yourdomain` to see reports, then move to `p=quarantine` and `p=reject`."
						: "Add a TXT record named _dmarc in Cloudflare → DNS → Records: `v=DMARC1; p=reject`.",
				],
				api: dmarcApi,
				// Only where there is no record at all: a record that exists is the owner's to change.
				change: "dmarc-monitor",
			}),
		);
	} else {
		const value = dmarc[0] ?? "";
		const policy = /(?:^|;)\s*p\s*=\s*(\w+)/i.exec(value)?.[1]?.toLowerCase();
		if (policy === "reject" || policy === "quarantine") out.push(check("dmarc", "email", "DMARC", "passed", "medium", `Policy ${policy}.`, whyDmarc, { items: [value] }));
		else
			out.push(
				check("dmarc", "email", "DMARC", "failed", "low", policy === "none" ? "Policy none: reports only, spoofed mail is still delivered." : "The DMARC record has no policy (p=).", whyDmarc, {
					fix: ["Once the reports show your own mail passing, change the policy to `p=quarantine`, then `p=reject`, in Cloudflare → DNS → Records."],
					items: [value],
				}),
			);
	}

	const dkim = records.filter((record) => record.name.toLowerCase().endsWith(`._domainkey.${apex(zone)}`) && (record.type === "TXT" || record.type === "CNAME"));
	if (dkim.length > 0) out.push(check("dkim", "email", "DKIM", "passed", "medium", `${dkim.length} DKIM key${dkim.length === 1 ? "" : "s"} published.`, whyDkim, { items: dkim.slice(0, 10).map((record) => record.name) }));
	else if (receivesMail)
		out.push(
			check("dkim", "email", "DKIM", "failed", "medium", "The domain receives mail but publishes no DKIM key under _domainkey.", whyDkim, {
				fix: ["Turn on DKIM signing at your mail provider and add the record it gives you in Cloudflare → DNS → Records."],
			}),
		);
	else out.push(check("dkim", "email", "DKIM", "passed", "low", "No MX record and no DKIM key: if the domain sends no mail, the SPF and DMARC records above are what stop spoofing.", whyDkim));
	return out;
}

// ---------------------------------------------------------------------------------------------
// Firewall and bots
// ---------------------------------------------------------------------------------------------

export function firewallChecks(zone: ZoneData): CfCheck[] {
	const out: CfCheck[] = [];
	const wafWhy = "Managed rules block common attacks (SQL injection, cross-site scripting, exploits of known vulnerabilities) before they reach your server. Cloudflare updates them every week.";
	const executes = (id: string, rules: RulesetRule[]) => rules.find((rule) => rule.action === "execute" && rule.action_parameters?.id === id);
	if (!zone.waf.ok) {
		out.push(couldNot("waf-managed", "firewall", "WAF managed rules", "high", wafWhy, zone.waf, PERMISSIONS.waf));
	} else if (zone.plan === "free") {
		const free = executes(MANAGED_RULESETS.free, zone.waf.value);
		if (free && free.enabled !== false) out.push(check("waf-managed", "firewall", "WAF managed rules", "passed", "high", "The Cloudflare Free Managed Ruleset is deployed.", wafWhy));
		else if (free)
			out.push(
				check("waf-managed", "firewall", "WAF managed rules", "failed", "high", "The Cloudflare Free Managed Ruleset is deployed but turned off.", wafWhy, {
					fix: ["Turn the Free Managed Ruleset back on in Cloudflare → Security → Settings, under Web application exploits."],
				}),
			);
		else
			out.push(
				check("waf-managed", "firewall", "WAF managed rules", "unknown", "high", "The Cloudflare Free Managed Ruleset is not listed among this zone's managed rules. Cloudflare may run it by default on Free zones; check that it is on.", wafWhy, {
					fix: ["Open Cloudflare → Security → Settings, filter by Web application exploits, and check that the Free Managed Ruleset is on."],
				}),
			);
	} else if (zone.plan === "unknown") {
		out.push(check("waf-managed", "firewall", "WAF managed rules", "unknown", "high", "The zone's plan could not be read, so Porchlight cannot say which managed rules it should have.", wafWhy));
	} else {
		const managed = executes(MANAGED_RULESETS.cloudflare, zone.waf.value);
		if (managed && managed.enabled !== false) out.push(check("waf-managed", "firewall", "WAF managed rules", "passed", "high", "The Cloudflare Managed Ruleset is deployed.", wafWhy));
		else
			out.push(
				check("waf-managed", "firewall", "WAF managed rules", "failed", "high", managed ? "The Cloudflare Managed Ruleset is deployed but turned off." : `The Cloudflare Managed Ruleset is not deployed, though the ${zone.plan} plan includes it.`, wafWhy, {
					fix: ["Turn on Cloudflare managed ruleset in Cloudflare → Security → Settings, under Web application exploits. Start with its default rules; they are chosen to block few legitimate requests."],
					api: 'PUT /zones/{zone_id}/rulesets/phases/http_request_firewall_managed/entrypoint with an execute rule for efb7b8c949ac4650a09736fc376e9aee',
				}),
			);
		const owaspWhy = "The OWASP Core Ruleset scores each request against many generic attack patterns. It catches more than the managed ruleset alone, and blocks more legitimate requests too, so run it in log mode first.";
		const owasp = executes(MANAGED_RULESETS.owasp, zone.waf.value);
		out.push(
			owasp && owasp.enabled !== false
				? check("waf-owasp", "firewall", "OWASP Core Ruleset", "passed", "low", "Deployed.", owaspWhy)
				: check("waf-owasp", "firewall", "OWASP Core Ruleset", "failed", "low", "Not deployed.", owaspWhy, {
						fix: ["Turn on OWASP Core in Cloudflare → Security → Settings with the action set to Log, read the security events for a week, then set it to Block."],
					}),
		);
	}
	if (zone.plan === "free") out.push(check("waf-owasp", "firewall", "OWASP Core Ruleset", "unavailable", "low", "Not on the Free plan: it comes with Pro and above.", "The OWASP Core Ruleset scores each request against many generic attack patterns."));

	const level = setting(zone, "security_level");
	const levelWhy = "Cloudflare no longer scores visitors by threat, so the security level now only switches Under Attack mode, which shows a challenge page to every visitor. That is right during an attack and wrong otherwise: it blocks APIs, apps and search engines.";
	if (!level.ok) out.push(couldNot("security-level", "firewall", "Security level (Under Attack mode)", "low", levelWhy, level, PERMISSIONS.settings));
	else if (level.value === "under_attack")
		out.push(
			check("security-level", "firewall", "Security level (Under Attack mode)", "failed", "low", "Under Attack mode is on: every visitor gets a challenge page.", levelWhy, {
				fix: ["If the attack is over, turn Under Attack mode off in Cloudflare → Security → Settings. To keep it for some paths only, use a configuration rule."],
				api: 'PATCH /zones/{zone_id}/settings/security_level with {"value":"medium"}',
			}),
		);
	else out.push(check("security-level", "firewall", "Security level (Under Attack mode)", "passed", "low", "Under Attack mode is off.", levelWhy));

	const bic = setting(zone, "browser_check");
	const bicWhy = "Browser Integrity Check turns away requests with headers that spam bots and attack tools commonly send, or leave out. It is on every plan and rarely blocks a real browser.";
	if (!bic.ok) out.push(couldNot("browser-check", "firewall", "Browser Integrity Check", "low", bicWhy, bic, PERMISSIONS.settings));
	else
		out.push(
			check("browser-check", "firewall", "Browser Integrity Check", bic.value === "on" ? "passed" : "failed", "low", bic.value === "on" ? "On." : "Off.", bicWhy, {
				fix: ["Turn on Browser integrity check in Cloudflare → Security → Settings. If an API client of yours is refused, skip it for that path with a configuration rule."],
				api: 'PATCH /zones/{zone_id}/settings/browser_check with {"value":"on"}',
				change: "browser-check",
			}),
		);

	out.push(botCheck(zone));
	return out;
}

function botCheck(zone: ZoneData): CfCheck {
	const why = "Bot Fight Mode (Free) and Super Bot Fight Mode (Pro and above) challenge traffic that matches known bots: scrapers, credential stuffers and vulnerability scanners. Both can also challenge your own scripts and monitoring, so check them after turning it on.";
	if (zone.plan === "enterprise") return check("bot-fight-mode", "firewall", "Bot protection", "unavailable", "low", "Enterprise zones use Bot Management, which Porchlight does not judge.", why);
	if (!zone.bots.ok) return couldNot("bot-fight-mode", "firewall", "Bot protection", "low", why, zone.bots, PERMISSIONS.bots);
	if (zone.plan === "free") {
		const on = zone.bots.value.fight_mode === true;
		return check("bot-fight-mode", "firewall", "Bot protection", on ? "passed" : "failed", "low", on ? "Bot Fight Mode is on." : "Bot Fight Mode is off.", why, {
			fix: ["Turn on Bot fight mode in Cloudflare → Security → Settings, filtered by Bot traffic. It cannot be skipped for a path, so leave it off if it challenges an API client of yours."],
			api: 'PUT /zones/{zone_id}/bot_management with {"fight_mode":true}',
			// Not offered as a change: a real account answered this request with HTTP 400 (docs/CLOUDFLARE-AUDIT.md).
		});
	}
	if (zone.plan === "unknown") return check("bot-fight-mode", "firewall", "Bot protection", "unknown", "low", "The zone's plan could not be read.", why);
	const action = zone.bots.value.sbfm_definitely_automated;
	const on = typeof action === "string" && action !== "allow";
	return check("bot-fight-mode", "firewall", "Bot protection", on ? "passed" : "failed", "low", on ? `Super Bot Fight Mode: definitely automated traffic is set to ${action}.` : "Super Bot Fight Mode lets definitely automated traffic through.", why, {
		fix: ["In Cloudflare → Security → Settings, filtered by Bot traffic, set Definitely automated to Managed Challenge, then Block once the security events show no traffic of yours. Keep it at Allow if the zone serves a Cloudflare Tunnel."],
		api: 'PUT /zones/{zone_id}/bot_management with {"sbfm_definitely_automated":"managed_challenge"}',
	});
}

// ---------------------------------------------------------------------------------------------
// Porchlight's ownership record
// ---------------------------------------------------------------------------------------------

export function ownershipCheck(zone: ZoneData): CfCheck {
	const why = "Porchlight looks a domain up on the network (where its records point, its HTTPS) only once the domain's _porchlight-challenge TXT record proves it is yours. The record changes nothing else and can be deleted at any time.";
	if (!zone.records.ok) return couldNot("ownership-record", "ownership", "Porchlight ownership record", "low", why, zone.records, PERMISSIONS.dns);
	const names = [`_porchlight-challenge.${apex(zone)}`, `_securityx-challenge.${apex(zone)}`];
	const values = zone.records.value.filter((record) => record.type === "TXT" && names.some((name) => sameName(record.name, name))).map((record) => txtValue(record.content));
	const token = zone.ownershipToken;
	if (token && values.some((value) => value === `porchlight-verify=${token}` || value === `securityx-verify=${token}`)) {
		return check("ownership-record", "ownership", "Porchlight ownership record", "passed", "low", "Published, and it holds the token this computer keeps for the zone.", why);
	}
	const detail =
		values.length > 0
			? "A challenge record is published, but it does not hold the token this computer keeps. Porchlight can add one that does."
			: "Not published. With DNS edit permission Porchlight can add it, once you approve the exact request.";
	return check("ownership-record", "ownership", "Porchlight ownership record", "failed", "low", detail, why, {
		fix: [`Add a TXT record named _porchlight-challenge in Cloudflare → DNS → Records holding the value Porchlight shows, or let Porchlight add it (the token needs "DNS Write").`],
		api: 'POST /zones/{zone_id}/dns_records with {"type":"TXT","name":"_porchlight-challenge","content":"\\"porchlight-verify=…\\""}',
		change: "ownership-record",
	});
}

// ---------------------------------------------------------------------------------------------
// Accounts and tokens
// ---------------------------------------------------------------------------------------------

export interface Member {
	status?: string;
	user?: { email?: string; two_factor_authentication_enabled?: boolean };
	roles?: { name?: string }[];
	policies?: { permission_groups?: { name?: string }[] }[];
}

export interface ApiToken {
	id?: string;
	name?: string;
	status?: string;
	issued_on?: string;
	last_used_on?: string;
	expires_on?: string;
	condition?: { request_ip?: { in?: string[] } };
	policies?: { effect?: string; resources?: Record<string, unknown>; permission_groups?: { name?: string }[] }[];
}

/** An email as the page shows it: the first letter and the domain, enough for the owner to tell who it is. */
export function maskEmail(email: string | undefined): string {
	if (!email || !email.includes("@")) return "a member without an email";
	const [local, domain] = email.split("@") as [string, string];
	return `${local.slice(0, 1)}…@${domain}`;
}

function roleNames(member: Member): string[] {
	const names = (member.roles ?? []).map((role) => role.name ?? "");
	for (const policy of member.policies ?? []) for (const group of policy.permission_groups ?? []) names.push(group.name ?? "");
	return names.filter(Boolean);
}

export function memberChecks(members: Read<Member[]>): CfCheck[] {
	const twoFactorWhy = "An account member without two-factor authentication can be taken over with a password alone, from a phishing page or another site's leak, and with them your domains.";
	const adminWhy = "Super Administrators can do anything, including removing everyone else. Each one is a way in; keep two, so one can recover the other.";
	if (!members.ok) {
		return [
			couldNot("member-2fa", "account", "Two-factor authentication for members", "high", twoFactorWhy, members, PERMISSIONS.members),
			couldNot("super-admins", "account", "Super Administrators", "low", adminWhy, members, PERMISSIONS.members),
		];
	}
	const accepted = members.value.filter((member) => member.status !== "pending" && member.status !== "rejected");
	const without = accepted.filter((member) => member.user?.two_factor_authentication_enabled === false);
	const unknown = accepted.filter((member) => typeof member.user?.two_factor_authentication_enabled !== "boolean");
	const out: CfCheck[] = [];
	if (without.length > 0) {
		out.push(
			check("member-2fa", "account", "Two-factor authentication for members", "failed", "high", `${without.length} of ${accepted.length} members ${without.length === 1 ? "has" : "have"} no two-factor authentication.`, twoFactorWhy, {
				fix: ["Ask each one to turn on two-factor authentication in their own Cloudflare profile, or remove them in Cloudflare → Manage Account → Members.", "Super Administrators can require it for every member from the same page."],
				items: without.map((member) => maskEmail(member.user?.email)),
			}),
		);
	} else if (unknown.length > 0) {
		out.push(check("member-2fa", "account", "Two-factor authentication for members", "unknown", "high", `Cloudflare did not say whether ${unknown.length} of ${accepted.length} members use it.`, twoFactorWhy, { items: unknown.map((member) => maskEmail(member.user?.email)) }));
	} else {
		out.push(check("member-2fa", "account", "Two-factor authentication for members", "passed", "high", `All ${accepted.length} members use it.`, twoFactorWhy));
	}
	const admins = accepted.filter((member) => roleNames(member).some((name) => /super administrator/i.test(name)));
	const pending = members.value.filter((member) => member.status === "pending");
	const roleItems = accepted.map((member) => `${maskEmail(member.user?.email)}: ${roleNames(member).slice(0, 4).join(", ") || "no role listed"}`);
	if (admins.length > 2 || pending.length > 0) {
		const parts = [admins.length > 2 ? `${admins.length} Super Administrators` : null, pending.length > 0 ? `${pending.length} invitation${pending.length === 1 ? "" : "s"} not yet accepted` : null].filter(Boolean);
		out.push(
			check("super-admins", "account", "Super Administrators", "failed", "low", `${parts.join(" and ")}.`, adminWhy, {
				fix: ["In Cloudflare → Manage Account → Members, give people the narrowest role that does their job, and revoke invitations nobody will accept."],
				items: [...roleItems, ...pending.map((member) => `${maskEmail(member.user?.email)}: invited, not accepted`)],
			}),
		);
	} else {
		out.push(check("super-admins", "account", "Super Administrators", "passed", "low", `${admins.length} Super Administrator${admins.length === 1 ? "" : "s"}, no open invitations.`, adminWhy, { items: roleItems }));
	}
	return out;
}

const ALL_RESOURCES = /^com\.cloudflare\.api\.(account\.zone\.\*|account\.\*|user\.\*)$/;

/** Whether a token can change things across every zone or account, and how it is limited. */
export function tokenBreadth(token: ApiToken): { writes: string[]; everywhere: boolean; ipLimited: boolean; expires: boolean } {
	const writes = new Set<string>();
	let everywhere = false;
	for (const policy of token.policies ?? []) {
		if (policy.effect === "deny") continue;
		const groups = (policy.permission_groups ?? []).map((group) => group.name ?? "");
		const writing = groups.filter((name) => /\b(write|edit|admin)\b/i.test(name));
		for (const name of writing) writes.add(name);
		const resources = Object.keys(policy.resources ?? {});
		if (writing.length > 0 && resources.some((resource) => ALL_RESOURCES.test(resource) || resource.endsWith(".*"))) everywhere = true;
	}
	return { writes: [...writes], everywhere, ipLimited: (token.condition?.request_ip?.in?.length ?? 0) > 0, expires: typeof token.expires_on === "string" && token.expires_on !== "" };
}

export function tokenChecks(id: string, title: string, tokens: Read<ApiToken[]>, permission: string, path: string, now: Date, selfId?: string): CfCheck {
	const why = "An API token that can change every zone, with no address limit and no end date, is as good as your password to whoever finds it in a repository, a CI log or an old laptop. Unused tokens are risk with no benefit.";
	if (!tokens.ok) return couldNot(id, "account", title, "medium", why, tokens, permission);
	const items: string[] = [];
	let worst: Severity | null = null;
	const raise = (severity: Severity) => {
		const order: Severity[] = ["low", "medium", "high", "critical"];
		if (worst === null || order.indexOf(severity) > order.indexOf(worst)) worst = severity;
	};
	for (const token of tokens.value) {
		if (token.status && token.status !== "active") continue;
		const name = (token.name ?? "unnamed token").slice(0, 80);
		const self = selfId !== undefined && token.id === selfId ? " (the token Porchlight uses)" : "";
		const breadth = tokenBreadth(token);
		if (breadth.everywhere && breadth.writes.length > 0 && !breadth.ipLimited && !breadth.expires) {
			raise("medium");
			items.push(`${name}${self}: can change every zone or account (${breadth.writes.slice(0, 4).join(", ")}${breadth.writes.length > 4 ? ", …" : ""}) from any address, with no end date`);
		}
		const last = Date.parse(token.last_used_on ?? "");
		const issued = Date.parse(token.issued_on ?? "");
		const idleDays = Number.isNaN(last) ? (Number.isNaN(issued) ? null : Math.floor((now.getTime() - issued) / DAY)) : Math.floor((now.getTime() - last) / DAY);
		if (!self && idleDays !== null && idleDays > 180) {
			raise("low");
			items.push(`${name}: ${Number.isNaN(last) ? "never used" : "not used"} in ${idleDays} days`);
		}
	}
	const count = tokens.value.length;
	if (worst === null) return check(id, "account", title, "passed", "medium", `${count} token${count === 1 ? "" : "s"}, none with broad rights left open, none unused for six months.`, why);
	return check(id, "account", title, "failed", worst, `${items.length} token${items.length === 1 ? " needs" : "s need"} attention.`, why, {
		fix: [`In ${path}, delete tokens nobody uses, and give the rest only the zones and permissions they need, a client IP address filter and an end date.`],
		items,
	});
}
