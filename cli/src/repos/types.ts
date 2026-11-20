export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export type ToolName = "gitleaks" | "osv-scanner";

/** One problem found in one repository, in a shape common to every scanner. */
export interface Finding {
	tool: ToolName;
	kind: "secret" | "vulnerability";
	severity: Severity;
	/** Scanner rule ID for a secret; advisory ID for a vulnerability. */
	ruleId: string;
	title: string;
	/** Path inside the repository, with a line number where there is one. */
	location: string;
	/** Commit for a secret; package and version for a vulnerability. */
	detail: string;
	/** Why the severity is lower than the finding type's default, when triage lowered it. */
	note?: string;
	/** For a vulnerability: the lowest release that fixes it, when the advisory names one. */
	fixedIn?: string;
}

export interface ToolStatus {
	tool: ToolName;
	/** `missing` means the scanner is not installed, so that kind of check did not run at all. */
	status: "ok" | "missing";
	version?: string;
	installHint: string;
}

export interface RepoResult {
	/** Absolute path of the repository. */
	path: string;
	findings: Finding[];
	/** Scanners that ran but failed on this repository. Its findings are then incomplete. */
	errors: { tool: ToolName; message: string }[];
	/**
	 * Files in the repository that tell a scanner to leave findings out
	 * (.gitleaksignore, osv-scanner.toml), or that Porchlight ignored
	 * (.gitleaks.toml). Missing from older reports.
	 */
	settingFiles?: string[];
	/**
	 * When this repository alone was scanned again, after the report's own scan time. Where a scanner
	 * did not look that time, its earlier findings were kept.
	 */
	rescannedAt?: string;
}

export interface ScanReport {
	root: string;
	/**
	 * Further folders scanned along with `root`, such as the one holding repositories fetched from
	 * GitHub. A repository in one is named under that folder's own name. Missing from older reports.
	 */
	otherRoots?: string[];
	scannedAt: string;
	tools: ToolStatus[];
	repos: RepoResult[];
}

/** Lower is more severe. */
export function severityRank(severity: Severity): number {
	return SEVERITIES.indexOf(severity);
}
