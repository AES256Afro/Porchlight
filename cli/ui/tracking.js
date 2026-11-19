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
	["accepted", "Accepted risk"],
	["false-positive", "False positive"],
]);

/** @typedef {(typeof STATUSES)[number][0]} FindingStatus */
/** @typedef {{ status: FindingStatus, note: string, updatedAt: string }} FindingNote */

/** The longest note, in characters. */
export const MAX_NOTE = 2000;

/** @param {unknown} value @returns {value is FindingStatus} */
export function isStatus(value) {
	return STATUSES.some(([status]) => status === value);
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
			? ` ${unchecked.toLocaleString()} ${unchecked === 1 ? "finding" : "findings"} of the previous scan could not be checked again, so ${unchecked === 1 ? "it is" : "they are"} not counted as fixed.`
			: "";
	if (change.newCount === 0 && change.fixedCount === 0) return `Nothing new and nothing fixed since the previous scan.${caveat}`;
	const parts = [];
	if (change.newCount > 0) parts.push(`${change.newCount.toLocaleString()} new`);
	if (change.fixedCount > 0) parts.push(`${change.fixedCount.toLocaleString()} fixed`);
	return `${parts.join(", ")} since the previous scan.${caveat}`;
}
