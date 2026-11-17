// @ts-check
import { banner, emptyState, h, icon, replace, severityBadge } from "./dom.js";
import { coverageBanner, filterBar, findingDetail, findingsHeader, noScanYet, severityTiles } from "./findings.js";
import { ALL_SEVERITIES, isFiltering, matchesFilter } from "./filter.js";
import { filterFromParams, paramsFromFilter } from "./list.js";
import { findingRows, load, store, subscribe } from "./store.js";

/** @typedef {import("./filter.js").Severity} Severity */
/** @typedef {import("./store.js").Repo} Repo */
/** @typedef {import("./store.js").SuggestedFinding} Finding */
/** @typedef {import("./findings.js").Route} Route */

const SEVERITY_LABELS = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
/** Findings listed for a repository before asking for the rest; keeps large repositories quick to open. */
const DETAIL_PAGE = 100;

/**
 * Findings grouped by repository, worst repository first.
 *
 * @param {HTMLElement} view
 * @param {Route} route
 * @returns {Promise<() => void>}
 */
export async function renderByRepo(view, route) {
	await load();
	const filter = filterFromParams(route.params);
	/** @type {{ key: "rank" | "name" | "secrets" | "vulnerabilities" | Severity, descending: boolean }} */
	let sort = { key: "rank", descending: true };
	/** @type {Set<string>} */
	const expanded = new Set();
	/** @type {Set<string>} */
	const showAll = new Set();
	/** @type {Set<string>} */
	const openFindings = new Set();

	const results = h("div");
	draw();
	return subscribe((change) => {
		if (change === "report") draw();
	});

	function draw() {
		if (!store.report) return replace(view, h("section", { class: "page" }, findingsHeader("by-repo"), noScanYet()));
		replace(view, h("section", { class: "page" }, findingsHeader("by-repo", filter), coverageBanner(), filterBar(filter, update), results));
		update();
	}

	function update() {
		const report = store.report;
		if (!report) return;
		route.replace(paramsFromFilter(filter));
		const filtering = isFiltering(filter);

		const rows = report.repos.map((repo, rank) => {
			const findings = repo.findings.filter((finding) => matchesFilter(finding, repo.name, filter));
			/** @type {Record<Severity, number>} */
			const counts = { critical: 0, high: 0, medium: 0, low: 0 };
			for (const finding of findings) counts[finding.severity]++;
			return {
				repo,
				rank,
				findings,
				counts,
				secrets: findings.filter((finding) => finding.kind === "secret").length,
				vulnerabilities: findings.filter((finding) => finding.kind === "vulnerability").length,
			};
		});
		// A repository with nothing matching is only worth a row when nothing is being filtered out.
		const visible = rows.filter((row) => row.findings.length > 0 || (!filtering && row.repo.findings.length === 0));
		const matching = findingRows().filter((row) => matchesFilter(row, row.repo, filter));

		const direction = sort.descending ? -1 : 1;
		visible.sort((a, b) => {
			if (sort.key === "rank") {
				// Worst first by what currently matches, so the order still means something under a filter.
				for (const severity of ALL_SEVERITIES) {
					if (a.counts[severity] !== b.counts[severity]) return b.counts[severity] - a.counts[severity];
				}
				return a.rank - b.rank;
			}
			if (sort.key === "name") return direction * a.repo.name.localeCompare(b.repo.name);
			const value = (/** @type {typeof a} */ row) => (sort.key === "secrets" || sort.key === "vulnerabilities" ? row[sort.key] : row.counts[/** @type {Severity} */ (sort.key)]);
			return direction * (value(a) - value(b)) || a.rank - b.rank;
		});

		if (visible.length === 0) return replace(results, severityTiles(matching, filtering), emptyState("No findings match", "Loosen the filters to see more."));

		const body = h("tbody");
		for (const row of visible) {
			const open = expanded.has(row.repo.path);
			const expandable = row.findings.length > 0;
			const toggle = () => {
				if (open) expanded.delete(row.repo.path);
				else expanded.add(row.repo.path);
				update();
			};
			body.append(
				h(
					"tr",
					{ class: `repo-row${open ? " open" : ""}${expandable ? " clickable" : ""}`, onclick: expandable ? toggle : null },
					h(
						"th",
						{ scope: "row" },
						expandable
							? h(
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
									row.repo.name,
								)
							: h("span", { class: "disclosure static" }, row.repo.name),
					),
					h("td", null, worstBadge(row.counts, row.repo.errors.length > 0)),
					...ALL_SEVERITIES.map((severity) => countCell(row.counts[severity])),
					countCell(row.secrets),
					countCell(row.vulnerabilities),
				),
			);
			if (open) body.append(h("tr", { class: "detail-row" }, h("td", { colSpan: 8 }, findingsList(row.repo, row.findings))));
		}

		replace(
			results,
			severityTiles(matching, filtering),
			h(
				"div",
				{ class: "table-wrap" },
				h(
					"table",
					{ class: "data" },
					h(
						"thead",
						null,
						h(
							"tr",
							null,
							sortHeader("Repository", "name", false),
							sortHeader("Worst", "rank", false),
							...ALL_SEVERITIES.map((severity) => sortHeader(SEVERITY_LABELS[severity], severity, true)),
							sortHeader("Secrets", "secrets", true),
							sortHeader("Vulnerabilities", "vulnerabilities", true),
						),
					),
					body,
				),
			),
		);
	}

	/**
	 * @param {string} label
	 * @param {typeof sort.key} key
	 * @param {boolean} numeric
	 */
	function sortHeader(label, key, numeric) {
		const active = sort.key === key;
		const ariaSort = !active ? "none" : key === "rank" || sort.descending ? "descending" : "ascending";
		return h(
			"th",
			{ scope: "col", class: numeric ? "num" : "", "aria-sort": ariaSort },
			h(
				"button",
				{
					type: "button",
					class: "sort",
					onclick: () => {
						// Numbers start largest first; names start A to Z.
						sort = active && key !== "rank" ? { key, descending: !sort.descending } : { key, descending: key !== "name" };
						update();
					},
				},
				label,
				active ? h("span", { class: "sort-mark", "aria-hidden": "true" }, ariaSort === "ascending" ? "↑" : "↓") : null,
			),
		);
	}

	/** @param {Repo} repo @param {Finding[]} findings */
	function findingsList(repo, findings) {
		const shown = findings.slice(0, showAll.has(repo.path) ? findings.length : DETAIL_PAGE);
		return h(
			"div",
			{ class: "findings" },
			repo.errors.length > 0
				? banner(
						"warning",
						"Not fully scanned",
						repo.errors.map((error) => `${error.tool}: ${error.message}`),
					)
				: null,
			h(
				"table",
				{ class: "data nested" },
				h("thead", null, h("tr", null, ...["Severity", "Finding", "Where", "Suggested fix"].map((label) => h("th", { scope: "col" }, label)))),
				h(
					"tbody",
					null,
					...shown.flatMap((finding) => {
						const key = `${repo.path}\n${finding.ruleId}\n${finding.location}\n${finding.detail}`;
						const open = openFindings.has(key);
						const toggle = () => {
							if (open) openFindings.delete(key);
							else openFindings.add(key);
							update();
						};
						return [
							h(
								"tr",
								{ class: `clickable${open ? " open" : ""}`, onclick: toggle },
								h("td", null, severityBadge(finding.severity)),
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
										h("span", { class: "wrap" }, finding.title),
									),
									h("div", { class: "hint mono" }, `${finding.ruleId} · ${finding.detail}`),
								),
								h("td", { class: "mono wrap col-where" }, finding.location),
								h("td", { class: "wrap col-what" }, finding.suggestion?.title ?? ""),
							),
							open ? h("tr", { class: "detail-row" }, h("td", { colSpan: 4 }, findingDetail(finding))) : null,
						];
					}),
				),
			),
			findings.length > shown.length
				? h(
						"button",
						{
							type: "button",
							class: "button quiet",
							onclick: () => {
								showAll.add(repo.path);
								update();
							},
						},
						`Show all ${findings.length.toLocaleString()} findings`,
					)
				: null,
		);
	}
}

/** @param {number} count */
function countCell(count) {
	return h("td", { class: count === 0 ? "num zero" : "num" }, count.toLocaleString());
}

/**
 * The most severe level a repository has, or that it is clean.
 *
 * @param {Record<Severity, number>} counts
 * @param {boolean} incomplete whether a scanner failed on this repository
 */
function worstBadge(counts, incomplete) {
	const worst = ALL_SEVERITIES.find((severity) => counts[severity] > 0);
	if (worst) return severityBadge(worst);
	if (incomplete) return h("span", { class: "severity status-warning" }, icon("warning"), "Not fully scanned");
	return h("span", { class: "severity status-good" }, icon("good"), "Clean");
}
