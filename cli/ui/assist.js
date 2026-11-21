// @ts-check
// Asking the local model, and showing what it wrote. The answer is plain text, built with `h()` like
// everything else, and always labelled as generated: the model reads attacker-controllable scan data,
// so what it writes is never trusted as markup and never acted on.
import { api, ApiError } from "./api.js";
import { followUpBox } from "./discussion.js";
import { announce, banner, h, icon, replace, stepNodes } from "./dom.js";
import { generatedLabel, localModelSetup, MAX_QUESTION, modelFields, paragraphs, questionProblem, waitingLabel } from "./generated.js";
import { answersPlace, retitle, showAnswer } from "./panel.js";

/** @typedef {import("./generated.js").AssistantSettings} AssistantSettings */
/** @typedef {{ start: string, busy: string, again: string, note?: string }} Labels */
/**
 * @typedef {(
 *   | { state: "idle" }
 *   | { state: "asking" }
 *   | { state: "done", text: string, model: string, cut?: string, follow: HTMLElement | null }
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

/** Every answer's redraw, so changing where answers appear moves the ones already given. */
/** @type {Set<() => void>} */
const redraws = new Set();

/** Puts every answer given so far where Settings → Appearance now says. */
export function redrawAnswers() {
	for (const redraw of redraws) redraw();
}

/**
 * The button whose question the model is answering, if any. The model answers one at a time, so
 * the other buttons wait, saying why, instead of being pressed and refused.
 */
/** @type {HTMLButtonElement | null} */
let answering = null;

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
	/** Stops the request that is waiting, when there is one. */
	/** @type {AbortController | null} */
	let stop = null;
	/** The answers panel's heading for this answer: what is being done, then the discussion's title. */
	/** @type {import("./panel.js").PanelHead} */
	let head = { title: labels.busy };
	const button = /** @type {HTMLButtonElement} */ (h("button", { type: submit ? "submit" : "button", class: "button", onclick: submit ? null : () => void run() }));
	// Where the answer belongs on the page. It holds the answer itself, or, when answers appear in the
	// answers panel, a line saying so with a link to bring this answer back there.
	const panel = h("section", { class: "assist", "aria-label": "Answer from the local model", hidden: true });
	// Not a live region: an answer can run to 1,500 words and is drawn again when answers move. Its arrival is said once (H-U1).
	const content = h("div", { class: "assist-content" });
	/** @type {Assist} */
	const self = { button, panel, run };
	draw();
	redraws.add(draw);
	return self;

	async function run() {
		if (state.state === "asking" || answering) return;
		state = { state: "asking" };
		head = { title: labels.busy };
		stop = new AbortController();
		answering = button;
		redrawAnswers();
		if (answersPlace() !== "below") showAnswer(self, content, head);
		try {
			const answer = await api("POST", path, { .../** @type {object} */ (body() ?? {}), ...modelFields(assistant) }, { signal: stop.signal });
			const model = typeof answer.model === "string" ? answer.model : modelName(assistant);
			const discussion = typeof answer.discussion === "string" ? answer.discussion : null;
			state = {
				state: "done",
				text: typeof answer.text === "string" ? answer.text : "",
				model,
				cut: typeof answer.cut === "string" ? answer.cut : undefined,
				// The answer is kept as a discussion: follow-up questions go under it, and it can be opened again later.
				follow: discussion
					? followUpBox({ id: discussion, model, host: assistant.host ?? "", hosted: assistant.hosted === true }, { link: answersPlace() === "below" })
					: null,
			};
			head = { title: typeof answer.title === "string" ? answer.title : labels.again, discussion };
		} catch (err) {
			if (err instanceof ApiError && err.body.stopped) {
				// Stopped by the owner: back to how it was, with nothing to report. The server stops the model too.
				state = { state: "idle" };
				head = { title: labels.start };
			} else {
				state = { state: "failed", error: err instanceof Error ? err.message : String(err) };
				head = { title: "The model could not answer" };
			}
		}
		stop = null;
		answering = null;
		redrawAnswers();
		retitle(self, head);
		if (state.state === "done") announce(`${state.model} answered. ${answersPlace() === "below" ? "The answer is below the button." : "The answer is in the answers panel."}`);
		else if (state.state === "failed") announce("The model could not answer");
	}

	function draw() {
		// aria-disabled, so the button that was pressed keeps keyboard focus while it waits.
		const waiting = state.state === "asking" || (answering !== null && answering !== button);
		if (waiting) button.setAttribute("aria-disabled", "true");
		else button.removeAttribute("aria-disabled");
		button.title = answering !== null && answering !== button ? "The model is answering another question. This one can be asked when it has finished." : "";
		replace(button, icon("spark"), state.state === "asking" ? labels.busy : state.state === "done" ? labels.again : labels.start);
		if (state.state === "asking") {
			replace(
				content,
				h("p", { class: "assist-wait" }, icon("pending"), waitingLabel(modelName(assistant))),
				h("button", { type: "button", class: "button", onclick: () => stop?.abort() }, "Stop"),
			);
		} else if (state.state === "done") {
			replace(content, generatedText(state.text, state.model, [labels.note, state.cut]), state.follow);
		} else if (state.state === "failed") {
			replace(content, banner("error", "The local model could not answer", [state.error]), h("button", { type: "button", class: "button", onclick: () => void run() }, "Try again"));
		} else {
			replace(content);
		}
		panel.hidden = state.state === "idle";
		if (answersPlace() === "below") {
			replace(panel, content);
			return;
		}
		replace(
			panel,
			h(
				"p",
				{ class: "assist-elsewhere" },
				icon("spark"),
				state.state === "asking" ? `${labels.busy} The answer shows in the answers panel. ` : "The answer is in the answers panel. ",
				h("button", { type: "button", class: "link-button", onclick: () => showAnswer(self, content, head) }, "Show it"),
			),
		);
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
			h("span", { class: "hint block" }, "A model, on this computer, on a server of yours or through an API, can explain a finding, summarise the roadmap, analyse findings against your code and answer questions about a scan."),
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
