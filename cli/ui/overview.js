// @ts-check
import { api } from "./api.js";
import { analysisCard } from "./analysis.js";
import { askCard, localModelCard } from "./assist.js";
import { banner, formatNumber, formatWhen, h, icon, isOff, PHASE_TITLES, plural, replace, setOff, severityBadge, statTile, stepNodes, tileRow, toast } from "./dom.js";
import { coverageBanner } from "./finding-parts.js";
import { githubPanel } from "./github.js";
import { emptyScanHints, overviewRedraws, previewAdvice, scheduleWords, toolAdvice } from "./hints.js";
import { connectionsCheck, glanceCard, reviewCard } from "./glance.js";
import { buildHash } from "./list.js";
import { choicesToParams, depthOf, describeChoices, PRESETS, startingChoices } from "./scan-choices.js";
import { scanOptions, sendsToHosted } from "./scan-options.js";
import { cancelScan, findingRows, load, loadCloudflare, startScan, store, subscribe } from "./store.js";
import { changeSummary } from "./tracking.js";

/** @typedef {import("../src/roadmap/types.ts").Roadmap} Roadmap */
/** @typedef {import("./filter.js").Severity} Severity */

const SEVERITIES = /** @type {const} */ (["critical", "high", "medium", "low"]);
const SEVERITY_LABELS = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
const TOP = 6;
/** Repositories named before a scan; the rest are counted. */
const CHIPS = 14;

/**
 * The Overview page: start a scan, see where things stand, and go to what needs doing first. Once a
 * scan exists its results come first, with a smaller "Check again" card under them (A-D1, W3). A change in the
 * shared store redraws only the part that shows it (B41).
 *
 * @param {HTMLElement} view
 * @param {import("./finding-parts.js").Route} context
 * @returns {Promise<() => void>}
 */
export async function renderOverview(view, context) {
	await load();
	// The Cloudflare card needs the latest audit. It is fetched without holding the page up, and the
	// card is drawn again when it arrives: a page that waits here can draw itself over a later one.
	void loadCloudflare().catch(() => {});
	let left = false;
	const service = store.settings?.service === true;
	const defaultDepth = store.settings?.scanDepth ?? 3;
	/** The answer to the latest "what is in this folder" question; an earlier one arriving late is dropped. */
	let asked = 0;
	/** @type {import("./hints.js").ScanPreview | null} */
	let preview = null;
	/** @type {ReturnType<typeof analysisCard>} */
	let analysis = null;
	/** Whether the owner has typed in the folder box: a new report then leaves it alone (B41). */
	let typed = false;
	/** The report the folder box was last set from. */
	let rootFrom = store.report?.root ?? null;
	/** Whether the page is laid out for a report (results first) or for a first scan. */
	let laidOutForReport = /** @type {boolean | null} */ (null);
	const scanSlot = h("div");
	const previewSlot = h("div", { class: "preview", "aria-live": "polite" });
	const summary = h("div");
	const analysisSlot = h("div");
	const cloudflareSlot = h("div");
	const monitorSlot = h("div");
	const assistantSlot = h("div");
	const glance = glanceCard(() => left);
	const reviewSlot = h("div");
	/** Look through the home folder itself: only when the owner asks (US-2). */
	let wholeHome = false;
	/** Credentials that look live, at the top of the page: until they are rotated they can be used. */
	const urgent = h("div");
	const intro = h("p", { class: "sub" });
	const parts = h("div", { class: "overview-parts" });
	const rootInput = /** @type {HTMLInputElement} */ (
		h("input", { type: "text", name: "root", value: store.report?.root ?? store.settings?.defaultRoot ?? "", spellcheck: false, autocomplete: "off", required: true })
	);
	// The depth the address names, else the one set for this Porchlight; the preview and the scan read it the same way (UI-B11).
	const depthInput = /** @type {HTMLInputElement} */ (
		h("input", { type: "number", name: "depth", value: String(depthOf(context.params.get("depth"), defaultDepth)), min: "0", max: "6", class: "narrow" })
	);
	const scanButton = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "button primary" }, "Scan"));
	// Fetching or removing a repository changes what a scan would cover.
	const github = githubPanel(() => void look());
	// A half-typed path is not looked into: that would walk folders nobody asked about. What was
	// shown no longer describes the box, so it is taken away until the folder is settled.
	rootInput.addEventListener("input", () => {
		typed = true;
		wholeHome = false;
		forget();
	});
	rootInput.addEventListener("change", () => void look());
	depthInput.addEventListener("change", () => {
		remember();
		void look();
	});
	// What the scan looks at lives in the address, like a page's filters, so a reload or a shared link
	// keeps it. With nothing named there, it starts from what the last scan used (B42).
	const initial = startingChoices(context.params, store.report?.choices);
	const optionsSummary = h("summary", null);
	const options = scanOptions(initial, h("label", { class: "field" }, h("span", null, "Folder levels to look through for repositories (0 to 6)"), depthInput), () => {
		remember();
		nameOptions();
		drawPreview();
		drawScan();
	});
	nameOptions();

	const scanHeading = h("h2", null);
	const scanIntro = h("p", { class: "sub" });
	const githubBox = /** @type {HTMLDetailsElement} */ (h("details", { class: "options github-box" }, h("summary", null, "Get repositories from GitHub"), github.node));
	const scanCard = h(
		"div",
		{ class: "card full scan-card" },
		scanHeading,
		scanIntro,
		h(
			"form",
			{
				class: "scan-form",
				onsubmit: async (/** @type {SubmitEvent} */ event) => {
					event.preventDefault();
					if (isOff(scanButton)) return;
					try {
						const choices = options.choices();
						remember();
						await startScan(rootInput.value, depthOf(depthInput.value, defaultDepth), choices, sendsToHosted(choices));
					} catch (err) {
						// Nothing is running to follow (a model analysing, GitHub fetching): the server's reason is said (B40).
						toast(err instanceof Error ? err.message : String(err), "error");
					}
				},
			},
			// A service checks the one folder its server gave it, so there is nothing to type.
			service ? null : h("label", { class: "field grow" }, h("span", null, "Folder that holds your projects"), rootInput),
			previewSlot,
			// Open when the choices are anything but a Standard scan, so what will run, and what it sends, is in sight.
			h("details", { class: "options", open: Object.values(choicesToParams(initial)).some((value) => value !== undefined) }, optionsSummary, options.node),
			h("div", { class: "actions" }, scanButton, h("button", { type: "button", class: "button quiet", onclick: () => void look() }, "Look again")),
		),
		scanSlot,
		githubBox,
	);

	replace(view, h("section", { class: "page" }, h("div", { class: "page-head" }, h("div", null, h("h1", null, "Overview"), intro)), urgent, parts));

	layOut();
	drawScan();
	drawSummary();
	drawAnalysis();
	replace(reviewSlot, reviewCard());
	drawCards(["cloudflare", "monitor", "assistant"]);
	void look();
	const unsubscribe = subscribe((change) => {
		const redraw = overviewRedraws(change);
		if (redraw.length === 0) return;
		if (change === "report") layOut();
		if (redraw.includes("scan")) drawScan();
		if (redraw.includes("summary")) drawSummary();
		if (redraw.includes("analysis")) drawAnalysis();
		if (redraw.includes("glance")) glance.refresh();
		if (redraw.includes("review") || redraw.includes("summary")) replace(reviewSlot, reviewCard());
		drawCards(redraw);
	});
	return () => {
		left = true;
		analysis?.stop();
		github.stop();
		unsubscribe();
	};

	/**
	 * Results first once there is a scan, the scan card under them; the full scan card first before
	 * there is one. The parts are kept, so moving them loses nothing typed or opened.
	 */
	function layOut() {
		const hasReport = store.report !== null;
		if (hasReport === laidOutForReport) return;
		laidOutForReport = hasReport;
		scanCard.classList.toggle("compact", hasReport);
		scanHeading.textContent = hasReport ? "Scan again" : "Scan your code";
		scanIntro.textContent = hasReport
			? "Scan the folder again, with the same options as last time unless you change them."
			: "Finds passwords and keys saved in your git repositories, old commits included, and packages with known security holes. Deep also looks for personal data.";
		// Before the first scan GitHub may be where the repositories come from, so it is open.
		githubBox.open = !hasReport;
		intro.textContent = hasReport
			? "Where your code and your domains stand, and what to do first."
			: "Porchlight checks two things you own: your code and your domains. Start with either one below.";
		// With a scan, its results lead and the scan card follows them; before one, the scan card is the start.
		replace(parts, ...(hasReport ? [glance.node, summary, reviewSlot, analysisSlot, scanCard] : [scanCard, glance.node, summary, analysisSlot]), cloudflareSlot, monitorSlot, assistantSlot);
	}

	/** "Options: Quick", so the preset is in sight with the panel closed. */
	function nameOptions() {
		const preset = options.choices().preset;
		optionsSummary.textContent = `Options: ${PRESETS.find((entry) => entry.key === preset)?.label ?? "Custom"}`;
	}

	/** Keeps the choices and the depth in the address, so "Check again" after a reload checks the same. */
	function remember() {
		const depth = depthOf(depthInput.value, defaultDepth);
		context.replace({ ...choicesToParams(options.choices()), depth: depth === defaultDepth ? undefined : depth });
	}

	/** The repositories the choices leave out, among those the folder holds. */
	function skippedHere() {
		const skip = options.choices().skip;
		return preview ? preview.repos.filter((name) => skip.includes(name)) : [];
	}

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
			const answer = await api("GET", `/repos/preview?root=${encodeURIComponent(root)}&depth=${depthOf(depthInput.value, defaultDepth)}${wholeHome ? "&home=1" : ""}`);
			if (left || current !== asked) return;
			preview = /** @type {import("./hints.js").ScanPreview} */ (answer.preview);
			drawPreview();
		} catch (err) {
			if (left || current !== asked) return;
			preview = null;
			replace(previewSlot, h("p", { class: "hint" }, err instanceof Error ? err.message : String(err)));
		}
		drawScan();
	}

	/** What the folder holds, with the repositories the choices skip marked as such. */
	function drawPreview() {
		if (!preview) return;
		const advice = previewAdvice(preview, store.settings);
		const shown = preview.repos.slice(0, CHIPS);
		const skip = options.choices().skip;
		// What the scan would lack, and the notes another folder would leave behind (US-2, US-10).
		const lacking = toolAdvice(preview);
		const notes = Object.keys(store.findingNotes).length;
		const elsewhere = store.report && notes > 0 && preview.exists && preview.root !== store.report.root;
		const extra = h(
			"div",
			null,
			...lacking.map((line) => h("p", { class: "form-error", role: "note" }, ...stepNodes(line, { copy: true }))),
			elsewhere
				? h(
						"p",
						{ class: "hint", role: "note" },
						`Your ${plural(notes, "status and note are", "statuses and notes are")} kept by each repository's name under ${store.report?.root}. A scan of ${preview.root} names repositories from there, so ${notes === 1 ? "it" : "they"} may no longer match. Scan the same folder to keep them.`,
					)
				: null,
			preview.isHome
				? h(
						"button",
						{
							type: "button",
							class: "button quiet",
							onclick: () => {
								wholeHome = true;
								void look();
							},
						},
						"Look through the home folder anyway",
					)
				: null,
		);
		replace(
			previewSlot,
			advice.found
				? h(
						"div",
						{ class: "found" },
						h("strong", null, h("span", { class: "severity status-good" }, icon("good"), advice.title)),
						h(
							"ul",
							{ class: "chips" },
							...shown.map((name) => (skip.includes(name) ? h("li", { class: "skipped" }, h("s", null, name), " skipped") : h("li", null, name))),
							preview.total > shown.length ? h("li", { class: "more" }, `and ${formatNumber(preview.total - shown.length)} more`) : null,
						),
					)
				: h(
						"div",
						{ class: "guide" },
						h("strong", null, h("span", { class: "severity status-pending" }, icon("pending"), advice.title)),
						...advice.lines.map((line) => h("p", null, ...stepNodes(line))),
						advice.steps.length > 0 ? h("ol", { class: "steps" }, ...advice.steps.map((step) => h("li", null, ...stepNodes(step)))) : null,
					),
			extra,
		);
	}

	function drawScan() {
		const scan = store.scan;
		const running = scan.state === "running";
		const total = preview ? preview.total - skippedHere().length : 0;
		// Nothing to check is said above the button; pressing it would only say so again.
		setOff(scanButton, running || (preview !== null && total <= 0));
		const count = preview && total > 0 ? ` ${plural(total, "repository", "repositories")}` : "";
		scanButton.textContent = running ? "Scanning…" : store.report ? `Scan${count} again` : `Scan${count}`;
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
					h(
						"button",
						{
							type: "button",
							class: "button",
							onclick: async () => {
								try {
									await cancelScan();
									toast("Scan stopped. The last scan is unchanged.");
								} catch (err) {
									toast(err instanceof Error ? err.message : String(err), "error");
								}
							},
						},
						"Stop",
					),
				),
			);
		} else if (scan.state === "failed") {
			replace(scanSlot, banner("error", "The scan did not finish", [scan.error, ...emptyScanHints(scan, store.settings)]));
		} else {
			replace(scanSlot);
		}
	}

	/** The cards beside the results that a change names: Cloudflare, the monitor, the model. @param {string[]} which */
	function drawCards(which) {
		if (which.includes("cloudflare")) replace(cloudflareSlot, cloudflareCard());
		if (which.includes("monitor")) replace(monitorSlot, monitorCard());
		if (which.includes("assistant")) replace(assistantSlot, assistantCard());
	}

	/** The model's deeper analysis, started again only when the report or the model changes. */
	function drawAnalysis() {
		analysis?.stop();
		analysis = store.report ? analysisCard() : null;
		replace(analysisSlot, analysis?.node);
	}

	function drawSummary() {
		const report = store.report;
		if (!report) {
			replace(urgent);
			replace(summary);
			return;
		}
		// The folder box follows a new report only when the owner has not typed in it, and is then looked into again.
		if (report.root !== rootFrom) {
			rootFrom = report.root;
			if (!typed && rootInput.value !== report.root) {
				rootInput.value = report.root;
				void look();
			}
		}
		const rows = findingRows();
		/** @type {Record<Severity, number>} */
		const counts = { critical: 0, high: 0, medium: 0, low: 0 };
		for (const row of rows) counts[row.severity]++;
		const affected = report.repos.filter((repo) => repo.findings.length > 0);

		const phases = h("div", { class: "card" }, h("h2", null, "What to repair first"), h("p", { class: "loading" }, "Working it out…"));
		replace(
			summary,
			h(
				"p",
				{ class: "sub scan-line" },
				`Last scan: ${plural(report.repos.length, "repository", "repositories")} under ${report.root}, ${formatWhen(report.scannedAt)}. ${describeChoices(report.choices)}.`,
				scheduleWords(store.settings?.scanEveryHours ?? 0) ? ` ${scheduleWords(store.settings?.scanEveryHours ?? 0)}` : null,
			),
			coverageBanner(),
			tileRow(
				// Each number opens the findings it counts.
				statTile("Total findings", rows.length, null, "#/findings"),
				...SEVERITIES.map((severity) => statTile(SEVERITY_LABELS[severity], counts[severity], icon(severity, `severity-${severity}`), buildHash(["findings"], { severity }))),
				statTile("Repositories affected", `${formatNumber(affected.length)} of ${formatNumber(report.repos.length)}`, null, "#/findings/by-repo"),
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
											h("span", { class: "link-meta" }, severityBadge(worst), `${formatNumber(count)} of ${plural(repo.findings.length, "finding", "findings")}`),
										),
									);
								}),
							),
					h("p", { class: "card-foot" }, h("a", { href: "#/findings/by-repo" }, "All repositories")),
				),
			),
			historyCard(),
		);
		void drawRoadmap(report, phases);
	}

	/**
	 * "What to repair first" and the live credentials, from the roadmap.
	 *
	 * @param {NonNullable<typeof store.report>} report
	 * @param {HTMLElement} phases
	 */
	async function drawRoadmap(report, phases) {
		try {
			const { roadmap } = /** @type {{ roadmap: Roadmap }} */ (await api("GET", "/repos/roadmap"));
			if (left || store.report !== report) return;
			const rotate = roadmap.phases[0]?.groups.flatMap((group) => group.actions.filter((action) => action.kind === "rotate").map((action) => ({ group: group.name, action }))) ?? [];
			replace(urgent, rotate.length > 0 ? liveCredentials(rotate) : null);
			replace(
				phases,
				h("h2", null, "What to repair first"),
				roadmap.totals.actions === 0
					? h("p", { class: "sub" }, "Nothing to repair: the scan found nothing in what it covered.")
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
				h("p", { class: "card-foot" }, h("a", { href: "#/roadmap" }, "Open the roadmap")),
			);
		} catch (err) {
			if (left) return;
			replace(phases, h("h2", null, "What to repair first"), banner("error", "Could not build the roadmap", [err instanceof Error ? err.message : String(err)]));
		}
	}
}

/**
 * The banner at the top of the Overview when credentials look live: how many, where the first few
 * are, and a link to the repairs. Each place opens that finding on the Findings page.
 *
 * @param {{ group: string, action: import("../src/roadmap/types.ts").Action }[]} rotate
 */
function liveCredentials(rotate) {
	return h(
		"section",
		{ class: "banner banner-error urgent", "aria-labelledby": "live-credentials" },
		h("h2", { id: "live-credentials", class: "banner-title" }, icon("warning"), plural(rotate.length, "credential looks live", "credentials look live")),
		h("p", null, "Rotate these first. Each one is in git history, so deleting the line does not make it safe."),
		h(
			"ul",
			{ class: "urgent-list" },
			...rotate.slice(0, TOP).map(({ group, action }) =>
				h("li", { class: "wrap" }, h("a", { href: buildHash(["findings"], { repo: group, q: action.match ?? action.where }) }, `${group}: `, h("code", null, action.where))),
			),
		),
		h(
			"p",
			{ class: "card-foot" },
			h("a", { class: "button", href: buildHash(["roadmap"], { kind: "secret" }) }, rotate.length > TOP ? `See all ${formatNumber(rotate.length)} on the Roadmap` : "See how to rotate them"),
		),
	);
}

/**
 * Questions about the scan when a local model is connected and there is a scan to ask about; how to
 * connect one when there is not.
 */
/** What changed since the previous scan, and the scans kept before it. */
function historyCard() {
	const change = store.change;
	const scans = store.scans.slice(0, 10);
	const fixedShown = change?.fixed.slice(0, 8) ?? [];
	return h(
		"div",
		{ class: "card full" },
		h("h2", null, "Since the last scan"),
		h(
			"p",
			{ class: "sub" },
			changeSummary(change) ??
				(store.changeProblem
					? `The scans kept before this one could not be compared with it, so nothing is marked new or fixed. ${store.changeProblem}`
					: "This is the first scan kept. The next scan shows what is new and what was fixed since this one."),
		),
		fixedShown.length > 0
			? h(
					"ul",
					{ class: "link-list" },
					...fixedShown.map((item) => h("li", null, severityBadge(item.severity), " ", h("span", { class: "wrap" }, item.title), h("span", { class: "hint" }, ` · ${item.repo}`))),
				)
			: null,
		change && change.fixedCount > fixedShown.length ? h("p", { class: "hint" }, `And ${(change.fixedCount - fixedShown.length).toLocaleString("en-GB")} more fixed.`) : null,
		change && change.newCount > 0 ? h("p", { class: "hint" }, h("a", { href: buildHash(["findings"], { new: "1" }) }, `Show the ${plural(change.newCount, "new finding", "new findings")}`), ". Each is marked New on the Findings page.") : null,
		scans.length > 1
			? h(
					"table",
					{ class: "history-table" },
					h("thead", null, h("tr", null, h("th", null, "Scanned"), h("th", { class: "num" }, "Findings"), h("th", { class: "num" }, "Critical"), h("th", { class: "num" }, "High"), h("th", { class: "num" }, "New"), h("th", { class: "num" }, "Fixed"))),
					h(
						"tbody",
						null,
						...scans.map((scan) =>
							h(
								"tr",
								null,
								h("td", null, formatWhen(scan.scannedAt)),
								h("td", { class: "num" }, scan.findings.toLocaleString("en-GB")),
								h("td", { class: "num" }, (scan.counts.critical ?? 0).toLocaleString("en-GB")),
								h("td", { class: "num" }, (scan.counts.high ?? 0).toLocaleString("en-GB")),
								h("td", { class: "num" }, scan.newCount === undefined ? "–" : scan.newCount.toLocaleString("en-GB")),
								h("td", { class: "num" }, scan.fixedCount === undefined ? "–" : scan.fixedCount.toLocaleString("en-GB")),
							),
						),
					),
				)
			: null,
	);
}

function assistantCard() {
	const assistant = store.settings?.assistant;
	if (!assistant?.configured) return localModelCard(assistant, store.settings?.service === true);
	return store.report ? askCard(`ask\n${store.report.scannedAt}`, assistant) : null;
}

/** Where the Cloudflare account stands, and the one thing to do next there. */
function cloudflareCard() {
	const cloudflare = store.cloudflare;
	const report = cloudflare.report;
	const body = [];
	let next = h("a", { class: "button", href: "#/cloudflare" }, "Open Cloudflare");
	if (!cloudflare.token.configured && !report) {
		body.push(h("p", null, h("span", { class: "severity status-pending" }, icon("pending"), "Not connected"), h("span", { class: "hint block" }, "Paste a read-only API token and Porchlight checks every domain in your account. No model is needed.")));
		next = h("a", { class: "button", href: "#/settings/cloudflare" }, "Connect in Settings");
	} else if (!report) {
		body.push(h("p", null, h("span", { class: "severity status-pending" }, icon("pending"), "Connected, not audited yet")));
		next = h("a", { class: "button", href: "#/cloudflare" }, "Audit your account");
	} else {
		const checks = report.zones.flatMap((zone) => zone.checks);
		const failed = checks.filter((check) => check.status === "failed");
		const unknown = checks.filter((check) => check.status === "unknown").length;
		const fixable = failed.filter((check) => check.change).length;
		body.push(
			h(
				"p",
				null,
				h("span", { class: `severity ${failed.length === 0 ? "status-good" : "status-warning"}` }, icon(failed.length === 0 ? "good" : "warning"), `${plural(failed.length, "finding", "findings")} across ${plural(report.zones.length, "domain", "domains")}`),
				h("span", { class: "hint block" }, `Audited ${formatWhen(report.checkedAt)}.${unknown > 0 ? ` ${plural(unknown, "check", "checks")} could not be made: the Cloudflare page says which permission to add.` : ""}${fixable > 0 ? ` Porchlight can fix ${fixable} of them for you, once you approve the requests.` : ""}`),
			),
		);
		next = h("a", { class: "button", href: "#/cloudflare" }, fixable > 0 ? "See them and fix what Porchlight can" : "Open the audit");
	}
	return h(
		"div",
		{ class: "card full" },
		h("h2", null, "Audit your Cloudflare account"),
		h("p", { class: "sub" }, "Checks each domain's settings in your Cloudflare account: HTTPS, certificates, DNS and email records, the firewall, and who can change the account."),
		...body,
		h("p", { class: "card-foot" }, next),
	);
}

function monitorCard() {
	const monitor = store.settings?.monitor;
	// Nothing given yet is the usual state after installing, not a mistake to quote back.
	const why = monitor?.unset ? "" : (monitor?.error ?? "");
	return h(
		"div",
		{ class: "card full" },
		h("h2", null, "Scan your domains"),
		h("p", { class: "sub" }, "Watches the domains you own for new subdomains, DNS changes, expiring certificates and missing security headers. It only looks at what is public."),
		monitor?.configured
			? h("div", null, h("p", null, h("span", { class: "severity status-good" }, icon("good"), `Set up with your monitor at ${monitor.host}`)), connectionsCheck())
			: h(
					"p",
					null,
					h("span", { class: "severity status-pending" }, icon("pending"), "Not set up yet"),
					h("span", { class: "hint block" }, why || "It needs the Porchlight monitor, a small service that runs on your Cloudflare account. The Domains page gives each step, with the commands to copy."),
				),
		h("p", { class: "card-foot" }, h("a", { class: "button", href: "#/domains" }, monitor?.configured ? "Open your domains" : "Set it up")),
	);
}
