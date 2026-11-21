// @ts-check
import { verdictMark } from "./analysis.js";
import { emptyState, h, icon, pager, PHASE_TITLES, replace, select, severityBadge } from "./dom.js";
import { coverageBanner, filterBar, findingDetail, findingsHeader, noScanYet, settingsBanner, severityTiles } from "./finding-parts.js";
import { trackingMarks } from "./finding-notes.js";
import { isFiltering, matchesFilter } from "./filter.js";
import { filterFromParams, paginate, paramsFromFilter, sortFindings } from "./list.js";
import { currentLook } from "./appearance.js";
import { findingRows, load, store, subscribe } from "./store.js";

/** @typedef {import("./store.js").FindingRow} FindingRow */
/** @typedef {import("./finding-parts.js").Route} Route */

const PAGE_SIZE = 50;
const SORTS = /** @type {[string, string][]} */ ([
	["severity", "By severity"],
	["repo", "By repository"],
	["location", "By file"],
	["title", "By name"],
	["verdict", "By model verdict"],
]);

/**
 * The Findings page: every finding of the scan in one list, each with the repair that clears it.
 *
 * @param {HTMLElement} view
 * @param {Route} route
 * @returns {Promise<() => void>}
 */
export async function renderFindings(view, route) {
	await load();
	const filter = filterFromParams(route.params);
	let sort = /** @type {"severity" | "repo" | "location" | "title" | "verdict"} */ (SORTS.some(([key]) => key === route.params.get("sort")) ? route.params.get("sort") : "severity");
	let page = Number(route.params.get("page")) || 1;
	/** @type {Set<string>} */
	const expanded = new Set();

	const results = h("div");
	draw();
	return subscribe((change) => {
		// A saved note changes the marks in the list, not the filters: only the list is drawn again.
		if (change === "report") draw();
		else if (change === "notes") update();
	});

	function draw() {
		const report = store.report;
		if (!report) return replace(view, h("section", { class: "page" }, findingsHeader("all"), noScanYet()));
		replace(
			view,
			h(
				"section",
				{ class: "page" },
				findingsHeader("all", filter),
				coverageBanner(),
				settingsBanner(),
				filterBar(
					filter,
					() => {
						page = 1;
						update();
					},
					{
						extras: [select("Order", SORTS, sort, (value) => ((sort = /** @type {typeof sort} */ (value)), (page = 1), update()))],
						onCleared: () => {
							page = 1;
							draw();
						},
					},
				),
				results,
			),
		);
		update();
	}

	function update() {
		const all = findingRows();
		const matching = sortFindings(all.filter((row) => matchesFilter(row, row.repo, filter)), sort);
		const shown = paginate(matching, page, PAGE_SIZE);
		page = shown.page;
		route.replace({ ...paramsFromFilter(filter), sort: sort === "severity" ? undefined : sort, page: page > 1 ? page : undefined });

		if (matching.length === 0) {
			return replace(
				results,
				severityTiles(matching, isFiltering(filter)),
				all.length === 0 ? emptyState("No findings", "The scan found nothing wrong in what it covered.") : emptyState("No findings match", "Loosen the filters to see more."),
			);
		}
		const table = h(
			"div",
			{ class: "table-wrap" },
			h(
				"table",
				{ class: "data" },
				h("thead", null, h("tr", null, ...["Severity", "Finding", "Repository", "Where", "When"].map((label) => h("th", { scope: "col" }, label)))),
				h("tbody", null, ...shown.items.flatMap(findingRow)),
			),
		);
		// "Split view" shows the chosen finding beside the list instead of under its row.
		const chosen = splitView() ? shown.items.find((row) => expanded.has(rowKey(row))) : undefined;
		replace(
			results,
			severityTiles(matching, isFiltering(filter)),
			splitView()
				? h(
						"div",
						{ class: "split-view" },
						table,
						h(
							"aside",
							{ class: "split-detail", "aria-label": "Chosen finding" },
							chosen ? h("h2", null, chosen.title) : h("p", { class: "hint" }, "Choose a finding to see its detail here."),
							chosen ? h("p", { class: "sub" }, severityBadge(chosen.severity), ` ${chosen.repo} · `, h("span", { class: "mono" }, chosen.location)) : null,
							chosen ? findingDetail(chosen, chosen.repo) : null,
						),
					)
				: table,
			pager(shown, "findings", (next) => {
				page = next;
				update();
				view.scrollIntoView({ block: "start" });
			}),
		);
	}

	/** @param {FindingRow} row */
	function findingRow(row) {
		const key = rowKey(row);
		const open = expanded.has(key);
		const toggle = () => {
			if (open) expanded.delete(key);
			else {
				// Beside the list there is room for one finding at a time.
				if (splitView()) expanded.clear();
				expanded.add(key);
			}
			update();
		};
		return [
			h(
				"tr",
				{ class: `finding-row clickable${open ? " open" : ""}`, onclick: toggle },
				h("td", null, severityBadge(row.severity)),
				h(
					"td",
					{ class: "col-what" },
					h(
						"button",
						{
							type: "button",
							class: "disclosure",
							"aria-expanded": String(open),
							onclick: (/** @type {MouseEvent} */ event) => {
								event.stopPropagation();
								toggle();
							},
						},
						icon("chevron"),
						h("span", { class: "wrap" }, row.title),
					),
					row.suggestion ? h("div", { class: "fix" }, h("span", { class: "fix-label" }, "Fix"), row.suggestion.title) : null,
					verdictMark(row),
					trackingMarks(row.repo, row),
				),
				h("td", { class: "wrap" }, row.repo),
				h("td", { class: "mono wrap col-where" }, row.location),
				h("td", { class: "nowrap" }, row.suggestion ? PHASE_TITLES[row.suggestion.phase] : ""),
			),
			open && !splitView() ? h("tr", { class: "detail-row" }, h("td", { colSpan: 5 }, findingDetail(row, row.repo))) : null,
		];
	}
}

/** @param {FindingRow} row */
function rowKey(row) {
	return `${row.repo}\n${row.ruleId}\n${row.location}\n${row.detail}`;
}

function splitView() {
	return currentLook() === "split";
}
