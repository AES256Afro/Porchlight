-- Why the last scan of a domain failed, short and with nothing secret in it, so
-- the page can say more than "3 scans failed in a row". Cleared by any scan that
-- does not fail.
ALTER TABLE domains ADD COLUMN last_error TEXT;

-- What happened to the monitor's own work, which no domain row can hold: whether
-- the last alert reached the webhook, and why the scheduled run last failed. One
-- row, read with the domain list, so a failure that would only reach the Worker's
-- log reaches the owner too. Never the webhook's address or the admin token.
CREATE TABLE monitor_status (
	id INTEGER PRIMARY KEY CHECK (id = 1),
	alert_sent_at TEXT,
	alert_error TEXT,
	alert_error_at TEXT,
	schedule_error TEXT,
	schedule_error_at TEXT
);
INSERT INTO monitor_status (id) VALUES (1);
