// @ts-check
// The charts' layouts (charts.js), as plain functions with no DOM, so they are tested on their own
// (cli/test/ui-logic.test.ts).

/** @typedef {"critical" | "high" | "medium" | "low"} Severity */

/** @type {readonly Severity[]} */
export const SEVERITY_ORDER = ["critical", "high", "medium", "low"];
const WORDS = { critical: "critical", high: "high", medium: "medium", low: "low" };

/** How wide a scan's preset looks: a narrower scan finds less, which is not a fix. */
const PRESET_WORDS = { quick: "Quick", standard: "Standard", deep: "Deep", custom: "Custom" };

/**
 * @typedef {{ scannedAt: string, root: string, findings: number, counts: Record<string, number>, preset?: string }} KeptScan
 * @typedef {{ at: string, counts: Record<Severity, number>, total: number, apart: string | null }} TrendColumn
 */

/**
 * One column per kept scan, oldest first, for at most `limit` scans. A scan of another folder, or with
 * another preset than the latest, is "apart": drawn hollow and labelled with why, so a Quick scan after a
 * Standard one never reads as an improvement (VS-12). A scan kept before presets were recorded was Standard.
 *
 * @param {KeptScan[]} scans newest first, as the server lists them
 * @param {number} [limit]
 * @returns {TrendColumn[]}
 */
export function trendColumns(scans, limit = 12) {
	const newest = [...scans].sort((a, b) => b.scannedAt.localeCompare(a.scannedAt));
	const shown = newest.slice(0, limit).reverse();
	const latest = newest[0];
	if (!latest) return [];
	const latestPreset = latest.preset ?? "standard";
	return shown.map((scan) => {
		/** @type {Record<Severity, number>} */
		const counts = { critical: 0, high: 0, medium: 0, low: 0 };
		for (const severity of SEVERITY_ORDER) counts[severity] = Number(scan.counts?.[severity] ?? 0);
		const preset = scan.preset ?? "standard";
		const apart = scan.root !== latest.root ? "Another folder" : preset !== latestPreset ? `${PRESET_WORDS[/** @type {keyof typeof PRESET_WORDS} */ (preset)] ?? "Another"} scan` : null;
		return { at: scan.scannedAt, counts, total: scan.findings, apart };
	});
}

/** "84 findings: 3 critical, 20 high, 40 medium, 21 low". @param {Record<Severity, number>} counts @param {number} [total] */
export function countsWords(counts, total) {
	const sum = total ?? SEVERITY_ORDER.reduce((all, severity) => all + counts[severity], 0);
	const parts = SEVERITY_ORDER.filter((severity) => counts[severity] > 0).map((severity) => `${count(counts[severity])} ${WORDS[severity]}`);
	return `${`${count(sum)} ${sum === 1 ? "finding" : "findings"}`}${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`;
}

/**
 * The share of each severity in a set of findings, as widths that add up to `width`: what the severity
 * bar draws. Zero counts get no segment.
 *
 * @param {Record<Severity, number>} counts
 * @param {number} width
 * @returns {{ severity: Severity, x: number, width: number, count: number }[]}
 */
export function barSegments(counts, width) {
	const total = SEVERITY_ORDER.reduce((all, severity) => all + Math.max(0, counts[severity] ?? 0), 0);
	if (total === 0) return [];
	let x = 0;
	return SEVERITY_ORDER.filter((severity) => (counts[severity] ?? 0) > 0).map((severity) => {
		const share = (counts[severity] / total) * width;
		const segment = { severity, x, width: share, count: counts[severity] };
		x += share;
		return segment;
	});
}


/** A whole number as the page writes it: "1,860". @param {number} value */
function count(value) {
	return value.toLocaleString("en-GB");
}
