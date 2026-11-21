// @ts-check
// Due dates by severity (FT-14): the owner sets how many days a finding of each severity may stay
// open, and a finding is due that many days after it was first seen (R6Q-9). Shared by the page and
// the server (the weekly digest counts what is overdue). A due date is shown beside a finding and
// never changes its severity, a count, the roadmap, an export or the exit code (invariant 17).

/** @typedef {"critical" | "high" | "medium" | "low"} Severity */
/** @typedef {Record<Severity, number | null>} DuePolicy days a finding of each severity may stay open; null: no due date */

/** @type {readonly Severity[]} */
export const DUE_SEVERITIES = ["critical", "high", "medium", "low"];

/** What a finding gets until the owner sets other days: a week for critical, a month for high, a quarter for medium. */
/** @type {DuePolicy} */
export const DEFAULT_DUE = { critical: 7, high: 30, medium: 90, low: null };

/** The longest a policy may give, in days: about three years. */
export const MAX_DUE_DAYS = 1000;

/**
 * A policy from a request or a file, checked: every severity a whole number of days from 1 to
 * MAX_DUE_DAYS, or null. Null when it is not one.
 *
 * @param {unknown} value
 * @returns {DuePolicy | null}
 */
export function duePolicyOf(value) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	/** @type {Partial<DuePolicy>} */
	const policy = {};
	for (const severity of DUE_SEVERITIES) {
		const days = /** @type {Record<string, unknown>} */ (value)[severity];
		if (days === null || days === undefined) policy[severity] = null;
		else if (typeof days === "number" && Number.isInteger(days) && days >= 1 && days <= MAX_DUE_DAYS) policy[severity] = days;
		else return null;
	}
	return /** @type {DuePolicy} */ (policy);
}

const DAY_MS = 86_400_000;

/**
 * When a finding first seen at `first` is due, and how it stands on `now`. Null when its severity has
 * no due date, or the date it was first seen is not known: nothing is guessed (invariant 5).
 *
 * @param {string | undefined} first when it was first seen, as an ISO time
 * @param {Severity} severity
 * @param {DuePolicy} policy
 * @param {Date} [now]
 * @returns {{ due: string, daysLeft: number, overdue: boolean } | null}
 */
export function dueState(first, severity, policy, now = new Date()) {
	const days = policy[severity];
	const start = first ? Date.parse(first) : Number.NaN;
	if (days === null || days === undefined || Number.isNaN(start)) return null;
	const dueAt = start + days * DAY_MS;
	const daysLeft = Math.ceil((dueAt - now.getTime()) / DAY_MS);
	return { due: new Date(dueAt).toISOString().slice(0, 10), daysLeft, overdue: daysLeft < 0 };
}

/**
 * The due date in words, for the page and the digest: "Due 2026-12-01, in 9 days", "Overdue by 3 days
 * (due 2026-11-18)", "Due today".
 *
 * @param {{ due: string, daysLeft: number, overdue: boolean }} state
 */
export function dueWords(state) {
	if (state.overdue) return `Overdue by ${-state.daysLeft === 1 ? "1 day" : `${-state.daysLeft} days`} (due ${state.due})`;
	if (state.daysLeft === 0) return `Due today (${state.due})`;
	return `Due ${state.due}, in ${state.daysLeft === 1 ? "1 day" : `${state.daysLeft} days`}`;
}

/**
 * When a finding was first seen, in words. `onOrBefore`: it was already there in the earliest scan
 * Porchlight kept, so it may be older.
 *
 * @param {{ first: string, onOrBefore?: boolean }} seen
 */
export function seenWords(seen) {
	const day = seen.first.slice(0, 10);
	return seen.onOrBefore ? `On or before ${day} (in the earliest scan kept)` : day;
}
