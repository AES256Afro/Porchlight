// @ts-check
import { api } from "./api.js";
import { banner, formatWhen, h, icon, PHASE_TITLES, plural, replace, severityBadge, statTile, toast } from "./dom.js";
import { coverageBanner } from "./findings.js";
import { buildHash } from "./list.js";
import { findingRows, load, startScan, store, subscribe } from "./store.js";

/** @typedef {import("../src/roadmap/types.ts").Roadmap} Roadmap */
/** @typedef {import("./filter.js").Severity} Severity */

const SEVERITIES = /** @type {const} */ (["critical", "high", "medium", "low"]);
const SEVERITY_LABELS = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
const TOP = 6;

/**
 * The Overview page: start a scan, see where things stand, and go to what needs doing first.
 *
 * @param {HTMLElement} view
 * @returns {Promise<() => void>}
 */
export async function renderOverview(view) {
	await load();
	let left = false;
	const scanSlot = h("div");
	const summary = h("div");
	const rootInput = /** @type {HTMLInputElement} */ (
		h("input", { type: "text", name: "root", value: store.report?.root ?? store.settings?.defaultRoot ?? "", spellcheck: false, autocomplete: "off", required: true })
	);
	const depthInput = /** @type {HTMLInputElement} */ (h("input", { type: "number", name: "depth", value: "3", min: "0", max: "6", class: "narrow" }));
	const scanButton = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "button primary" }, "Scan"));

	replace(
		view,
		h(
			"section",
			{ class: "page" },
			h("div", { class: "page-head" }, h("div", null, h("h1", null, "Overview"), h("p", { class: "sub" }, "Where your repositories and domains stand, and what to do first."))),
			h(
				"div",
				{ class: "card full" },
				h("h2", null, "Scan repositories"),
				h("p", { class: "sub" }, "Looks through every git repository under a folder for committed secrets and for dependencies with known vulnerabilities."),
				h(
					"form",
					{
						class: "inline-form",
						onsubmit: async (/** @type {SubmitEvent} */ event) => {
							event.preventDefault();
							try {
								await startScan(rootInput.value, Number(depthInput.value));
							} catch (err) {
								toast(err instanceof Error ? err.message : String(err), "error");
							}
						},
					},
					h("label", { class: "field grow" }, h("span", null, "Folder"), rootInput),
					h("label", { class: "field" }, h("span", null, "Depth"), depthInput),
					scanButton,
				),
				scanSlot,
			),
			summary,
		),
	);

	drawScan();
	void drawSummary();
	const unsubscribe = subscribe((change) => {
		if (change === "scan") drawScan();
		else void drawSummary();
	});
	return () => {
		left = true;
		unsubscribe();
	};

	function drawScan() {
		const scan = store.scan;
		const running = scan.state === "running";
		scanButton.disabled = running;
		scanButton.textContent = running ? "Scanning…" : "Scan";
		if (running) {
			const known = scan.total > 0;
			replace(
				scanSlot,
				h(
					"div",
					{ class: "progress" },
					h(
						"div",
						{ class: "progress-text" },
						h("strong", null, known ? `Scanning ${Math.min(scan.done + 1, scan.total)} of ${scan.total}` : "Finding repositories"),
						known && scan.current ? h("span", { class: "path" }, scan.current) : null,
					),
					h("progress", { max: known ? scan.total : null, value: known ? scan.done : null, "aria-label": "Scan progress" }),
				),
			);
		} else if (scan.state === "failed") {
			replace(scanSlot, banner("error", "The scan did not finish", [scan.error]));
		} else {
			replace(scanSlot);
		}
	}

	async function drawSummary() {
		const report = store.report;
		if (!report) return replace(summary, monitorCard());
		const rows = findingRows();
		/** @type {Record<Severity, number>} */
		const counts = { critical: 0, high: 0, medium: 0, low: 0 };
		for (const row of rows) counts[row.severity]++;
		const affected = report.repos.filter((repo) => repo.findings.length > 0);
		rootInput.value = report.root;

		const phases = h("div", { class: "card" }, h("h2", null, "What to repair first"), h("p", { class: "loading" }, "Working it out…"));
		replace(
			summary,
			h("p", { class: "sub scan-line" }, `Last scan: ${plural(report.repos.length, "repository", "repositories")} under ${report.root}, ${formatWhen(report.scannedAt)}.`),
			coverageBanner(),
			h(
				"div",
				{ class: "tiles" },
				statTile("Total findings", rows.length),
				...SEVERITIES.map((severity) => statTile(SEVERITY_LABELS[severity], counts[severity], icon(severity, `severity-${severity}`))),
				statTile("Repositories affected", `${affected.length.toLocaleString()} of ${report.repos.length.toLocaleString()}`),
			),
			h(
				"div",
				{ class: "columns" },
				phases,
				h(
					"div",
					{ class: "card" },
					h("h2", null, "Most affected repositories"),
					affected.length === 0
						? h("p", { class: "sub" }, "No repository has findings.")
						: h(
								"ul",
								{ class: "link-list" },
								...affected.slice(0, TOP).map((repo) => {
									const worst = SEVERITIES.find((severity) => repo.findings.some((finding) => finding.severity === severity)) ?? "low";
									const count = repo.findings.filter((finding) => finding.severity === worst).length;
									return h(
										"li",
										null,
										h(
											"a",
											{ href: buildHash(["findings"], { repo: repo.name }) },
											h("span", { class: "link-title wrap" }, repo.name),
											h("span", { class: "link-meta" }, severityBadge(worst), `${count.toLocaleString()} of ${plural(repo.findings.length, "finding", "findings")}`),
										),
									);
								}),
							),
					h("p", { class: "card-foot" }, h("a", { href: "#/findings/by-repo" }, "All repositories")),
				),
			),
			monitorCard(),
		);

		try {
			const { roadmap } = /** @type {{ roadmap: Roadmap }} */ (await api("GET", "/repos/roadmap"));
			if (left || store.report !== report) return;
			const rotate = roadmap.phases[0]?.groups.flatMap((group) => group.actions.filter((action) => action.kind === "rotate").map((action) => ({ group: group.name, action }))) ?? [];
			replace(
				phases,
				h("h2", null, "What to repair first"),
				roadmap.totals.actions === 0
					? h("p", { class: "sub" }, "Nothing to repair: the scan found no problems in what it covered.")
					: h(
							"ol",
							{ class: "link-list phase-list" },
							...roadmap.phases.map((phase) => {
								const actions = phase.groups.flatMap((group) => group.actions);
								const cleared = actions.reduce((sum, action) => sum + SEVERITIES.reduce((total, severity) => total + action.counts[severity], 0), 0);
								return h(
									"li",
									null,
									h(
										"a",
										{ href: buildHash(["roadmap"], { phase: phase.key }) },
										h("span", { class: "link-title" }, PHASE_TITLES[phase.key]),
										h("span", { class: "link-meta" }, actions.length === 0 ? "Nothing here" : `${plural(actions.length, "action", "actions")}, clearing ${plural(cleared, "finding", "findings")}`),
									),
								);
							}),
						),
				rotate.length > 0
					? h(
							"div",
							{ class: "callout" },
							h("strong", null, plural(rotate.length, "credential looks live", "credentials look live")),
							h("ul", null, ...rotate.slice(0, TOP).map(({ group, action }) => h("li", { class: "wrap" }, `${group}: `, h("code", null, action.where)))),
						)
					: null,
				h("p", { class: "card-foot" }, h("a", { href: "#/roadmap" }, "Open the roadmap")),
			);
		} catch (err) {
			if (left) return;
			replace(phases, h("h2", null, "What to repair first"), banner("error", "Could not build the roadmap", [err instanceof Error ? err.message : String(err)]));
		}
	}
}

function monitorCard() {
	const monitor = store.settings?.monitor;
	// A service with nothing set yet: the Domains page says where to set it, in the service's own terms.
	const why = store.settings?.service && monitor?.unset ? "" : (monitor?.error ?? "");
	return h(
		"div",
		{ class: "card full" },
		h("h2", null, "Domains"),
		monitor?.configured
			? h("p", null, h("span", { class: "severity status-good" }, icon("good"), `Connected to the monitor at ${monitor.host}`))
			: h("p", null, h("span", { class: "severity status-pending" }, icon("pending"), "The attack-surface monitor is not connected"), h("span", { class: "hint block" }, why)),
		h("p", { class: "card-foot" }, h("a", { href: "#/domains" }, monitor?.configured ? "Open domains" : "How to connect it")),
	);
}
