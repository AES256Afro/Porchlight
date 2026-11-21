/**
 * The GitHub settings audit's rules: what is weak in one repository's settings, and how to repair it.
 * Plain code, no model, no network: they read what `audit.ts` fetched and nothing else. A value the
 * token could not read makes its rule `unknown` with the permission to add, never `passed`
 * (invariant 5); a feature GitHub does not offer the repository is `unavailable`, never a fault.
 */
import type { Severity } from "../repos/types.ts";
import type { GhArea, GhCheck, GhStatus } from "./audit-types.ts";

/**
 * A value read from GitHub, or why it could not be. `permission` names what the token lacks when it
 * was refused; `unavailable` says GitHub does not offer it for this repository.
 */
export type Read<T> = { ok: true; value: T; partial?: boolean } | { ok: false; why: "denied" | "unavailable" | "failed"; message: string; permission?: PermissionKey };

/** The permissions the audit reads with: a fine-grained token's repository permission, and a classic token's scope. */
export const PERMISSIONS = {
	metadata: { name: "Metadata: Read-only", classic: "repo (public_repo for public repositories alone)", purpose: "the list of your repositories, their default branches, and the ruleset rules that apply to a branch" },
	administration: {
		name: "Administration: Read-only",
		classic: "repo",
		purpose: "classic branch protection, whether secret scanning, push protection and Dependabot alerts are on, the Actions settings, and deploy keys",
	},
	secretAlerts: { name: "Secret scanning alerts: Read-only", classic: "security_events (or repo)", purpose: "open secret-scanning alerts, counted by type; GitHub is asked to leave the secret out" },
	dependabotAlerts: { name: "Dependabot alerts: Read-only", classic: "security_events (or repo)", purpose: "open Dependabot alerts, counted by severity" },
	webhooks: { name: "Webhooks: Read-only", classic: "read:repo_hook", purpose: "webhooks that send over plain http or do not check the certificate; only each one's host is kept" },
} as const;
export type PermissionKey = keyof typeof PERMISSIONS;

/** Classic branch protection, as far as the rules read it. */
export interface ClassicProtection {
	required_pull_request_reviews?: { required_approving_review_count?: number } | null;
	allow_force_pushes?: { enabled?: boolean } | null;
	allow_deletions?: { enabled?: boolean } | null;
}

/** A ruleset rule in force on a branch (GitHub's "Get rules for a branch"). */
export interface BranchRule {
	type?: string;
	parameters?: { required_approving_review_count?: number } | null;
}

export interface Webhook {
	/** The host alone: never the path, the query or anything else of the address. */
	host: string;
	plainHttp: boolean;
	noCertificateCheck: boolean;
}

export interface DeployKey {
	title: string;
	readOnly: boolean;
}

/** What the audit read about one repository. */
export interface RepoData {
	name: string;
	private: boolean;
	/** null for a repository with no branch yet. */
	defaultBranch: string | null;
	/** GitHub's `security_and_analysis`: a status per feature; a feature absent is one GitHub does not offer it. */
	security: Read<Record<string, string>>;
	/** null when the branch has no classic protection. */
	protection: Read<ClassicProtection | null>;
	rules: Read<BranchRule[]>;
	/** Whether Dependabot alerts are on; false when GitHub said they are off. */
	dependabotOn: Read<boolean>;
	/** Open Dependabot alerts' severities, when they are on. */
	dependabotAlerts: Read<string[]>;
	/** Open secret-scanning alerts' types, when scanning is on; null when GitHub said it is off. */
	secretAlerts: Read<string[] | null>;
	/** Whether Actions may run at all. */
	actionsOn: Read<boolean>;
	workflow: Read<{ defaultPermission: string; canApprove: boolean }>;
	/** Public repositories only: which first-time contributors' workflows wait for approval. */
	forkApproval: Read<string> | null;
	keys: Read<DeployKey[]>;
	hooks: Read<Webhook[]>;
}

function check(id: string, area: GhArea, title: string, status: GhStatus, severity: Severity, detail: string, why: string, extra: { fix?: string[]; items?: string[]; permission?: string } = {}): GhCheck {
	return {
		id,
		area,
		title,
		status,
		severity,
		detail,
		why,
		...(extra.fix && status !== "passed" && status !== "unavailable" ? { fix: extra.fix } : {}),
		...(extra.items && extra.items.length > 0 ? { items: extra.items } : {}),
		...(extra.permission && status === "unknown" ? { permission: extra.permission } : {}),
	};
}

/** The words for a permission the token lacks: the fine-grained permission, and a classic token's scope. */
export function permissionWords(key: PermissionKey): string {
	return `"${PERMISSIONS[key].name}" (a classic token: the ${PERMISSIONS[key].classic} scope)`;
}

/** A rule that could not run: the token may not read what it needs, GitHub did not answer, or does not offer it. */
function couldNot(id: string, area: GhArea, title: string, severity: Severity, why: string, read: { why: "denied" | "unavailable" | "failed"; message: string; permission?: PermissionKey }): GhCheck {
	if (read.why === "unavailable") return check(id, area, title, "unavailable", severity, `GitHub does not offer this for this repository: ${read.message}`, why);
	if (read.why === "denied" && read.permission) {
		return check(id, area, title, "unknown", severity, `This token may not read it. Give the token ${permissionWords(read.permission)} to check it.`, why, { permission: PERMISSIONS[read.permission].name });
	}
	return check(id, area, title, "unknown", severity, `GitHub did not answer: ${read.message}`, why, read.permission ? { permission: PERMISSIONS[read.permission].name } : {});
}

const SETTINGS = "On GitHub, open the repository, then Settings";

/** Every check for one repository, in a fixed order. */
export function repoChecks(repo: RepoData): GhCheck[] {
	return [...branchChecks(repo), ...secretChecks(repo), ...dependabotChecks(repo), ...actionsChecks(repo), deployKeyCheck(repo), webhookCheck(repo)];
}

// Branch protection and rulesets, on the default branch.

const BRANCH_RULES = [
	{
		id: "branch-reviews",
		title: "Pull requests need an approving review before they merge into the default branch",
		severity: "medium" as Severity,
		why: "Without a required review, one stolen token or one hurried push puts code on the default branch that nobody else has read.",
		classic: (p: ClassicProtection) => (p.required_pull_request_reviews?.required_approving_review_count ?? 0) >= 1,
		rule: (r: BranchRule) => r.type === "pull_request" && (r.parameters?.required_approving_review_count ?? 0) >= 1,
		fix: [
			`${SETTINGS}, then Rules, then Rulesets, and add a branch ruleset for the default branch with "Require a pull request before merging" and at least one approval.`,
			"Working alone, you may list yourself under the ruleset's bypass list, so the rule still stops a token or an app that is not you.",
		],
	},
	{
		id: "branch-force-push",
		title: "Force pushes to the default branch are blocked",
		severity: "high" as Severity,
		why: "A force push rewrites history: it can remove the record of a change, or put back code that was taken out.",
		classic: (p: ClassicProtection) => p.allow_force_pushes?.enabled !== true,
		rule: (r: BranchRule) => r.type === "non_fast_forward",
		fix: [`${SETTINGS}, then Rules, then Rulesets, and add a branch ruleset for the default branch with "Block force pushes".`],
	},
	{
		id: "branch-deletion",
		title: "The default branch cannot be deleted",
		severity: "medium" as Severity,
		why: "A deleted default branch takes the repository's working history with it until someone restores it.",
		classic: (p: ClassicProtection) => p.allow_deletions?.enabled !== true,
		rule: (r: BranchRule) => r.type === "deletion",
		fix: [`${SETTINGS}, then Rules, then Rulesets, and add a branch ruleset for the default branch with "Restrict deletions".`],
	},
];

function branchChecks(repo: RepoData): GhCheck[] {
	return BRANCH_RULES.map((rule) => {
		if (repo.defaultBranch === null) return check(rule.id, "branches", rule.title, "unavailable", rule.severity, "The repository has no branch yet, so there is nothing to protect.", rule.why);
		const branch = repo.defaultBranch;
		if (repo.rules.ok && repo.rules.value.some(rule.rule)) return check(rule.id, "branches", rule.title, "passed", rule.severity, `A ruleset does this on ${branch}.`, rule.why);
		if (repo.protection.ok && repo.protection.value && rule.classic(repo.protection.value)) return check(rule.id, "branches", rule.title, "passed", rule.severity, `Branch protection does this on ${branch}.`, rule.why);
		// Neither says so. Only when both were read is that a finding; a read that failed proves nothing.
		if (!repo.rules.ok) return couldNot(rule.id, "branches", rule.title, rule.severity, rule.why, repo.rules);
		if (!repo.protection.ok) {
			if (repo.protection.why === "unavailable") {
				// An empty repository's default branch does not exist yet; anything else is a plan that lacks the feature.
				if (/no commits/.test(repo.protection.message)) return check(rule.id, "branches", rule.title, "unavailable", rule.severity, "The repository has no commits yet, so there is no branch to protect.", rule.why);
				return check(rule.id, "branches", rule.title, "unavailable", rule.severity, `GitHub offers branch protection and rulesets for a private repository on a paid plan only, and no ruleset applies to ${branch}.`, rule.why);
			}
			return couldNot(rule.id, "branches", rule.title, rule.severity, rule.why, repo.protection);
		}
		const how = repo.protection.value ? "Branch protection is on" : "There is no branch protection";
		return check(rule.id, "branches", rule.title, "failed", rule.severity, `${how} for ${branch}, and no ruleset does this.`, rule.why, { fix: rule.fix });
	});
}

// Secret scanning, push protection and open alerts.

function secretChecks(repo: RepoData): GhCheck[] {
	const out: GhCheck[] = [];
	const scanningWhy = "Secret scanning tells you when a credential is committed, so it can be revoked before someone else finds it.";
	const pushWhy = "Push protection stops a push that holds a known kind of credential, before it is ever on GitHub.";
	const alertsWhy = "An open alert is a credential GitHub found in the repository. Until it is revoked, anyone who reads the repository can use it.";
	const scanningTitle = "Secret scanning is on";
	const pushTitle = "Push protection is on";
	if (!repo.security.ok) {
		out.push(couldNot("secret-scanning", "secrets", scanningTitle, "high", scanningWhy, repo.security), couldNot("push-protection", "secrets", pushTitle, "medium", pushWhy, repo.security));
	} else {
		out.push(featureCheck(repo, "secret-scanning", scanningTitle, "high", scanningWhy, repo.security.value.secret_scanning, "Secret scanning", "Advanced Security (or Code security), then Secret Protection"));
		out.push(featureCheck(repo, "push-protection", pushTitle, "medium", pushWhy, repo.security.value.secret_scanning_push_protection, "Push protection", "Advanced Security (or Code security), then Push protection"));
	}
	const scanningOff = repo.security.ok && repo.security.value.secret_scanning !== "enabled";
	const alertsTitle = "No open secret-scanning alerts";
	// With scanning off there are no alerts to count: the check above already says so.
	if (scanningOff) return out;
	if (!repo.secretAlerts.ok) out.push(couldNot("secret-alerts", "secrets", alertsTitle, "critical", alertsWhy, repo.secretAlerts));
	else if (repo.secretAlerts.value === null) out.push(check("secret-alerts", "secrets", alertsTitle, "unavailable", "critical", "GitHub says secret scanning is off for this repository, so it has no alerts to count.", alertsWhy));
	else {
		const types = repo.secretAlerts.value;
		const counts = countBy(types);
		const more = repo.secretAlerts.partial ? "at least " : "";
		out.push(
			types.length === 0
				? check("secret-alerts", "secrets", alertsTitle, "passed", "critical", "GitHub has no open secret-scanning alert for this repository.", alertsWhy)
				: check("secret-alerts", "secrets", alertsTitle, "failed", "critical", `${more}${types.length} open ${types.length === 1 ? "alert" : "alerts"}, counted by type. Porchlight asked GitHub to leave the secrets out and kept none.`, alertsWhy, {
						items: counts.map(([type, count]) => `${type}: ${count}`),
						fix: [
							"Revoke or rotate each credential with the service that issued it first: removing it from the repository does not stop it working.",
							"On GitHub, open the repository, then Security, then Secret scanning, and close each alert as revoked once it is.",
						],
					}),
		);
	}
	return out;
}

function featureCheck(repo: RepoData, id: string, title: string, severity: Severity, why: string, status: string | undefined, name: string, where: string): GhCheck {
	if (status === "enabled") return check(id, "secrets", title, "passed", severity, `${name} is on.`, why);
	if (status === undefined) {
		return check(id, "secrets", title, "unavailable", severity, repo.private ? `GitHub does not offer ${name.toLowerCase()} for this private repository: it needs GitHub Secret Protection.` : `GitHub does not offer ${name.toLowerCase()} for this repository.`, why);
	}
	if (status !== "disabled") return check(id, "secrets", title, "unknown", severity, `GitHub said "${status.slice(0, 40)}", which Porchlight does not recognise.`, why);
	return check(id, "secrets", title, "failed", severity, `${name} is off.`, why, { fix: [`${SETTINGS}, then ${where}, and turn it on.`] });
}

// Dependabot alerts.

const SEVERITY_ORDER: Severity[] = ["critical", "high", "medium", "low"];

function dependabotChecks(repo: RepoData): GhCheck[] {
	const onWhy = "Dependabot alerts tell you when a package the repository uses has a published vulnerability, between Porchlight's own scans.";
	const openWhy = "An open alert is a known vulnerability in a package the repository uses. It is fixed by upgrading the package, or dismissed with a reason.";
	const onTitle = "Dependabot alerts are on";
	const openTitle = "No open Dependabot alerts";
	if (!repo.dependabotOn.ok) return [couldNot("dependabot-on", "dependencies", onTitle, "medium", onWhy, repo.dependabotOn)];
	if (!repo.dependabotOn.value) {
		return [check("dependabot-on", "dependencies", onTitle, "failed", "medium", "Dependabot alerts are off.", onWhy, { fix: [`${SETTINGS}, then Advanced Security (or Code security), then Dependabot alerts, and turn them on.`] })];
	}
	const out = [check("dependabot-on", "dependencies", onTitle, "passed", "medium", "Dependabot alerts are on.", onWhy)];
	if (!repo.dependabotAlerts.ok) {
		out.push(couldNot("dependabot-open", "dependencies", openTitle, "high", openWhy, repo.dependabotAlerts));
		return out;
	}
	const severities = repo.dependabotAlerts.value.map((value) => (value === "moderate" ? "medium" : value));
	if (severities.length === 0) {
		out.push(check("dependabot-open", "dependencies", openTitle, "passed", "high", "GitHub has no open Dependabot alert for this repository.", openWhy));
		return out;
	}
	const worst = SEVERITY_ORDER.find((severity) => severities.includes(severity)) ?? "low";
	const counts = SEVERITY_ORDER.map((severity) => [severity, severities.filter((value) => value === severity).length] as const).filter(([, count]) => count > 0);
	const other = severities.filter((value) => !SEVERITY_ORDER.includes(value as Severity)).length;
	const more = repo.dependabotAlerts.partial ? "at least " : "";
	out.push(
		check("dependabot-open", "dependencies", openTitle, "failed", worst, `${more}${severities.length} open ${severities.length === 1 ? "alert" : "alerts"}.`, openWhy, {
			items: [...counts.map(([severity, count]) => `${severity}: ${count}`), ...(other > 0 ? [`severity not given: ${other}`] : [])],
			fix: [`On GitHub, open the repository, then Security, then Dependabot, and upgrade each package it names; Porchlight's own scan of the repository lists the same with the version that fixes it.`],
		}),
	);
	return out;
}

// Actions.

function actionsChecks(repo: RepoData): GhCheck[] {
	const tokenWhy = "A workflow's GITHUB_TOKEN that can write lets any step of any workflow, and any action it uses, push code or change releases.";
	const approveWhy = "A workflow that may approve pull requests can approve its own changes, which defeats a required review.";
	const forkWhy = "A workflow run from a stranger's pull request runs their code with your workflow's access; approving the first one from each new contributor keeps a person in the way.";
	const tokenTitle = "Workflows get a read-only token by default";
	const approveTitle = "Workflows may not approve pull requests";
	const forkTitle = "Workflows from first-time contributors wait for approval";
	if (repo.actionsOn.ok && !repo.actionsOn.value) {
		return [
			check("actions-token", "actions", tokenTitle, "passed", "medium", "Actions is off for this repository.", tokenWhy),
			check("actions-approve", "actions", approveTitle, "passed", "medium", "Actions is off for this repository.", approveWhy),
		];
	}
	const out: GhCheck[] = [];
	if (!repo.workflow.ok) {
		out.push(couldNot("actions-token", "actions", tokenTitle, "medium", tokenWhy, repo.workflow), couldNot("actions-approve", "actions", approveTitle, "medium", approveWhy, repo.workflow));
	} else {
		const { defaultPermission, canApprove } = repo.workflow.value;
		const where = `${SETTINGS}, then Actions, then General, under Workflow permissions`;
		out.push(
			defaultPermission === "read"
				? check("actions-token", "actions", tokenTitle, "passed", "medium", "The default is read-only.", tokenWhy)
				: defaultPermission === "write"
					? check("actions-token", "actions", tokenTitle, "failed", "medium", "Every workflow's token can write to the repository unless the workflow says otherwise.", tokenWhy, {
							fix: [`${where}, choose "Read repository contents and packages permissions"; give a workflow that needs more its own \`permissions:\` block.`],
						})
					: check("actions-token", "actions", tokenTitle, "unknown", "medium", "GitHub's answer was not one Porchlight recognises.", tokenWhy),
		);
		out.push(
			canApprove
				? check("actions-approve", "actions", approveTitle, "failed", "medium", "GitHub Actions may create and approve pull requests.", approveWhy, { fix: [`${where}, untick "Allow GitHub Actions to create and approve pull requests".`] })
				: check("actions-approve", "actions", approveTitle, "passed", "medium", "GitHub Actions may not approve pull requests.", approveWhy),
		);
	}
	if (repo.forkApproval !== null) {
		const policy = repo.forkApproval;
		if (!policy.ok) out.push(couldNot("fork-approval", "actions", forkTitle, "low", forkWhy, policy));
		else if (policy.value === "first_time_contributors" || policy.value === "all_external_contributors") {
			out.push(check("fork-approval", "actions", forkTitle, "passed", "low", policy.value === "all_external_contributors" ? "Every outside contributor's workflows wait for approval." : "Every first-time contributor's workflows wait for approval.", forkWhy));
		} else if (policy.value === "first_time_contributors_new_to_github") {
			out.push(
				check("fork-approval", "actions", forkTitle, "failed", "low", "Only contributors new to GitHub wait for approval: anyone with an older account runs workflows on their first pull request.", forkWhy, {
					fix: [`${SETTINGS}, then Actions, then General, under "Approval for running fork pull request workflows from contributors", choose "Require approval for first-time contributors".`],
				}),
			);
		} else out.push(check("fork-approval", "actions", forkTitle, "unknown", "low", "GitHub's answer was not one Porchlight recognises.", forkWhy));
	}
	return out;
}

// Deploy keys and webhooks.

function deployKeyCheck(repo: RepoData): GhCheck {
	const why = "A deploy key that can write pushes to the repository from wherever the key is kept, past every review, and nobody's account is named on the push.";
	const title = "Deploy keys are read-only";
	if (!repo.keys.ok) return couldNot("deploy-keys", "access", title, "medium", why, repo.keys);
	const writers = repo.keys.value.filter((key) => !key.readOnly);
	if (writers.length === 0) return check("deploy-keys", "access", title, "passed", "medium", repo.keys.value.length === 0 ? "The repository has no deploy keys." : `${repo.keys.value.length} deploy ${repo.keys.value.length === 1 ? "key, read-only" : "keys, all read-only"}.`, why);
	return check("deploy-keys", "access", title, "failed", "medium", `${writers.length} of ${repo.keys.value.length} deploy ${repo.keys.value.length === 1 ? "key" : "keys"} can write. Listed by title; the keys themselves are never read.`, why, {
		items: writers.map((key) => key.title),
		fix: [`${SETTINGS}, then Deploy keys. Remove each key that need not push, and add it again without "Allow write access" where it only reads.`],
	});
}

function webhookCheck(repo: RepoData): GhCheck {
	const why = "A webhook sent over plain http, or without checking the certificate, can be read or changed by anyone on the way, and its payload names your repository's changes.";
	const title = "Webhooks use https and check the certificate";
	if (!repo.hooks.ok) return couldNot("webhooks", "access", title, "high", why, repo.hooks);
	const plain = repo.hooks.value.filter((hook) => hook.plainHttp);
	const unchecked = repo.hooks.value.filter((hook) => !hook.plainHttp && hook.noCertificateCheck);
	if (plain.length + unchecked.length === 0) {
		return check("webhooks", "access", title, "passed", "high", repo.hooks.value.length === 0 ? "The repository has no webhooks." : `${repo.hooks.value.length} ${repo.hooks.value.length === 1 ? "webhook uses" : "webhooks use"} https with the certificate checked.`, why);
	}
	return check("webhooks", "access", title, "failed", plain.length > 0 ? "high" : "medium", `${plain.length + unchecked.length} of ${repo.hooks.value.length} ${repo.hooks.value.length === 1 ? "webhook is" : "webhooks are"} insecure. Listed by host alone.`, why, {
		items: [...plain.map((hook) => `${hook.host}: plain http`), ...unchecked.map((hook) => `${hook.host}: the certificate is not checked`)],
		fix: [`${SETTINGS}, then Webhooks. Edit each one listed: give it an https address, and choose "Enable SSL verification".`],
	});
}

function countBy(values: string[]): [string, number][] {
	const counts = new Map<string, number>();
	for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
	return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "en"));
}
