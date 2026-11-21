// @ts-check
import { api } from "./api.js";
import { announce, banner, formatNumber, formatWhen, h, icon, pageVisibility, replace, toast } from "./dom.js";
import { analysisNotice, analysisProgress, generatedLabel, modelFields, VERDICT_LABELS } from "./generated.js";
import { poller } from "./poller.js";
import { loadJudgements, store } from "./store.js";

/** @typedef {import("../src/ui/server.ts").AnalysisStatus} AnalysisStatus */
/** @typedef {import("./store.js").Judgement} Judgement */

const POLL_MS = 1500;
const VERDICT_CLASS = { confirmed: "status-warning", likely: "status-warning", unclear: "status-pending", unlikely: "status-good" };
const VERDICT_ICON = /** @type {const} */ ({ confirmed: "warning", likely: "warning", unclear: "pending", unlikely: "good" });

/**
 * The model's verdict on a finding as a small mark: shape and word, like a severity. Null when the
 * model has not judged it.
 *
 * @param {{ analysis?: Judgement }} finding
 */
export function verdictMark(finding) {
	const verdict = finding.analysis?.verdict;
	if (!verdict) return null;
	return h("span", { class: `severity verdict ${VERDICT_CLASS[verdict]}` }, icon(VERDICT_ICON[verdict]), VERDICT_LABELS[verdict]);
}

/**
 * The model's judgement of a finding, in full: verdict, reason, its repair steps and the evidence
 * it was given. Text only, labelled as generated with the model's name.
 *
 * @param {{ analysis?: Judgement }} finding
 */
export function judgementBlock(finding) {
	const judgement = finding.analysis;
	if (!judgement) return null;
	const evidence = judgement.evidence;
	return h(
		"div",
		{ class: "generated judgement" },
		h("div", { class: "generated-label" }, icon("spark"), generatedLabel(judgement.model)),
		h("p", null, verdictMark(finding)),
		judgement.reason ? h("p", null, judgement.reason) : null,
		judgement.overruled ? h("p", { class: "hint" }, `Porchlight: ${judgement.overruled}`) : null,
		// The model's words stay text: a click path in them is not made a link (S37).
		judgement.steps.length > 0 ? h("div", null, h("strong", null, "The model's repair steps"), h("ol", null, ...judgement.steps.map((step) => h("li", null, step)))) : null,
		evidence
			? h(
					"details",
					{ class: "options" },
					h("summary", null, "What the model was shown from your code"),
					h(
						"dl",
						{ class: "facts" },
						h("dt", null, "Declared as"),
						h("dd", null, evidence.declared),
						h("dt", null, "Imported in"),
						h("dd", null, evidence.usedInFiles === 0 ? "No file of this repository's own code" : `${evidence.usedInFiles.toLocaleString("en-GB")} ${evidence.usedInFiles === 1 ? "file" : "files"}${evidence.onlyInTests ? ", all of them tests" : ""}`),
						h("dt", null, "Looked through"),
						h("dd", null, `${evidence.filesRead.toLocaleString("en-GB")} source files${evidence.complete ? "" : " (stopped there: the repository is larger)"}`),
					),
					evidence.uses.length > 0 ? h("ul", { class: "uses" }, ...evidence.uses.map((use) => h("li", null, h("span", { class: "mono wrap" }, use.file), h("code", { class: "wrap" }, use.line)))) : null,
				)
			: null,
	);
}

/**
 * "Deeper analysis" on the Overview: start the model on the findings it has not judged, watch it
 * work, stop it. Null when no model is connected or nothing has been scanned.
 *
 * @returns {{ node: HTMLElement, stop: () => void } | null}
 */
export function analysisCard() {
	const assistant = store.settings?.assistant;
	if (!assistant?.configured || !store.report) return null;
	/** @type {AnalysisStatus} */
	let status = { state: "idle" };
	/** Why a Deep scan's analysis did not start, when the server says so (R6U-11). @type {{ at: string, why: string } | null} */
	let notStarted = null;
	let said = "";
	/** @type {{ items: number, judged: number, waiting: Record<string, number>, verdicts: Record<string, number> } | null} */
	let summary = null;
	let judgedShown = -1;

	// Not a live region: progress moves with each judgement. The start and the end are said with announce().
	const body = h("div");
	const countInput = /** @type {HTMLInputElement} */ (h("input", { type: "number", name: "limit", value: "25", min: "1", max: "500", class: "narrow", "aria-label": "How many to analyse now" }));
	const everything = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", name: "all" }));
	const node = h(
		"div",
		{ class: "card full" },
		h("h2", null, "Deeper analysis"),
		h(
			"p",
			{ class: "sub" },
			`${assistant.model} looks at each finding with evidence from your code: is the package really used, or only in tests? It gives a verdict, its reason and repair steps for this repository. Its verdicts are advice shown beside a finding; they never change a severity or hide anything.`,
		),
		body,
	);
	const follow = poller({
		every: POLL_MS,
		visibility: pageVisibility(),
		run: async () => {
			const answer = await api("GET", "/analysis");
			status = answer.status;
			summary = answer.summary;
			notStarted = answer.notStarted && typeof answer.notStarted.why === "string" ? answer.notStarted : null;
			draw();
			// New judgements belong on the findings pages too.
			if (summary && summary.judged !== judgedShown) {
				if (judgedShown !== -1) void loadJudgements();
				judgedShown = summary.judged;
			}
			if (status.state === "running" && said !== "running") announce(`${assistant.model} started analysing`);
			else if (status.state !== "running" && said === "running") announce(status.state === "stopped" ? "The analysis stopped" : "The analysis finished");
			said = status.state;
			return status.state === "running";
		},
		onGiveUp: (err) => replace(body, banner("error", "Could not read the analysis", [message(err)])),
	});
	follow.now();
	return { node, stop: () => follow.stop() };

	/** @param {string} path @param {unknown} [send] */
	async function act(path, send) {
		try {
			await api("POST", path, path === "/analysis" ? { .../** @type {object} */ (send ?? {}), ...modelFields(store.settings?.assistant) } : send);
			follow.now();
		} catch (err) {
			toast(message(err), "error");
		}
	}

	function draw() {
		const running = status.state === "running";
		const waiting = summary ? summary.items - summary.judged : 0;
		const verdicts = summary?.verdicts ?? {};
		// A Deep scan's analysis that did not start is said here, where it would have run, not only in Activity.
		const finishedAt = status.state === "done" || status.state === "stopped" ? status.finishedAt : "";
		const missed = notStarted && !running && notStarted.at > finishedAt ? notStarted : null;
		replace(
			body,
			missed ? banner("warning", "The analysis after the Deep scan did not start", [`${missed.why} (${formatWhen(missed.at)}).`, "Analyse below to start it now."]) : null,
			h("p", null, analysisProgress(summary)),
			summary && summary.judged > 0
				? h(
						"p",
						{ class: "hint" },
						Object.entries(VERDICT_LABELS)
							.filter(([verdict]) => (verdicts[verdict] ?? 0) > 0)
							.map(([verdict, label]) => `${label.replace("Model: ", "")}: ${verdicts[verdict]?.toLocaleString("en-GB")}`)
							.join(" · "),
						" · ",
						h("a", { href: "#/findings?sort=verdict" }, "See them, confirmed first"),
					)
				: null,
			status.state === "running"
				? h(
						"div",
						{ class: "progress" },
						h("div", { class: "progress-text" }, h("strong", null, `Analysing ${Math.min(status.done + 1, status.total)} of ${status.total}`), status.current ? h("span", { class: "path" }, status.current) : null),
						h("progress", { max: status.total, value: status.done, "aria-label": "Analysis progress" }),
					)
				: null,
			(status.state === "done" || status.state === "stopped") && status.failed > 0
				? banner(
						"warning",
						status.gaveUp ? `Stopped after ${status.failed.toLocaleString("en-GB")} ${status.failed === 1 ? "item" : "items"} could not be analysed in a row` : `${status.failed.toLocaleString("en-GB")} of ${status.total.toLocaleString("en-GB")} could not be analysed`,
						[...(status.lastError ? [status.lastError] : []), ...(status.gaveUp ? ["The rest were not sent. Check the model under Settings → Model, then analyse again."] : [])],
					)
				: null,
			running || waiting === 0 ? null : h("p", { class: "hint" }, analysisNotice(assistant ?? { configured: true })),
			h(
				"div",
				{ class: "actions" },
				running
					? h("button", { type: "button", class: "button", onclick: () => void act("/analysis/stop") }, "Stop")
					: waiting > 0
						? h(
								"button",
								{
									type: "button",
									class: "button primary",
									onclick: () => void act("/analysis", { limit: Number(countInput.value), severities: everything.checked ? ["critical", "high", "medium", "low"] : ["critical", "high"] }),
								},
								"Analyse",
							)
						: null,
				running || waiting === 0 ? null : h("label", { class: "field inline" }, h("span", null, "How many now"), countInput),
				running || waiting === 0 ? null : h("label", { class: "check" }, everything, "Include medium and low"),
			),
		);
	}
}

/** @param {unknown} err */
function message(err) {
	return err instanceof Error ? err.message : String(err);
}
