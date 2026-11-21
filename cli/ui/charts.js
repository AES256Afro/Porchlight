// @ts-check
// Small charts (VS-12 to VS-15): the findings trend across kept scans, one severity bar, and what each
// phase of the roadmap clears. Each is drawn with svg() (dom.js), coloured by class (the page's security
// policy forbids inline style), carries every number in text as well (a title per mark and a caption), and
// sits beside the table it illustrates, never in place of it. The layouts are plain functions in
// chart-layout.js, tested without a DOM (cli/test/ui-logic.test.ts).
import { formatNumber, formatWhen, h, plural, severityBadge, svg } from "./dom.js";
import { barSegments, countsWords, SEVERITY_ORDER } from "./chart-layout.js";

/** @typedef {import("./chart-layout.js").Severity} Severity */
/** @typedef {import("./chart-layout.js").TrendColumn} TrendColumn */

export { trendColumns } from "./chart-layout.js";

const TREND = { column: 22, gap: 10, height: 96, top: 14, bottom: 4 };

/**
 * The findings trend: a stacked column per kept scan, beside the history table.
 *
 * @param {TrendColumn[]} columns
 * @param {string} caption
 */
export function trendChart(columns, caption) {
	if (columns.length < 2) return null;
	const max = Math.max(1, ...columns.map((column) => column.total));
	const width = columns.length * (TREND.column + TREND.gap) + TREND.gap;
	const plot = TREND.height - TREND.top - TREND.bottom;
	const marks = columns.map((column, index) => {
		const x = TREND.gap + index * (TREND.column + TREND.gap);
		const words = `${formatWhen(column.at)}: ${countsWords(column.counts, column.total)}${column.apart ? ` (${column.apart.toLowerCase()}, not comparable)` : ""}`;
		const scaled = (/** @type {number} */ count) => (count / max) * plot;
		const parts = [svg("title", null, words)];
		if (column.apart) {
			const height = Math.max(1, scaled(column.total));
			parts.push(svg("rect", { class: "bar-apart", x, y: TREND.height - TREND.bottom - height, width: TREND.column, height }));
		} else {
			let base = TREND.height - TREND.bottom;
			// Low at the foot, critical on top, as the eye reads down from the worst.
			for (const severity of [...SEVERITY_ORDER].reverse()) {
				const height = scaled(column.counts[severity]);
				if (height <= 0) continue;
				base -= height;
				parts.push(svg("rect", { class: `bar-${severity}`, x, y: base, width: TREND.column, height }));
			}
		}
		parts.push(svg("text", { x: x + TREND.column / 2, y: TREND.height - TREND.bottom - scaled(column.total) - 3, "text-anchor": "middle" }, formatNumber(column.total)));
		return svg("g", { role: "listitem", "aria-label": words }, ...parts);
	});
	return h(
		"figure",
		{ class: "chart trend-chart" },
		svg("svg", { viewBox: `0 0 ${width} ${TREND.height}`, width, height: TREND.height, role: "list", "aria-label": caption }, svg("line", { class: "chart-axis", x1: 0, x2: width, y1: TREND.height - TREND.bottom, y2: TREND.height - TREND.bottom }), ...marks),
		h("figcaption", { class: "hint" }, caption),
	);
}

/**
 * One severity bar (VS-14): the proportions drawn, and under them each severity as shape, colour, word and
 * number, which is what a reader relies on. `link` makes each count a link (to the filtered list).
 *
 * Used wherever findings are counted by severity: Findings, the Overview, a domain's report and the
 * Cloudflare audit. `order`: the severities the source has (a domain's findings are never critical).
 *
 * @param {Record<Severity, number>} counts
 * @param {(severity: Severity) => string | null} [link]
 * @param {readonly Severity[]} [order]
 */
export function severityBar(counts, link, order = SEVERITY_ORDER) {
	const segments = barSegments(counts, 100);
	const total = SEVERITY_ORDER.reduce((all, severity) => all + (counts[severity] ?? 0), 0);
	return h(
		"div",
		{ class: "severity-bar" },
		segments.length > 0
			? svg(
					"svg",
					{ viewBox: "0 0 100 6", preserveAspectRatio: "none", "aria-hidden": "true", class: "severity-bar-track" },
					...segments.map((segment) => svg("rect", { class: `bar-${segment.severity}`, x: segment.x, y: 0, width: segment.width, height: 6 })),
				)
			: null,
		h(
			"ul",
			{ class: "severity-bar-legend", "aria-label": countsWords(counts, total) },
			...order.map((severity) => {
				const target = link?.(severity) ?? null;
				const content = [severityBadge(severity), " ", h("strong", null, formatNumber(counts[severity] ?? 0))];
				return h("li", null, target ? h("a", { href: target }, ...content) : h("span", null, ...content));
			}),
		),
	);
}

/**
 * How many findings each phase of the roadmap clears (VS-15), as bars beside the phase table.
 *
 * @param {{ title: string, findings: number }[]} phases
 */
export function phaseChart(phases) {
	const total = phases.reduce((all, phase) => all + phase.findings, 0);
	if (total === 0) return null;
	const row = 18;
	const label = 120;
	const bar = 200;
	const height = phases.length * row;
	return h(
		"figure",
		{ class: "chart phase-chart" },
		svg(
			"svg",
			{ viewBox: `0 0 ${label + bar + 60} ${height}`, width: label + bar + 60, height, role: "list", "aria-label": "Findings each phase clears" },
			...phases.map((phase, index) => {
				const words = `${index + 1}. ${phase.title}: ${plural(phase.findings, "finding", "findings")} of ${formatNumber(total)}`;
				const width = (phase.findings / total) * bar;
				return svg(
					"g",
					{ role: "listitem", "aria-label": words },
					svg("title", null, words),
					svg("text", { x: 0, y: index * row + 13 }, `${index + 1}. ${phase.title}`),
					svg("rect", { class: "bar-phase", x: label, y: index * row + 4, width: Math.max(phase.findings > 0 ? 1 : 0, width), height: row - 8 }),
					svg("text", { x: label + width + 6, y: index * row + 13 }, formatNumber(phase.findings)),
				);
			}),
		),
		h("figcaption", { class: "hint" }, `Findings each phase clears, of ${formatNumber(total)}.`),
	);
}
