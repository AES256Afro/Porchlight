/**
 * The Cloudflare account audit: what Porchlight reads from the owner's own Cloudflare account through
 * an API token they give it, and the built-in rules' verdict on it. Every rule is plain code
 * (`rules.ts`); a model may analyse the result afterwards but decides nothing.
 *
 * What a token could not read is `unknown`, shown as "Could not check" and never as passed
 * (invariant 5). A feature the zone's plan does not include is `unavailable`, never a fault.
 */
import type { Severity } from "../repos/types.ts";

export const CF_AREAS = ["tls", "dns", "email", "firewall", "ownership", "account"] as const;
export type CfArea = (typeof CF_AREAS)[number];

/**
 * - `passed`: the setting is as the rule recommends.
 * - `failed`: it is weaker than recommended; `severity` says how much that matters.
 * - `unknown`: the token could not read it, or the answer was not understood. Never a pass.
 * - `unavailable`: the zone's plan does not include the feature. Never a fault.
 */
export type CfStatus = "passed" | "failed" | "unknown" | "unavailable";

export const CF_PLANS = ["free", "pro", "business", "enterprise"] as const;
export type CfPlan = (typeof CF_PLANS)[number] | "unknown";

export interface CfCheck {
	/** The rule, stable across audits: "ssl-mode", "dnssec", "member-2fa". */
	id: string;
	area: CfArea;
	title: string;
	status: CfStatus;
	/** How serious it is when it fails. Kept for every status, to order them. */
	severity: Severity;
	/** What was seen, in words. Never a token, never an email in full. */
	detail: string;
	/** Why the rule matters. */
	why: string;
	/** Steps to repair it. Dashboard paths are written as known click paths ("Cloudflare → SSL/TLS → Overview"). */
	fix?: string[];
	/** The API call that changes it, for the owner to read or run themselves. */
	api?: string;
	/** A list the detail refers to: records, members, tokens. Members are named by a masked email only. */
	items?: string[];
	/** A change Porchlight can make, but only once the owner approves the exact request on this computer's page. */
	change?: CfChangeId;
	/** For `unknown` because of a missing permission: the permission to add to the token. */
	permission?: string;
}

/** The changes Porchlight can make. Each is built from a fixed template in `apply.ts`. */
export const CF_CHANGES = ["ownership-record", "always-use-https", "min-tls-1.2", "tls-1.3", "automatic-https-rewrites", "browser-check"] as const;
export type CfChangeId = (typeof CF_CHANGES)[number];

export interface CfZoneReport {
	id: string;
	name: string;
	plan: CfPlan;
	/** The plan as Cloudflare names it, such as "Free Website". */
	planName: string;
	status: string;
	paused: boolean;
	accountId: string;
	checks: CfCheck[];
}

export interface CfAccountReport {
	id: string;
	name: string;
	checks: CfCheck[];
}

/** One permission the audit asks the token for, and whether a request that needs it was answered. */
export interface CfPermissionState {
	name: string;
	scope: "Zone" | "Account" | "User";
	/** true: a request needing it was answered; false: every one was refused; null: none was made. */
	granted: boolean | null;
	/** What it lets Porchlight read, in words. */
	purpose: string;
}

export interface CfReport {
	checkedAt: string;
	token: {
		/** "active" when Cloudflare says so; anything else is said as Cloudflare said it. */
		status: string;
		kind: "user" | "account";
		expiresOn?: string;
	};
	permissions: CfPermissionState[];
	accounts: CfAccountReport[];
	/** The checks of the user who owns the token: their own API tokens. Empty for an account token. */
	userChecks: CfCheck[];
	zones: CfZoneReport[];
	/** Zones the account has that were not audited (the limit), by count. */
	zonesSkipped: number;
	/** What this audit does not look at, so a clean result is not read as more than it is. */
	notCovered: string[];
	/** Whether it looked up where CNAME records point, for zones whose ownership record proved them. */
	lookups: boolean;
}

export interface CfProgress {
	done: number;
	total: number;
	current: string;
}
