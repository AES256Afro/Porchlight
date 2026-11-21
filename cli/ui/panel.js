// @ts-check
// The answers panel: where a model's answer and the follow-ups under it show, beside the page or in
// a drawer under it (Settings → Appearance), instead of below the button that asked. It lives
// outside the page, so it stays open while the owner moves between pages. It shows one answer at a
// time; the button that asked keeps a "Show it" link to bring its answer back. On a narrow screen it
// covers the page, with a button to close it. It only moves answers: it never hides a finding.
import { h, icon, replace } from "./dom.js";
import { DEFAULT_ANSWER_PLACE, isAnswerPlace } from "./looks.js";
import { store } from "./store.js";

/** @typedef {{ title: string, discussion?: string | null }} PanelHead */

/** Where answers appear now: "right", "below" or "bottom". */
export function answersPlace() {
	const place = store.settings?.answers;
	return isAnswerPlace(place) ? /** @type {string} */ (place) : DEFAULT_ANSWER_PLACE;
}

/** The answer on show, by who asked for it, so a later redraw of that answer updates the panel. */
/** @type {{ owner: object, body: HTMLElement, head: PanelHead } | null} */
let current = null;
let wide = false;
/** Where focus was when the panel opened, so Close gives it back there (H-U2). @type {HTMLElement | null} */
let returnTo = null;

function element() {
	return /** @type {HTMLElement | null} */ (document.getElementById("answers"));
}

/**
 * Shows an answer in the panel, in place of the one there before.
 *
 * @param {object} owner whoever asked: the same object for the same answer
 * @param {HTMLElement} body the answer, its follow-ups, or the wait for them; moved into the panel
 * @param {PanelHead} head
 */
export function showAnswer(owner, body, head) {
	const panel = element();
	if (!panel) return;
	const opening = panel.hidden || current?.owner !== owner;
	if (opening && !(document.activeElement instanceof Node && panel.contains(document.activeElement))) {
		returnTo = document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;
	}
	current = { owner, body, head };
	draw(panel);
	panel.hidden = false;
	document.body.dataset.answers = answersPlace();
	document.body.classList.add("answers-open");
	// Focus moves into the panel, so a keyboard or screen-reader user is where the answer is; on a narrow screen it covers the page.
	if (opening) /** @type {HTMLElement | null} */ (panel.querySelector(".answers-title"))?.focus({ preventScroll: true });
}

/**
 * The title and discussion of an answer on show, once the answer has come.
 *
 * @param {object} owner
 * @param {PanelHead} head
 */
export function retitle(owner, head) {
	if (current?.owner !== owner) return;
	current.head = head;
	const panel = element();
	if (panel) draw(panel);
}

/** @param {object} owner */
export function isShowing(owner) {
	return current?.owner === owner && !element()?.hidden;
}

export function closeAnswers() {
	const panel = element();
	const hadFocus = panel !== null && document.activeElement instanceof Node && panel.contains(document.activeElement);
	if (panel) {
		panel.hidden = true;
		replace(panel);
	}
	current = null;
	document.body.classList.remove("answers-open");
	// Focus goes back to what opened the panel, if it is still on the page, rather than to the top of it.
	if (hadFocus) (returnTo?.isConnected ? returnTo : /** @type {HTMLElement | null} */ (document.getElementById("view")))?.focus({ preventScroll: true });
	returnTo = null;
}

/** After the place changes in Settings: "below" closes the panel; another place moves it there. */
export function answersPlaceChanged() {
	if (answersPlace() === "below") return closeAnswers();
	const panel = element();
	if (!current || !panel || panel.hidden) return;
	document.body.dataset.answers = answersPlace();
	draw(panel);
}

/** @param {HTMLElement} panel */
function draw(panel) {
	if (!current) return;
	const { head, body } = current;
	const widen = /** @type {HTMLButtonElement} */ (
		h(
			"button",
			{
				type: "button",
				class: "button answers-widen",
				"aria-pressed": String(wide),
				onclick: () => {
					wide = !wide;
					document.body.classList.toggle("answers-wide", wide);
					widen.setAttribute("aria-pressed", String(wide));
					replace(widen, wide ? "Narrower" : "Wider");
				},
			},
			wide ? "Narrower" : "Wider",
		)
	);
	replace(
		panel,
		h(
			"div",
			{
				class: "answers-head",
				// Escape closes the panel from anywhere inside it.
				onkeydown: (/** @type {KeyboardEvent} */ event) => {
					if (event.key === "Escape") closeAnswers();
				},
			},
			h("h2", { class: "answers-title", tabindex: "-1" }, icon("spark"), head.title),
			h(
				"div",
				{ class: "answers-tools" },
				head.discussion ? h("a", { class: "button", href: `#/discussions/${head.discussion}`, onclick: () => closeAnswers() }, "Open in Discussions") : null,
				answersPlace() === "right" ? widen : null,
				h("button", { type: "button", class: "button", "aria-label": "Close the answer", onclick: () => closeAnswers() }, icon("close"), "Close"),
			),
		),
		h(
			"div",
			{
				class: "answers-body",
				onkeydown: (/** @type {KeyboardEvent} */ event) => {
					if (event.key === "Escape" && !(event.target instanceof HTMLTextAreaElement && event.target.value)) closeAnswers();
				},
			},
			body,
		),
	);
	document.body.classList.toggle("answers-wide", wide && answersPlace() === "right");
}
