// @ts-check
// Shared by the page (to show findings) and the server (to export them), so
// "export what the filters show" exports exactly what the page shows.
import { findingKey } from "./tracking.js";

/** @typedef {"critical" | "high" | "medium" | "low"} Severity */

/**
 * @typedef {object} FindingFilter
 * @property {Severity[]} severities levels to include
 * @property {"all" | "secret" | "vulnerability" | "private-data"} kind
 * @property {string} query text to find in the repository name or any finding field
 * @property {string} [repo] only this repository, by name; empty or absent for all
 * @property {boolean} [newOnly] only findings new since the last scan (B-Q1). Newness is Porchlight's own
 *   comparison of two scans by `findingKey`, never the owner's status, so it hides nothing invariant 17 keeps
 * @property {ReadonlySet<string>} [newKeys] the keys of the findings new since the last scan, filled in by
 *   whoever holds the comparison (the store on the page, the history on the server). With `newOnly` and
 *   no keys (a first scan, or one that could not be compared) nothing is new, so nothing matches
 */

/** @type {Severity[]} */
export const ALL_SEVERITIES = ["critical", "high", "medium", "low"];

/** @returns {FindingFilter} a filter that lets everything through */
export function noFilter() {
	return { severities: [...ALL_SEVERITIES], kind: "all", query: "", repo: "" };
}

/** @param {FindingFilter} filter */
export function isFiltering(filter) {
	return (
		filter.newOnly === true ||
		filter.query.trim() !== "" ||
		filter.kind !== "all" ||
		Boolean(filter.repo) ||
		ALL_SEVERITIES.some((severity) => !filter.severities.includes(severity))
	);
}

/**
 * @param {{ severity: string, kind: string, ruleId: string, location: string, detail: string, title: string }} finding
 * @param {string} repoName
 * @param {FindingFilter} filter
 */
export function matchesFilter(finding, repoName, filter) {
	if (!filter.severities.includes(/** @type {Severity} */ (finding.severity))) return false;
	if (filter.kind !== "all" && finding.kind !== filter.kind) return false;
	if (filter.repo && repoName !== filter.repo) return false;
	if (filter.newOnly && !filter.newKeys?.has(findingKey(repoName, finding))) return false;
	const query = filter.query.trim().toLowerCase();
	if (query === "") return true;
	return [repoName, finding.ruleId, finding.location, finding.detail, finding.title].some((text) => text.toLowerCase().includes(query));
}

/**
 * The filter in words, for the top of an export, so a partial roadmap is never mistaken for the whole one.
 *
 * @param {FindingFilter} filter
 * @returns {string | null} null when nothing is filtered out
 */
export function describeFilter(filter) {
	if (!isFiltering(filter)) return null;
	const parts = [];
	const kept = ALL_SEVERITIES.filter((severity) => filter.severities.includes(severity));
	if (kept.length < ALL_SEVERITIES.length) parts.push(kept.length > 0 ? `${kept.join(", ")} severity only` : "no severity selected");
	if (filter.kind === "secret") parts.push("secrets only");
	if (filter.kind === "vulnerability") parts.push("vulnerabilities only");
	if (filter.kind === "private-data") parts.push("private data only");
	if (filter.repo) parts.push(`in ${filter.repo}`);
	if (filter.newOnly) parts.push("new since the last scan only");
	if (filter.query.trim() !== "") parts.push(`matching "${filter.query.trim()}"`);
	return parts.join("; ");
}
