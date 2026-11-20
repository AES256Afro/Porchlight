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
	method: "POST" | "PATCH";
	path: string;
	/** The full address, as sent. */
	url: string;
	body: unknown;
	/** For the ownership record: the token its value holds, kept by this computer once it is added. */
	ownershipToken?: string;
	createdAt: number;
}

/** How long a request shown to the owner can still be approved. */
export const APPROVAL_WINDOW_MS = 10 * 60_000;

const SETTING_CHANGES: Record<Exclude<CfChangeId, "ownership-record">, { settingId: string; value: string; title: string }> = {
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
export function planChange(zone: { id: string; name: string }, change: CfChangeId, ownershipToken?: string): PlannedChange {
	if (!isCloudflareId(zone.id)) throw new Error("Not a Cloudflare zone ID");
	const base = { id: randomBytes(12).toString("hex"), zoneId: zone.id, zone: zone.name, change, createdAt: Date.now() };
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
	const template = SETTING_CHANGES[change];
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
		request: {
			method: planned.method,
			url: planned.url,
			headers: { Authorization: "Bearer (your saved token, not shown)", "Content-Type": "application/json" },
			body: planned.body,
		},
		expiresAt: new Date(planned.createdAt + APPROVAL_WINDOW_MS).toISOString(),
	};
}

/** Sends one approved change, exactly as planned. `denied`: the token lacks the permission for it. */
export async function sendChange(client: CfClient, planned: PlannedChange): Promise<{ ok: boolean; result: string; denied?: boolean }> {
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
): PlannedChange[] {
	const planned: PlannedChange[] = [];
	for (const zone of zones) {
		for (const check of zone.checks) {
			if (check.status !== "failed" || !check.change || planned.length >= MAX_BATCH) continue;
			planned.push(planChange(zone, check.change, check.change === "ownership-record" ? ownershipToken(zone.name) : undefined));
		}
	}
	return planned;
}
