// @ts-check
import { api } from "./api.js";
import { assistAction } from "./assist.js";
import { banner, emptyState, h, pager, PHASE_TITLES, plural, replace, select, severityBadge, stepNodes } from "./dom.js";
import { exportButton, openExportDialog } from "./export.js";
import { openSendDialog, sendButton } from "./send.js";
import { clearFiltersButton, newChip, noScanYet, repoChoices, scanAgainButton, severityChips, viewLink } from "./finding-parts.js";
import { matchesFilter } from "./filter.js";
import { phaseChart } from "./charts.js";
import { debounce, filterFromParams, paginate, paramsFromFilter } from "./list.js";
import { findingRows, load, newFindingKeys, store, subscribe } from "./store.js";

/** @typedef {import("../src/roadmap/types.ts").Roadmap} Roadmap */
/** @typedef {import("../src/roadmap/types.ts").Action} Action */
/** @typedef {import("../src/roadmap/types.ts").Phase} Phase */
/** @typedef {import("./finding-parts.js").Route} Route */

const SEVERITIES = /** @type {const} */ (["critical", "high", "medium", "low"]);
/** Advisory IDs listed on an action before the rest are summarised as a count. */
const MAX_IDS = 8;
/** Actions shown in a group at a time; a long group is paged. */
const ACTIONS_PAGE = 20;

/**
 * The Roadmap page: what to repair, in order. One action can clear many findings.
 *
 * @param {HTMLElement} view
 * @param {Route} route
 * @returns {Promise<() => void>}
 */
export async function renderRoadmap(view, route) {
	await load();
	const filter = filterFromParams(route.params, newFindingKeys);
	let phaseKey = route.params.get("phase") ?? "";
	/** @type {Roadmap | null} */
	let roadmap = null;
	/** Only the answer to the latest request is shown, however the requests overlap. */
	let request = 0;
	let left = false;
	/** The page shown in each group of the chosen phase, by the group's name. @type {Map<string, number>} */
	const pages = new Map();

	const body = h("div");
	const fetchSoon = debounce(fetchRoadmap, 200);
	draw();
	const unsubscribe = subscribe((change) => {
		if (change === "report") draw();
	});
	return () => {
		left = true;
		unsubscribe();
	};

	function draw() {
		const report = store.report;
		if (!report) return replace(view, h("section", { class: "page" }, header(null), noScanYet("The shortest list of repairs appears here, most urgent first. One repair, such as upgrading a package, can clear many problems at once.")));
		const refetch = () => {
			pages.clear();
			clear.refresh();
			void fetchRoadmap();
		};
		const clear = clearFiltersButton(filter, () => {
			pages.clear();
			draw();
		});
		const search = /** @type {HTMLInputElement} */ (
			h("input", {
				type: "search",
				placeholder: "Search by package, file or advisory",
				value: filter.query,
				"aria-label": "Search the roadmap",
				oninput: () => {
					filter.query = search.value;
					pages.clear();
					clear.refresh();
					fetchSoon();
				},
			})
		);
		// The summary covers the whole roadmap, as the fix for a finding is planned from the whole scan.
		const assistant = store.settings?.assistant;
		const summary =
			assistant?.configured && findingRows().length > 0
				? assistAction(
						`roadmap\n${report.scannedAt}`,
						"/assist/roadmap",
						assistant,
						{ start: "Summarise", busy: "Summarising…", again: "Summarise again", note: "This covers the whole roadmap, whatever the filters show." },
						() => ({}),
					)
				: null;
		replace(
			view,
			h(
				"section",
				{ class: "page" },
				header(
					h(
						"div",
						{ class: "actions" },
						summary?.button,
						sendButton(() => {
							const shown = findingRows().filter((row) => matchesFilter(row, row.repo, filter)).length;
							openSendDialog({ filter, shown, total: findingRows().length }, "roadmap");
						}, findingRows().length === 0),
						exportButton(() => {
							const shown = findingRows().filter((row) => matchesFilter(row, row.repo, filter)).length;
							openExportDialog({ filter, shown, total: findingRows().length }, "roadmap");
						}),
					),
				),
				summary?.panel,
				store.notes.length > 0 ? banner("warning", "The scan was incomplete, so this roadmap is too", store.notes) : null,
				store.settingNotes.length > 0 ? banner("warning", "Some repositories tell the scanners to leave findings out", store.settingNotes) : null,
				h(
					"div",
					{ class: "filters" },
					h("div", { class: "field grow" }, search),
					// The severity filter can come from a link (the Overview's tiles, a shared address), so it is always shown.
					severityChips(filter, refetch),
					select("Repository", repoChoices(filter), filter.repo ?? "", (value) => ((filter.repo = value), refetch())),
					select(
						"Type",
						[
							["all", "All types"],
							["secret", "Secrets"],
							["vulnerability", "Vulnerabilities"],
							["private-data", "Private data"],
						],
						filter.kind,
						(value) => ((filter.kind = /** @type {typeof filter.kind} */ (value)), refetch()),
					),
					newChip(filter, refetch),
					clear.button,
				),
				body,
			),
		);
		if (!roadmap) replace(body, h("p", { class: "loading" }, "Working out what to repair…"));
		void fetchRoadmap();
	}

	async function fetchRoadmap() {
		const current = ++request;
		body.classList.add("stale"); // Keep the last answer on screen, dimmed, instead of flashing empty.
		try {
			const query = new URLSearchParams(paramsFromFilter(filter)).toString();
			const answer = await api("GET", `/repos/roadmap${query ? `?${query}` : ""}`);
			if (left || current !== request) return;
			roadmap = /** @type {Roadmap} */ (answer.roadmap);
			show();
		} catch (err) {
			if (left || current !== request) return;
			replace(body, banner("error", "Could not build the roadmap", [err instanceof Error ? err.message : String(err)]), h("button", { type: "button", class: "button", onclick: fetchRoadmap }, "Try again"));
		} finally {
			if (current === request) body.classList.remove("stale");
		}
	}

	function show() {
		if (!roadmap) return;
		const withWork = roadmap.phases.filter((phase) => phase.groups.length > 0);
		const phase = roadmap.phases.find((candidate) => candidate.key === phaseKey && candidate.groups.length > 0) ?? withWork[0];
		phaseKey = phase?.key ?? "";
		route.replace({ ...paramsFromFilter(filter), phase: phase && phase !== withWork[0] ? phase.key : undefined });

		if (!phase) {
			return replace(
				body,
				roadmap.scope ? emptyState("Nothing to repair matches", "Loosen the filters to see more.") : emptyState("Nothing to repair", "The scan found no problems in what it covered."),
			);
		}
		replace(
			body,
			// What each phase clears (VS-15): the tabs below carry the same figures in words.
			phaseChart(roadmap.phases.map((candidate) => ({ title: candidate.title, findings: candidate.groups.flatMap((group) => group.actions).reduce((sum, action) => sum + action.counts.critical + action.counts.high + action.counts.medium + action.counts.low, 0) }))),
			h(
				"div",
				{ class: "phases", role: "tablist", "aria-label": "Phases", onkeydown: moveBetweenTabs },
				...roadmap.phases.map((candidate, index) => phaseTab(candidate, index, candidate === phase)),
			),
			h(
				"div",
				{ id: "roadmap-phase", role: "tabpanel", "aria-labelledby": `phase-tab-${phase.key}` },
				h("p", { class: "sub phase-summary" }, phase.summary),
				...phase.groups.map((group) => {
					const paged = paginate(group.actions, pages.get(group.name) ?? 1, ACTIONS_PAGE);
					return h(
						"section",
						{ class: "action-group" },
						h("h2", null, group.name, h("span", { class: "count" }, plural(group.actions.length, "action", "actions"))),
						h("ul", { class: "action-list" }, ...paged.items.map((action) => actionCard(action, group.name, filter))),
						paged.pages > 1
							? pager(paged, "actions", (next) => {
									pages.set(group.name, next);
									show();
								})
							: null,
					);
				}),
			),
		);
	}

	/**
	 * Arrow keys, Home and End move between the phases, as in any tab list; each tab is one Tab stop.
	 *
	 * @param {KeyboardEvent} event
	 */
	function moveBetweenTabs(event) {
		const tabs = /** @type {HTMLButtonElement[]} */ ([...(/** @type {HTMLElement} */ (event.currentTarget)).querySelectorAll('[role="tab"]:not([aria-disabled="true"])')]);
		const at = tabs.indexOf(/** @type {HTMLButtonElement} */ (document.activeElement));
		if (at === -1) return;
		const next = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: tabs.length - 1 }[event.key];
		if (next === undefined) return;
		event.preventDefault();
		const tab = tabs[(next + tabs.length) % tabs.length];
		tab?.click();
		/** @type {HTMLElement | null} */ (body.querySelector('[role="tab"][aria-selected="true"]'))?.focus();
	}

	/** @param {Phase} phase @param {number} index @param {boolean} selected */
	function phaseTab(phase, index, selected) {
		const actions = phase.groups.flatMap((group) => group.actions);
		const findings = actions.reduce((sum, action) => sum + SEVERITIES.reduce((total, severity) => total + action.counts[severity], 0), 0);
		return h(
			"button",
			{
				type: "button",
				role: "tab",
				id: `phase-tab-${phase.key}`,
				class: "phase-tab",
				"aria-selected": String(selected),
				"aria-controls": "roadmap-phase",
				tabindex: selected ? "0" : "-1",
				"aria-disabled": actions.length === 0 ? "true" : null,
				onclick: () => {
					phaseKey = phase.key;
					pages.clear();
					show();
				},
			},
			h("span", { class: "phase-name" }, `${index + 1}. ${PHASE_TITLES[phase.key]}`),
			h("span", { class: "phase-count" }, actions.length.toLocaleString("en-GB")),
			h("span", { class: "hint" }, actions.length === 0 ? "Nothing here" : `${actions.length === 1 ? "action clears" : "actions clear"} ${plural(findings, "finding", "findings")}`),
		);
	}
}

/** @param {Node | null} action placed at the top right */
function header(action) {
	return h(
		"div",
		{ class: "page-head" },
		h("div", null, h("h1", null, "Roadmap"), h("p", { class: "sub" }, "What to repair, in order. One action, such as upgrading a package, can clear many findings.")),
		action,
	);
}

/**
 * @param {Action} action
 * @param {string} place the repository or host the action belongs to
 * @param {import("./filter.js").FindingFilter} filter the page's filter, so the linked findings are the ones counted here
 */
function actionCard(action, place, filter) {
	const total = SEVERITIES.reduce((sum, severity) => sum + action.counts[severity], 0);
	const breakdown = SEVERITIES.filter((severity) => action.counts[severity] > 0).map((severity) => `${action.counts[severity].toLocaleString("en-GB")} ${severity}`).join(", ");
	const ids = action.clears.length > MAX_IDS ? [...action.clears.slice(0, MAX_IDS), `and ${(action.clears.length - MAX_IDS).toLocaleString("en-GB")} more`] : action.clears;
	return h(
		"li",
		{ class: "action-card" },
		h("div", { class: "action-head" }, severityBadge(action.priority), h("h3", null, action.title)),
		h(
			"dl",
			{ class: "facts" },
			h("dt", null, "Where"),
			h("dd", { class: "mono wrap" }, action.where),
			h("dt", null, "Clears"),
			h("dd", { class: "wrap" }, `${plural(total, "finding", "findings")} (${breakdown}): `, h("span", { class: "mono" }, ids.join(", "))),
			h("dt", null, "How"),
			h("dd", null, h("ol", null, ...action.how.map((step) => h("li", null, ...stepNodes(step, { copy: true }))))),
		),
		// The findings behind the action, on the Findings page, where each has its detail and notes.
		h(
			"p",
			{ class: "hint action-foot" },
			action.match ? viewLink(["findings"], { ...filter, query: action.match, repo: place }, {}, `See ${total === 1 ? "this finding" : `these ${total.toLocaleString("en-GB")} findings`}`) : null,
			// Repaired? Scan the repository again and see what that fixed (US-4).
			scanAgainButton(place),
		),
	);
}
