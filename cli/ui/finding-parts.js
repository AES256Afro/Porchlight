// @ts-check
// The parts the Findings pages (All findings, By repository), the Roadmap and the Overview share:
// the page head and its views, the filter bar, the headline tiles, the banners and one finding's detail.
import { judgementBlock } from "./analysis.js";
import { download } from "./api.js";
import { assistAction } from "./assist.js";
import { banner, emptyState, formatNumber, formatWhen, h, icon, plural, replace, select, severityBadge, statTile, stepNodes, tileRow, toast } from "./dom.js";
import { exportButton, openExportDialog } from "./export.js";
import { openSendDialog, sendButton } from "./send.js";
import { noteEditor } from "./finding-notes.js";
import { seenFacts } from "./seen.js";
import { ALL_SEVERITIES, isFiltering, matchesFilter, noFilter } from "./filter.js";
import { buildHash, debounce, paramsFromFilter } from "./list.js";
import { discussionsOnce, findingRows, rescanRepo, rescanRepos, store, subscribe } from "./store.js";
import { checkWords, findingKey } from "./tracking.js";
import { coverageGroups } from "./hints.js";
import { severityBar } from "./charts.js";

/** @typedef {import("./filter.js").FindingFilter} FindingFilter */
/** @typedef {import("./filter.js").Severity} Severity */
/** @typedef {import("./store.js").FindingRow} FindingRow */
/**
 * What a page is given by the router. `isCurrent`: whether it is still the page the owner asked for;
 * a page checks it after each wait before changing the address (B43).
 *
 * @typedef {{ path: string[], params: URLSearchParams, replace: (settings: Record<string, string | number | undefined>) => void, isCurrent: () => boolean }} Route
 */

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
 * "Check it now" (FT-11), where the owner has just made a repair: on a roadmap action and in a finding's
 * detail. It scans the repository again (US-4) and then says whether the findings the repair was for
 * are gone, still there, or could not be checked again (`checkWords`). Without findings to check it is
 * "Scan <repository> again". Null for a place that is not a repository of the latest scan, such as a domain.
 *
 * @param {string} repo the repository's name, as the report gives it
 * @param {string[]} [keys] the findings to check, by `findingKey`
 */
export function scanAgainButton(repo, keys = []) {
	if (!store.report?.repos.some((entry) => entry.name === repo)) return null;
	const running = store.scan.state === "running";
	const label = keys.length > 0 ? "Check it now" : `Scan ${repo} again`;
	return h(
		"button",
		{
			type: "button",
			class: "button quiet",
			"aria-disabled": running ? "true" : null,
			title: running
				? "A scan is running"
				: keys.length > 0
					? `Scans ${repo} again with the same options as the last scan, and says whether ${keys.length === 1 ? "this finding is" : "these findings are"} fixed`
					: `Scans ${repo} again with the same options as the last scan, and says what was fixed`,
			onclick: async () => {
				if (store.scan.state === "running") return;
				try {
					await rescanRepo(repo);
					if (keys.length > 0) followCheck(repo, keys);
				} catch (err) {
					toast(err instanceof Error ? err.message : String(err), "error");
				}
			},
		},
		label,
	);
}

/**
 * Waits for the scan "Check it now" started, then says what became of the findings it checks. A scan
 * that fails or is stopped says nothing about them, so nothing is said.
 *
 * @param {string} repo
 * @param {string[]} keys
 */
function followCheck(repo, keys) {
	const stop = subscribe((change) => {
		if (change === "scan" && (store.scan.state === "failed" || store.scan.state === "idle")) return void stop();
		if (change !== "report" || store.scan.state !== "done") return;
		stop();
		const rescan = store.scan.rescan;
		if (!rescan) return;
		const later = new Set(findingRows().filter((row) => row.repo === repo).map((row) => findingKey(repo, row)));
		// Not fixed yet is news, not a fault: both are said the same way.
		toast(checkWords(keys, later, { repo, uncheckedCount: rescan.uncheckedCount }).words);
	});
}

/**
 * The findings a roadmap action clears in one repository, by `findingKey`: all of them, whatever the
 * page's filter, since the repair is planned for them all (invariant 12).
 *
 * @param {string | undefined} match the action's search words
 * @param {string} repo
 */
export function actionKeys(match, repo) {
	if (!match) return [];
	const filter = { ...noFilter(), query: match, repo };
	return findingRows()
		.filter((row) => matchesFilter(row, row.repo, filter))
		.map((row) => findingKey(row.repo, row));
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
			...seenFacts(repo, finding),
		),
		finding.suggestion
			? h(
					"div",
					{ class: "how" },
					h("h3", null, finding.suggestion.title),
					h("ol", null, ...finding.suggestion.how.map((step) => h("li", null, ...stepNodes(step, { copy: true })))),
					// The same repair on the Roadmap, where it is ranked among the others.
					h("p", { class: "hint" }, viewLink(["roadmap"], { ...noFilter(), query: finding.ruleId, repo }, {}, "See this repair on the Roadmap"), " ", scanAgainButton(repo, [findingKey(repo, finding)])),
				)
			: null,
		judgementBlock(finding),
		explain ? h("div", { class: "assist-block" }, explain.button, explain.panel, explainedBefore(repo, finding)) : null,
		noteEditor(repo, finding),
	);
}

/**
 * "Explained before": the kept discussion about this finding, where Explain is, so an answer is read
 * again rather than asked for again (H-Q1). The newest one about this scan comes first; one about an
 * earlier scan is said to be.
 *
 * @param {string} repo
 * @param {{ ruleId: string, location: string, detail: string }} finding
 */
function explainedBefore(repo, finding) {
	const slot = h("p", { class: "hint" });
	void discussionsOnce().then((list) => {
		const matches = list.filter((item) => item.kind === "finding" && item.repo === repo && item.finding?.ruleId === finding.ruleId && item.finding.location === finding.location && item.finding.detail === finding.detail);
		if (matches.length === 0) return;
		const current = store.report?.scannedAt;
		const best = matches.find((item) => item.finding?.scannedAt === current) ?? matches[0];
		if (!best) return;
		const same = best.finding?.scannedAt === current;
		replace(slot, h("a", { href: `#/discussions/${encodeURIComponent(best.id)}` }, same ? `Explained before, ${formatWhen(best.updatedAt)}` : `Explained about an earlier scan, ${formatWhen(best.updatedAt)}`), ` by ${best.model}.`);
	});
	return slot;
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
					: "The findings in your code: leaked secrets and vulnerable packages.",
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
	return emptyState("Your code has not been scanned yet", shows, h("a", { class: "button primary", href: "#/overview" }, "Scan your code"));
}

export function coverageBanner() {
	if (store.notes.length === 0) return null;
	const report = store.report;
	const groups = report ? coverageGroups(report) : [];
	// Lines of one cause are said once, with the repositories and what to do (US-9); the rest as they are.
	const others = groups.length > 0 ? store.notes.filter((line) => !/^(gitleaks|osv-scanner) (failed on|on) /.test(line)) : store.notes;
	const node = banner("warning", "This scan is incomplete, so a clean result here is not a clean bill of health", others);
	if (groups.length === 0) return node;
	(node.lastElementChild ?? node).append(
		h(
			"ul",
			{ class: "coverage-groups" },
			...groups.slice(0, 20).map((group) =>
				h(
					"li",
					null,
					h("strong", null, `${group.title} (${plural(group.repos.length, "repository", "repositories")})`),
					h("span", { class: "hint block wrap" }, group.repos.slice(0, 8).join(", "), group.repos.length > 8 ? ` and ${formatNumber(group.repos.length - 8)} more` : ""),
					h("span", { class: "hint block" }, ...stepNodes(group.fix)),
					rescanAllButton(group.repos),
				),
			),
		),
	);
	return node;
}

/**
 * "Scan these again": the repositories of one cause, scanned again as one job, by name (US-9).
 *
 * @param {string[]} repos
 */
function rescanAllButton(repos) {
	return h(
		"button",
		{
			type: "button",
			class: "button quiet",
			onclick: async () => {
				if (store.scan.state === "running") return toast("A scan is running. Scan these again when it has finished.");
				try {
					await rescanRepos(repos);
				} catch (err) {
					toast(err instanceof Error ? err.message : String(err), "error");
				}
			},
		},
		repos.length === 1 ? `Scan ${repos[0]} again` : `Scan these ${formatNumber(repos.length)} again`,
	);
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
					// The set of new findings is kept: only the choice to show those alone is cleared.
					filter.newOnly = false;
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
	// On a phone the filters fold behind one button, so the first finding is not two screens down (W8).
	const toggle = /** @type {HTMLButtonElement} */ (
		h(
			"button",
			{
				type: "button",
				class: "button filters-toggle",
				"aria-expanded": "false",
				onclick: () => {
					const open = bar.classList.toggle("open");
					toggle.setAttribute("aria-expanded", String(open));
				},
			},
			isFiltering(filter) ? "Filters (on)" : "Filters",
		)
	);
	const bar = h(
		"div",
		{ class: "filters foldable" },
		h("div", { class: "field grow" }, search),
		toggle,
		severityChips(filter, changedNow),
		select(
			"Type",
			[
				["all", "All types"],
				["secret", "Secrets"],
				["vulnerability", "Vulnerabilities"],
				["private-data", "Private data"],
				["workflow", "Workflows"],
			],
			filter.kind,
			(value) => ((filter.kind = /** @type {FindingFilter["kind"]} */ (value)), changedNow()),
		),
		select("Repository", repoChoices(filter), filter.repo ?? "", (value) => ((filter.repo = value), changedNow())),
		newChip(filter, changedNow),
		...extras,
		clear.button,
	);
	return bar;
}

/**
 * "New since the last scan" (B-Q1): Porchlight's own comparison of this scan with the one before it,
 * never a status, so it narrows the list as the other filters do and an export of it matches.
 *
 * @param {FindingFilter} filter
 * @param {() => void} onChange
 */
export function newChip(filter, onChange) {
	const count = store.change?.newCount ?? 0;
	return h(
		"button",
		{
			type: "button",
			class: "chip",
			"aria-pressed": String(filter.newOnly === true),
			title: store.change ? "Only findings the last scan did not have" : "There is no earlier scan of these folders to compare with",
			onclick: (/** @type {MouseEvent} */ event) => {
				filter.newOnly = !filter.newOnly;
				/** @type {HTMLElement} */ (event.currentTarget).setAttribute("aria-pressed", String(filter.newOnly));
				onChange();
			},
		},
		store.change ? `New since the last scan (${formatNumber(count)})` : "New since the last scan",
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
	const tiles = tileRow(
		statTile(filtering ? "Matching findings" : "Total findings", rows.length),
		statTile("Repositories affected", `${formatNumber(affected)} of ${formatNumber(store.report?.repos.length ?? 0)}`),
	);
	tiles.classList.add("findings-tiles");
	// One severity bar in place of a tile per severity (VS-14): each as shape, colour, word and number.
	const bar = severityBar(counts);
	bar.classList.add("findings-tiles");
	// On a phone the tiles fold into one line (W8); pages.css shows one or the other.
	const line = h(
		"p",
		{ class: "findings-line" },
		`${plural(rows.length, filtering ? "matching finding" : "finding", filtering ? "matching findings" : "findings")}: ${ALL_SEVERITIES.map((severity) => `${formatNumber(counts[severity])} ${SEVERITY_LABELS[severity].toLowerCase()}`).join(", ")}, in ${plural(affected, "repository", "repositories")}.`,
	);
	return h("div", null, tiles, bar, line);
}
