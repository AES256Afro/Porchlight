-- How many scans of a domain have failed in a row. A failed scan is retried
-- within hours rather than a full interval later, and the owner is alerted
-- once the streak reaches a few. A successful scan resets it.
ALTER TABLE domains ADD COLUMN error_streak INTEGER NOT NULL DEFAULT 0;

-- When a scan of the domain started, while it runs. A second scan (the
-- schedule and a manual one at once) finds the claim and stands down, so a
-- change is never alerted twice. A claim older than the lease is ignored, so a
-- scan that died cannot block the domain for good.
ALTER TABLE domains ADD COLUMN scan_claimed_at TEXT;
