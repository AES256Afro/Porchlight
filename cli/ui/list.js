// @ts-check
// Pure helpers for lists and for keeping a page's state in the address.
// No DOM here, so they are tested directly.
import { ALL_SEVERITIES, noFilter } from "./filter.js";
import { verdictRank } from "./generated.js";

/** @typedef {import("./filter.js").FindingFilter} FindingFilter */

/**
 * One page of a list. A page number that is out of range is pulled back into it.
 *
 * @template T
 * @param {T[]} items
 * @param {number} page 1-based
 * @param {number} size
 */
export function paginate(items, page, size) {
	const pages = Math.max(1, Math.ceil(items.length / size));
	const current = Math.min(Math.max(1, Math.floor(page) || 1), pages);
	const start = (current - 1) * size;
	return {
		items: items.slice(start, start + size),
		page: current,
		pages,
		from: items.length === 0 ? 0 : start + 1,
		to: Math.min(start + size, items.length),
		total: items.length,
	};
}

/**
 * Splits `#/findings/by-repo?severity=high&q=x` into its path and its settings.
 *
 * @param {string} hash
 * @returns {{ path: string[], params: URLSearchParams }}
 */
export function parseHash(hash) {
	const [pathPart = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
	const path = pathPart.split("/").filter(Boolean).map(safeDecode);
	return { path, params: new URLSearchParams(query) };
}

/**
 * @param {string[]} path
 * @param {Record<string, string | number | undefined | null>} [settings] empty values are left out
 */
export function buildHash(path, settings = {}) {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(settings)) {
		if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
	}
	const query = params.toString();
	return `#/${path.map(encodeURIComponent).join("/")}${query ? `?${query}` : ""}`;
}

/** @param {string} value */
function safeDecode(value) {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

/**
 * The filter an address describes. Anything unrecognised is ignored, so a stale or hand-edited link still opens.
 *
 * @param {URLSearchParams} params
 * @returns {FindingFilter}
 */
export function filterFromParams(params) {
	const filter = noFilter();
	const severity = params.get("severity");
	if (severity !== null) {
		const wanted = severity.split(",");
		const known = ALL_SEVERITIES.filter((level) => wanted.includes(level));
		if (known.length > 0 || severity === "none") filter.severities = known;
	}
	const kind = params.get("kind");
	if (kind === "secret" || kind === "vulnerability" || kind === "private-data") filter.kind = kind;
	filter.query = params.get("q") ?? "";
	filter.repo = params.get("repo") ?? "";
	return filter;
}

/**
 * The settings that put `filter` in an address or an export request. Defaults are left out, so a
 * page with no filtering has a clean address.
 *
 * @param {FindingFilter} filter
 * @returns {Record<string, string>}
 */
export function paramsFromFilter(filter) {
	/** @type {Record<string, string>} */
	const settings = {};
	if (filter.severities.length < ALL_SEVERITIES.length) settings.severity = filter.severities.join(",") || "none";
	if (filter.kind !== "all") settings.kind = filter.kind;
	if (filter.query.trim() !== "") settings.q = filter.query.trim();
	if (filter.repo) settings.repo = filter.repo;
	return settings;
}

/** @typedef {{ key: "rank" | "name" | "secrets" | "vulnerabilities" | "private" | import("./filter.js").Severity, descending: boolean }} RepoSort */

const REPO_SORT_KEYS = ["rank", "name", "secrets", "vulnerabilities", "private", ...ALL_SEVERITIES];

/**
 * The By repository order an address describes: `sort=critical`, with `order=asc` only when it
 * differs from that column's own first order (counts start largest, names start at A).
 *
 * @param {URLSearchParams} params
 * @returns {RepoSort}
 */
export function repoSortFromParams(params) {
	const wanted = params.get("sort") ?? "rank";
	const key = /** @type {RepoSort["key"]} */ (REPO_SORT_KEYS.includes(wanted) ? wanted : "rank");
	const natural = key !== "name";
	const order = params.get("order");
	return { key, descending: key === "rank" ? true : order === "asc" ? false : order === "desc" ? true : natural };
}

/**
 * The address settings for a By repository order; the worst-first default leaves the address clean.
 *
 * @param {RepoSort} sort
 * @returns {Record<string, string | undefined>}
 */
export function repoSortParams(sort) {
	if (sort.key === "rank") return {};
	const natural = sort.key !== "name";
	return { sort: sort.key, order: sort.descending === natural ? undefined : sort.descending ? "desc" : "asc" };
}

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

/**
 * Orders finding rows. Ties always fall back to severity, then place, so the order is stable.
 *
 * @template {{ severity: string, repo: string, location: string, title: string, analysis?: { verdict: string } }} T
 * @param {T[]} rows
 * @param {"severity" | "repo" | "location" | "title" | "verdict"} key
 * @returns {T[]} a new array
 */
export function sortFindings(rows, key) {
	const rank = (/** @type {T} */ row) => SEVERITY_RANK[/** @type {keyof typeof SEVERITY_RANK} */ (row.severity)] ?? 9;
	const bySeverity = (/** @type {T} */ a, /** @type {T} */ b) => rank(a) - rank(b) || a.repo.localeCompare(b.repo) || a.location.localeCompare(b.location);
	if (key === "severity") return [...rows].sort(bySeverity);
	if (key === "verdict") return [...rows].sort((a, b) => verdictRank(a) - verdictRank(b) || bySeverity(a, b));
	const text = key;
	return [...rows].sort((a, b) => a[text].localeCompare(b[text]) || bySeverity(a, b));
}

/**
 * Delays a call until input has stopped for `ms`, so typing in a search box does not fire a request per key.
 *
 * @template {unknown[]} A
 * @param {(...args: A) => void} fn
 * @param {number} ms
 * @returns {(...args: A) => void}
 */
export function debounce(fn, ms) {
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	return (...args) => {
		clearTimeout(timer);
		timer = setTimeout(() => fn(...args), ms);
	};
}

/**
 * Whether a fragment is a page's address: none at all, `#`, or `#/…`. Any other fragment, such as the
 * skip link's `#view`, is a place on the page, and following it must not change the page (B45).
 *
 * @param {string} hash
 */
export function isPageAddress(hash) {
	return hash === "" || hash === "#" || hash.startsWith("#/");
}
