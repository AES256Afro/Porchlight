import { basename } from "node:path";
import { describeFilter, matchesFilter, noFilter, type FindingFilter } from "../../ui/filter.js";
import { coverageNotes, rankRepos, repoName } from "../repos/report.ts";
import { severityRank, type Finding, type ScanReport, type Severity } from "../repos/types.ts";
import { assemble, emptyCounts, type Action, type FindingRow, type FindingsList, type PhaseKey, type Planned, type Roadmap } from "./types.ts";
import { bumpKind, highestVersion, mayBreak } from "./versions.ts";

const SUMMARIES: Record<PhaseKey, string> = {
	now: "Credentials that look live, and critical vulnerabilities.",
	next: "High-severity vulnerabilities, and personal data in git history such as ID numbers or data dumps.",
	schedule: "Medium-severity vulnerabilities, possible secrets that need a look, and other personal data.",
	later: "Low-severity vulnerabilities, matches that are unlikely to be real secrets, and low-risk private data such as network names and example values.",
};

const PHASE_OF: Record<Severity, PhaseKey> = { critical: "now", high: "next", medium: "schedule", low: "later" };

/** Locations listed for a batch of secrets to check before the rest are summarised as a count. */
const MAX_LISTED = 8;

/**
 * Turns a repository scan into repairs, one per package to upgrade or
 * credential to deal with, instead of one line per finding.
 *
 * Every repair is planned from the whole repository; a filter only chooses
 * which repairs are listed (those clearing at least one finding it lets
 * through). Planning from the filtered part would name an upgrade that clears
 * the advisories on show and leaves the others in place.
 */
export function buildRepoRoadmap(report: ScanReport, filter: FindingFilter = noFilter()): Roadmap {
	return assemble(
		{
			title: "Repair roadmap",
			source: report.root,
			scannedAt: report.scannedAt,
			scope: describeFilter(filter),
			caveats: coverageNotes(report),
		},
		SUMMARIES,
		plan(report).filter(({ group, findings }) => findings.some((finding) => matchesFilter(finding, group, filter))),
	);
}

/**
 * Every finding the filter lets through, each with the repair that clears
 * it. The repair is planned from the whole repository, not the filtered
 * part, so an upgrade named here is the one that clears every advisory
 * against the package and not only the ones on show.
 */
export function listRepoFindings(report: ScanReport, filter: FindingFilter = noFilter()): FindingsList {
	const rows: FindingRow[] = [];
	for (const { group, phase, action, findings } of plan(report)) {
		for (const finding of findings) {
			if (!matchesFilter(finding, group, filter)) continue;
			rows.push({
				place: group,
				severity: finding.severity,
				type: finding.kind === "secret" ? "Secret" : finding.kind === "private-data" ? "Private data" : "Vulnerability",
				id: finding.ruleId,
				title: finding.title,
				where: finding.location,
				detail: finding.detail,
				...(finding.note ? { note: finding.note } : {}),
				phase,
				suggestion: action.title,
				how: action.how,
			});
		}
	}
	rows.sort(
		(a, b) =>
			severityRank(a.severity) - severityRank(b.severity) ||
			a.type.localeCompare(b.type) ||
			a.place.localeCompare(b.place) ||
			a.where.localeCompare(b.where) ||
			a.id.localeCompare(b.id),
	);
	return {
		title: "Findings and suggested fixes",
		source: report.root,
		scannedAt: report.scannedAt,
		scope: describeFilter(filter),
		caveats: coverageNotes(report),
		rows,
	};
}

/** The repair for each finding of a report, for showing beside it. Keyed by the finding objects of `report`. */
export function suggestionsFor(report: ScanReport): Map<Finding, { title: string; how: string[]; phase: PhaseKey }> {
	const suggestions = new Map<Finding, { title: string; how: string[]; phase: PhaseKey }>();
	for (const { phase, action, findings } of plan(report)) {
		for (const finding of findings) suggestions.set(finding, { title: action.title, how: action.how, phase });
	}
	return suggestions;
}

/**
 * Groups a repository's findings into actions: one per package to upgrade,
 * credential to rotate, or batch of doubtful matches to check. Takes no
 * filter on purpose (invariant 12): see buildRepoRoadmap.
 */
function plan(report: ScanReport): Planned<Finding>[] {
	const entries: Planned<Finding>[] = [];

	for (const repo of rankRepos(report.repos)) {
		const name = repoName(report, repo);
		const findings = repo.findings;

		for (const group of groupBy(findings.filter((finding) => finding.kind === "vulnerability"), (finding) => `${finding.location}\n${finding.detail}`)) {
			const action = upgradeAction(group);
			entries.push({ group: name, phase: PHASE_OF[action.priority], action, findings: group });
		}

		// A key in a file git does not track has never left this computer: it is kept out of git, not rotated.
		const local = findings.filter((finding) => finding.kind === "secret" && finding.source === "local");
		if (local.length > 0) {
			const action = keepAction(local, "keys");
			entries.push({ group: name, phase: PHASE_OF[action.priority], action, findings: local });
		}
		entries.push(...privateActions(name, findings.filter((finding) => finding.kind === "private-data")));
		const secrets = findings.filter((finding) => finding.kind === "secret" && finding.source !== "local");
		for (const secret of secrets.filter((finding) => finding.severity === "high")) {
			// A credential that looks live outranks its own severity label: until it is rotated it is usable.
			entries.push({ group: name, phase: "now", action: rotateAction(secret), findings: [secret] });
		}
		for (const group of groupBy(secrets.filter((finding) => finding.severity !== "high"), (finding) => `${finding.severity}\n${finding.note ?? ""}`)) {
			const action = reviewAction(group);
			entries.push({ group: name, phase: PHASE_OF[action.priority], action, findings: group });
		}
	}
	return entries;
}

/** One package at one version in one lockfile: a single upgrade clears every advisory against it. */
function upgradeAction(findings: Finding[]): Action {
	const first = findings[0]!;
	const at = first.detail.lastIndexOf("@");
	// Steps mark commands with backticks, so a name may not bring its own.
	const [name, version] = [first.detail.slice(0, at), first.detail.slice(at + 1)].map((part) => part.replace(/`/g, "")) as [string, string];
	const target = highestVersion(findings.map((finding) => finding.fixedIn).filter((fix) => fix !== undefined))?.replace(/`/g, "");
	const unfixed = findings.filter((finding) => finding.fixedIn === undefined);
	const base = { priority: worst(findings), where: first.location, clears: unique(findings.map((finding) => finding.ruleId)), counts: count(findings), match: first.detail };

	if (target === undefined) {
		return {
			...base,
			kind: "replace",
			title: `Replace or mitigate ${name} ${version}: no fixed release is published`,
			how: [
				"Check the advisories for a workaround, or for a maintained package to move to.",
				"If neither exists, record why the risk is accepted, and look again when the advisories change.",
			],
		};
	}
	const how = [upgradeHint(name, target, first.location)];
	if (bumpKind(version, target) === "major") how.push("This is a major version change: read the changelog for breaking changes before upgrading.");
	else if (mayBreak(version, target)) how.push("Before version 1.0, this change can break things like a major version: read the changelog before upgrading.");
	if (unfixed.length > 0) {
		how.push(`${unfixed.length} of these have no fixed release yet and will remain: ${unfixed.map((finding) => finding.ruleId).join(", ")}.`);
	}
	return { ...base, kind: "upgrade", title: `Upgrade ${name} from ${version} to ${target} or later`, how };
}

/** The command for the package manager that owns the lockfile. */
function upgradeHint(name: string, target: string, lockfile: string): string {
	const file = basename(lockfile).toLowerCase();
	const transitive = (why: string) => ` If it stays below ${target}, it is pulled in by another package: \`${why}\` shows which one to upgrade.`;
	if (file === "package-lock.json" || file === "npm-shrinkwrap.json") return `Run \`npm update ${name}\`.${transitive(`npm ls ${name}`)}`;
	if (file === "pnpm-lock.yaml") return `Run \`pnpm update ${name}\`.${transitive(`pnpm why ${name}`)}`;
	if (file === "yarn.lock") return `Run \`yarn up ${name}\` (\`yarn upgrade ${name}\` on Yarn 1).${transitive(`yarn why ${name}`)}`;
	if (file === "uv.lock") return `Run \`uv lock --upgrade-package ${name}\`.`;
	if (file === "poetry.lock") return `Run \`poetry update ${name}\`.`;
	if (file === "pipfile.lock") return `Run \`pipenv update ${name}\`.`;
	if (/^requirements.*\.txt$/.test(file)) return `Change the pin to \`${name}>=${target}\` and reinstall.`;
	if (file === "cargo.lock") return `Run \`cargo update -p ${name}\`.`;
	if (file === "go.mod" || file === "go.sum") return `Run \`go get ${name}@v${target.replace(/^v/, "")}\`, then \`go mod tidy\`.`;
	if (file === "gemfile.lock") return `Run \`bundle update ${name}\`.`;
	if (file === "composer.lock") return `Run \`composer update ${name}\`.`;
	return `Raise ${name} to ${target} or later with the package manager that owns this file.`;
}

function rotateAction(secret: Finding): Action {
	return {
		kind: "rotate",
		priority: secret.severity,
		title: `Rotate the credential in ${secret.location}`,
		where: secret.location,
		how: [
			"Revoke or rotate it with the service that issued it. It is in git history, so deleting the line does not make it safe.",
			"Load the new value from the environment or a secret store, not from a committed file.",
			"If the value turns out to be public by design, record it in .gitleaksignore so it stops being reported.",
		],
		clears: [`${secret.ruleId} (${secret.detail})`],
		counts: count([secret]),
		match: secret.location,
	};
}

/** Network names and addresses, and private data that rules call examples: looked at, not purged. */
const REVIEW_RULES = new Set(["private-ip", "private-tailnet-ip", "private-tailnet-name", "private-internal-name"]);

/**
 * Repairs for private data in one repository: data on this computer only is kept out of git; data
 * in a file that was committed is removed from history, one action per file, since that is how
 * history is rewritten; network names and example values are checked, a batch at a time.
 */
function privateActions(name: string, findings: Finding[]): Planned<Finding>[] {
	const entries: Planned<Finding>[] = [];
	const local = findings.filter((finding) => finding.source === "local");
	if (local.length > 0) {
		const action = keepAction(local, "personal data");
		entries.push({ group: name, phase: PHASE_OF[action.priority], action, findings: local });
	}
	const committed = findings.filter((finding) => finding.source !== "local");
	const example = (finding: Finding) => /examples or testing/.test(finding.note ?? "");
	const metadata = (finding: Finding) => /in project metadata/.test(finding.note ?? "");
	const network = committed.filter((finding) => REVIEW_RULES.has(finding.ruleId));
	const examples = committed.filter((finding) => !REVIEW_RULES.has(finding.ruleId) && example(finding));
	const maintainers = committed.filter((finding) => !REVIEW_RULES.has(finding.ruleId) && !example(finding) && metadata(finding));
	for (const file of groupBy(committed.filter((finding) => !REVIEW_RULES.has(finding.ruleId) && !example(finding) && !metadata(finding)), (finding) => fileOf(finding))) {
		const action = purgeAction(file);
		entries.push({ group: name, phase: PHASE_OF[action.priority], action, findings: file });
	}
	for (const [batch, kind] of [
		[network, "network"],
		[maintainers, "metadata"],
		[examples, "examples"],
	] as const) {
		if (batch.length === 0) continue;
		const action = privateReviewAction(batch, kind);
		entries.push({ group: name, phase: PHASE_OF[action.priority], action, findings: batch });
	}
	return entries;
}

/** The file a finding is in, without its line. */
function fileOf(finding: Finding): string {
	return finding.location.replace(/:\d+$/, "");
}

/** Private data in a committed file: deleting it now leaves it in every earlier commit, so history is rewritten. */
function purgeAction(findings: Finding[]): Action {
	// Steps mark commands with backticks, so a file name may not bring its own.
	const file = fileOf(findings[0]!).replace(/`/g, "");
	const whole = findings.every((finding) => finding.ruleId === "private-document" || finding.ruleId === "private-dump-file" || finding.ruleId === "private-photo-location");
	return {
		kind: "purge",
		priority: worst(findings),
		title: `Remove the personal data in ${file} from git history`,
		where: file,
		how: [
			`It is in git history, so deleting it now leaves it in every earlier commit. ${whole ? `Rewrite history without the file: \`git filter-repo --invert-paths --path ${shellPath(file)}\`.` : `Rewrite history without it: \`git filter-repo --invert-paths --path ${shellPath(file)}\` drops the whole file, or \`git filter-repo --replace-text <file of expressions>\` replaces the values alone.`} Then force-push every branch and tag.`,
			"Every clone, fork and CI cache still has the old history: ask for fresh clones, and treat the data as seen by anyone who had access.",
			"Keep such data out of the repository from now on: add the file to .gitignore, and load real data from outside the repository.",
			"If it turns out to be made-up sample data, record it in .gitleaksignore so it stops being reported.",
		],
		clears: unique(findings.map((finding) => finding.ruleId)),
		counts: count(findings),
		match: fileOf(findings[0]!),
	};
}

/** A path as one shell word: quoted when it holds anything but plain path characters. */
function shellPath(path: string): string {
	return /^[\w./-]+$/.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`;
}

/** Network names and addresses, a project's own contact details, or values published for examples: checked in one sitting. */
function privateReviewAction(findings: Finding[], kind: "network" | "metadata" | "examples"): Action {
	const files = unique(findings.map(fileOf));
	const listed = files.slice(0, MAX_LISTED);
	if (files.length > MAX_LISTED) listed.push(`and ${files.length - MAX_LISTED} more`);
	const where = files.length === 1 ? "1 file" : `${files.length} files`;
	return {
		kind: "review",
		priority: worst(findings),
		title:
			kind === "network"
				? `Check the internal network names and addresses in ${where}`
				: kind === "metadata"
					? `Check the contact details in the project metadata of ${where}`
					: `Check the example personal data in ${where}`,
		where: listed.join(", "),
		how:
			kind === "network"
				? [
						"They show how a private network is laid out: which machines exist and what they are called. On their own they open nothing.",
						"If the repository is public, or will be, move them into configuration that is not committed.",
					]
				: kind === "metadata"
					? [
							"A maintainer's address in package metadata, a licence or an authors file is usually published on purpose.",
							"Check that each one is meant to be public. If one is a personal address, use a role address or the forge's no-reply address instead.",
						]
					: [
						"These are values published for examples and testing (example.com addresses, test card numbers, fictional phone numbers), so they usually need no repair.",
						"Check that nothing real sits beside them, then record them in .gitleaksignore so they stop being reported.",
					],
		clears: unique(findings.map((finding) => finding.ruleId)),
		counts: count(findings),
		...(files.length === 1 ? { match: files[0]! } : {}),
	};
}

/** Keys or personal data in files git does not track: nothing to repair while they stay out of every commit. */
function keepAction(found: Finding[], what: "keys" | "personal data"): Action {
	const files = unique(found.map(fileOf));
	const listed = files.slice(0, MAX_LISTED);
	if (files.length > MAX_LISTED) listed.push(`and ${files.length - MAX_LISTED} more`);
	return {
		kind: "keep",
		priority: worst(found),
		title: `Keep ${files.length === 1 ? "1 file" : `${files.length} files`} with ${what} out of git`,
		where: listed.join(", "),
		how: [
			what === "keys"
				? "These files are on this computer only: git does not track them, so the keys in them have not been committed. They need no rotation while that stays true."
				: "These files are on this computer only: git does not track them, or the change is not committed, so the data in them has not left this computer.",
			"Check that .gitignore covers each one (`git check-ignore -v <file>` names the rule), so a later `git add` cannot pick it up.",
			what === "keys"
				? "If one was shared some other way (copied into a chat, a ticket or another machine), rotate that key with the service that issued it."
				: "If the data is other people's, keep it somewhere meant for it rather than in a project folder.",
		],
		clears: unique(found.map((finding) => finding.ruleId)),
		counts: count(found),
		...(files.length === 1 ? { match: files[0]! } : {}),
	};
}

/** Possible secrets with the same doubt against them, checked in one sitting. */
function reviewAction(secrets: Finding[]): Action {
	const first = secrets[0]!;
	const doubt = first.note?.replace(/^Ranked lower: /, "");
	const listed = secrets.slice(0, MAX_LISTED).map((secret) => secret.location);
	if (secrets.length > MAX_LISTED) listed.push(`and ${secrets.length - MAX_LISTED} more`);
	return {
		kind: "review",
		priority: first.severity,
		title: `Check ${secrets.length === 1 ? "1 possible secret" : `${secrets.length} possible secrets`}${doubt ? ` (${doubt})` : ""}`,
		where: listed.join(", "),
		how: [
			"Open each location. A live credential must be rotated with the service that issued it, because it is in git history.",
			"Record placeholders and test values in .gitleaksignore so they stop being reported.",
		],
		clears: unique(secrets.map((secret) => secret.ruleId)),
		counts: count(secrets),
		...(secrets.length === 1 ? { match: first.location } : {}),
	};
}

function groupBy<T>(items: T[], key: (item: T) => string): T[][] {
	const groups = new Map<string, T[]>();
	for (const item of items) groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
	return [...groups.values()];
}

function unique(values: string[]): string[] {
	return [...new Set(values)];
}

function count(findings: Finding[]) {
	const counts = emptyCounts();
	for (const finding of findings) counts[finding.severity]++;
	return counts;
}

function worst(findings: Finding[]): Severity {
	return findings.reduce((best, finding) => (severityRank(finding.severity) < severityRank(best) ? finding.severity : best), "low" as Severity);
}
