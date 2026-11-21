// @ts-check
// "Investigate with a model": a model plans an investigation of a website you have proven you own,
// and Porchlight carries it out with a few fixed tools. This page adds domains and shows their
// ownership record, starts a run, puts each HTTP request and TCP connection to you first (or, when
// you approve a whole run at once, lists what that run may send before you do), and shows the
// steps, the evidence and what the model judged. Everything here comes from the target or the
// model, so every element is built with h() and shown as text.
import { api, ApiError, download } from "./api.js";
import { announce, banner, copyButton, emptyState, formatWhen, h, icon, isOff, pager, pageVisibility, plural, replace, setOff, shownText, stepNodes, toast } from "./dom.js";
import { approvalLine, OUTSIDE, ownershipSteps, runLimits, runStatusWord } from "./hints.js";
import { paginate } from "./list.js";
import { poller } from "./poller.js";
import { announceSaved } from "./projects.js";
import { currentProject, loadCloudflare, store } from "./store.js";
import { modelFields } from "./generated.js";

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
/** Earlier investigations listed at a time. */
const HISTORY_PAGE = 10;

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
 * "Run again" (E-Q2): the domain, goal and turns of an earlier run, put into the form once. Never an
 * approval: a new run asks before each request unless the owner says otherwise there (invariant 20).
 *
 * @type {{ domain: string, goal: string, maxTurns?: number } | null}
 */
let runAgain = null;

/**
 * @param {HTMLElement} view
 * @param {import("./finding-parts.js").Route} route a run to show is the second part of its address
 * @returns {Promise<() => void>}
 */
export async function renderInvestigate(view, route) {
	/** @type {string | undefined} */
	let runId = route.path[1];
	/** @type {InvestigateState} */
	let state = /** @type {any} */ (await api("GET", "/investigate"));
	// Whether a domain is in the Cloudflare account decides what the ownership steps say.
	if (!store.cloudflare.loaded) await loadCloudflare().catch(() => {});
	const setupSlot = h("div");
	// Not a live region: the run card is rebuilt on every step. What changed is said once with announce() (E-U1).
	const runSlot = h("div");
	/** One notice while Porchlight does not answer, in place of a toast a second (B49). */
	const offlineSlot = h("div");
	const historySlot = h("div");
	let historyPage = 1;
	let wasActive = state.active !== null;
	/** What was last said about the run, so each change is said once. */
	let said = "";
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
						"A model plans an investigation of a domain you have proven you own, one step at a time. Porchlight runs each step with a few fixed tools: DNS lookups on their own, HTTP requests and TCP connections only with your approval, given one at a time or once for the whole run. Nothing outside the domain and its subdomains is touched.",
					),
				),
			),
			offlineSlot,
			runSlot,
			setupSlot,
			historySlot,
		),
	);

	/** Reads the state again, and draws what changed. Throws when Porchlight does not answer. */
	async function refresh() {
		state = /** @type {any} */ (await api("GET", "/investigate"));
		const active = state.active !== null;
		// A run that just ended here stays on show, under its own address.
		if (state.active) lastActive = state.active.id;
		else if (lastActive && !runId) {
			runId = lastActive;
			if (route.isCurrent()) history.replaceState(null, "", `#/investigate/${runId}`);
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
		const pendingBefore = drawn.split(" ")[4] ?? "";
		drawn = key;
		replace(runSlot, run ? runView(run) : runId ? emptyState("No such investigation", "It may have been removed. Start a new one below.") : null);
		if (!run) return;
		// Said once per change: a step taken, a request waiting, the end.
		const now = `${run.id} ${run.status} ${run.steps.length} ${run.pending?.stepId ?? ""}`;
		if (now !== said) {
			said = now;
			if (run.pending) announce(`An action is waiting for your approval: ${run.pending.tool}`);
			else if (run.status === "running") announce(`Turn ${run.turns} of ${run.maxTurns}`, { topic: "investigate", every: 15_000 });
			else announce(`The investigation of ${run.domain}: ${runStatusWord(run)}`);
		}
		// A request that has just arrived takes focus, so it is not missed by a keyboard or screen-reader user (E-U2).
		if (run.pending && state.canChange && String(run.pending.stepId) !== pendingBefore) {
			/** @type {HTMLElement | null} */ (runSlot.querySelector(".investigate-approval h3"))?.focus();
		}
	}

	function drawSetup() {
		replace(setupSlot, setupView());
	}

	function drawHistory() {
		const past = state.runs.filter((summary) => summary.id !== state.active?.id);
		const shown = paginate(past, historyPage, HISTORY_PAGE);
		historyPage = shown.page;
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
							...shown.items.map((summary) =>
								h(
									"li",
									null,
									h("a", { href: `#/investigate/${summary.id}` }, `${summary.domain}: ${summary.goal}`),
									" ",
									runAgainButton(summary),
									h(
										"span",
										{ class: "hint" },
										` · ${runStatusWord(summary)} ${formatWhen(summary.finishedAt ?? summary.startedAt)} · ${plural(summary.findings, "finding", "findings")} · ${summary.model}`,
									),
								),
							),
						),
						pager(shown, "investigations", (next) => {
							historyPage = next;
							drawHistory();
						}),
					),
		);
	}

	/**
	 * Fills the form with an earlier run's domain, goal and turns, and goes to it. Approvals are never carried over.
	 *
	 * @param {{ domain: string, goal: string, maxTurns?: number }} run
	 */
	function runAgainButton(run) {
		return h(
			"button",
			{
				type: "button",
				class: "button quiet",
				title: "Start a new run with this domain, goal and number of turns. It asks before each request, as every run does.",
				onclick: () => {
					runAgain = { domain: run.domain, goal: run.goal, ...(typeof run.maxTurns === "number" ? { maxTurns: run.maxTurns } : {}) };
					const address = location.hash;
					if (address === "#/investigate") drawSetup();
					else location.hash = "#/investigate";
				},
			},
			"Run again",
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
				state.canChange ? addForm : h("p", { class: "hint" }, "Domains are added on the computer that runs Porchlight."),
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
						if (isOff(check)) return;
						setOff(check, true);
						try {
							const answer = await api("POST", "/investigate/verify", { domain: domain.name });
							state.domains = answer.domains;
							toast(answer.verified ? `${domain.name}: the record is in place` : `${domain.name}: the record was not found yet. DNS changes can take a few minutes.`, answer.verified ? "info" : "error");
							drawSetup();
						} catch (err) {
							toast(err instanceof Error ? err.message : String(err), "error");
							setOff(check, false);
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
		// The domain the address names (from Cloudflare or Domains), else the last run's, else the first (E-Q2).
		const again = runAgain;
		runAgain = null;
		const known = (/** @type {string | null | undefined} */ name) => (name && state.domains.some((domain) => domain.name === name) ? name : null);
		const chosenDomain = known(again?.domain) ?? known(route.params.get("domain")) ?? known(state.runs[0]?.domain) ?? state.domains[0]?.name ?? "";
		const domainSelect = /** @type {HTMLSelectElement} */ (h("select", { name: "domain", "aria-label": "Domain" }, ...state.domains.map((domain) => h("option", { value: domain.name, selected: domain.name === chosenDomain }, domain.name))));
		const goal = /** @type {HTMLTextAreaElement} */ (h("textarea", { name: "goal", rows: 3, maxLength: state.defaults.maxGoal, "aria-label": "Goal" }));
		goal.value = again?.goal ?? state.defaults.goal;
		const turns = /** @type {HTMLInputElement} */ (h("input", { type: "number", name: "turns", min: 1, max: state.defaults.maxTurnsLimit, value: String(Math.min(again?.maxTurns ?? state.defaults.maxTurns, state.defaults.maxTurnsLimit)), "aria-label": "Turns" }));
		// With a hosted model the page says above what is sent, and the button says where it goes: pressing it is the yes.
		const startButton = /** @type {HTMLButtonElement} */ (
			h(
				"button",
				{ type: "submit", class: "button primary", "aria-disabled": state.active !== null ? "true" : null, title: state.active !== null ? "One investigation runs at a time" : null },
				assistant.hosted ? `Start, sending to ${assistant.model}` : "Start investigation",
			)
		);
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
		// Why a run could not start, kept on the form with what to do, instead of a message that disappears.
		const startProblem = h("div", { "aria-live": "polite" });
		const approveEach = /** @type {HTMLInputElement} */ (h("input", { type: "radio", name: "approval", value: "each", checked: true }));
		const approveAll = /** @type {HTMLInputElement} */ (h("input", { type: "radio", name: "approval", value: "all" }));
		return h(
			"form",
			{
				class: "card",
				onsubmit: async (/** @type {SubmitEvent} */ event) => {
					event.preventDefault();
					if (isOff(startButton)) return;
					setOff(startButton, true);
					replace(startProblem);
					try {
						const answer = await api("POST", "/investigate/start", {
							domain: domainSelect.value,
							goal: goal.value,
							maxTurns: Number(turns.value),
							approveAll: approveAll.checked,
							...modelFields(assistant),
						});
						runId = undefined;
						if (route.isCurrent() && location.hash !== "#/investigate") history.replaceState(null, "", "#/investigate");
						state.active = answer.run;
						follow.now();
					} catch (err) {
						const text = err instanceof Error ? err.message : String(err);
						// The ownership record is not found: that is a job to do, so the steps are shown.
						if (err instanceof ApiError && err.status === 409 && /TXT record/.test(text)) replace(startProblem, ownershipHelp(domainSelect.value, `The ownership record for ${domainSelect.value} was not found`));
						else toast(text, "error");
						setOff(startButton, state.active !== null);
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
			assistant.hosted
				? h("p", { class: "hint" }, `Starting sends what the box above describes to ${assistant.model}, ${OUTSIDE}. Every step it takes is listed here and on the Activity page as it happens. To keep everything on your machines, choose a local model in Settings.`)
				: null,
			h("div", { class: "actions" }, startButton),
			startProblem,
		);
	}

	/**
	 * What to do when a domain's ownership record is not found: the steps, with where to go.
	 *
	 * @param {string} domain
	 * @param {string} title
	 */
	function ownershipHelp(domain, title) {
		const onCloudflare = store.cloudflare.report?.zones.some((zone) => zone.name === domain) === true;
		return h(
			"div",
			{ class: "banner banner-warning", role: "note" },
			icon("warning"),
			h(
				"div",
				null,
				h("strong", null, title),
				h("p", null, "Porchlight sends nothing to a domain until its DNS holds the record that proves it is yours. A record just added can take a few minutes to be seen."),
				h("ol", { class: "host-fix" }, ...ownershipSteps({ domain, onCloudflare }).map((step) => h("li", null, ...stepNodes(step)))),
				onCloudflare ? h("p", null, h("a", { class: "button", href: "#/cloudflare" }, "Open the Cloudflare page")) : null,
			),
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
				h("h2", { tabindex: "-1" }, `${run.domain}: ${runStatusWord(run)}`),
				live
					? h(
							"button",
							{
								type: "button",
								class: "button danger",
								onclick: async () => {
									await api("POST", "/investigate/stop").catch(() => {});
									follow.now();
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
			!live && run.status === "stopped" && /^Ownership/.test(run.ended ?? "") ? ownershipHelp(run.domain, "What to do about the ownership record") : null,
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
						runAgainButton(run),
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
			// The card goes once answered: focus goes to the run's heading rather than the top of the page (E-U2).
			try {
				await refresh();
			} catch {
				// The poll says so if Porchlight stopped answering.
			}
			/** @type {HTMLElement | null} */ (runSlot.querySelector(".investigate-run-head h2"))?.focus();
		};
		return h(
			"div",
			{ class: "banner banner-warning investigate-approval", role: "group", "aria-labelledby": "investigate-approval-title" },
			icon("warning"),
			h(
				"div",
				null,
				h("h3", { id: "investigate-approval-title", tabindex: "-1" }, "Approve this action?"),
				h("p", null, "It would be sent from this computer to your site exactly as shown:"),
				h("pre", { class: "investigate-pre" }, `${pending.tool} ${JSON.stringify(pending.args, null, 2)}`),
				pending.rationale ? h("p", { class: "generated-label" }, icon("spark"), `The model's reason: ${pending.rationale}`) : null,
				state.canChange
					? h(
							"div",
							null,
							// What "Approve all the rest" allows is listed, open, above the button that allows it (S29, invariant 20).
							h(
								"div",
								{ class: "investigate-rest" },
								h("p", { class: "hint" }, "\u201cApprove all the rest\u201d sends this request and every later one of this run without stopping to ask. Nothing else changes:"),
								h(
									"ul",
									{ class: "investigate-limits" },
									...runLimits({ tools: state.tools, domain: run.domain, maxTurns: run.maxTurns, minGapMs: run.minGapMs, turnsLeft: run.maxTurns - run.turns }).map((line) => h("li", null, line)),
								),
							),
							h(
								"div",
								{ class: "actions" },
								h("button", { type: "button", class: "button primary", onclick: () => void answer(true) }, "Approve"),
								h("button", { type: "button", class: "button", onclick: () => void answer(true, true) }, "Approve all the rest"),
								h("button", { type: "button", class: "button", onclick: () => void answer(false) }, "Deny"),
							),
						)
					: h("p", { class: "hint" }, "Approve it on the computer that runs Porchlight."),
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

	/**
	 * Follows a run while one is going: one request at a time, each after the last has answered (R6U-9),
	 * paused while the tab is hidden. While Porchlight does not answer, one notice says so (B49).
	 */
	const follow = poller({
		every: POLL_MS,
		tries: 30,
		visibility: pageVisibility(),
		run: async () => {
			// Only while something is running, or a run shown here might still change.
			if (!(state.active || wasActive)) return POLL_MS * 5;
			await refresh();
			return true;
		},
		onFailure: (err) => replace(offlineSlot, banner("error", "Lost touch with Porchlight", [err instanceof Error ? err.message : String(err), "The run goes on there. This page asks again, more slowly."])),
		onRecover: () => replace(offlineSlot),
		onGiveUp: (err) =>
			replace(
				offlineSlot,
				banner("error", "Lost touch with Porchlight", [err instanceof Error ? err.message : String(err)]),
				h("p", null, h("button", { type: "button", class: "button", onclick: () => (replace(offlineSlot), follow.now()) }, "Try again")),
			),
	});

	drawSetup();
	drawHistory();
	await drawRun();
	follow.start();
	return () => follow.stop();
}

