// What the monitor's API sends, as types alone: no code and no imports, so the CLI and its web
// page import these (type-only, erased at run time) instead of declaring their own copies.

export type Severity = "high" | "medium" | "low";

/** A problem with the current state of the domain, as opposed to a change between scans. */
export interface Finding {
	/** Stable across scans, so a finding is reported once when it appears and once when it clears. */
	id: string;
	severity: Severity;
	host: string;
	/** Which observation the finding rests on; decides whether a later scan can clear it. */
	basis: "dns" | "http" | "cert" | "apex";
	title: string;
}

export type Change =
	| { kind: "host_added"; host: string }
	| { kind: "host_removed"; host: string }
	| { kind: "dns_changed"; host: string; record: string; before: string[]; after: string[] }
	| { kind: "https_changed"; host: string; before: string; after: string };

/** What one scan concluded. Stored with its snapshot and sent as the alert payload. */
export interface ScanReport {
	domain: string;
	takenAt: string;
	/** True for the first scan of a domain: there is nothing to compare against. */
	baseline: boolean;
	changes: Change[];
	newFindings: Finding[];
	resolvedFindings: Finding[];
	/** All open findings, including ones first reported by earlier scans. */
	findings: Finding[];
	hostCount: number;
	/** Limits on what this scan could see, so an empty report is not mistaken for a clean one. */
	notes: string[];
}

export type ScanStatus = "ok" | "unverified" | "error";

/** A domain as `/domains` lists it and `/domains/:name` describes it. */
export interface DomainView {
	name: string;
	/** Verified once, and the challenge record was still there at the last check. */
	verified: boolean;
	verifiedAt: string | null;
	lastScanAt: string | null;
	lastScanStatus: ScanStatus | null;
	/** Scans that have failed in a row; 0 unless the last scan failed. */
	errorStreak: number;
	/** Why the last scan failed, short and scrubbed of secrets; null unless it failed (or before migration 0004). */
	lastError: string | null;
	/** Open findings of the latest scan, by severity; null until the domain has been scanned. */
	openFindings: Record<Severity, number> | null;
	/** The DNS record that proves ownership. */
	challenge: { type: "TXT"; name: string; value: string };
}

/**
 * One kept scan in a domain's history (`/domains/:name/history`): what it saw change, without the
 * whole list of findings that were open at the time.
 */
export interface HistoryEntry {
	takenAt: string;
	baseline: boolean;
	changes: Change[];
	newFindings: Finding[];
	resolvedFindings: Finding[];
	/** How many findings were open after this scan, by severity. */
	openFindings: Record<Severity, number>;
	hostCount: number;
	notes: string[];
}

/** When something was seen to go wrong, and what. */
export interface MonitorProblem {
	at: string;
	error: string;
}

/**
 * The monitor's own state, sent beside the domain list (`GET /domains`): where alerts go and what
 * went wrong with them or with the scheduled run, which would otherwise reach only the Worker's log.
 * Never the webhook's address beyond its host, and never the admin token.
 */
export interface MonitorStatus {
	alerts: {
		/** A webhook, or only the Worker's log: no webhook is set, or the one set cannot be used. */
		to: "webhook" | "log";
		/** The webhook's host and format; never its path or query, which hold its secret. */
		host?: string;
		format?: string;
		/** Why a webhook that was set is not used. */
		problem?: string;
		/** null when the record could not be read (the database lacks migration 0004): not known, not "none". */
		delivery: { lastDeliveredAt: string | null; lastError: MonitorProblem | null } | null;
	};
	/** The scheduled run's last failure, while it lasts; null when the record could not be read. */
	schedule: { lastError: MonitorProblem | null } | null;
}
