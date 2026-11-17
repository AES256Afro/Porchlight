import { basename, relative } from "node:path";
import { describeFilter, matchesFilter, noFilter, type FindingFilter } from "../../ui/filter.js";
import { coverageNotes, rankRepos } from "../repos/report.ts";
import { severityRank, type Finding, type ScanReport, type Severity } from "../repos/types.ts";
import { assemble, emptyCounts, type Action, type FindingRow, type FindingsList, type PhaseKey, type Planned, type Roadmap } from "./types.ts";
import { bumpKind, highestVersion } from "./versions.ts";

const SUMMARIES: Record<PhaseKey, string> = {
	now: "Credentials that look live, and critical vulnerabilities.",
	next: "High-severity vulnerabilities.",
	schedule: "Medium-severity vulnerabilities, and possible secrets that need a look.",
	later: "Low-severity vulnerabilities, and matches that are unlikely to be real secrets.",
};

const PHASE_OF: Record<Severity, PhaseKey> = { critical: "now", high: "next", medium: "schedule", low: "later" };

/** Locations listed for a batch of secrets to check before the rest are summarised as a count. */
const MAX_LISTED = 8;

/**
 * Turns a repository scan into repairs, one per package to upgrade or
 * credential to deal with, instead of one line per finding.
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
		plan(report, filter),
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
	for (const { group, phase, action, findings } of plan(report, noFilter())) {
		for (const finding of findings) {
			if (!matchesFilter(finding, group, filter)) continue;
			rows.push({
				place: group,
				severity: finding.severity,
				type: finding.kind === "secret" ? "Secret" : "Vulnerability",
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
	for (const { phase, action, findings } of plan(report, noFilter())) {
		for (const finding of findings) suggestions.set(finding, { title: action.title, how: action.how, phase });
	}
	return suggestions;
}

/** Groups findings into actions: one per package to upgrade, credential to rotate, or batch of doubtful matches to check. */
function plan(report: ScanReport, filter: FindingFilter): Planned<Finding>[] {
	const entries: Planned<Finding>[] = [];

	for (const repo of rankRepos(report.repos)) {
		const name = relative(report.root, repo.path) || basename(report.root);
		const findings = repo.findings.filter((finding) => matchesFilter(finding, name, filter));

		for (const group of groupBy(findings.filter((finding) => finding.kind === "vulnerability"), (finding) => `${finding.location}\n${finding.detail}`)) {
			const action = upgradeAction(group);
			entries.push({ group: name, phase: PHASE_OF[action.priority], action, findings: group });
		}

		const secrets = findings.filter((finding) => finding.kind === "secret");
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
	const base = { priority: worst(findings), where: first.location, clears: unique(findings.map((finding) => finding.ruleId)), counts: count(findings) };

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
