// @ts-check
import { api } from "./api.js";
import { assistAction } from "./assist.js";
import { banner, emptyState, h, PHASE_TITLES, plural, replace, select, severityBadge, stepNodes } from "./dom.js";
import { exportButton, openExportDialog } from "./export.js";
import { openSendDialog, sendButton } from "./send.js";
import { noScanYet } from "./findings.js";
import { matchesFilter } from "./filter.js";
import { debounce, filterFromParams, paramsFromFilter } from "./list.js";
import { findingRows, load, store, subscribe } from "./store.js";

/** @typedef {import("../src/roadmap/types.ts").Roadmap} Roadmap */
/** @typedef {import("../src/roadmap/types.ts").Action} Action */
/** @typedef {import("../src/roadmap/types.ts").Phase} Phase */
/** @typedef {import("./findings.js").Route} Route */

const SEVERITIES = /** @type {const} */ (["critical", "high", "medium", "low"]);
/** Advisory IDs listed on an action before the rest are summarised as a count. */
const MAX_IDS = 8;

/**
 * The Roadmap page: what to repair, in order. One action can clear many findings.
 *
 * @param {HTMLElement} view
 * @param {Route} route
 * @returns {Promise<() => void>}
 */
export async function renderRoadmap(view, route) {
	await load();
	const filter = filterFromParams(route.params);
	let phaseKey = route.params.get("phase") ?? "";
	/** @type {Roadmap | null} */
	let roadmap = null;
	/** Only the answer to the latest request is shown, however the requests overlap. */
	let request = 0;
	let left = false;

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
		const repos = report.repos.filter((repo) => repo.findings.length > 0).map((repo) => repo.name).sort((a, b) => a.localeCompare(b));
		const search = /** @type {HTMLInputElement} */ (
			h("input", {
				type: "search",
				placeholder: "Search by package, file or advisory",
				value: filter.query,
				"aria-label": "Search the roadmap",
				oninput: () => {
					filter.query = search.value;
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
					select("Repository", [["", "All repositories"], .../** @type {[string, string][]} */ (repos.map((name) => [name, name]))], filter.repo ?? "", (value) => ((filter.repo = value), fetchRoadmap())),
					select(
						"Type",
						[
							["all", "Secrets and vulnerabilities"],
							["secret", "Secrets"],
							["vulnerability", "Vulnerabilities"],
						],
						filter.kind,
						(value) => ((filter.kind = /** @type {typeof filter.kind} */ (value)), fetchRoadmap()),
					),
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
			h(
				"div",
				{ class: "phases", role: "tablist", "aria-label": "Phases" },
				...roadmap.phases.map((candidate, index) => phaseTab(candidate, index, candidate === phase)),
			),
			h("p", { class: "sub phase-summary" }, phase.summary),
			...phase.groups.map((group) =>
				h(
					"section",
					{ class: "action-group" },
					h("h2", null, group.name, h("span", { class: "count" }, plural(group.actions.length, "action", "actions"))),
					h("ul", { class: "action-list" }, ...group.actions.map(actionCard)),
				),
			),
		);
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
				class: "phase-tab",
				"aria-selected": String(selected),
				disabled: actions.length === 0,
				onclick: () => {
					phaseKey = phase.key;
					show();
				},
			},
			h("span", { class: "phase-name" }, `${index + 1}. ${PHASE_TITLES[phase.key]}`),
			h("span", { class: "phase-count" }, actions.length.toLocaleString()),
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

/** @param {Action} action */
function actionCard(action) {
	const total = SEVERITIES.reduce((sum, severity) => sum + action.counts[severity], 0);
	const breakdown = SEVERITIES.filter((severity) => action.counts[severity] > 0).map((severity) => `${action.counts[severity].toLocaleString()} ${severity}`).join(", ");
	const ids = action.clears.length > MAX_IDS ? [...action.clears.slice(0, MAX_IDS), `and ${(action.clears.length - MAX_IDS).toLocaleString()} more`] : action.clears;
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
			h("dd", null, h("ol", null, ...action.how.map((step) => h("li", null, ...stepNodes(step))))),
		),
	);
}
