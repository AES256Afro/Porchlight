/**
 * The GitHub settings audit (invariant 24): reads the settings of the repositories the owner's token
 * can administer, then runs the built-in rules on what it read. It only reads: every request is a GET to
 * api.github.com at an address `auditAddress` builds, with the token as the Authorization header.
 *
 * What is kept is what the rules need and the page shows: a secret-scanning alert's type (GitHub is
 * asked with `hide_secret=true`, and the secret is never read from the answer), a Dependabot alert's
 * severity, a deploy key's title and whether it can write, and a webhook's host. Never a key, a secret,
 * a webhook's path, query or secret, or the token (invariant 3).
 */
import { GhClient, MAX_PAGES, PER_PAGE, type GhAnswer, type Sleep } from "./audit-client.ts";
import { PERMISSIONS, permissionWords, repoChecks, type BranchRule, type ClassicProtection, type DeployKey, type PermissionKey, type Read, type RepoData, type Webhook } from "./audit-rules.ts";
import { GH_AREAS, type GhCheck, type GhPermissionState, type GhProgress, type GhRepoReport, type GhReport } from "./audit-types.ts";
import { auditAddress, parseRepoName, validBranch, type BranchRead, type RepoRead } from "./github.ts";

/** Repositories audited in one run: about a dozen reads each, well inside GitHub's 5,000 an hour. */
export const MAX_REPOS = 100;
/** Characters kept of a name GitHub gives (an alert's type, a deploy key's title). */
const NAME_CHARS = 80;

export interface GithubAuditOptions {
	token: string;
	fetchFn?: typeof fetch;
	onProgress?: (progress: GhProgress) => void;
	now?: () => Date;
	maxRepos?: number;
	/** Waits out GitHub's rate limit. Tests pass one that only records the wait. */
	sleep?: Sleep;
}

export class GithubAuditError extends Error {}

interface ListedRepo {
	name: string;
	private: boolean;
	fork: boolean;
	archived: boolean;
	admin: boolean;
	defaultBranch: string | null;
}

/** What the audit asks the token for, in the order the page lists them. */
export const READ_PERMISSIONS = (Object.keys(PERMISSIONS) as PermissionKey[]).map((key) => ({ key, ...PERMISSIONS[key] }));

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A name from GitHub, as text: no control characters, no backticks, cut short. */
function cleanName(value: unknown, fallback: string): string {
	const text = typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f`]/g, " ").trim() : "";
	return text === "" ? fallback : text.slice(0, NAME_CHARS);
}

export async function auditGithub(options: GithubAuditOptions): Promise<GhReport> {
	const now = options.now ?? (() => new Date());
	const client = new GhClient(options.token, options.fetchFn ?? fetch, options.sleep, () => now().getTime());
	const evidence = new Map<PermissionKey, boolean>();
	const note = (permission: PermissionKey, granted: boolean) => {
		if (granted) evidence.set(permission, true);
		else if (!evidence.get(permission)) evidence.set(permission, false);
	};

	const notCovered: string[] = [
		"Branches other than the default branch, tags and their protection, and environments with their protection rules.",
		"An organisation's own settings, members, two-factor rule and the rulesets it keeps: they are read only as they apply to each repository's default branch.",
		"Actions secrets and variables, which actions may run, and self-hosted runners.",
		"GitHub Apps, OAuth apps and personal access tokens with access to your repositories.",
		"Code scanning alerts.",
		"Where each secret-scanning alert's secret was found, and the secret itself: alerts are counted by type, and GitHub is asked to leave the secret out.",
		"Workflows from forks on private repositories.",
	];

	const listed = await client.list<unknown>((page) => auditAddress({ list: true }, { affiliation: "owner,collaborator,organization_member", sort: "pushed", per_page: String(PER_PAGE), page: String(page) }));
	if (!listed.ok) {
		if (listed.kind === "refused") throw new GithubAuditError(listed.message);
		if (listed.kind === "limited") throw new GithubAuditError("GitHub's rate limit is used up for now. Audit again later.");
		if (listed.kind === "denied" || listed.kind === "missing") throw new GithubAuditError(`GitHub would not list the token's repositories. Give the token ${permissionWords("metadata")}.`);
		throw new GithubAuditError(`GitHub did not list the repositories: ${listed.message}`);
	}
	note("metadata", true);
	if (listed.truncated) notCovered.unshift(`Repositories beyond the first ${listed.value.length}: GitHub's list is longer than the ${MAX_PAGES} pages Porchlight reads.`);
	const repos = listed.value.map(toListed).filter((repo): repo is ListedRepo => repo !== null);
	const archived = repos.filter((repo) => repo.archived);
	const readOnly = repos.filter((repo) => !repo.archived && !repo.admin);
	const eligible = repos.filter((repo) => !repo.archived && repo.admin);
	if (archived.length > 0) notCovered.unshift(`${archived.length} archived ${archived.length === 1 ? "repository" : "repositories"}: nothing can be pushed to an archived repository, so its settings are not audited.`);
	if (readOnly.length > 0) notCovered.unshift(`${readOnly.length} ${readOnly.length === 1 ? "repository" : "repositories"} you can read but do not administer: GitHub shows a repository's settings to its admins alone.`);
	const limit = options.maxRepos ?? MAX_REPOS;
	const audited = eligible.slice(0, limit);
	if (eligible.length > limit) notCovered.unshift(`${eligible.length - limit} of the ${eligible.length} repositories you administer: an audit covers the ${limit} pushed to most recently.`);

	const reports: GhRepoReport[] = [];
	for (const [index, repo] of audited.entries()) {
		options.onProgress?.({ done: index, total: audited.length, current: repo.name });
		const checks = await guarded(() => readRepo(client, repo, note).then(repoChecks));
		reports.push({ name: repo.name, private: repo.private, fork: repo.fork, defaultBranch: repo.defaultBranch, checks: sortChecks(checks) });
	}
	options.onProgress?.({ done: audited.length, total: audited.length, current: "" });
	if (client.limited) notCovered.unshift("Some settings: GitHub's rate limit was reached during the audit, so those checks say Could not check. Audit again later.");

	const permissions: GhPermissionState[] = READ_PERMISSIONS.map(({ key, name, classic, purpose }) => ({ name, classic, purpose, granted: evidence.has(key) ? (evidence.get(key) as boolean) : null }));
	return { checkedAt: now().toISOString(), repos: reports, reposSkipped: Math.max(0, eligible.length - audited.length), permissions, notCovered, rateLimited: client.limited };
}

function toListed(item: unknown): ListedRepo | null {
	if (!isObject(item) || typeof item.full_name !== "string" || !parseRepoName(item.full_name)) return null;
	const permissions = isObject(item.permissions) ? item.permissions : {};
	return {
		name: item.full_name,
		private: item.private === true,
		fork: item.fork === true,
		archived: item.archived === true,
		admin: permissions.admin === true,
		defaultBranch: typeof item.default_branch === "string" ? item.default_branch : null,
	};
}

type Note = (permission: PermissionKey, granted: boolean) => void;

/** Reads one repository's settings, a dozen GETs at once, and turns each answer into a `Read`. */
async function readRepo(client: GhClient, repo: ListedRepo, note: Note): Promise<RepoData> {
	const at = (read: RepoRead, query: Record<string, string> = {}) => auditAddress({ repo: repo.name, read }, query);
	const atBranch = (read: BranchRead) => auditAddress({ repo: repo.name, branch: repo.defaultBranch as string, read });
	const branchOk = repo.defaultBranch !== null && validBranch(repo.defaultBranch);
	const pages = (read: RepoRead, query: Record<string, string> = {}) => (page: number) => at(read, { ...query, per_page: String(PER_PAGE), page: String(page) });
	const notAsked = <T>(): Promise<GhAnswer<T>> => Promise.resolve({ ok: false, status: 0, kind: "failed", message: "not asked" });

	const [details, protection, rules, vulnerability, dependabot, secrets, actions, workflow, fork, keys, hooks] = await Promise.all([
		client.get<unknown>(at("repo")),
		branchOk ? client.get<unknown>(atBranch("protection")) : notAsked<unknown>(),
		branchOk ? client.list<unknown>((page) => auditAddress({ repo: repo.name, branch: repo.defaultBranch as string, read: "rules" }, { per_page: String(PER_PAGE), page: String(page) })) : notAsked<unknown[]>(),
		client.get<unknown>(at("vulnerabilityAlerts")),
		// Dependabot's list pages by cursor and refuses `page`.
		client.cursorList<unknown>((after) => at("dependabotAlerts", { state: "open", per_page: String(PER_PAGE), ...(after ? { after } : {}) })),
		client.list<unknown>(pages("secretAlerts", { state: "open", hide_secret: "true" })),
		client.get<unknown>(at("actions")),
		client.get<unknown>(at("workflow")),
		repo.private ? notAsked<unknown>() : client.get<unknown>(at("forkApproval")),
		client.list<unknown>(pages("keys")),
		client.list<unknown>(pages("hooks")),
	]);

	/** An answer as a Read: refused reads name `permission`; 404, where GitHub hides what a token cannot see, too. */
	const read = <T>(answer: GhAnswer<unknown>, permission: PermissionKey, convert: (value: unknown) => T | undefined): Read<T> => {
		if (answer.ok) {
			note(permission, true);
			const value = convert(answer.value);
			if (value === undefined) return { ok: false, why: "failed", message: "its answer was not in the form Porchlight expects" };
			return answer.truncated ? { ok: true, value, partial: true } : { ok: true, value };
		}
		if (answer.kind === "unavailable") return { ok: false, why: "unavailable", message: answer.message };
		if (answer.kind === "denied" || answer.kind === "missing") {
			note(permission, false);
			return { ok: false, why: "denied", message: answer.message, permission };
		}
		return { ok: false, why: "failed", message: answer.message, permission };
	};
	/** A whole list or nothing, for a rule that would pass on items it never saw (keys, webhooks). */
	const whole = <T>(value: Read<T>): Read<T> => (value.ok && value.partial ? { ok: false, why: "failed", message: `the list is longer than the ${MAX_PAGES} pages Porchlight reads, so it was not read whole` } : value);
	const said = (answer: GhAnswer<unknown>, pattern: RegExp) => !answer.ok && pattern.test(answer.message);

	if (!details.ok) throw new RepoUnread(read(details, "metadata", () => null));
	const security = isObject(details.value) && isObject(details.value.security_and_analysis) ? details.value.security_and_analysis : null;
	const statuses: Read<Record<string, string>> = security
		? {
				ok: true,
				value: Object.fromEntries(Object.entries(security).flatMap(([feature, setting]) => (isObject(setting) && typeof setting.status === "string" ? [[feature, setting.status]] : []))),
			}
		: isObject(details.value) && isObject(details.value.permissions) && details.value.permissions.admin === true
			? // The token administers the repository, so the block's absence is GitHub not offering these features
				// here: secret scanning on a private repository of a personal account, say.
				{ ok: false, why: "unavailable", message: "GitHub does not offer secret scanning or push protection for this repository on its plan" }
			: // GitHub leaves the block out of its answer for a token that may not see it.
				{ ok: false, why: "denied", message: "GitHub left these settings out of its answer", permission: "administration" };

	// Classic protection: a 404 that says the branch is not protected is an answer, not a refusal.
	// A repository with no commit yet has no branch to protect: GitHub says "Branch not found".
	const empty = said(protection, /branch not found/i) || (isObject(details.value) && details.value.size === 0 && !protection.ok && protection.kind === "missing");
	const protectionRead: Read<ClassicProtection | null> = !branchOk
		? { ok: false, why: "failed", message: repo.defaultBranch === null ? "no branch" : "the default branch's name is not one Porchlight puts in an address" }
		: empty
			? { ok: false, why: "unavailable", message: "the repository has no commits yet, so its default branch does not exist" }
		: said(protection, /branch not protected/i)
			? (note("administration", true), { ok: true, value: null })
			: read(protection, "administration", (value) => (isObject(value) ? (value as ClassicProtection) : undefined));
	const rulesRead: Read<BranchRule[]> = branchOk
		? whole(read(rules, "metadata", (value) => (Array.isArray(value) && value.every(isObject) ? (value as BranchRule[]) : undefined)))
		: { ok: false, why: "failed", message: "the default branch's name is not one Porchlight puts in an address" };

	// Dependabot: the alerts list says whether they are on; else 204 or 404 from vulnerability-alerts,
	// where a 404 means off only once another Administration read proved the token may ask.
	const alertsOff = said(dependabot, /disabled|not enabled/i);
	const dependabotAlerts: Read<string[]> = alertsOff
		? { ok: true, value: [] }
		: read(dependabot, "dependabotAlerts", (value) =>
		Array.isArray(value) ? value.map((alert) => (isObject(alert) && isObject(alert.security_advisory) && typeof alert.security_advisory.severity === "string" ? alert.security_advisory.severity.toLowerCase() : "unknown")) : undefined,
	);
	const workflowRead = read(workflow, "administration", (value) =>
		isObject(value) && typeof value.default_workflow_permissions === "string" ? { defaultPermission: value.default_workflow_permissions, canApprove: value.can_approve_pull_request_reviews === true } : undefined,
	);
	const adminProven = protectionRead.ok || workflowRead.ok;
	let dependabotOn: Read<boolean>;
	if (dependabot.ok) dependabotOn = { ok: true, value: true };
	else if (alertsOff) dependabotOn = { ok: true, value: false };
	else if (vulnerability.ok) {
		note("administration", true);
		dependabotOn = { ok: true, value: true };
	} else if (!vulnerability.ok && vulnerability.kind === "missing" && adminProven) dependabotOn = { ok: true, value: false };
	else dependabotOn = read(vulnerability, "administration", () => true);

	// Secret-scanning alerts: GitHub answers 404 with "disabled" when scanning is off.
	const secretAlerts: Read<string[] | null> = said(secrets, /disabled|not enabled/i)
		? { ok: true, value: null }
		: read(secrets, "secretAlerts", (value) => (Array.isArray(value) ? value.map((alert) => (isObject(alert) ? cleanName(alert.secret_type_display_name ?? alert.secret_type, "a type GitHub did not name") : "a type GitHub did not name")) : undefined));

	return {
		name: repo.name,
		private: repo.private,
		defaultBranch: repo.defaultBranch,
		security: statuses,
		protection: protectionRead,
		rules: rulesRead,
		dependabotOn,
		dependabotAlerts,
		secretAlerts,
		actionsOn: read(actions, "administration", (value) => (isObject(value) && typeof value.enabled === "boolean" ? value.enabled : undefined)),
		workflow: workflowRead,
		forkApproval: repo.private
			? null
			: !fork.ok && fork.kind === "missing"
				? { ok: false, why: "unavailable", message: "GitHub did not offer this setting" }
				: read(fork, "administration", (value) => (isObject(value) && typeof value.approval_policy === "string" ? value.approval_policy : undefined)),
		keys: whole(read(keys, "administration", (value) => (Array.isArray(value) ? value.map(toKey) : undefined))),
		hooks: whole(read(hooks, "webhooks", (value) => (Array.isArray(value) ? value.map(toHook) : undefined))),
	};
}

/** A deploy key's title and whether it can write. Its `key` is never read. */
function toKey(item: unknown): DeployKey {
	const fields = isObject(item) ? item : {};
	// A key whose flag is missing is counted as able to write: it is not known to be read-only.
	return { title: cleanName(fields.title, "untitled key"), readOnly: fields.read_only === true };
}

/** A webhook's host and how it is sent. Its path, query, user name and secret are never kept. */
function toHook(item: unknown): Webhook {
	const config = isObject(item) && isObject(item.config) ? item.config : {};
	let host = "an address Porchlight could not read";
	let plainHttp = false;
	if (typeof config.url === "string") {
		try {
			const url = new URL(config.url);
			plainHttp = url.protocol === "http:";
			host = /^[A-Za-z0-9.:[\]-]{1,253}$/.test(url.host) ? url.host : "a host Porchlight does not show";
		} catch {
			// Kept as unread; not shown.
		}
	}
	return { host, plainHttp, noCertificateCheck: config.insecure_ssl === "1" || config.insecure_ssl === 1 };
}

/** A repository whose own details could not be read: one check that says so, never a pass. */
class RepoUnread extends Error {
	read: Read<unknown>;
	constructor(read: Read<unknown>) {
		super("unread");
		this.read = read;
	}
}

async function guarded(checks: () => Promise<GhCheck[]>): Promise<GhCheck[]> {
	try {
		return await checks();
	} catch (err) {
		const read = err instanceof RepoUnread ? err.read : null;
		const denied = read !== null && !read.ok && read.why === "denied";
		return [
			{
				id: "repo-unread",
				area: "branches",
				title: "This repository's settings",
				status: "unknown",
				severity: "high",
				detail:
					read && !read.ok
						? denied
							? `This token may not read the repository. Give the token ${permissionWords("metadata")} for it.`
							: `GitHub did not answer: ${read.message}`
						: "GitHub answered in a form Porchlight did not understand, so these checks could not run. Audit again; if it stays, the answer has changed shape.",
				why: "A check that could not read its answer is never counted as passed.",
				...(denied ? { permission: PERMISSIONS.metadata.name } : {}),
			},
		];
	}
}

const STATUS_ORDER = { failed: 0, unknown: 1, unavailable: 2, passed: 3 };
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

/** Problems first, worst first; then what could not be checked; then the rest, by area. */
export function sortChecks(checks: GhCheck[]): GhCheck[] {
	return [...checks].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || GH_AREAS.indexOf(a.area) - GH_AREAS.indexOf(b.area));
}

export function allChecks(report: GhReport): GhCheck[] {
	return report.repos.flatMap((repo) => repo.checks);
}

export function ghCounts(checks: GhCheck[]): { failed: number; unknown: number; passed: number; unavailable: number; bySeverity: Record<string, number> } {
	const bySeverity: Record<string, number> = { critical: 0, high: 0, medium: 0, low: 0 };
	const counts = { failed: 0, unknown: 0, passed: 0, unavailable: 0 };
	for (const item of checks) {
		counts[item.status]++;
		if (item.status === "failed") bySeverity[item.severity] = (bySeverity[item.severity] ?? 0) + 1;
	}
	return { ...counts, bySeverity };
}
