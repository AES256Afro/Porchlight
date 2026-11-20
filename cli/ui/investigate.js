// @ts-check
// "Investigate with a model": a model plans an investigation of a website you have proven you own,
// and Porchlight carries it out with a few fixed tools. This page adds domains and shows their
// ownership record, starts a run, puts each HTTP request and TCP connection to you first (or, when
// you approve a whole run at once, lists what that run may send before you do), and shows the
// steps, the evidence and what the model judged. Everything here comes from the target or the
// model, so every element is built with h() and shown as text.
import { api, ApiError, download } from "./api.js";
import { emptyState, formatWhen, h, icon, plural, replace, stepNodes, toast } from "./dom.js";
import { approvalLine, runLimits } from "./hints.js";
import { announceSaved } from "./projects.js";
import { currentProject } from "./store.js";

/** @typedef {import("../src/investigate/engine.ts").Run} Run */
/** @typedef {import("../src/investigate/engine.ts").Step} Step */
/** @typedef {import("../src/investigate/engine.ts").InvestigationFinding} InvestigationFinding */
/** @typedef {import("../src/investigate/store.ts").RunSummary} RunSummary */
/** @typedef {{ name: string, source: "local" | "monitor", verifiedAt?: string, challenge: { type: string, name: string, value: string } }} InvestigateDomain */
/**
 * @typedef {{
 *   canChange: boolean,
 *   domains: InvestigateDomain[],
 *   runs: RunSummary[],
 *   active: Run | null,
 *   assistant: import("./generated.js").AssistantSettings,
 *   disclosure?: string,
 *   monitor: boolean,
 *   tools: import("../src/investigate/tools.ts").ToolSpec[],
 *   defaults: { goal: string, maxTurns: number, maxTurnsLimit: number, minGapMs: number, maxGoal: number },
 * }} InvestigateState
 */

const POLL_MS = 1000;

const STATUS_WORDS = /** @type {Record<Run["status"], string>} */ ({
	running: "Running",
	waiting: "Waiting for you",
	done: "Finished",
	stopped: "Stopped",
	failed: "Failed",
});

const OUTCOME_WORDS = /** @type {Record<Step["outcome"], string>} */ ({
	ran: "Ran",
	refused: "Refused before it ran",
	denied: "You denied it",
	waiting: "Waiting for you",
	stopped: "Stopped",
	invalid: "Reply not understood",
	"no action": "No action",
});

/**
 * @param {HTMLElement} view
 * @param {string | undefined} runId a run to show, from the address
 * @returns {Promise<() => void>}
 */
export async function renderInvestigate(view, runId) {
	/** @type {InvestigateState} */
	let state = /** @type {any} */ (await api("GET", "/investigate"));
	const setupSlot = h("div");
	const runSlot = h("div", { "aria-live": "polite" });
	const historySlot = h("div");
	let timer = /** @type {ReturnType<typeof setInterval> | undefined} */ (undefined);
	let wasActive = state.active !== null;
	/** The run that was going on when last asked, so it stays on show once it ends. */
	let lastActive = state.active?.id ?? "";
	/** The pending step drawn last, so a poll does not redraw the approval card under the pointer. */
	let drawn = "";

	replace(
		view,
		h(
			"section",
			{ class: "page" },
			h(
				"div",
				{ class: "page-head" },
				h(
					"div",
					null,
					h("h1", null, "Investigate with a model"),
					h(
						"p",
						{ class: "sub" },
						"A model plans an investigation of a website you have proven you own, one step at a time. Porchlight runs each step with a few fixed tools: DNS lookups on their own, HTTP requests and TCP connections only with your approval, given one at a time or once for the whole run. Nothing outside the domain and its subdomains is touched.",
					),
				),
			),
			runSlot,
			setupSlot,
			historySlot,
		),
	);

	async function refresh() {
		try {
			state = /** @type {any} */ (await api("GET", "/investigate"));
		} catch (err) {
			if (err instanceof ApiError && err.status === 0) toast(err.message, "error");
			return;
		}
		const active = state.active !== null;
		// A run that just ended here stays on show, under its own address.
		if (state.active) lastActive = state.active.id;
		else if (lastActive && !runId) {
			runId = lastActive;
			history.replaceState(null, "", `#/investigate/${runId}`);
		}
		if (active !== wasActive) {
			wasActive = active;
			drawSetup();
			drawHistory();
		}
		await drawRun();
	}

	async function drawRun() {
		/** @type {Run | null} */
		let run = state.active;
		if (runId && run?.id !== runId) {
			try {
				run = /** @type {any} */ (await api("GET", `/investigate/run?id=${encodeURIComponent(runId)}`)).run;
			} catch {
				run = null;
			}
		}
		const key = run ? `${run.id} ${run.status} ${run.steps.length} ${run.findings.map((finding) => finding.status).join()} ${run.pending?.stepId ?? ""}` : "";
		if (key === drawn) return;
		drawn = key;
		replace(runSlot, run ? runView(run) : runId ? emptyState("No such investigation", "It may have been removed. Start a new one below.") : null);
	}

	function drawSetup() {
		replace(setupSlot, setupView());
	}

	function drawHistory() {
		const past = state.runs.filter((summary) => summary.id !== state.active?.id);
		replace(
			historySlot,
			past.length === 0
				? null
				: h(
						"div",
						{ class: "card" },
						h("h2", null, "Earlier investigations"),
						h(
							"ul",
							{ class: "plain-list" },
							...past.map((summary) =>
								h(
									"li",
									null,
									h("a", { href: `#/investigate/${summary.id}` }, `${summary.domain}: ${summary.goal}`),
									h(
										"span",
										{ class: "hint" },
										` · ${STATUS_WORDS[summary.status]} ${formatWhen(summary.finishedAt ?? summary.startedAt)} · ${plural(summary.findings, "finding", "findings")} · ${summary.model}`,
									),
								),
							),
						),
					),
		);
	}

	/** Adding domains, their ownership records, and the form that starts a run. */
	function setupView() {
		const assistant = state.assistant;
		const domainInput = /** @type {HTMLInputElement} */ (h("input", { type: "text", name: "domain", placeholder: "example.com", autocomplete: "off", required: true, "aria-label": "Domain" }));
		const addForm = h(
			"form",
			{
				class: "inline-form",
				onsubmit: async (/** @type {SubmitEvent} */ event) => {
					event.preventDefault();
					try {
						const answer = await api("POST", "/investigate/domains", { domain: domainInput.value });
						state.domains = answer.domains;
						drawSetup();
					} catch (err) {
						toast(err instanceof Error ? err.message : String(err), "error");
					}
				},
			},
			h("div", { class: "field grow" }, domainInput),
			h("button", { type: "submit", class: "button" }, icon("plus"), "Add domain"),
		);

		const domainCards = state.domains.map((domain) => domainCard(domain));
		return h(
			"div",
			null,
			h(
				"div",
				{ class: "card" },
				h("h2", null, "Your domains"),
				h(
					"p",
					null,
					"An investigation runs only on a domain whose DNS holds Porchlight's ownership record. It is checked when the run starts and again before every action; if it disappears, the run stops.",
				),
				state.monitor ? h("p", { class: "hint" }, "When the monitor already watches a domain, its record is used here too, so you publish one record for both.") : null,
				...domainCards,
				state.canChange ? addForm : h("p", { class: "hint" }, "Domains are added on the Mac that runs Porchlight."),
			),
			state.domains.length > 0 && state.canChange ? startCard(assistant) : null,
		);
	}

	/** @param {InvestigateDomain} domain */
	function domainCard(domain) {
		const check = /** @type {HTMLButtonElement} */ (
			h(
				"button",
				{
					type: "button",
					class: "button",
					onclick: async () => {
						check.disabled = true;
						try {
							const answer = await api("POST", "/investigate/verify", { domain: domain.name });
							state.domains = answer.domains;
							toast(answer.verified ? `${domain.name}: the record is in place` : `${domain.name}: the record was not found yet. DNS changes can take a few minutes.`, answer.verified ? "info" : "error");
							drawSetup();
						} catch (err) {
							toast(err instanceof Error ? err.message : String(err), "error");
							check.disabled = false;
						}
					},
				},
				"Check DNS record",
			)
		);
		const remove = h(
			"button",
			{
				type: "button",
				class: "button quiet",
				onclick: async () => {
					try {
						const answer = await api("POST", "/investigate/domains/remove", { domain: domain.name });
						state.domains = answer.domains;
						drawSetup();
					} catch (err) {
						toast(err instanceof Error ? err.message : String(err), "error");
					}
				},
			},
			"Remove",
		);
		return h(
			"div",
			{ class: "investigate-domain" },
			h(
				"h3",
				null,
				domain.name,
				" ",
				domain.verifiedAt
					? h("span", { class: "severity status-good" }, icon("good"), `Record found ${formatWhen(domain.verifiedAt)}`)
					: h("span", { class: "severity status-pending" }, icon("pending"), "Record not checked yet"),
			),
			h(
				"dl",
				{ class: "record" },
				h("dt", null, "Type"),
				h("dd", null, h("code", null, domain.challenge.type)),
				h("dt", null, "Name"),
				h("dd", null, h("code", null, domain.challenge.name), copyButton(domain.challenge.name, "name")),
				h("dt", null, "Value"),
				h("dd", null, h("code", null, domain.challenge.value), copyButton(domain.challenge.value, "value")),
			),
			state.canChange ? h("div", { class: "actions" }, check, remove) : null,
		);
	}

	/** @param {import("./generated.js").AssistantSettings} assistant */
	function startCard(assistant) {
		if (!assistant.configured) {
			return h("div", { class: "card" }, h("h2", null, "Start an investigation"), h("p", null, ...stepNodes("Choose a model in Settings → Model first. The model plans each step; Porchlight checks and runs it.")));
		}
		const domainSelect = /** @type {HTMLSelectElement} */ (h("select", { name: "domain", "aria-label": "Domain" }, ...state.domains.map((domain) => h("option", { value: domain.name }, domain.name))));
		const goal = /** @type {HTMLTextAreaElement} */ (h("textarea", { name: "goal", rows: 3, maxLength: state.defaults.maxGoal, "aria-label": "Goal" }));
		goal.value = state.defaults.goal;
		const turns = /** @type {HTMLInputElement} */ (h("input", { type: "number", name: "turns", min: 1, max: state.defaults.maxTurnsLimit, value: String(state.defaults.maxTurns), "aria-label": "Turns" }));
		const consent = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", name: "sendsToHosted", required: true }));
		const startButton = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "button primary", disabled: state.active !== null }, "Start investigation"));
		// The model chooses each step as it goes, so what can be shown before a run is what every step is held to.
		const limits = h("ul", { class: "investigate-limits" });
		const drawLimits = () => {
			const asked = Number(turns.value);
			const maxTurns = Number.isInteger(asked) && asked >= 1 ? Math.min(asked, state.defaults.maxTurnsLimit) : state.defaults.maxTurns;
			replace(limits, ...runLimits({ tools: state.tools, domain: domainSelect.value, maxTurns, minGapMs: state.defaults.minGapMs }).map((line) => h("li", null, line)));
		};
		domainSelect.addEventListener("change", drawLimits);
		turns.addEventListener("input", drawLimits);
		drawLimits();
		const approveEach = /** @type {HTMLInputElement} */ (h("input", { type: "radio", name: "approval", value: "each", checked: true }));
		const approveAll = /** @type {HTMLInputElement} */ (h("input", { type: "radio", name: "approval", value: "all" }));
		return h(
			"form",
			{
				class: "card",
				onsubmit: async (/** @type {SubmitEvent} */ event) => {
					event.preventDefault();
					startButton.disabled = true;
					try {
						const answer = await api("POST", "/investigate/start", {
							domain: domainSelect.value,
							goal: goal.value,
							maxTurns: Number(turns.value),
							approveAll: approveAll.checked,
							...(assistant.hosted ? { sendsToHosted: consent.checked } : {}),
						});
						runId = undefined;
						if (location.hash !== "#/investigate") history.replaceState(null, "", "#/investigate");
						state.active = answer.run;
						await refresh();
					} catch (err) {
						toast(err instanceof Error ? err.message : String(err), "error");
						startButton.disabled = state.active !== null;
					}
				},
			},
			h("h2", null, "Start an investigation"),
			h("p", { class: "hint" }, `With ${assistant.model} at ${assistant.host}.`),
			assistant.hosted
				? h(
						"div",
						{ class: "banner banner-warning", role: "note" },
						icon("warning"),
						h("div", null, h("strong", null, "This sends your site's responses to a hosted model"), h("p", null, state.disclosure ?? "")),
					)
				: h("p", { class: "hint" }, state.disclosure ?? ""),
			h("label", { class: "field" }, h("span", null, "Domain"), domainSelect),
			h("label", { class: "field" }, h("span", null, "Goal"), goal),
			h("label", { class: "field" }, h("span", null, "Turns at most"), turns),
			h(
				"fieldset",
				null,
				h("legend", null, "Requests to your site"),
				h(
					"label",
					{ class: "choice" },
					approveEach,
					h("span", null, h("strong", null, "Ask me before each one"), h("span", { class: "hint" }, "Every HTTP request and TCP connection waits for you, showing exactly what would be sent.")),
				),
				h(
					"label",
					{ class: "choice" },
					approveAll,
					h(
						"span",
						null,
						h("strong", null, "Approve them all for this run"),
						h("span", { class: "hint" }, "Porchlight sends each one as the model asks for it, without stopping to ask, inside the limits below. It applies to this run only."),
					),
				),
			),
			h("div", { class: "investigate-may-send" }, h("h3", null, "What this run may send"), limits),
			assistant.hosted ? h("label", { class: "check-line" }, consent, `Send this to ${assistant.model}, outside my machines`) : null,
			h("div", { class: "actions" }, startButton),
		);
	}

	/** @param {Run} run */
	function runView(run) {
		const live = run.status === "running" || run.status === "waiting";
		const evidence = new Map(run.evidence.map((item) => [item.id, item]));
		return h(
			"div",
			{ class: "card investigate-run" },
			h(
				"div",
				{ class: "investigate-run-head" },
				h("h2", null, `${run.domain}: ${STATUS_WORDS[run.status]}`),
				live
					? h(
							"button",
							{
								type: "button",
								class: "button danger",
								onclick: async () => {
									await api("POST", "/investigate/stop").catch(() => {});
									await refresh();
								},
							},
							"Stop",
						)
					: null,
			),
			h("p", null, run.goal),
			h(
				"p",
				{ class: "hint" },
				`Turn ${run.turns} of ${run.maxTurns} · ${plural(run.evidence.length, "action run", "actions run")} · ${run.model}${run.hosted ? " (hosted)" : ""} · started ${formatWhen(run.startedAt)}`,
			),
			run.ended && !live ? h("p", null, run.ended) : null,
			h("p", { class: "hint" }, approvalLine(run)),
			run.pending ? approvalCard(run) : null,
			findingsView(run),
			run.summary ? h("div", { class: "generated" }, h("p", { class: "generated-label" }, icon("spark"), `Written by ${run.model}. Check it against the evidence.`), h("div", { class: "generated-text" }, h("p", null, run.summary))) : null,
			h("h3", null, "Steps"),
			run.steps.length === 0
				? h("p", { class: "hint" }, live ? "Asking the model for the first step…" : "No steps were taken.")
				: h("ol", { class: "investigate-steps" }, ...run.steps.map((step) => stepView(step, step.evidenceId ? evidence.get(step.evidenceId) : undefined))),
			live
				? null
				: h(
						"div",
						{ class: "actions" },
						saveToProjectButton(run),
						exportButton(run, "md", "Export as Markdown"),
						exportButton(run, "json", "Export as JSON"),
					),
		);
	}

	/** @param {Run} run */
	function approvalCard(run) {
		const pending = /** @type {NonNullable<Run["pending"]>} */ (run.pending);
		/** @param {boolean} approve @param {boolean} [rest] this one and every later request of the run */
		const answer = async (approve, rest = false) => {
			try {
				await api("POST", "/investigate/approve", { run: run.id, step: pending.stepId, approve, ...(rest ? { rest: true } : {}) });
			} catch (err) {
				toast(err instanceof Error ? err.message : String(err), "error");
			}
			await refresh();
		};
		return h(
			"div",
			{ class: "banner banner-warning investigate-approval", role: "alert" },
			icon("warning"),
			h(
				"div",
				null,
				h("strong", null, "Approve this action?"),
				h("p", null, "It would be sent from this computer to your site exactly as shown:"),
				h("pre", { class: "investigate-pre" }, `${pending.tool} ${JSON.stringify(pending.args, null, 2)}`),
				pending.rationale ? h("p", { class: "generated-label" }, icon("spark"), `The model's reason: ${pending.rationale}`) : null,
				state.canChange
					? h(
							"div",
							null,
							h(
								"div",
								{ class: "actions" },
								h("button", { type: "button", class: "button primary", onclick: () => void answer(true) }, "Approve"),
								h("button", { type: "button", class: "button", onclick: () => void answer(true, true) }, "Approve all the rest"),
								h("button", { type: "button", class: "button", onclick: () => void answer(false) }, "Deny"),
							),
							h(
								"details",
								{ class: "investigate-rest" },
								h("summary", null, "What \u201cApprove all the rest\u201d allows"),
								h("p", { class: "hint" }, "This request and every later one of this run are sent without stopping to ask. Nothing else changes:"),
								h(
									"ul",
									{ class: "investigate-limits" },
									...runLimits({ tools: state.tools, domain: run.domain, maxTurns: run.maxTurns, minGapMs: run.minGapMs, turnsLeft: run.maxTurns - run.turns }).map((line) => h("li", null, line)),
								),
							),
						)
					: h("p", { class: "hint" }, "Approve it on the Mac that runs Porchlight."),
			),
		);
	}

	/** @param {Run} run */
	function findingsView(run) {
		return h(
			"div",
			null,
			h("h3", null, "What the model found"),
			h("p", { class: "generated-label" }, icon("spark"), `Judged by ${run.model}. Each finding cites the evidence below; check it there. They change no scan, count or roadmap until you act on them yourself.`),
			run.findings.length === 0 ? h("p", { class: "hint" }, "Nothing backed by evidence yet.") : h("ul", { class: "investigate-findings" }, ...run.findings.map((finding) => findingView(run, finding))),
			run.discarded > 0 ? h("p", { class: "hint" }, `${plural(run.discarded, "finding", "findings")} cited no real evidence and ${run.discarded === 1 ? "was" : "were"} discarded.`) : null,
		);
	}

	/** @param {Run} run @param {InvestigationFinding} finding */
	function findingView(run, finding) {
		/** @param {"open" | "accepted" | "dismissed"} status */
		const review = async (status) => {
			try {
				await api("POST", "/investigate/finding", { run: run.id, finding: finding.id, status });
				drawn = "";
				await drawRun();
			} catch (err) {
				toast(err instanceof Error ? err.message : String(err), "error");
			}
		};
		return h(
			"li",
			{ class: "investigate-finding" },
			h("strong", null, finding.title),
			h("span", { class: "hint" }, ` · the model's severity: ${finding.severity}${finding.asset ? ` · ${finding.asset}` : ""} · evidence ${finding.evidenceIds.join(", ")}`),
			finding.description ? h("p", null, finding.description) : null,
			h(
				"div",
				{ class: "actions" },
				finding.status === "open" ? h("span", { class: "hint" }, "Not reviewed") : h("span", { class: "hint" }, finding.status === "accepted" ? "You accepted this" : "You dismissed this"),
				state.canChange && finding.status !== "accepted" ? h("button", { type: "button", class: "button", onclick: () => void review("accepted") }, "Accept") : null,
				state.canChange && finding.status !== "dismissed" ? h("button", { type: "button", class: "button quiet", onclick: () => void review("dismissed") }, "Dismiss") : null,
				state.canChange && finding.status !== "open" ? h("button", { type: "button", class: "button quiet", onclick: () => void review("open") }, "Undo") : null,
			),
		);
	}

	/**
	 * @param {Step} step
	 * @param {import("../src/investigate/engine.ts").Evidence | undefined} evidence
	 */
	function stepView(step, evidence) {
		const what = step.description ?? (step.tool ? `${step.tool} ${JSON.stringify(step.args ?? {})}` : "");
		return h(
			"li",
			{ class: `investigate-step outcome-${step.outcome.replace(/\s/g, "-")}` },
			h(
				"div",
				null,
				h("span", { class: "hint" }, `Turn ${step.turn} · ${OUTCOME_WORDS[step.outcome]}${step.approvedBy === "run" ? " · approved for the whole run" : step.approvedBy === "owner" ? " · approved by you" : ""}`),
				what ? h("code", null, what) : null,
			),
			step.thought ? h("p", { class: "generated-label" }, icon("spark"), step.thought) : null,
			step.reason && step.outcome !== "ran" ? h("p", { class: "hint" }, step.reason) : null,
			evidence
				? h(
						"details",
						null,
						h("summary", null, `Evidence ${evidence.id}${evidence.ok ? "" : " (the action failed)"}`),
						h("p", { class: "hint" }, "Request"),
						h("pre", { class: "investigate-pre" }, evidence.request),
						h("p", { class: "hint" }, "Response"),
						h("pre", { class: "investigate-pre" }, evidence.response),
					)
				: null,
		);
	}

	/** With a project in use: the Markdown export written into its folder. @param {Run} run */
	function saveToProjectButton(run) {
		const project = currentProject();
		if (!project) return null;
		return h(
			"button",
			{
				type: "button",
				class: "button",
				onclick: async () => {
					try {
						const { saved } = await api("POST", `/investigate/export?id=${encodeURIComponent(run.id)}&format=md`);
						announceSaved(saved);
					} catch (err) {
						toast(err instanceof Error ? err.message : String(err), "error");
					}
				},
			},
			icon("folder"),
			`Save in ${project.name}`,
		);
	}

	/** @param {Run} run @param {"md" | "json"} format @param {string} label */
	function exportButton(run, format, label) {
		return h(
			"button",
			{
				type: "button",
				class: "button",
				onclick: async () => {
					try {
						toast(`Saved ${await download(`/investigate/export?id=${encodeURIComponent(run.id)}&format=${format}`)}`);
					} catch (err) {
						toast(err instanceof Error ? err.message : String(err), "error");
					}
				},
			},
			icon("download"),
			label,
		);
	}

	drawSetup();
	drawHistory();
	await drawRun();
	timer = setInterval(() => {
		// Only while something is running, or a run shown here might still change.
		if (state.active || wasActive) void refresh();
	}, POLL_MS);
	return () => clearInterval(timer);
}

/** @param {string} text @param {string} what */
function copyButton(text, what) {
	return h(
		"button",
		{
			type: "button",
			class: "button quiet icon-only",
			"aria-label": `Copy ${what}`,
			title: `Copy ${what}`,
			onclick: async () => {
				try {
					await navigator.clipboard.writeText(text);
					toast(`Copied the record ${what}`);
				} catch {
					toast("Could not copy. Select the text and copy it by hand.", "error");
				}
			},
		},
		icon("copy"),
	);
}
