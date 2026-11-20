import type { ScanReport } from "./report.ts";
import type { Snapshot } from "./snapshot.ts";
import type { ScanStatus } from "./types.ts";

export interface DomainRow {
	id: number;
	name: string;
	challenge_token: string;
	/** When the ownership challenge last passed; null until the first success. */
	verified_at: string | null;
	/** When the last scan attempt started or (for a completed scan) was taken. */
	last_scan_at: string | null;
	/** null until the first scan, and again after a lapsed domain is verified anew. */
	last_scan_status: ScanStatus | null;
	created_at: string;
	/** Scans that have failed in a row; 0 after any scan that did not fail. */
	error_streak: number;
	/** Set while a scan of the domain runs; see `claimScan`. */
	scan_claimed_at: string | null;
}

export type { ScanStatus };

export interface StoredScan {
	snapshot: Snapshot;
	report: ScanReport;
}

/** Returns the existing row if the domain was already added, so its challenge token is stable. */
export async function addDomain(
	db: D1Database,
	name: string,
	token: string,
	now: string,
): Promise<DomainRow> {
	await db
		.prepare(
			"INSERT INTO domains (name, challenge_token, created_at) VALUES (?, ?, ?) ON CONFLICT (name) DO NOTHING",
		)
		.bind(name, token, now)
		.run();
	return (await getDomain(db, name))!;
}

export function getDomain(db: D1Database, name: string): Promise<DomainRow | null> {
	return db.prepare("SELECT * FROM domains WHERE name = ?").bind(name).first<DomainRow>();
}

export async function listDomains(db: D1Database): Promise<DomainRow[]> {
	const { results } = await db.prepare("SELECT * FROM domains ORDER BY name").all<DomainRow>();
	return results;
}

/** Removes the domain and, by cascade, every snapshot taken of it. */
export async function deleteDomain(db: D1Database, name: string): Promise<boolean> {
	const result = await db.prepare("DELETE FROM domains WHERE name = ?").bind(name).run();
	return result.meta.changes > 0;
}

/**
 * Records a passed ownership check. A domain whose record had lapsed is no
 * longer shown as failing, and is due for a scan on the next tick.
 */
export async function markVerified(db: D1Database, id: number, now: string): Promise<DomainRow> {
	return (await db
		.prepare(
			`UPDATE domains SET verified_at = ?,
			   last_scan_status = CASE WHEN last_scan_status = 'unverified' THEN NULL ELSE last_scan_status END
			 WHERE id = ? RETURNING *`,
		)
		.bind(now, id)
		.first<DomainRow>())!;
}

/** Records that the ownership check failed. Not a scan failure, so the error streak ends. */
export async function markUnverified(db: D1Database, id: number, now: string): Promise<void> {
	await db
		.prepare(
			"UPDATE domains SET last_scan_at = ?, last_scan_status = 'unverified', error_streak = 0 WHERE id = ?",
		)
		.bind(now, id)
		.run();
}

/** Records a failed scan and returns how many have now failed in a row. */
export async function markFailed(db: D1Database, id: number, now: string): Promise<number> {
	const row = await db
		.prepare(
			`UPDATE domains SET last_scan_at = ?, last_scan_status = 'error', error_streak = error_streak + 1
			 WHERE id = ? RETURNING error_streak`,
		)
		.bind(now, id)
		.first<{ error_streak: number }>();
	return row?.error_streak ?? 0;
}

/**
 * Claims the domain for one scan and returns its current row, or null when
 * another scan holds an unexpired claim. The update is a single statement, so
 * of two scans that start together exactly one gets the row.
 */
export function claimScan(
	db: D1Database,
	id: number,
	now: string,
	staleBefore: string,
): Promise<DomainRow | null> {
	return db
		.prepare(
			`UPDATE domains SET scan_claimed_at = ?
			 WHERE id = ? AND (scan_claimed_at IS NULL OR scan_claimed_at < ?)
			 RETURNING *`,
		)
		.bind(now, id, staleBefore)
		.first<DomainRow>();
}

/** Releases the claim taken at `claimedAt`, unless a later scan has since taken it over. */
export async function releaseScan(db: D1Database, id: number, claimedAt: string): Promise<void> {
	await db
		.prepare("UPDATE domains SET scan_claimed_at = NULL WHERE id = ? AND scan_claimed_at = ?")
		.bind(id, claimedAt)
		.run();
}

export interface DueCutoffs {
	/** A domain last scanned before this is due. */
	interval: string;
	/** A domain whose only failed scan started before this is due for a retry. */
	firstRetry: string;
	/** A domain that has failed more than once is retried once its last attempt is before this. */
	laterRetry: string;
	/** A claim older than this belongs to a scan that died. */
	staleClaim: string;
}

/**
 * The verified domain most in need of a scan, if any is due: one never scanned
 * or verified anew comes first, then the oldest. A failed scan is retried
 * sooner than the interval.
 */
export function nextDueDomain(db: D1Database, cutoffs: DueCutoffs): Promise<DomainRow | null> {
	return db
		.prepare(
			`SELECT * FROM domains
			 WHERE verified_at IS NOT NULL
			   AND (scan_claimed_at IS NULL OR scan_claimed_at < ?4)
			   AND (
			     last_scan_at IS NULL OR last_scan_status IS NULL OR last_scan_at < ?1
			     OR (last_scan_status = 'error' AND last_scan_at < CASE WHEN error_streak <= 1 THEN ?2 ELSE ?3 END)
			   )
			 ORDER BY last_scan_status IS NOT NULL, last_scan_at IS NOT NULL, last_scan_at, id
			 LIMIT 1`,
		)
		.bind(cutoffs.interval, cutoffs.firstRetry, cutoffs.laterRetry, cutoffs.staleClaim)
		.first<DomainRow>();
}

export async function latestScan(db: D1Database, domainId: number): Promise<StoredScan | null> {
	const row = await db
		.prepare(
			"SELECT data, report FROM snapshots WHERE domain_id = ? ORDER BY taken_at DESC, id DESC LIMIT 1",
		)
		.bind(domainId)
		.first<{ data: string; report: string }>();
	if (!row) return null;
	return {
		snapshot: JSON.parse(row.data) as Snapshot,
		report: JSON.parse(row.report) as ScanReport,
	};
}

/** Stores the scan, marks the domain scanned (ending any error streak), and drops snapshots beyond the newest `keep`. */
export async function saveScan(
	db: D1Database,
	domainId: number,
	scan: StoredScan,
	keep: number,
): Promise<void> {
	const takenAt = scan.snapshot.takenAt;
	await db.batch([
		db
			.prepare("INSERT INTO snapshots (domain_id, taken_at, data, report) VALUES (?, ?, ?, ?)")
			.bind(domainId, takenAt, JSON.stringify(scan.snapshot), JSON.stringify(scan.report)),
		db
			.prepare(
				"UPDATE domains SET last_scan_at = ?, last_scan_status = 'ok', error_streak = 0, verified_at = ? WHERE id = ?",
			)
			.bind(takenAt, takenAt, domainId),
		db
			.prepare(
				`DELETE FROM snapshots WHERE domain_id = ? AND id NOT IN (
					SELECT id FROM snapshots WHERE domain_id = ? ORDER BY taken_at DESC, id DESC LIMIT ?
				)`,
			)
			.bind(domainId, domainId, keep),
	]);
}
