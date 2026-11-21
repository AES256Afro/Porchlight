// @ts-check
// The parts the Findings pages (All findings, By repository), the Roadmap and the Overview share:
// the page head and its views, the filter bar, the headline tiles, the banners and one finding's detail.
import { judgementBlock } from "./analysis.js";
import { download } from "./api.js";
import { assistAction } from "./assist.js";
import { banner, emptyState, formatWhen, h, icon, plural, select, severityBadge, statTile, stepNodes, tileRow, toast } from "./dom.js";
import { exportButton, openExportDialog } from "./export.js";
import { openSendDialog, sendButton } from "./send.js";
import { noteEditor } from "./finding-notes.js";
import { ALL_SEVERITIES, isFiltering, matchesFilter, noFilter } from "./filter.js";
import { buildHash, debounce, paramsFromFilter } from "./list.js";
import { findingRows, store } from "./store.js";

/** @typedef {import("./filter.js").FindingFilter} FindingFilter */
/** @typedef {import("./filter.js").Severity} Severity */
/** @typedef {import("./store.js").FindingRow} FindingRow */
/** @typedef {{ path: string[], params: URLSearchParams, replace: (settings: Record<string, string | number | undefined>) => void }} Route */

const SEVERITY_LABELS = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

/**
 * A link to another view of the findings that takes the filters along, so switching between All
 * findings, By repository and the Roadmap keeps what the owner narrowed down. The address is worked
 * out when the link is followed, as the filters may have changed since the page was drawn.
 *
 * @param {string[]} path
 * @param {FindingFilter | undefined} filter
 * @param {Record<string, unknown>} props
 * @param {...(Node | string)} children
 */
export function viewLink(path, filter, props, ...children) {
	const link = /** @type {HTMLAnchorElement} */ (
		h(
			"a",
			{
				...props,
				href: buildHash(path, filter ? paramsFromFilter(filter) : {}),
				onclick: () => {
					if (filter) link.href = buildHash(path, paramsFromFilter(filter));
				},
			},
			...children,
		)
	);
	return link;
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
					// The same repair on the Roadmap, where it is ranked among the others.
					h("p", { class: "hint" }, viewLink(["roadmap"], { ...noFilter(), query: finding.ruleId, repo }, {}, "See this repair on the Roadmap")),
				)
			: null,
		judgementBlock(finding),
		explain ? h("div", { class: "assist-block" }, explain.button, explain.panel) : null,
		noteEditor(repo, finding),
	);
}

/**
 * The page title, what the scan covered, and the switch between the two ways of looking at findings.
 *
 * @param {"all" | "by-repo"} mode
 * @param {FindingFilter} [filter] the page's filter, carried to the other view and offered to Export
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
				viewLink(["findings"], filter, { "aria-current": mode === "all" ? "page" : null }, "All findings"),
				viewLink(["findings", "by-repo"], filter, { "aria-current": mode === "by-repo" ? "page" : null }, "By repository"),
			),
			filter && report
				? sendButton(() => {
						const shown = findingRows().filter((row) => matchesFilter(row, row.repo, filter)).length;
						openSendDialog({ filter, shown, total: findingRows().length }, "findings");
					}, findingRows().length === 0)
				: null,
			// Every package the repositories use, not only the vulnerable ones: read from the lockfiles, offline.
			mode === "by-repo" && report ? sbomButton() : null,
			filter && report
				? exportButton(() => {
						const shown = findingRows().filter((row) => matchesFilter(row, row.repo, filter)).length;
						openExportDialog({ filter, shown, total: findingRows().length }, "findings");
					}, findingRows().length === 0)
				: null,
		),
	);
}

/** Downloads a CycloneDX bill of materials of the scan's repositories. It takes a few seconds, so the button says so while it works. */
function sbomButton() {
	const button = /** @type {HTMLButtonElement} */ (
		h(
			"button",
			{
				type: "button",
				class: "button",
				title: "Every package the repositories' lockfiles name, as a CycloneDX file. Read on this computer; nothing is sent anywhere.",
				onclick: async () => {
					if (button.getAttribute("aria-disabled") === "true") return;
					button.setAttribute("aria-disabled", "true");
					button.textContent = "Listing packages…";
					try {
						toast(`Saved ${await download("/repos/sbom")}`);
					} catch (err) {
						toast(err instanceof Error ? err.message : String(err), "error");
					} finally {
						button.removeAttribute("aria-disabled");
						button.textContent = "SBOM";
					}
				},
			},
			"SBOM",
		)
	);
	return button;
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
 * The repositories a filter can choose from. One named by the address but not in this scan (an old
 * link, a repository since removed) still filters the page, so it is listed too, marked, rather
 * than hidden behind "All repositories".
 *
 * @param {FindingFilter} filter
 * @returns {[string, string][]}
 */
export function repoChoices(filter) {
	const names = (store.report?.repos ?? []).filter((repo) => repo.findings.length > 0).map((repo) => repo.name).sort((a, b) => a.localeCompare(b));
	/** @type {[string, string][]} */
	const choices = [["", "All repositories"], ...names.map((name) => /** @type {[string, string]} */ ([name, name]))];
	if (filter.repo && !names.includes(filter.repo)) choices.push([filter.repo, `${filter.repo} (no findings in this scan)`]);
	return choices;
}

/**
 * Four toggles, one per severity. Changes are written into `filter`.
 *
 * @param {FindingFilter} filter
 * @param {() => void} onChange
 */
export function severityChips(filter, onChange) {
	return h(
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
	);
}

/**
 * A button that puts every filter back to "show everything". Hidden while nothing is filtered.
 * `onCleared` redraws the controls, since each of them shows a filter's value.
 *
 * @param {FindingFilter} filter
 * @param {() => void} onCleared
 * @returns {{ button: HTMLButtonElement, refresh: () => void }}
 */
export function clearFiltersButton(filter, onCleared) {
	const button = /** @type {HTMLButtonElement} */ (
		h(
			"button",
			{
				type: "button",
				class: "button quiet",
				onclick: () => {
					Object.assign(filter, noFilter());
					onCleared();
					// The button hides itself, so focus goes to the search box at the start of the filters.
					/** @type {HTMLElement | null} */ (document.querySelector('#view .filters input[type="search"]'))?.focus();
				},
			},
			"Clear filters",
		)
	);
	const refresh = () => {
		button.hidden = !isFiltering(filter);
	};
	refresh();
	return { button, refresh };
}

/**
 * Search, severity, type and repository. Changes are written into `filter`.
 *
 * @param {FindingFilter} filter
 * @param {() => void} onChange
 * @param {{ extras?: Node[], onCleared: () => void }} options further controls, placed last; `onCleared` redraws the page after "Clear filters"
 */
export function filterBar(filter, onChange, { extras = [], onCleared }) {
	const clear = clearFiltersButton(filter, onCleared);
	const changedNow = () => {
		clear.refresh();
		onChange();
	};
	const changed = debounce(changedNow, 150);
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
		severityChips(filter, changedNow),
		select(
			"Type",
			[
				["all", "All types"],
				["secret", "Secrets"],
				["vulnerability", "Vulnerabilities"],
				["private-data", "Private data"],
			],
			filter.kind,
			(value) => ((filter.kind = /** @type {FindingFilter["kind"]} */ (value)), changedNow()),
		),
		select("Repository", repoChoices(filter), filter.repo ?? "", (value) => ((filter.repo = value), changedNow())),
		...extras,
		clear.button,
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
	return tileRow(
		statTile(filtering ? "Matching findings" : "Total findings", rows.length),
		...ALL_SEVERITIES.map((severity) => statTile(SEVERITY_LABELS[severity], counts[severity], icon(severity, `severity-${severity}`))),
		statTile("Repositories affected", `${affected.toLocaleString()} of ${(store.report?.repos.length ?? 0).toLocaleString()}`),
	);
}
