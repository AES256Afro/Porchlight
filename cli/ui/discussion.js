// @ts-check
// One discussion with a model: its answers and a box for a follow-up question. It sits under an
// answer where it was asked (Explain, Summarise, Ask, Send to a model) and on the Discussions page.
// The page sends only the discussion's id and the owner's question; the server rebuilds the data the
// model reads (invariant 13). Every answer is generated text, built with h(), and never acted on.
import { api, ApiError } from "./api.js";
import { generatedText } from "./assist.js";
import { banner, h, icon, replace, setOff, stepNodes } from "./dom.js";
import { MAX_QUESTION, questionProblem, waitingLabel } from "./generated.js";

/** @typedef {import("../src/discussions/discussions.ts").DiscussionTurn} Turn */
/** @typedef {{ id: string, model: string, host: string, hosted: boolean }} DiscussionRef */

/**
 * One turn: the owner's question, if there was one, and the model's answer, labelled as generated.
 *
 * @param {Turn} turn
 * @param {(string | undefined)[]} [notes] said under the answer's label
 * @returns {Node[]}
 */
export function turnNodes(turn, notes = []) {
	return [
		turn.question ? h("div", { class: "turn-question" }, h("p", { class: "turn-who" }, "You"), h("p", { class: "turn-text" }, turn.question)) : null,
		generatedText(turn.answer, turn.model, [turn.note, ...notes]),
	].filter((node) => node !== null);
}

/**
 * The follow-ups asked so far and a form to ask another. `blocked`: why no follow-up can be asked
 * (a newer scan, the model no longer set up), shown in place of the form.
 *
 * @param {DiscussionRef} discussion
 * @param {{ turns?: Turn[], blocked?: string | null, link?: boolean, onTurn?: (turn: Turn) => void }} [options]
 */
export function followUpBox(discussion, options = {}) {
	const thread = h("div", { class: "turns" }, ...(options.turns ?? []).flatMap((turn) => turnNodes(turn)));
	const status = h("div", { class: "follow-up-status", "aria-live": "polite" });
	const link = options.link
		? h("p", { class: "hint" }, h("a", { href: `#/discussions/${discussion.id}` }, "Open in Discussions"), ". Kept on this computer after Porchlight closes.")
		: null;
	if (options.blocked) return h("div", { class: "follow-up" }, thread, h("p", { class: "hint follow-up-blocked" }, ...stepNodes(options.blocked)), link);

	const input = /** @type {HTMLTextAreaElement} */ (
		h("textarea", {
			name: "follow-up",
			rows: 2,
			maxLength: MAX_QUESTION,
			required: true,
			"aria-label": "Follow-up question",
			placeholder: "Ask a follow-up question about this answer",
			onkeydown: (/** @type {KeyboardEvent} */ event) => {
				// ⌘↩ or Ctrl+↩ sends, as in a chat.
				if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
					event.preventDefault();
					form.requestSubmit();
				}
			},
		})
	);
	const error = h("p", { class: "form-error", role: "alert", hidden: true });
	const button = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "button" }, icon("spark"), "Ask"));
	const where = discussion.hosted
		? `Your question and this discussion go to ${discussion.host}, outside your machines.`
		: `Answered by ${discussion.model} at ${discussion.host}, from the same data as the first answer.`;
	const form = /** @type {HTMLFormElement} */ (
		h(
			"form",
			{
				class: "ask-form follow-up-form",
				onsubmit: (/** @type {SubmitEvent} */ event) => {
					event.preventDefault();
					const problem = questionProblem(input.value);
					error.hidden = problem === null;
					replace(error, problem ?? "");
					if (problem === null) void ask(input.value.trim());
				},
			},
			input,
			error,
			h("div", { class: "ask-row" }, h("span", { class: "hint" }, where), button),
		)
	);

	/** @param {string} question */
	async function ask(question) {
		// aria-disabled and read-only rather than disabled: focus stays where it was while the model answers.
		setOff(button, true);
		input.readOnly = true;
		replace(status, h("div", { class: "turn-question" }, h("p", { class: "turn-who" }, "You"), h("p", { class: "turn-text" }, question)), h("p", { class: "assist-wait" }, icon("pending"), waitingLabel(discussion.model)));
		try {
			const answer = await api("POST", "/discussions/ask", { id: discussion.id, question });
			const turn = /** @type {Turn} */ (answer.turn);
			replace(status);
			thread.append(...turnNodes(turn));
			input.value = "";
			options.onTurn?.(turn);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			replace(status, banner("error", "The model could not answer", [message]));
			// A newer scan, or the model gone: no follow-up can succeed, so the form goes.
			if (err instanceof ApiError && err.status === 409 && !/still answering|waiting for an answer/.test(message)) {
				form.remove();
				return;
			}
		} finally {
			setOff(button, false);
			input.readOnly = false;
		}
		input.focus();
	}

	return h("div", { class: "follow-up" }, thread, status, form, link);
}
