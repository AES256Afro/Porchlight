// @ts-check
import { judgementBlock, verdictMark } from "./analysis.js";
import { assistAction } from "./assist.js";
import { banner, emptyState, formatWhen, h, icon, pager, PHASE_TITLES, plural, replace, select, severityBadge, statTile, stepNodes } from "./dom.js";
import { exportButton, openExportDialog } from "./export.js";
import { ALL_SEVERITIES, isFiltering, matchesFilter } from "./filter.js";
import { debounce, filterFromParams, paginate, paramsFromFilter, sortFindings } from "./list.js";
import { currentLook } from "./appearance.js";
import { findingRows, load, store, subscribe } from "./store.js";

/** @typedef {import("./filter.js").FindingFilter} FindingFilter */
/** @typedef {import("./filter.js").Severity} Severity */
/** @typedef {import("./store.js").FindingRow} FindingRow */
/** @typedef {{ path: string[], params: URLSearchParams, replace: (settings: Record<string, string | number | undefined>) => void }} Route */

const SEVERITY_LABELS = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
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
		if (change === "report") draw();
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
					[select("Order", SORTS, sort, (value) => ((sort = /** @type {typeof sort} */ (value)), (page = 1), update()))],
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

/**
 * Everything known about one finding, and how to fix it. With a local model, a button asks it to
 * explain the finding, and its answer opens underneath.
 *
 * @param {FindingRow | import("./store.js").SuggestedFinding} finding
 * @param {string} repo the repository's name, as the report gives it
 */
export function findingDetail(finding, repo) {
	const assistant = store.settings?.assistant;
	const explain = assistant?.configured
		? assistAction(
				["finding", store.report?.scannedAt, repo, finding.ruleId, finding.location, finding.detail].join("\n"),
				"/assist/finding",
				assistant,
				{ start: "Explain", busy: "Explaining…", again: "Explain again" },
				() => ({ repo, ruleId: finding.ruleId, location: finding.location, detail: finding.detail }),
			)
		: null;
	const id =
		finding.kind === "vulnerability"
			? h("a", { href: `https://osv.dev/vulnerability/${encodeURIComponent(finding.ruleId)}`, target: "_blank", rel: "noopener noreferrer" }, finding.ruleId)
			: finding.ruleId;
	return h(
		"div",
		{ class: "detail-panel" },
		h(
			"dl",
			{ class: "facts" },
			h("dt", null, finding.kind === "vulnerability" ? "Advisory" : "Rule"),
			h("dd", { class: "mono" }, id),
			h("dt", null, finding.kind === "vulnerability" ? "Package" : "Found in"),
			h("dd", { class: "mono wrap" }, finding.detail),
			finding.fixedIn ? h("dt", null, "Fixed in") : null,
			finding.fixedIn ? h("dd", { class: "mono" }, finding.fixedIn) : null,
			finding.note ? h("dt", null, "Ranking") : null,
			finding.note ? h("dd", null, finding.note) : null,
		),
		finding.suggestion
			? h(
					"div",
					{ class: "how" },
					h("h3", null, finding.suggestion.title),
					h("ol", null, ...finding.suggestion.how.map((step) => h("li", null, ...stepNodes(step)))),
				)
			: null,
		judgementBlock(finding),
		explain ? h("div", { class: "assist-block" }, explain.button, explain.panel) : null,
	);
}

/**
 * The page title, what the scan covered, and the switch between the two ways of looking at findings.
 *
 * @param {"all" | "by-repo"} mode
 * @param {FindingFilter} [filter] the page's filter, so Export can offer "only what the filters show"
 */
export function findingsHeader(mode, filter) {
	const report = store.report;
	const tools = report?.tools.map((tool) => (tool.status === "ok" ? `${tool.tool} ${tool.version ?? ""}`.trim() : `${tool.tool} missing`)).join(", ");
	return h(
		"div",
		{ class: "page-head" },
		h(
			"div",
			null,
			h("h1", null, "Findings"),
			h(
				"p",
				{ class: "sub" },
				report
					? `${plural(report.repos.length, "repository", "repositories")} under ${report.root} · scanned ${formatWhen(report.scannedAt)} · ${tools}`
					: "The problems found in your code: leaked secrets and vulnerable packages.",
			),
		),
		h(
			"div",
			{ class: "actions" },
			h(
				"nav",
				{ class: "segmented", "aria-label": "View" },
				h("a", { href: "#/findings", "aria-current": mode === "all" ? "page" : null }, "All findings"),
				h("a", { href: "#/findings/by-repo", "aria-current": mode === "by-repo" ? "page" : null }, "By repository"),
			),
			filter && report
				? exportButton(() => {
						const shown = findingRows().filter((row) => matchesFilter(row, row.repo, filter)).length;
						openExportDialog({ filter, shown, total: findingRows().length }, "findings");
					}, findingRows().length === 0)
				: null,
		),
	);
}

/**
 * In place of a page that has nothing to show until a scan has run: what the page is for, and where to start.
 *
 * @param {string} [shows] what this page will hold once there is a scan
 */
export function noScanYet(shows = "Every leaked password or key and every vulnerable package appears here, worst first.") {
	return emptyState("Your code has not been checked yet", shows, h("a", { class: "button primary", href: "#/overview" }, "Check your code"));
}

export function coverageBanner() {
	return store.notes.length > 0 ? banner("warning", "This scan is incomplete, so a clean result here is not a clean bill of health", store.notes) : null;
}

/** Ignore files and scanner settings found in repositories: what they hide is not listed here. */
export function settingsBanner() {
	return store.settingNotes.length > 0 ? banner("warning", "Some repositories tell the scanners to leave findings out", store.settingNotes) : null;
}

/**
 * Search, severity, type and repository. Changes are written into `filter`.
 *
 * @param {FindingFilter} filter
 * @param {() => void} onChange
 * @param {Node[]} [extras] further controls, placed last
 */
export function filterBar(filter, onChange, extras = []) {
	const repos = (store.report?.repos ?? []).filter((repo) => repo.findings.length > 0).map((repo) => repo.name).sort((a, b) => a.localeCompare(b));
	const changed = debounce(onChange, 150);
	const search = /** @type {HTMLInputElement} */ (
		h("input", {
			type: "search",
			placeholder: "Search findings",
			value: filter.query,
			"aria-label": "Search findings",
			oninput: () => {
				filter.query = search.value;
				changed();
			},
		})
	);
	return h(
		"div",
		{ class: "filters" },
		h("div", { class: "field grow" }, search),
		h(
			"div",
			{ class: "chip-group", role: "group", "aria-label": "Severity" },
			...ALL_SEVERITIES.map((severity) =>
				h(
					"button",
					{
						type: "button",
						class: "chip",
						"aria-pressed": String(filter.severities.includes(severity)),
						onclick: (/** @type {MouseEvent} */ event) => {
							filter.severities = ALL_SEVERITIES.filter((level) => (level === severity ? !filter.severities.includes(level) : filter.severities.includes(level)));
							/** @type {HTMLElement} */ (event.currentTarget).setAttribute("aria-pressed", String(filter.severities.includes(severity)));
							onChange();
						},
					},
					severityBadge(severity),
				),
			),
		),
		select(
			"Type",
			[
				["all", "All types"],
				["secret", "Secrets"],
				["vulnerability", "Vulnerabilities"],
			],
			filter.kind,
			(value) => ((filter.kind = /** @type {FindingFilter["kind"]} */ (value)), onChange()),
		),
		select("Repository", [["", "All repositories"], .../** @type {[string, string][]} */ (repos.map((name) => [name, name]))], filter.repo ?? "", (value) => ((filter.repo = value), onChange())),
		...extras,
	);
}

/**
 * Headline numbers for the findings on show.
 *
 * @param {FindingRow[]} rows
 * @param {boolean} filtering
 */
export function severityTiles(rows, filtering) {
	/** @type {Record<Severity, number>} */
	const counts = { critical: 0, high: 0, medium: 0, low: 0 };
	for (const row of rows) counts[row.severity]++;
	const affected = new Set(rows.map((row) => row.repo)).size;
	return h(
		"div",
		{ class: "tiles" },
		statTile(filtering ? "Matching findings" : "Total findings", rows.length),
		...ALL_SEVERITIES.map((severity) => statTile(SEVERITY_LABELS[severity], counts[severity], icon(severity, `severity-${severity}`))),
		statTile("Repositories affected", `${affected.toLocaleString()} of ${(store.report?.repos.length ?? 0).toLocaleString()}`),
	);
}
