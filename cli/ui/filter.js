// @ts-check
// Shared by the page (to show findings) and the server (to export them), so
// "export what the filters show" exports exactly what the page shows.

/** @typedef {"critical" | "high" | "medium" | "low"} Severity */

/**
 * @typedef {object} FindingFilter
 * @property {Severity[]} severities levels to include
 * @property {"all" | "secret" | "vulnerability"} kind
 * @property {string} query text to find in the repository name or any finding field
 * @property {string} [repo] only this repository, by name; empty or absent for all
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
	if (filter.repo) parts.push(`in ${filter.repo}`);
	if (filter.query.trim() !== "") parts.push(`matching "${filter.query.trim()}"`);
	return parts.join("; ");
}
