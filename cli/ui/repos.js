// @ts-check
import { banner, emptyState, formatWhen, h, icon, pager, replace, severityBadge, toast } from "./dom.js";
import { coverageBanner, filterBar, findingDetail, findingsHeader, noScanYet, settingsBanner, severityTiles } from "./finding-parts.js";
import { ALL_SEVERITIES, isFiltering, matchesFilter } from "./filter.js";
import { filterFromParams, paginate, paramsFromFilter, repoSortFromParams, repoSortParams } from "./list.js";
import { findingRows, load, rescanRepo, store, subscribe } from "./store.js";

/** @typedef {import("./filter.js").Severity} Severity */
/** @typedef {import("./store.js").Repo} Repo */
/** @typedef {import("./store.js").SuggestedFinding} Finding */
/** @typedef {import("./finding-parts.js").Route} Route */

const SEVERITY_LABELS = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
/** Findings listed for a repository at a time; a large repository is paged, so it opens quickly. */
const DETAIL_PAGE = 50;

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
	// The order is kept in the address, like the filters, so a reload or a shared link keeps it.
	let sort = repoSortFromParams(route.params);
	/** @type {Set<string>} */
	const expanded = new Set();
	/** The page of findings shown in each open repository, by its path. @type {Map<string, number>} */
	const pages = new Map();
	/** @type {Set<string>} */
	const openFindings = new Set();

	const results = h("div");
	draw();
	return subscribe((change) => {
		if (change === "report") draw();
		// "Scan this repository again" follows whether a scan is running.
		else if (change === "scan" && expanded.size > 0) update();
	});

	function draw() {
		if (!store.report) return replace(view, h("section", { class: "page" }, findingsHeader("by-repo"), noScanYet()));
		replace(
			view,
			h(
				"section",
				{ class: "page" },
				findingsHeader("by-repo", filter),
				coverageBanner(),
				settingsBanner(),
				filterBar(filter, () => (pages.clear(), update()), { onCleared: () => (pages.clear(), draw()) }),
				results,
			),
		);
		update();
	}

	function update() {
		const report = store.report;
		if (!report) return;
		route.replace({ ...paramsFromFilter(filter), ...repoSortParams(sort) });
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
				private: findings.filter((finding) => finding.kind === "private-data").length,
			};
		});
		// A column for private data only once a scan has looked for it.
		const privateColumn = report.choices?.privateData === true || report.repos.some((repo) => repo.findings.some((finding) => finding.kind === "private-data"));
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
			const value = (/** @type {typeof a} */ row) => (sort.key === "secrets" || sort.key === "vulnerabilities" || sort.key === "private" ? row[sort.key] : row.counts[/** @type {Severity} */ (sort.key)]);
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
					// A scanner that is not installed checked no repository, so none of them is clean.
					h("td", null, worstBadge(row.counts, row.repo.errors.length > 0 || (store.report?.tools ?? []).some((tool) => tool.status === "missing"))),
					...ALL_SEVERITIES.map((severity) => countCell(row.counts[severity], SEVERITY_LABELS[severity])),
					countCell(row.secrets, "Secrets"),
					countCell(row.vulnerabilities, "Vulnerabilities"),
					privateColumn ? countCell(row.private, "Private data") : null,
				),
			);
			if (open) body.append(h("tr", { class: "detail-row" }, h("td", { colSpan: privateColumn ? 9 : 8 }, findingsList(row.repo, row.findings))));
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
							privateColumn ? sortHeader("Private data", "private", true) : null,
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
		const paged = paginate(findings, pages.get(repo.path) ?? 1, DETAIL_PAGE);
		const shown = paged.items;
		const running = store.scan.state === "running";
		return h(
			"div",
			{ class: "findings" },
			h(
				"p",
				{ class: "repo-actions" },
				// After a fix: check this repository alone, without waiting for a scan of them all.
				h(
					"button",
					{
						type: "button",
						class: "button",
						"aria-disabled": running ? "true" : null,
						onclick: async () => {
							if (store.scan.state === "running") return;
							try {
								await rescanRepo(repo.name);
							} catch (err) {
								toast(err instanceof Error ? err.message : String(err), "error");
							}
						},
					},
					store.scan.state === "running" && store.scan.current === repo.name ? "Scanning…" : "Scan this repository again",
				),
				repo.rescannedAt ? h("span", { class: "hint" }, `Scanned again ${formatWhen(repo.rescannedAt)}, after the scan of them all.`) : null,
			),
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
							open ? h("tr", { class: "detail-row" }, h("td", { colSpan: 4 }, findingDetail(finding, repo.name))) : null,
						];
					}),
				),
			),
			paged.pages > 1
				? pager(paged, "findings", (next) => {
						pages.set(repo.path, next);
						update();
					})
				: null,
		);
	}
}

/**
 * @param {number} count
 * @param {string} label
 */
function countCell(count, label) {
	// The label is shown only where the column headings are not, as on repository cards.
	return h("td", { class: count === 0 ? "num zero" : "num", dataset: { label } }, count.toLocaleString());
}

/**
 * The most severe level a repository has, or that it is clean.
 *
 * @param {Record<Severity, number>} counts
 * @param {boolean} incomplete whether a scanner failed on this repository or was not installed
 */
function worstBadge(counts, incomplete) {
	const worst = ALL_SEVERITIES.find((severity) => counts[severity] > 0);
	if (worst) return severityBadge(worst);
	if (incomplete) return h("span", { class: "severity status-warning" }, icon("warning"), "Not fully scanned");
	return h("span", { class: "severity status-good" }, icon("good"), "Clean");
}
