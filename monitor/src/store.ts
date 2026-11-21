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
	/** Why the last scan failed, scrubbed and cut short; null after any scan that did not fail. */
	last_error: string | null;
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

/** Every domain with the report of its latest scan, or null where there has been none. */
export async function listDomainsWithReports(
	db: D1Database,
): Promise<{ domain: DomainRow; report: ScanReport | null }[]> {
	const { results } = await db
		.prepare(
			`SELECT d.*, (
			   SELECT report FROM snapshots s WHERE s.domain_id = d.id ORDER BY s.taken_at DESC, s.id DESC LIMIT 1
			 ) AS latest_report
			 FROM domains d ORDER BY d.name`,
		)
		.all<DomainRow & { latest_report: string | null }>();
	return results.map(({ latest_report, ...domain }) => ({
		domain,
		report: latest_report ? (JSON.parse(latest_report) as ScanReport) : null,
	}));
}

/** The reports of the domain's kept scans, newest first. */
export async function scanHistory(db: D1Database, domainId: number): Promise<ScanReport[]> {
	const { results } = await db
		.prepare("SELECT report FROM snapshots WHERE domain_id = ? ORDER BY taken_at DESC, id DESC")
		.bind(domainId)
		.all<{ report: string }>();
	return results.map((row) => JSON.parse(row.report) as ScanReport);
}

/** Removes the domain and, by cascade, every snapshot taken of it. */
export async function deleteDomain(db: D1Database, name: string): Promise<boolean> {
	const result = await db.prepare("DELETE FROM domains WHERE name = ?").bind(name).run();
	return result.meta.changes > 0;
}

/**
 * What a write made after an await matches besides the id. A domain may be
 * removed while a verify or scan of it waits on the network, and another added:
 * before migration 0003 it could take the same id, and the same name added again
 * gets a new token. A write that matches no row changes nothing.
 */
export type DomainKey = Pick<DomainRow, "id" | "name" | "challenge_token">;

const SAME_DOMAIN = "id = ? AND name = ? AND challenge_token = ?";

function keyOf(domain: DomainKey): [number, string, string] {
	return [domain.id, domain.name, domain.challenge_token];
}

/** Whether the domain is still registered as it was read: not removed, and not removed and added again. */
export async function isRegistered(db: D1Database, domain: DomainKey): Promise<boolean> {
	const row = await db
		.prepare(`SELECT 1 AS found FROM domains WHERE ${SAME_DOMAIN}`)
		.bind(...keyOf(domain))
		.first<{ found: number }>();
	return row !== null;
}

/**
 * Records a passed ownership check. A domain whose record had lapsed is no
 * longer shown as failing, and is due for a scan on the next tick. Returns
 * null, changing nothing, when the domain was removed while it was checked.
 */
export function markVerified(
	db: D1Database,
	domain: DomainKey,
	now: string,
): Promise<DomainRow | null> {
	return db
		.prepare(
			`UPDATE domains SET verified_at = ?,
			   last_scan_status = CASE WHEN last_scan_status = 'unverified' THEN NULL ELSE last_scan_status END
			 WHERE ${SAME_DOMAIN} RETURNING *`,
		)
		.bind(now, ...keyOf(domain))
		.first<DomainRow>();
}

/**
 * Records that the scan started at `startedAt` found the challenge record
 * missing. Not a scan failure, so the error streak ends. A verify that passed
 * after the scan started saw the record more recently, so it stands and
 * nothing changes. Returns whether the domain was marked.
 */
export async function markUnverified(
	db: D1Database,
	domain: DomainKey,
	startedAt: string,
): Promise<boolean> {
	const result = await db
		.prepare(
			`UPDATE domains SET last_scan_at = ?1, last_scan_status = 'unverified', error_streak = 0, last_error = NULL
			 WHERE id = ?2 AND name = ?3 AND challenge_token = ?4
			   AND (verified_at IS NULL OR verified_at <= ?1)`,
		)
		.bind(startedAt, ...keyOf(domain))
		.run();
	return result.meta.changes > 0;
}

/**
 * The ownership lookup of a domain last seen without its record failed. Nothing
 * was observed, so it stays unverified (invariant 5): only the time of its next
 * attempt moves. Changes nothing if a verify has passed since.
 */
export async function postponeUnverified(
	db: D1Database,
	domain: DomainKey,
	now: string,
): Promise<void> {
	await db
		.prepare(
			`UPDATE domains SET last_scan_at = ? WHERE ${SAME_DOMAIN} AND last_scan_status = 'unverified'`,
		)
		.bind(now, ...keyOf(domain))
		.run();
}

/**
 * Records a failed scan and why (`error`, already scrubbed), and returns how many
 * have now failed in a row: 0 when the domain was removed meanwhile, and nothing
 * was recorded.
 */
export async function markFailed(
	db: D1Database,
	domain: DomainKey,
	now: string,
	error: string,
): Promise<number> {
	const row = await db
		.prepare(
			`UPDATE domains SET last_scan_at = ?, last_scan_status = 'error', error_streak = error_streak + 1,
			   last_error = ?
			 WHERE ${SAME_DOMAIN} RETURNING error_streak`,
		)
		.bind(now, error, ...keyOf(domain))
		.first<{ error_streak: number }>();
	return row?.error_streak ?? 0;
}

/**
 * Claims the domain for one scan and returns its current row, or null when
 * another scan holds an unexpired claim or the domain is no longer registered
 * as `domain` describes it. The update is a single statement, so of two scans
 * that start together exactly one gets the row.
 *
 * With `lastScanAt` (the scheduled run, which read the row to find it due), the
 * claim also needs the last scan to be the one that was read: a scan that
 * finished in between means the domain is no longer due, so it is not scanned again.
 */
export function claimScan(
	db: D1Database,
	domain: DomainKey,
	now: string,
	staleBefore: string,
	lastScanAt?: string | null,
): Promise<DomainRow | null> {
	const due = lastScanAt === undefined ? "" : " AND last_scan_at IS ?";
	return db
		.prepare(
			`UPDATE domains SET scan_claimed_at = ?
			 WHERE ${SAME_DOMAIN} AND (scan_claimed_at IS NULL OR scan_claimed_at < ?)${due}
			 RETURNING *`,
		)
		.bind(now, ...keyOf(domain), staleBefore, ...(lastScanAt === undefined ? [] : [lastScanAt]))
		.first<DomainRow>();
}

/** Releases the claim taken at `claimedAt`, unless a later scan has since taken it over. */
export async function releaseScan(
	db: D1Database,
	domain: DomainKey,
	claimedAt: string,
): Promise<void> {
	await db
		.prepare(
			`UPDATE domains SET scan_claimed_at = NULL WHERE ${SAME_DOMAIN} AND scan_claimed_at = ?`,
		)
		.bind(...keyOf(domain), claimedAt)
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

/**
 * Stores the scan, marks the domain scanned (ending any error streak), and drops
 * snapshots beyond the newest `keep`, all only while the scan's claim, taken at
 * `claimedAt`, is still held on this domain. Returns false, having changed
 * nothing, when the domain was removed (and perhaps another added) while the
 * scan ran, or a later scan took the claim over: the scan is then discarded.
 */
export async function saveScan(
	db: D1Database,
	domain: DomainKey,
	claimedAt: string,
	scan: StoredScan,
	keep: number,
): Promise<boolean> {
	const takenAt = scan.snapshot.takenAt;
	const held = `EXISTS (SELECT 1 FROM domains WHERE ${SAME_DOMAIN} AND scan_claimed_at = ?)`;
	const claim = [...keyOf(domain), claimedAt];
	const [, updated] = await db.batch([
		db
			.prepare(
				`INSERT INTO snapshots (domain_id, taken_at, data, report) SELECT ?, ?, ?, ? WHERE ${held}`,
			)
			.bind(
				domain.id,
				takenAt,
				JSON.stringify(scan.snapshot),
				JSON.stringify(scan.report),
				...claim,
			),
		db
			.prepare(
				`UPDATE domains SET last_scan_at = ?, last_scan_status = 'ok', error_streak = 0, verified_at = ?,
				   last_error = NULL
				 WHERE ${SAME_DOMAIN} AND scan_claimed_at = ?`,
			)
			.bind(takenAt, takenAt, ...claim),
		db
			.prepare(
				`DELETE FROM snapshots WHERE domain_id = ? AND ${held} AND id NOT IN (
					SELECT id FROM snapshots WHERE domain_id = ? ORDER BY taken_at DESC, id DESC LIMIT ?
				)`,
			)
			.bind(domain.id, ...claim, domain.id, keep),
	]);
	return (updated?.meta.changes ?? 0) > 0;
}

/** When something was seen to go wrong, and what. */
export interface Problem {
	at: string;
	error: string;
}

export interface MonitorStatusRow {
	alertSentAt: string | null;
	alertError: Problem | null;
	scheduleError: Problem | null;
}

/** The monitor's own record of alert delivery and the scheduled run (migration 0004). Throws if it cannot be read. */
export async function readMonitorStatus(db: D1Database): Promise<MonitorStatusRow> {
	const row = await db
		.prepare("SELECT * FROM monitor_status WHERE id = 1")
		.first<Record<string, string | null>>();
	const problem = (error: string | null | undefined, at: string | null | undefined) =>
		error && at ? { at, error } : null;
	return {
		alertSentAt: row?.alert_sent_at ?? null,
		alertError: problem(row?.alert_error, row?.alert_error_at),
		scheduleError: problem(row?.schedule_error, row?.schedule_error_at),
	};
}

/** Records one alert's delivery: when it reached the webhook, or why it did not (`error`, already scrubbed). */
export async function recordAlertDelivery(
	db: D1Database,
	at: string,
	error: string | null,
): Promise<void> {
	const statement = error
		? db
				.prepare("UPDATE monitor_status SET alert_error = ?, alert_error_at = ? WHERE id = 1")
				.bind(error, at)
		: db.prepare("UPDATE monitor_status SET alert_sent_at = ? WHERE id = 1").bind(at);
	await statement.run();
}

/**
 * Records that the scheduled run failed, and returns whether it was working
 * before, so the owner is alerted once per run of failures rather than every tick.
 */
export async function recordScheduleError(
	db: D1Database,
	at: string,
	error: string,
): Promise<boolean> {
	const row = await db
		.prepare(
			`UPDATE monitor_status SET schedule_error = ?1,
			   schedule_error_at = CASE WHEN schedule_error IS NULL THEN ?2 ELSE schedule_error_at END
			 WHERE id = 1 RETURNING schedule_error_at = ?2 AS fresh`,
		)
		.bind(error, at)
		.first<{ fresh: number }>();
	if (!row) throw new Error("The monitor's status row is missing");
	return row.fresh === 1;
}

/** The scheduled run worked: any failure it recorded is over. Writes only when one was recorded. */
export async function clearScheduleError(db: D1Database): Promise<void> {
	await db
		.prepare(
			`UPDATE monitor_status SET schedule_error = NULL, schedule_error_at = NULL
			 WHERE id = 1 AND schedule_error IS NOT NULL`,
		)
		.run();
}
