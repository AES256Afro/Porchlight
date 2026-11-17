// @ts-check
import { api, ApiError } from "./api.js";
import { formatWhen, h, icon, plural, replace, severityBadge, statTile, toast } from "./dom.js";

/** @typedef {import("../src/repos/types.ts").Finding} Finding */
/** @typedef {import("../src/repos/types.ts").Severity} Severity */
/** @typedef {import("../src/repos/types.ts").RepoResult & { name: string }} Repo */
/** @typedef {Omit<import("../src/repos/types.ts").ScanReport, "repos"> & { repos: Repo[] }} ScanReport */
/** @typedef {import("../src/ui/server.ts").ScanStatus} ScanStatus */

/** @type {Severity[]} */
const SEVERITIES = ["critical", "high", "medium", "low"];
const SEVERITY_LABELS = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
/** Findings listed for a repository before asking for the rest; keeps large repositories quick to open. */
const DETAIL_PAGE = 100;
const POLL_MS = 800;

/**
 * The Repositories page: start a scan, then read its results worst first.
 *
 * @param {HTMLElement} view
 * @returns {Promise<() => void>} stops background polling when the page is left
 */
export async function renderRepos(view) {
	/** @type {{ report: ScanReport | null, notes: string[] }} */
	let data = { report: null, notes: [] };
	const filters = {
		severities: new Set(SEVERITIES),
		/** @type {"all" | "secret" | "vulnerability"} */
		kind: "all",
		query: "",
	};
	/** @type {{ key: "rank" | "name" | "secrets" | "vulnerabilities" | Severity, descending: boolean }} */
	let sort = { key: "rank", descending: true };
	/** @type {Set<string>} */
	const expanded = new Set();
	/** @type {Set<string>} */
	const showAll = new Set();
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let pollTimer;
	let left = false;

	const state = await api("GET", "/state");

	const subtitle = h("p", { class: "sub" });
	const rootInput = /** @type {HTMLInputElement} */ (
		h("input", { type: "text", name: "root", value: state.defaultRoot, spellcheck: false, autocomplete: "off", required: true })
	);
	const depthInput = /** @type {HTMLInputElement} */ (
		h("input", { type: "number", name: "depth", value: "3", min: "0", max: "6", class: "narrow" })
	);
	const scanButton = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "button primary" }, "Scan"));
	const progress = h("div", { class: "progress-slot" });
	const coverage = h("div");
	const tiles = h("div", { class: "tiles" });
	const filterRow = h("div", { class: "filters" });
	const tableSlot = h("div");

	replace(
		view,
		h(
			"section",
			{ class: "page" },
			h(
				"div",
				{ class: "page-head" },
				h("div", null, h("h1", null, "Repositories"), subtitle),
				h(
					"form",
					{ class: "inline-form", onsubmit: startScan },
					h("label", { class: "field grow" }, h("span", null, "Folder"), rootInput),
					h("label", { class: "field" }, h("span", null, "Depth"), depthInput),
					scanButton,
				),
			),
			progress,
			coverage,
			tiles,
			filterRow,
			tableSlot,
		),
	);

	await loadReport();
	showStatus(state.scan);
	if (state.scan.state === "running") poll();

	return () => {
		left = true;
		clearTimeout(pollTimer);
	};

	async function loadReport() {
		try {
			data = /** @type {typeof data} */ (await api("GET", "/repos/report"));
		} catch (err) {
			data = { report: null, notes: [] };
			toast(err instanceof Error ? err.message : String(err), "error");
		}
		renderAll();
	}

	/** @param {SubmitEvent} event */
	async function startScan(event) {
		event.preventDefault();
		try {
			const { scan } = await api("POST", "/repos/scan", { root: rootInput.value, depth: Number(depthInput.value) });
			showStatus(scan);
			poll();
		} catch (err) {
			toast(err instanceof Error ? err.message : String(err), "error");
			if (err instanceof ApiError && err.status === 409) poll();
		}
	}

	function poll() {
		clearTimeout(pollTimer);
		pollTimer = setTimeout(async () => {
			if (left) return;
			try {
				const { scan } = await api("GET", "/repos/scan");
				showStatus(scan);
				if (scan.state === "running") return poll();
				if (scan.state === "done") {
					await loadReport();
					toast("Scan finished");
				}
			} catch (err) {
				showStatus({ state: "failed", root: "", finishedAt: "", error: err instanceof Error ? err.message : String(err) });
			}
		}, POLL_MS);
	}

	/** @param {ScanStatus} scan */
	function showStatus(scan) {
		const running = scan.state === "running";
		scanButton.disabled = running;
		scanButton.textContent = running ? "Scanning…" : "Scan";
		if (running) {
			const known = scan.total > 0;
			replace(
				progress,
				h(
					"div",
					{ class: "progress", role: "status" },
					h(
						"div",
						{ class: "progress-text" },
						h("strong", null, known ? `Scanning ${scan.done + 1} of ${scan.total}` : "Finding repositories"),
						known && scan.current ? h("span", { class: "path" }, scan.current) : null,
					),
					h("progress", { max: known ? scan.total : null, value: known ? scan.done : null, "aria-label": "Scan progress" }),
				),
			);
		} else if (scan.state === "failed") {
			replace(progress, banner("error", "The scan did not finish", [scan.error]));
		} else {
			replace(progress);
		}
	}

	function renderAll() {
		const report = data.report;
		if (!report) {
			subtitle.textContent = "No scan yet. Choose a folder and scan it.";
			replace(coverage);
			replace(tiles);
			replace(filterRow);
			replace(
				tableSlot,
				h(
					"div",
					{ class: "empty" },
					h("h2", null, "Nothing scanned yet"),
					h(
						"p",
						null,
						"A scan looks through every git repository under the folder for committed secrets and for dependencies with known vulnerabilities.",
					),
				),
			);
			return;
		}
		const tools = report.tools.map((tool) => (tool.status === "ok" ? `${tool.tool} ${tool.version ?? ""}`.trim() : `${tool.tool} missing`));
		subtitle.textContent = `${plural(report.repos.length, "repository", "repositories")} under ${report.root} · scanned ${formatWhen(report.scannedAt)} · ${tools.join(", ")}`;
		rootInput.value = report.root;
		replace(
			coverage,
			data.notes.length > 0 ? banner("warning", "This scan is incomplete, so a clean result here is not a clean bill of health", data.notes) : null,
		);
		renderFilters();
		renderResults();
	}

	function renderFilters() {
		const report = data.report;
		if (!report) return;
		const kinds = /** @type {const} */ ([
			["all", "All"],
			["secret", "Secrets"],
			["vulnerability", "Vulnerabilities"],
		]);
		const search = /** @type {HTMLInputElement} */ (
			h("input", {
				type: "search",
				placeholder: "Filter by repository, package, rule or file",
				value: filters.query,
				"aria-label": "Filter findings",
				oninput: () => {
					filters.query = search.value;
					renderResults();
				},
			})
		);
		replace(
			filterRow,
			h(
				"div",
				{ class: "chip-group", role: "group", "aria-label": "Severity" },
				...SEVERITIES.map((severity) =>
					h(
						"button",
						{
							type: "button",
							class: "chip",
							"aria-pressed": String(filters.severities.has(severity)),
							onclick: (/** @type {MouseEvent} */ event) => {
								if (filters.severities.has(severity)) filters.severities.delete(severity);
								else filters.severities.add(severity);
								/** @type {HTMLElement} */ (event.currentTarget).setAttribute("aria-pressed", String(filters.severities.has(severity)));
								renderResults();
							},
						},
						severityBadge(severity),
					),
				),
			),
			h(
				"div",
				{ class: "segmented", role: "group", "aria-label": "Finding type" },
				...kinds.map(([value, label]) =>
					h(
						"button",
						{
							type: "button",
							"aria-pressed": String(filters.kind === value),
							onclick: () => {
								filters.kind = value;
								renderFilters();
								renderResults();
							},
						},
						label,
					),
				),
			),
			h("div", { class: "field grow" }, search),
		);
	}

	/** @param {Finding} finding @param {Repo} repo @param {string} query */
	function matches(finding, repo, query) {
		if (!filters.severities.has(finding.severity)) return false;
		if (filters.kind !== "all" && finding.kind !== filters.kind) return false;
		if (query === "") return true;
		return [repo.name, finding.ruleId, finding.location, finding.detail, finding.title].some((text) => text.toLowerCase().includes(query));
	}

	function renderResults() {
		const report = data.report;
		if (!report) return;
		const query = filters.query.trim().toLowerCase();
		const filtering = query !== "" || filters.kind !== "all" || filters.severities.size < SEVERITIES.length;

		const rows = report.repos.map((repo, rank) => {
			const findings = repo.findings.filter((finding) => matches(finding, repo, query));
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
		const affected = rows.filter((row) => row.findings.length > 0);

		replace(
			tiles,
			statTile("Repositories scanned", report.repos.length),
			statTile(filtering ? "With matching findings" : "With findings", affected.length),
			...SEVERITIES.map((severity) =>
				statTile(
					SEVERITY_LABELS[severity],
					affected.reduce((sum, row) => sum + row.counts[severity], 0),
					icon(severity, `severity-${severity}`),
				),
			),
		);

		const direction = sort.descending ? -1 : 1;
		visible.sort((a, b) => {
			if (sort.key === "rank") {
				// Worst first by what currently matches, so the order still means something under a filter.
				for (const severity of SEVERITIES) {
					if (a.counts[severity] !== b.counts[severity]) return b.counts[severity] - a.counts[severity];
				}
				return a.rank - b.rank;
			}
			if (sort.key === "name") return direction * a.repo.name.localeCompare(b.repo.name);
			const value = (/** @type {typeof a} */ row) => (sort.key === "secrets" || sort.key === "vulnerabilities" ? row[sort.key] : row.counts[/** @type {Severity} */ (sort.key)]);
			return direction * (value(a) - value(b)) || a.rank - b.rank;
		});

		if (visible.length === 0) {
			replace(tableSlot, h("div", { class: "empty" }, h("h2", null, "No findings match"), h("p", null, "Loosen the filters to see more.")));
			return;
		}

		const body = h("tbody");
		for (const row of visible) {
			const open = expanded.has(row.repo.path);
			const expandable = row.findings.length > 0;
			const toggle = () => {
				if (open) expanded.delete(row.repo.path);
				else expanded.add(row.repo.path);
				renderResults();
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
					...SEVERITIES.map((severity) => countCell(row.counts[severity])),
					countCell(row.secrets),
					countCell(row.vulnerabilities),
				),
			);
			if (open) body.append(h("tr", { class: "detail-row" }, h("td", { colSpan: 8 }, findingsList(row.repo, row.findings))));
		}

		replace(
			tableSlot,
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
							...SEVERITIES.map((severity) => sortHeader(SEVERITY_LABELS[severity], severity, true)),
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
						renderResults();
					},
				},
				label,
				active ? h("span", { class: "sort-mark", "aria-hidden": "true" }, ariaSort === "ascending" ? "↑" : "↓") : null,
			),
		);
	}

	/** @param {Repo} repo @param {Finding[]} findings */
	function findingsList(repo, findings) {
		const limit = showAll.has(repo.path) ? findings.length : DETAIL_PAGE;
		const shown = findings.slice(0, limit);
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
				h(
					"thead",
					null,
					h("tr", null, ...["Severity", "Type", "Rule or advisory", "Where", "Detail", "What"].map((label) => h("th", { scope: "col" }, label))),
				),
				h(
					"tbody",
					null,
					...shown.map((finding) =>
						h(
							"tr",
							null,
							h("td", null, severityBadge(finding.severity)),
							h("td", null, finding.kind === "secret" ? "Secret" : "Vulnerability"),
							h(
								"td",
								{ class: "mono nowrap" },
								finding.kind === "vulnerability"
									? h(
											"a",
											{ href: `https://osv.dev/vulnerability/${encodeURIComponent(finding.ruleId)}`, target: "_blank", rel: "noopener noreferrer" },
											finding.ruleId,
										)
									: finding.ruleId,
							),
							h("td", { class: "mono wrap col-where" }, finding.location),
							h("td", { class: "mono wrap col-detail" }, finding.detail),
							h("td", { class: "wrap col-what" }, finding.title),
						),
					),
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
								renderResults();
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
	const worst = SEVERITIES.find((severity) => counts[severity] > 0);
	if (worst) return severityBadge(worst);
	if (incomplete) return h("span", { class: "severity status-warning" }, icon("warning"), "Not fully scanned");
	return h("span", { class: "severity status-good" }, icon("good"), "Clean");
}

/**
 * @param {"warning" | "error"} kind
 * @param {string} title
 * @param {string[]} lines
 */
export function banner(kind, title, lines) {
	const first = lines.slice(0, 3);
	const rest = lines.slice(3);
	return h(
		"div",
		{ class: `banner banner-${kind}`, role: kind === "error" ? "alert" : "note" },
		icon("warning"),
		h(
			"div",
			null,
			h("strong", null, title),
			h("ul", null, ...first.map((line) => h("li", null, line))),
			rest.length > 0
				? h("details", null, h("summary", null, `${rest.length} more`), h("ul", null, ...rest.map((line) => h("li", null, line))))
				: null,
		),
	);
}
