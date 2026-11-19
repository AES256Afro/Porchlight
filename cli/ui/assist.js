// @ts-check
// Asking the local model, and showing what it wrote. The answer is plain text, built with `h()` like
// everything else, and always labelled as generated: the model reads attacker-controllable scan data,
// so what it writes is never trusted as markup and never acted on.
import { api } from "./api.js";
import { banner, h, icon, replace, stepNodes } from "./dom.js";
import { generatedLabel, localModelSetup, MAX_QUESTION, paragraphs, questionProblem, waitingLabel } from "./generated.js";

/** @typedef {import("./generated.js").AssistantSettings} AssistantSettings */
/** @typedef {{ start: string, busy: string, again: string, note?: string }} Labels */
/**
 * @typedef {(
 *   | { state: "idle" }
 *   | { state: "asking" }
 *   | { state: "done", text: string, model: string, cut?: string }
 *   | { state: "failed", error: string }
 * )} AssistState
 */
/** @typedef {{ button: HTMLButtonElement, panel: HTMLElement, run: () => Promise<void> }} Assist */

/**
 * Requests made while the page is open, by what they ask about. A list that redraws, or a page
 * visited again, gets back the same button and panel, and so the answer it already has.
 *
 * @type {Map<string, Assist>}
 */
const kept = new Map();
/** @type {Map<string, HTMLElement>} */
const askCards = new Map();

/**
 * A button that asks the local model, and the panel that shows the answer. The same `key` returns
 * the same pair, so place them anew on every redraw.
 *
 * @param {string} key what is being asked about, including the scan it comes from
 * @param {string} path the API route, for example "/assist/finding"
 * @param {AssistantSettings} assistant
 * @param {Labels} labels the button's words before, during and after
 * @param {() => unknown} body the request body, read when the button is pressed
 * @returns {Assist}
 */
export function assistAction(key, path, assistant, labels, body) {
	let entry = kept.get(key);
	if (!entry) {
		entry = createAssist(path, assistant, labels, body, false);
		kept.set(key, entry);
	}
	return entry;
}

/**
 * @param {string} path
 * @param {AssistantSettings} assistant
 * @param {Labels} labels
 * @param {() => unknown} body
 * @param {boolean} submit the button submits the form it sits in, which then calls `run`
 * @returns {Assist}
 */
function createAssist(path, assistant, labels, body, submit) {
	/** @type {AssistState} */
	let state = { state: "idle" };
	const button = /** @type {HTMLButtonElement} */ (h("button", { type: submit ? "submit" : "button", class: "button", onclick: submit ? null : () => void run() }));
	const panel = h("section", { class: "assist", "aria-live": "polite", "aria-label": "Answer from the local model", hidden: true });
	draw();
	return { button, panel, run };

	async function run() {
		if (state.state === "asking") return;
		state = { state: "asking" };
		draw();
		try {
			const answer = await api("POST", path, body());
			state = {
				state: "done",
				text: typeof answer.text === "string" ? answer.text : "",
				model: typeof answer.model === "string" ? answer.model : modelName(assistant),
				cut: typeof answer.cut === "string" ? answer.cut : undefined,
			};
		} catch (err) {
			state = { state: "failed", error: err instanceof Error ? err.message : String(err) };
		}
		draw();
	}

	function draw() {
		button.disabled = state.state === "asking";
		replace(button, icon("spark"), state.state === "asking" ? labels.busy : state.state === "done" ? labels.again : labels.start);
		panel.hidden = state.state === "idle";
		if (state.state === "asking") {
			replace(panel, h("p", { class: "assist-wait" }, icon("pending"), waitingLabel(modelName(assistant))));
		} else if (state.state === "done") {
			replace(panel, generatedText(state.text, state.model, [labels.note, state.cut]));
		} else if (state.state === "failed") {
			replace(panel, banner("error", "The local model could not answer", [state.error]), h("button", { type: "button", class: "button", onclick: () => void run() }, "Try again"));
		} else {
			replace(panel);
		}
	}
}

/**
 * Text the local model wrote, labelled as generated. Plain text only: paragraphs split on blank
 * lines, line breaks kept, nothing parsed as markup.
 *
 * @param {string} text
 * @param {string} model
 * @param {(string | undefined)[]} [notes] said under the label, such as what part of the scan the model saw
 */
export function generatedText(text, model, notes = []) {
	return h(
		"div",
		{ class: "generated" },
		h("p", { class: "generated-label" }, icon("spark"), generatedLabel(model)),
		...notes.filter((note) => note).map((note) => h("p", { class: "hint" }, note)),
		h("div", { class: "generated-text" }, ...paragraphs(text).map((paragraph) => h("p", null, paragraph))),
	);
}

/**
 * The Overview's "Ask about this scan" card. One per report: a new scan starts a fresh card, and
 * coming back to the page shows the last question and its answer.
 *
 * @param {string} key the report the questions are about
 * @param {AssistantSettings} assistant
 */
export function askCard(key, assistant) {
	const existing = askCards.get(key);
	if (existing) return existing;
	let question = "";
	const input = /** @type {HTMLTextAreaElement} */ (
		h("textarea", {
			name: "question",
			rows: 3,
			maxLength: MAX_QUESTION,
			required: true,
			"aria-label": "Question about this scan",
			placeholder: "Which repository should I fix first? Are any of the secrets outside test files?",
		})
	);
	const error = h("p", { class: "form-error", role: "alert", hidden: true });
	const ask = createAssist("/assist/ask", assistant, { start: "Ask", busy: "Asking…", again: "Ask" }, () => ({ question }), true);
	const card = h(
		"div",
		{ class: "card full" },
		h("h2", null, "Ask about this scan"),
		h("p", { class: "sub" }, `Answered by ${modelName(assistant)} from the stored report only. It sees what this page shows, never secret values.`),
		h(
			"form",
			{
				class: "ask-form",
				onsubmit: (/** @type {SubmitEvent} */ event) => {
					event.preventDefault();
					const problem = questionProblem(input.value);
					error.hidden = problem === null;
					replace(error, problem ?? "");
					if (problem !== null) return;
					question = input.value.trim();
					void ask.run();
				},
			},
			input,
			error,
			h("div", { class: "ask-row" }, h("span", { class: "hint" }, `Up to ${MAX_QUESTION} characters.`), ask.button),
		),
		ask.panel,
	);
	askCards.set(key, card);
	return card;
}

/**
 * How to connect a local model, shown where the features would be when none is configured.
 *
 * @param {AssistantSettings | null | undefined} assistant
 * @param {boolean} service
 */
export function localModelCard(assistant, service) {
	const setup = localModelSetup(assistant, service);
	return h(
		"div",
		{ class: "card full" },
		h("h2", null, "Model"),
		h(
			"p",
			null,
			h("span", { class: "severity status-pending" }, icon("pending"), "Not connected"),
			h("span", { class: "hint block" }, "A model, on this Mac, on a server of yours or through an API, can explain a finding, summarise the roadmap, analyse findings against your code and answer questions about a scan."),
		),
		setup.reason ? h("p", null, ...stepNodes(setup.reason), ".") : null,
		...setup.steps.map((step) => h("p", null, ...stepNodes(step))),
		setup.commands ? h("pre", null, h("code", null, setup.commands)) : null,
		service ? null : h("p", null, h("a", { class: "button primary", href: "#/settings" }, "Choose a model")),
		h("p", { class: "hint" }, "It only ever sees what these pages show: never secret values, authors or emails."),
	);
}

/** @param {AssistantSettings} assistant */
function modelName(assistant) {
	return assistant.model ?? "the local model";
}
