/**
 * The GitHub settings audit (invariant 24): what Porchlight reads about the repositories the owner's
 * GitHub token can administer, and the built-in rules' verdict on it. Every rule is plain code
 * (`audit-rules.ts`). It only reads: nothing here describes a change.
 *
 * What the token could not read is `unknown`, shown as "Could not check" with the permission to add,
 * never as passed (invariant 5). A feature GitHub does not offer the repository (on its plan, or for
 * its visibility) is `unavailable`, never a fault.
 */
import type { Severity } from "../repos/types.ts";

export const GH_AREAS = ["branches", "secrets", "dependencies", "actions", "access"] as const;
export type GhArea = (typeof GH_AREAS)[number];

/**
 * - `passed`: the setting is as the rule recommends.
 * - `failed`: it is weaker than recommended; `severity` says how much that matters.
 * - `unknown`: the token could not read it, GitHub did not answer, or the answer was not understood.
 * - `unavailable`: GitHub does not offer it for this repository. Never a fault.
 */
export type GhStatus = "passed" | "failed" | "unknown" | "unavailable";

export interface GhCheck {
	/** The rule, stable across audits: "branch-force-push", "secret-scanning". */
	id: string;
	area: GhArea;
	title: string;
	status: GhStatus;
	/** How serious it is when it fails. Kept for every status, to order them. */
	severity: Severity;
	/** What was seen, in words. Never a token, a key, a secret or a webhook's address beyond its host. */
	detail: string;
	/** Why the rule matters. */
	why: string;
	/** Steps to repair it on GitHub. */
	fix?: string[];
	/** A list the detail refers to: alert counts by type, deploy key titles, webhook hosts. */
	items?: string[];
	/** For `unknown` because of a missing permission: the permission to add, as GitHub names it. */
	permission?: string;
}

export interface GhRepoReport {
	/** `owner/repository`. */
	name: string;
	private: boolean;
	fork: boolean;
	defaultBranch: string | null;
	checks: GhCheck[];
}

/** One permission the audit asks the token for, and whether a request that needed it was answered. */
export interface GhPermissionState {
	/** The fine-grained token's repository permission, as GitHub names it. */
	name: string;
	/** What a classic token needs for the same. */
	classic: string;
	/** true: a request needing it was answered; false: every one was refused; null: none was made. */
	granted: boolean | null;
	/** What it lets Porchlight read, in words. */
	purpose: string;
}

export interface GhReport {
	checkedAt: string;
	repos: GhRepoReport[];
	/** Repositories the token can administer that were not audited (the limit), by count. */
	reposSkipped: number;
	permissions: GhPermissionState[];
	/** What this audit does not look at, so a clean result is not read as more than it is. */
	notCovered: string[];
	/** GitHub's rate limit stopped some reads; they say Could not check. */
	rateLimited: boolean;
}

export interface GhProgress {
	done: number;
	total: number;
	current: string;
}

export type GithubAuditStatus =
	| { state: "idle" }
	| { state: "running"; startedAt: string; done: number; total: number; current: string }
	| { state: "done"; finishedAt: string }
	| { state: "failed"; finishedAt: string; error: string };
