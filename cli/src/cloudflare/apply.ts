/**
 * Changes Porchlight can make in the owner's Cloudflare account (invariant 21). Each is built here
 * from a fixed template and the zone's own ID; nothing from a request becomes part of it. The page
 * shows the exact request first; only the owner's approval on this computer's page sends it, and
 * every change sent is recorded. Nothing is ever applied automatically.
 */
import { randomBytes } from "node:crypto";
import { challengeName, challengeValue } from "../investigate/ownership.ts";
import { CfClient, isCloudflareId, zonePath } from "./client.ts";
import { CF_CHANGES, type CfChangeId } from "./types.ts";

export interface PlannedChange {
	/** Names this request while it waits for the owner. Random, so it cannot be guessed. */
	id: string;
	zoneId: string;
	zone: string;
	change: CfChangeId;
	title: string;
	/** The permission the token needs for it. */
	permission: string;
	method: "POST" | "PATCH" | "PUT";
	path: string;
	/**
	 * Set for a change that can affect how the site or its mail behaves: what could go wrong, in
	 * words. Such a change is shown with this warning and is never ticked for the owner.
	 */
	care?: string;
	/** The full address, as sent. */
	url: string;
	body: unknown;
	/** For the ownership record: the token its value holds, kept by this computer once it is added. */
	ownershipToken?: string;
	/** The audit (its `checkedAt`) that found the problem this change repairs. A newer audit ends the request. */
	auditAt?: string;
	createdAt: number;
}

/** How long a request shown to the owner can still be approved. */
export const APPROVAL_WINDOW_MS = 10 * 60_000;

type SettingChange = "always-use-https" | "min-tls-1.2" | "tls-1.3" | "automatic-https-rewrites" | "browser-check";

/**
 * Changes that are right for most sites and wrong for some. Each is still one fixed request; what
 * differs is that the owner is told what could go wrong and has to choose it.
 */
const CARE_CHANGES: Record<Exclude<CfChangeId, SettingChange | "ownership-record" | "dmarc-monitor">, { method: "PATCH" | "PUT"; path: string; body: unknown; title: string; permission: string; care: string }> = {
	"bot-fight-mode": {
		method: "PUT",
		path: "/bot_management",
		body: { fight_mode: true },
		title: "Turn on Bot Fight Mode",
		permission: "Bot Management Write",
		care: "It challenges traffic that looks automated, and that can include your own scripts, monitoring or an API client. It cannot be skipped for one path.",
	},
	dnssec: {
		method: "PATCH",
		path: "/dnssec",
		body: { status: "active" },
		title: "Turn on DNSSEC",
		permission: "DNS Write",
		care: "It protects nothing until the DS record Cloudflare then shows is added at your registrar. Cloudflare Registrar adds it for you; anywhere else you add it by hand. Later, moving the domain away from Cloudflare means turning DNSSEC off first.",
	},
	hsts: {
		method: "PATCH",
		path: "/settings/security_header",
		body: { value: { strict_transport_security: { enabled: true, max_age: 15_552_000, include_subdomains: false, preload: false, nosniff: true } } },
		title: "Turn on HSTS for 6 months",
		permission: "Zone Settings Write",
		care: "Browsers that have visited then refuse plain HTTP for this domain for 6 months, and turning it off does not undo that for them. Do it only if the site works over HTTPS and will keep doing so. Subdomains are not included.",
	},
	"ssl-strict": {
		method: "PATCH",
		path: "/settings/ssl",
		body: { value: "strict" },
		title: "Set the encryption mode to Full (strict)",
		permission: "Zone Settings Write",
		care: "Cloudflare then checks your server's certificate. If it is expired, self-signed or for another name, visitors get error 526 until it is fixed or the mode is set back to Full.",
	},
};

const SETTING_CHANGES: Record<SettingChange, { settingId: string; value: string; title: string }> = {
	"always-use-https": { settingId: "always_use_https", value: "on", title: "Turn on Always Use HTTPS" },
	"min-tls-1.2": { settingId: "min_tls_version", value: "1.2", title: "Set the minimum TLS version to 1.2" },
	"tls-1.3": { settingId: "tls_1_3", value: "on", title: "Turn on TLS 1.3" },
	"automatic-https-rewrites": { settingId: "automatic_https_rewrites", value: "on", title: "Turn on Automatic HTTPS Rewrites" },
	"browser-check": { settingId: "browser_check", value: "on", title: "Turn on Browser Integrity Check" },
};

export function isChangeId(value: unknown): value is CfChangeId {
	return typeof value === "string" && (CF_CHANGES as readonly string[]).includes(value);
}

/** The exact request for a change to one zone. `ownershipToken` is needed for the ownership record. */
export function planChange(zone: { id: string; name: string }, change: CfChangeId, ownershipToken?: string, auditAt?: string): PlannedChange {
	if (!isCloudflareId(zone.id)) throw new Error("Not a Cloudflare zone ID");
	const base = { id: randomBytes(12).toString("hex"), zoneId: zone.id, zone: zone.name, change, createdAt: Date.now(), ...(auditAt ? { auditAt } : {}) };
	if (change === "ownership-record") {
		if (!ownershipToken || !/^[0-9a-f]{16,128}$/.test(ownershipToken)) throw new Error("No ownership token for this zone");
		const path = zonePath(zone.id, "/dns_records");
		return {
			...base,
			title: `Add Porchlight's ownership record to ${zone.name}`,
			permission: "DNS Write",
			method: "POST",
			path,
			url: CfClient.url(path).href,
			// TXT content is sent quoted, as Cloudflare stores it.
			body: { type: "TXT", name: challengeName(zone.name), content: `"${challengeValue(ownershipToken)}"`, ttl: 1, comment: "Porchlight ownership record" },
			ownershipToken,
		};
	}
	if (change === "dmarc-monitor") {
		const path = zonePath(zone.id, "/dns_records");
		return {
			...base,
			title: `Add a DMARC record that only reports to ${zone.name}`,
			permission: "DNS Write",
			method: "POST",
			path,
			url: CfClient.url(path).href,
			body: { type: "TXT", name: `_dmarc.${zone.name}`, content: '"v=DMARC1; p=none"', ttl: 1, comment: "Added by Porchlight: reports only" },
			care: "It blocks nothing: it is the first step. The audit will still list DMARC as weak until you change the policy to quarantine or reject, which should wait until you know who sends mail for the domain.",
		};
	}
	if (change in CARE_CHANGES) {
		const template = CARE_CHANGES[change as keyof typeof CARE_CHANGES];
		const path = zonePath(zone.id, template.path);
		return { ...base, title: `${template.title} for ${zone.name}`, permission: template.permission, method: template.method, path, url: CfClient.url(path).href, body: template.body, care: template.care };
	}
	const template = SETTING_CHANGES[change as SettingChange];
	const path = zonePath(zone.id, `/settings/${template.settingId}`);
	return { ...base, title: `${template.title} for ${zone.name}`, permission: "Zone Settings Write", method: "PATCH", path, url: CfClient.url(path).href, body: { value: template.value } };
}

/** What the page shows before the owner approves: everything that will be sent, but the token. */
export function describeChange(planned: PlannedChange) {
	return {
		id: planned.id,
		zone: planned.zone,
		change: planned.change,
		title: planned.title,
		permission: planned.permission,
		...(planned.care ? { care: planned.care } : {}),
		request: {
			method: planned.method,
			url: planned.url,
			headers: { Authorization: "Bearer (your saved token, not shown)", "Content-Type": "application/json" },
			body: planned.body,
		},
		expiresAt: new Date(planned.createdAt + APPROVAL_WINDOW_MS).toISOString(),
	};
}

/**
 * Whether a change still repairs what the audit found, from the value Cloudflare holds now. The owner
 * may have changed it in Cloudflare's dashboard since the request was shown, perhaps to something
 * stronger than the fixed template (HSTS with preload, TLS 1.3 as the minimum), which sending it
 * would lower (S28). Each reads one fixed path of the same zone; a value that cannot be read or is not
 * understood means the change is not sent.
 */
export async function stillNeeded(client: CfClient, planned: PlannedChange): Promise<{ needed: true } | { needed: false; why: string }> {
	const unread = (message: string) => ({ needed: false as const, why: `Porchlight could not read the current value first (${message}), so it did not send the change.` });
	const changed = { needed: false as const, why: "the setting is no longer what the audit found: it was changed after the audit. Audit again to see it." };
	const setting = async (id: string, failing: (value: unknown) => boolean | null) => {
		const answer = await client.get<{ value?: unknown } | null>(zonePath(planned.zoneId, `/settings/${id}`));
		if (!answer.ok) return unread(answer.message);
		const verdict = failing(answer.result?.value);
		return verdict === null ? unread("its answer was not understood") : verdict ? { needed: true as const } : changed;
	};
	const records = async (query: Record<string, string>, failing: (records: { type?: unknown; name?: unknown; content?: unknown }[]) => boolean) => {
		const answer = await client.list<{ type?: unknown; name?: unknown; content?: unknown }>(zonePath(planned.zoneId, "/dns_records"), query, 100);
		if (!answer.ok) return unread(answer.message);
		if (answer.truncated) return unread("the list of records is too long to read whole");
		return failing(answer.result) ? { needed: true as const } : changed;
	};
	const named = (name: string) => (record: { name?: unknown }) => typeof record.name === "string" && record.name.toLowerCase().replace(/\.$/, "") === name.toLowerCase();
	const text = (content: unknown) => (typeof content === "string" ? content.replace(/^"|"$/g, "").replace(/"\s*"/g, "") : "");
	const notOn = (value: unknown) => (typeof value === "string" ? value !== "on" : null);
	switch (planned.change) {
		case "always-use-https":
		case "automatic-https-rewrites":
		case "browser-check":
			return setting(SETTING_CHANGES[planned.change].settingId, notOn);
		case "tls-1.3":
			return setting("tls_1_3", (value) => (typeof value === "string" ? value !== "on" && value !== "zrt" : null));
		// Only TLS 1.0 or 1.1 is what the audit faults; a minimum of 1.3 set since must not be lowered.
		case "min-tls-1.2":
			return setting("min_tls_version", (value) => (typeof value === "string" ? value === "1.0" || value === "1.1" : null));
		// Only HSTS that is off: one turned on since, with any max-age, subdomains or preload, is the owner's.
		case "hsts":
			return setting("security_header", (value) => {
				if (typeof value !== "object" || value === null) return null;
				return (value as { strict_transport_security?: { enabled?: unknown } }).strict_transport_security?.enabled !== true;
			});
		// Offered from Full only (rules.ts): from Flexible or Off the server may not answer over HTTPS at all.
		case "ssl-strict":
			return setting("ssl", (value) => (typeof value === "string" ? value === "full" : null));
		case "dnssec": {
			const answer = await client.get<{ status?: unknown } | null>(zonePath(planned.zoneId, "/dnssec"));
			if (!answer.ok) return unread(answer.message);
			const status = answer.result?.status;
			if (typeof status !== "string") return unread("its answer was not understood");
			return status !== "active" && status !== "pending" ? { needed: true } : changed;
		}
		case "bot-fight-mode": {
			const answer = await client.get<{ fight_mode?: unknown } | null>(zonePath(planned.zoneId, "/bot_management"));
			if (!answer.ok) return unread(answer.message);
			if (typeof answer.result !== "object" || answer.result === null) return unread("its answer was not understood");
			return answer.result.fight_mode !== true ? { needed: true } : changed;
		}
		// Only where there is no DMARC record at all, a TXT or a CNAME to a reporting service.
		case "dmarc-monitor": {
			const name = `_dmarc.${planned.zone}`;
			return records({ name }, (found) => !found.some((record) => named(name)(record) && (record.type === "CNAME" || (record.type === "TXT" && /^v=DMARC1/i.test(text(record.content))))));
		}
		case "ownership-record": {
			const name = challengeName(planned.zone);
			const value = planned.ownershipToken ? challengeValue(planned.ownershipToken) : "";
			return records({ type: "TXT", name }, (found) => !found.some((record) => named(name)(record) && record.type === "TXT" && text(record.content) === value));
		}
	}
}

/**
 * Sends one approved change, exactly as planned, once it is clear the change still repairs what the
 * audit found. `denied`: the token lacks the permission for it. `notSent`: it was not sent, and why.
 */
export async function sendChange(client: CfClient, planned: PlannedChange): Promise<{ ok: boolean; result: string; denied?: boolean; notSent?: boolean }> {
	const current = await stillNeeded(client, planned);
	if (!current.needed) return { ok: false, notSent: true, result: `Not sent: ${current.why}` };
	const answer = await client.send<unknown>(planned.method, planned.path, planned.body);
	if (answer.ok) return { ok: true, result: "Cloudflare accepted the change." };
	const hint = answer.denied ? ` The token needs "${planned.permission}" for this.` : "";
	return { ok: false, result: `${answer.message}.${hint}`, ...(answer.denied ? { denied: true } : {}) };
}

/** The most changes one approval may cover. */
export const MAX_BATCH = 300;

/**
 * Every change the latest audit offers, for one zone or for all of them: one fixed template per
 * problem that has one, in the audit's own order. Nothing from a request chooses a change; a
 * request can only name a zone of the audit, or leave some of these out.
 */
export function planBatch(
	zones: readonly { id: string; name: string; checks: readonly { status: string; change?: CfChangeId }[] }[],
	ownershipToken: (zone: string) => string,
	auditAt?: string,
): { changes: PlannedChange[]; offered: number } {
	const planned: PlannedChange[] = [];
	// Counted past the limit too, so the page can say how many were left for the next "Fix these" (F-F5).
	let offered = 0;
	for (const zone of zones) {
		for (const check of zone.checks) {
			if (check.status !== "failed" || !check.change) continue;
			offered += 1;
			if (planned.length >= MAX_BATCH) continue;
			planned.push(planChange(zone, check.change, check.change === "ownership-record" ? ownershipToken(zone.name) : undefined, auditAt));
		}
	}
	return { changes: planned, offered };
}
