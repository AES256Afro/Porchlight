// @ts-check
import { api } from "./api.js";
import { analysisCard } from "./analysis.js";
import { askCard, localModelCard } from "./assist.js";
import { banner, formatWhen, h, icon, PHASE_TITLES, plural, replace, severityBadge, statTile, stepNodes, toast } from "./dom.js";
import { coverageBanner } from "./findings.js";
import { githubPanel } from "./github.js";
import { emptyScanHints, previewAdvice } from "./hints.js";
import { buildHash } from "./list.js";
import { findingRows, load, startScan, store, subscribe } from "./store.js";

/** @typedef {import("../src/roadmap/types.ts").Roadmap} Roadmap */
/** @typedef {import("./filter.js").Severity} Severity */

const SEVERITIES = /** @type {const} */ (["critical", "high", "medium", "low"]);
const SEVERITY_LABELS = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
const TOP = 6;
/** Repositories named before a scan; the rest are counted. */
const CHIPS = 14;

/**
 * The Overview page: start a scan, see where things stand, and go to what needs doing first.
 *
 * @param {HTMLElement} view
 * @returns {Promise<() => void>}
 */
export async function renderOverview(view) {
	await load();
	let left = false;
	const service = store.settings?.service === true;
	/** The answer to the latest "what is in this folder" question; an earlier one arriving late is dropped. */
	let asked = 0;
	/** @type {import("./hints.js").ScanPreview | null} */
	let preview = null;
	/** @type {ReturnType<typeof analysisCard>} */
	let analysis = null;
	const scanSlot = h("div");
	const previewSlot = h("div", { class: "preview", "aria-live": "polite" });
	const summary = h("div");
	const intro = h("p", { class: "sub" });
	const rootInput = /** @type {HTMLInputElement} */ (
		h("input", { type: "text", name: "root", value: store.report?.root ?? store.settings?.defaultRoot ?? "", spellcheck: false, autocomplete: "off", required: true })
	);
	const depthInput = /** @type {HTMLInputElement} */ (h("input", { type: "number", name: "depth", value: "3", min: "0", max: "6", class: "narrow" }));
	const scanButton = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "button primary" }, "Check"));
	// Fetching or removing a repository changes what a scan would cover.
	const github = githubPanel(() => void look());
	// A half-typed path is not looked into: that would walk folders nobody asked about. What was
	// shown no longer describes the box, so it is taken away until the folder is settled.
	rootInput.addEventListener("input", forget);
	rootInput.addEventListener("change", () => void look());
	depthInput.addEventListener("change", () => void look());

	replace(
		view,
		h(
			"section",
			{ class: "page" },
			h("div", { class: "page-head" }, h("div", null, h("h1", null, "Overview"), intro)),
			h(
				"div",
				{ class: "card full" },
				h("h2", null, "Check your code"),
				h("p", { class: "sub" }, "Finds passwords and keys saved in your git repositories, old commits included, and packages with known security holes."),
				h(
					"form",
					{
						class: "scan-form",
						onsubmit: async (/** @type {SubmitEvent} */ event) => {
							event.preventDefault();
							try {
								await startScan(rootInput.value, Number(depthInput.value));
							} catch (err) {
								toast(err instanceof Error ? err.message : String(err), "error");
							}
						},
					},
					// A service checks the one folder its server gave it, so there is nothing to type.
					service ? null : h("label", { class: "field grow" }, h("span", null, "Folder that holds your projects"), rootInput),
					previewSlot,
					h(
						"div",
						{ class: "actions" },
						scanButton,
						h("button", { type: "button", class: "button quiet", onclick: () => void look() }, "Look again"),
						h(
							"details",
							{ class: "options" },
							h("summary", null, "Options"),
							h("label", { class: "field" }, h("span", null, "Folder levels to look through for repositories (0 to 6)"), depthInput),
						),
					),
				),
				scanSlot,
				github.node,
			),
			summary,
		),
	);

	drawScan();
	void drawSummary();
	void look();
	const unsubscribe = subscribe((change) => {
		if (change === "scan") drawScan();
		else void drawSummary();
	});
	return () => {
		left = true;
		analysis?.stop();
		github.stop();
		unsubscribe();
	};

	function forget() {
		asked++;
		preview = null;
		replace(previewSlot);
		drawScan();
	}

	/** Asks the server what a scan of the chosen folder would cover, and says so before anything is run. */
	async function look() {
		forget();
		const current = asked;
		const root = rootInput.value.trim();
		if (root === "") return;
		replace(previewSlot, h("p", { class: "hint" }, "Looking for repositories…"));
		try {
			const answer = await api("GET", `/repos/preview?root=${encodeURIComponent(root)}&depth=${encodeURIComponent(depthInput.value || "3")}`);
			if (left || current !== asked) return;
			preview = /** @type {import("./hints.js").ScanPreview} */ (answer.preview);
			const advice = previewAdvice(preview, store.settings);
			const shown = preview.repos.slice(0, CHIPS);
			replace(
				previewSlot,
				advice.found
					? h(
							"div",
							{ class: "found" },
							h("strong", null, h("span", { class: "severity status-good" }, icon("good"), advice.title)),
							h("ul", { class: "chips" }, ...shown.map((name) => h("li", null, name)), preview.total > shown.length ? h("li", { class: "more" }, `and ${(preview.total - shown.length).toLocaleString()} more`) : null),
						)
					: h(
							"div",
							{ class: "guide" },
							h("strong", null, h("span", { class: "severity status-pending" }, icon("pending"), advice.title)),
							...advice.lines.map((line) => h("p", null, ...stepNodes(line))),
							advice.steps.length > 0 ? h("ol", { class: "steps" }, ...advice.steps.map((step) => h("li", null, ...stepNodes(step)))) : null,
						),
			);
		} catch (err) {
			if (left || current !== asked) return;
			preview = null;
			replace(previewSlot, h("p", { class: "hint" }, err instanceof Error ? err.message : String(err)));
		}
		drawScan();
	}

	function drawScan() {
		const scan = store.scan;
		const running = scan.state === "running";
		// Nothing to check is said above the button; pressing it would only say so again.
		scanButton.disabled = running || preview?.total === 0;
		const count = preview && preview.total > 0 ? ` ${plural(preview.total, "repository", "repositories")}` : "";
		scanButton.textContent = running ? "Checking…" : store.report ? `Check${count} again` : `Check${count}`;
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
						h("strong", null, known ? `Checking ${Math.min(scan.done + 1, scan.total)} of ${scan.total}` : "Finding repositories"),
						known && scan.current ? h("span", { class: "path" }, scan.current) : null,
					),
					h("progress", { max: known ? scan.total : null, value: known ? scan.done : null, "aria-label": "Scan progress" }),
				),
			);
		} else if (scan.state === "failed") {
			replace(scanSlot, banner("error", "The scan did not finish", [scan.error, ...emptyScanHints(scan, store.settings)]));
		} else {
			replace(scanSlot);
		}
	}

	async function drawSummary() {
		const report = store.report;
		intro.textContent = report
			? "Where your code and your websites stand, and what to do first."
			: "SecurityX checks two things you own: your code and your websites. Start with either one below.";
		if (!report) return replace(summary, monitorCard(), assistantCard());
		const rows = findingRows();
		/** @type {Record<Severity, number>} */
		const counts = { critical: 0, high: 0, medium: 0, low: 0 };
		for (const row of rows) counts[row.severity]++;
		const affected = report.repos.filter((repo) => repo.findings.length > 0);
		rootInput.value = report.root;
		analysis?.stop();
		analysis = analysisCard();

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
			analysis?.node,
			monitorCard(),
			assistantCard(),
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

/**
 * Questions about the scan when a local model is connected and there is a scan to ask about; how to
 * connect one when there is not.
 */
function assistantCard() {
	const assistant = store.settings?.assistant;
	if (!assistant?.configured) return localModelCard(assistant, store.settings?.service === true);
	return store.report ? askCard(`ask\n${store.report.scannedAt}`, assistant) : null;
}

function monitorCard() {
	const monitor = store.settings?.monitor;
	// Nothing given yet is the usual state after installing, not a mistake to quote back.
	const why = monitor?.unset ? "" : (monitor?.error ?? "");
	return h(
		"div",
		{ class: "card full" },
		h("h2", null, "Check your websites"),
		h("p", { class: "sub" }, "Watches the domains you own for new subdomains, DNS changes, expiring certificates and missing security headers. It only looks at what is public."),
		monitor?.configured
			? h("p", null, h("span", { class: "severity status-good" }, icon("good"), `Connected to your monitor at ${monitor.host}`))
			: h(
					"p",
					null,
					h("span", { class: "severity status-pending" }, icon("pending"), "Not set up yet"),
					h("span", { class: "hint block" }, why || "It needs the SecurityX monitor, a small service that runs on your Cloudflare account. Setting it up takes three steps."),
				),
		h("p", { class: "card-foot" }, h("a", { class: "button", href: "#/domains" }, monitor?.configured ? "Open your websites" : "Set it up")),
	);
}
