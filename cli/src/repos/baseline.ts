/**
 * `repos scan --baseline <report.json>` (FT-9): a CI gate that fails only on findings the baseline
 * does not hold. A finding is matched by its identity across scans (`findingKey`), as the history
 * matches it. The gate is conservative: a finding the baseline did not look for (a check it left out,
 * history it did not read, a scanner that failed there) is not in it, so it counts against the gate
 * rather than being waved through. An incomplete scan still cannot pass (`exitCode`).
 */
import { findingKey } from "../../ui/tracking.js";
import { keyed } from "./history.ts";
import { coverageNotes, repoName } from "./report.ts";
import { severityRank, type ScanReport, type Severity } from "./types.ts";

/** The report with only the findings the baseline does not hold: what `--fail-on` then judges. */
export function beyondBaseline(baseline: ScanReport, current: ScanReport): ScanReport {
	const known = keyed(baseline);
	return {
		...current,
		repos: current.repos.map((repo) => {
			const name = repoName(current, repo);
			return { ...repo, findings: repo.findings.filter((finding) => !known.has(findingKey(name, finding))) };
		}),
	};
}

/** How many findings are new against the baseline, and how many of those are at or above the threshold. */
export function baselineSummary(baseline: ScanReport, current: ScanReport, failOn: Severity | undefined): { total: number; newCount: number; atOrAbove: number } {
	const fresh = beyondBaseline(baseline, current).repos.flatMap((repo) => repo.findings);
	return {
		total: current.repos.reduce((sum, repo) => sum + repo.findings.length, 0),
		newCount: fresh.length,
		atOrAbove: failOn === undefined ? 0 : fresh.filter((finding) => severityRank(finding.severity) <= severityRank(failOn)).length,
	};
}

/** The baseline's own gaps: findings it did not look for count as new, and the owner is told why. */
export function baselineGaps(baseline: ScanReport): string[] {
	return coverageNotes(baseline);
}
