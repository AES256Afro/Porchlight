-- A removed domain's id is never given to another. Without AUTOINCREMENT,
-- SQLite hands the newest deleted id to the next row, so a scan or verify
-- still running for a removed domain could write to the domain added after it.
-- (Every such write also matches the domain's name and challenge token, so
-- this is the second guard, not the only one. It also covers the one id this
-- cannot: one removed before this migration, above every id that remains.)
--
-- SQLite cannot add AUTOINCREMENT to a table, so `domains` is rebuilt. D1
-- keeps foreign keys on, and `PRAGMA defer_foreign_keys` does not stop
-- ON DELETE CASCADE, so dropping `domains` while `snapshots` refers to it would
-- delete every snapshot. The snapshots are therefore set aside in a table with
-- no foreign key, `snapshots` is dropped first, and it is made again, with
-- the same columns, key, cascade and index, once the new `domains` is in place.
-- D1 runs a migration as one transaction, so a failure leaves both as they were.

CREATE TABLE snapshots_kept (
	id INTEGER PRIMARY KEY,
	domain_id INTEGER NOT NULL,
	taken_at TEXT NOT NULL,
	data TEXT NOT NULL,
	report TEXT NOT NULL
);
INSERT INTO snapshots_kept (id, domain_id, taken_at, data, report)
	SELECT id, domain_id, taken_at, data, report FROM snapshots;
DROP TABLE snapshots;

CREATE TABLE domains_rebuilt (
	id INTEGER PRIMARY KEY AUTOINCREMENT,
	name TEXT NOT NULL UNIQUE,
	challenge_token TEXT NOT NULL,
	verified_at TEXT,
	last_scan_at TEXT,
	last_scan_status TEXT,
	created_at TEXT NOT NULL,
	error_streak INTEGER NOT NULL DEFAULT 0,
	scan_claimed_at TEXT
);
INSERT INTO domains_rebuilt (
	id, name, challenge_token, verified_at, last_scan_at, last_scan_status, created_at,
	error_streak, scan_claimed_at
)
	SELECT id, name, challenge_token, verified_at, last_scan_at, last_scan_status, created_at,
		error_streak, scan_claimed_at
	FROM domains;
DROP TABLE domains;
ALTER TABLE domains_rebuilt RENAME TO domains;

CREATE TABLE snapshots (
	id INTEGER PRIMARY KEY,
	domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
	taken_at TEXT NOT NULL,
	data TEXT NOT NULL,
	report TEXT NOT NULL
);
-- A snapshot whose domain is gone could not be read anyway, and would fail the key.
INSERT INTO snapshots (id, domain_id, taken_at, data, report)
	SELECT id, domain_id, taken_at, data, report FROM snapshots_kept
	WHERE domain_id IN (SELECT id FROM domains);
DROP TABLE snapshots_kept;

CREATE INDEX snapshots_domain_taken ON snapshots (domain_id, taken_at DESC);
