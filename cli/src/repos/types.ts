export const SEVERITIES = ["critical", "high", "medium", "low"] as const;
export type Severity = (typeof SEVERITIES)[number];

export type ToolName = "gitleaks" | "osv-scanner";

/** One problem found in one repository, in a shape common to every scanner. */
export interface Finding {
	tool: ToolName;
	kind: "secret" | "vulnerability" | "private-data";
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
	/** For private data: how many different values of this kind the file holds. Never a value itself. */
	count?: number;
	/**
	 * For a secret or private data: where it was found. `history`: in a commit. `files`: in a file git tracks, as it is
	 * now (a scan that did not read every commit). `local`: in a file git does not track, so it has
	 * never been committed. Missing from older reports, which read history alone.
	 */
	source?: SecretSource;
}

export type SecretSource = "history" | "files" | "local";

/** How far back a secrets scan reads: every commit, the last so many, or none (the files as they are). */
export type HistoryReach = "all" | "none" | number;

/**
 * What a scan was asked to look at. Saved with the report, so the report, the page and every export
 * can say what it did not cover. Missing from older reports, which are `standard`.
 */
export interface ScanChoices {
	/** The preset these match, or `custom` when a switch was changed from one. */
	preset: "quick" | "standard" | "deep" | "custom";
	secrets: boolean;
	dependencies: boolean;
	/** Personal data committed to a repository: contact details, ID numbers, locations, dumps, documents. Missing from older reports: off. */
	privateData: boolean;
	history: HistoryReach;
	/** Also read files git does not track (such as .env), reported as on this computer only. */
	localFiles: boolean;
	/** Repositories, by name, not to scan. */
	skip: string[];
	/** Start the model's deeper analysis once the scan has finished (the interface only). */
	analyse: boolean;
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
	/**
	 * Tracked files a scan of the current files did not read: larger than it reads, or not a file it
	 * could open. Missing when none were.
	 */
	unreadFiles?: number;
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
	/** What the scan was asked to cover. Missing from older reports, which covered what `standard` does. */
	choices?: ScanChoices;
	/** Repositories found and left out because the choices named them. */
	skipped?: string[];
}

/** Lower is more severe. */
export function severityRank(severity: Severity): number {
	return SEVERITIES.indexOf(severity);
}
