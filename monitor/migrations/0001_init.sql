-- Domains under monitoring. A domain is only scanned after its ownership
-- challenge has passed (verified_at is set), and the challenge is re-checked
-- before every scan.
CREATE TABLE domains (
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL UNIQUE,
	challenge_token TEXT NOT NULL,
	verified_at TEXT,
	last_scan_at TEXT,
	last_scan_status TEXT,
	created_at TEXT NOT NULL
);

-- One row per completed scan. `data` is the observed state (Snapshot JSON);
-- `report` is what that scan concluded (ScanReport JSON).
CREATE TABLE snapshots (
	id INTEGER PRIMARY KEY,
	domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
	taken_at TEXT NOT NULL,
	data TEXT NOT NULL,
	report TEXT NOT NULL
);

CREATE INDEX snapshots_domain_taken ON snapshots (domain_id, taken_at DESC);
