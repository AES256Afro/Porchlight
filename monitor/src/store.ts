import type { ScanReport } from "./report.ts";
import type { Snapshot } from "./snapshot.ts";

export interface DomainRow {
	id: number;
	name: string;
	challenge_token: string;
	/** When the ownership challenge last passed; null until the first success. */
	verified_at: string | null;
	last_scan_at: string | null;
	last_scan_status: ScanStatus | null;
	created_at: string;
}

export type ScanStatus = "ok" | "unverified" | "error";

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

export async function markVerified(db: D1Database, id: number, now: string): Promise<void> {
	await db.prepare("UPDATE domains SET verified_at = ? WHERE id = ?").bind(now, id).run();
}

export async function markScan(
	db: D1Database,
	id: number,
	status: ScanStatus,
	now: string,
): Promise<void> {
	await db
		.prepare("UPDATE domains SET last_scan_at = ?, last_scan_status = ? WHERE id = ?")
		.bind(now, status, id)
		.run();
}

/** The verified domain whose last scan is oldest and older than `cutoff`, if any. */
export function nextDueDomain(db: D1Database, cutoff: string): Promise<DomainRow | null> {
	return db
		.prepare(
			`SELECT * FROM domains
			 WHERE verified_at IS NOT NULL AND (last_scan_at IS NULL OR last_scan_at < ?)
			 ORDER BY last_scan_at IS NOT NULL, last_scan_at, id
			 LIMIT 1`,
		)
		.bind(cutoff)
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

/** Stores the scan, marks the domain scanned, and drops snapshots beyond the newest `keep`. */
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
				"UPDATE domains SET last_scan_at = ?, last_scan_status = 'ok', verified_at = ? WHERE id = ?",
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
