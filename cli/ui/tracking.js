// @ts-check
// What the owner keeps about findings across scans: which ones are new or fixed since the last scan,
// and the status and note the owner gives each. Shared by the page and the server, so both name a
// finding the same way. None of it changes a severity, a count, the roadmap or an export.

/**
 * A finding's identity across scans: its repository, rule or advisory, place and detail (a commit
 * for a secret, a package and version for a vulnerability). An upgrade that changes the version
 * makes it a different finding, so the old one counts as fixed.
 *
 * @param {string} repo
 * @param {{ ruleId: string, location: string, detail: string }} finding
 */
export function findingKey(repo, finding) {
	return [repo, finding.ruleId, finding.location, finding.detail].join("\n");
}

/** The statuses an owner can give a finding, with their words. "open" is what a finding starts as. */
export const STATUSES = /** @type {const} */ ([
	["open", "Open"],
	["in-progress", "In progress"],
	["fixed", "Fixed"],
	// For a secret: the credential was replaced with the service that issued it. The old one stays in
	// git history, so the finding stays listed; this says it no longer opens anything.
	["rotated", "Rotated"],
	["accepted", "Accepted risk"],
	["false-positive", "False positive"],
]);

/** @typedef {(typeof STATUSES)[number][0]} FindingStatus */
/**
 * `until`: for "accepted", the last day (YYYY-MM-DD) the owner accepts the risk for. After it the
 * finding reads as open again, with a mark saying the acceptance has ended.
 *
 * @typedef {{ status: FindingStatus, note: string, updatedAt: string, until?: string }} FindingNote
 */

/** The longest note, in characters. */
export const MAX_NOTE = 2000;

/** @param {unknown} value @returns {value is FindingStatus} */
export function isStatus(value) {
	return STATUSES.some(([status]) => status === value);
}

/** The statuses offered for a finding of this kind: "Rotated" is for secrets alone. @param {string} kind */
export function statusesFor(kind) {
	return STATUSES.filter(([status]) => status !== "rotated" || kind === "secret");
}

/** A day as the owner typed it, and a real one: "2027-02-30" is not. @param {unknown} value @returns {value is string} */
export function isDay(value) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/**
 * Whether an accepted risk has run past the day it was accepted until. The status the owner chose
 * is kept as it was; the page shows it as ended, so it is looked at again rather than forgotten.
 *
 * @param {{ status: string, until?: string } | null | undefined} note
 * @param {Date} [now]
 */
export function acceptanceEnded(note, now = new Date()) {
	return note?.status === "accepted" && typeof note.until === "string" && note.until < localDay(now);
}

/** Today as YYYY-MM-DD where the owner is. @param {Date} [now] */
export function localDay(now = new Date()) {
	const pad = (/** @type {number} */ part) => String(part).padStart(2, "0");
	return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** @param {string} status */
export function statusLabel(status) {
	return STATUSES.find(([value]) => value === status)?.[1] ?? "Open";
}

/**
 * One line on what changed since the previous scan, or null when there is no previous scan. Findings
 * this scan could not look for again are said separately: not found is not fixed.
 *
 * @param {{ previousScannedAt: string, newCount: number, fixedCount: number, uncheckedCount?: number } | null} change
 */
export function changeSummary(change) {
	if (!change) return null;
	const unchecked = change.uncheckedCount ?? 0;
	const caveat =
		unchecked > 0
			? ` ${unchecked.toLocaleString("en-GB")} ${unchecked === 1 ? "finding" : "findings"} of the previous scan could not be checked again, so ${unchecked === 1 ? "it is" : "they are"} not counted as fixed.`
			: "";
	if (change.newCount === 0 && change.fixedCount === 0) return `Nothing new and nothing fixed since the previous scan.${caveat}`;
	const parts = [];
	if (change.newCount > 0) parts.push(`${change.newCount.toLocaleString("en")} new`);
	if (change.fixedCount > 0) parts.push(`${change.fixedCount.toLocaleString("en")} fixed`);
	return `${parts.join(", ")} since the previous scan.${caveat}`;
}

/**
 * Note text, status and date being typed, by `findingKey`, so a redraw of the page (a poll, a save of
 * another note) builds the editor again with what was typed rather than what was saved (B44). Save
 * clears a finding's draft.
 *
 * @template T
 */
export function createDrafts() {
	/** @type {Map<string, T>} */
	const drafts = new Map();
	return {
		/** @param {string} key @returns {T | undefined} */
		get: (key) => drafts.get(key),
		/** @param {string} key @param {T} draft */
		set: (key, draft) => void drafts.set(key, draft),
		/** @param {string} key */
		clear: (key) => void drafts.delete(key),
		get size() {
			return drafts.size;
		},
	};
}
