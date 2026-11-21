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
	/**
	 * For a vulnerability: the lowest release above the installed one that no advisory against this
	 * package lists as affected, when there is one. Each advisory's own fix can sit inside another's
	 * affected range, so this is what a complete repair upgrades to (invariant 12, B23).
	 */
	safeIn?: string;
	/**
	 * For private data: how many different values of this kind the file holds. For secrets past
	 * PER_FILE of one rule in one file: how many more matches this one finding stands for (S60). Never
	 * a value itself.
	 */
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
	 * When gitleaks' history was not read again because nothing that decides its findings had changed
	 * since a full reading (OP-1, history-reuse.ts): the time of that reading, whose findings these are.
	 */
	historyReusedFrom?: string;
	/**
	 * Tracked files a scan of the current files did not read: larger than it reads, or not a file it
	 * could open. Missing when none were.
	 */
	unreadFiles?: number;
	/**
	 * What a scanner ran but could not cover in this repository, such as history cut short by a shallow
	 * clone. Said under "Not covered", and no finding of that scanner there counts as fixed or new.
	 * Missing when there was nothing.
	 */
	notCovered?: NotCovered[];
}

/** Something a scanner ran but could not cover in a repository: said in the report, never read as clean. */
export interface NotCovered {
	tool: ToolName;
	message: string;
}

/**
 * The shape of a report this version writes. 2 adds `notCovered` (M9) and `notSearched` (M11), which an
 * older Porchlight would not know to read as an incomplete scan; a reader refuses a report newer than it
 * knows.
 */
export const REPORT_FORMAT = 2;

export interface ScanReport {
	/** Missing from reports before format 2. */
	format?: number;
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
	/**
	 * Folder levels the scan looked through for repositories, so "Check again" looks as deep again (B42).
	 * Missing from older reports, which are taken as 3 (`reportDepth` in ui/scan-choices.js).
	 */
	depth?: number;
	/** Repositories found and left out because the choices named them. */
	skipped?: string[];
	/**
	 * Folders the search for repositories passed over that could hold one, named under the scanned
	 * folder, with why (S59). Said under "Not covered". Missing when there were none.
	 */
	notSearched?: { name: string; reason: string }[];
}

/** Lower is more severe. */
export function severityRank(severity: Severity): number {
	return SEVERITIES.indexOf(severity);
}
