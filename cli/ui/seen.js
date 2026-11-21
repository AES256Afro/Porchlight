// @ts-check
// "First seen" and "Due" beside a finding (R6Q-9, FT-14), and the card under Settings where the owner
// sets the due dates. Both only show: neither changes a severity, a count, the roadmap or an export.
import { api } from "./api.js";
import { h, replace, toast } from "./dom.js";
import { DUE_SEVERITIES, dueState, dueWords, MAX_DUE_DAYS, seenWords } from "./due.js";
import { store } from "./store.js";
import { findingKey } from "./tracking.js";

/** @typedef {import("./due.js").DuePolicy} DuePolicy */
/** @typedef {{ scannedAt: string | null, seen: Record<string, { first: string, onOrBefore?: boolean }>, policy: DuePolicy }} SeenAnswer */

/** @type {{ scannedAt: string | undefined, answer: Promise<SeenAnswer> } | null} */
let cached = null;

/** The dates for the report on the page, asked once per report. */
function seenOnce() {
	const scannedAt = store.report?.scannedAt;
	if (!cached || cached.scannedAt !== scannedAt) {
		const answer = /** @type {Promise<SeenAnswer>} */ (api("GET", "/findings/seen"));
		cached = { scannedAt, answer };
		// A failure is not kept, so the next finding opened asks again.
		answer.catch(() => {
			if (cached?.answer === answer) cached = null;
		});
	}
	return cached.answer;
}

/** Asked again next time: after the due dates change. */
export function forgetSeen() {
	cached = null;
}

/**
 * "First seen" and "Due" rows for a finding's facts, filled in once the dates arrive. They stay hidden
 * when the date is not known: nothing is guessed.
 *
 * @param {string} repo
 * @param {{ ruleId: string, location: string, detail: string, severity: import("./due.js").Severity }} finding
 * @returns {HTMLElement[]}
 */
export function seenFacts(repo, finding) {
	const rows = [h("dt", { hidden: true }, "First seen"), h("dd", { hidden: true }), h("dt", { hidden: true }, "Due"), h("dd", { hidden: true })];
	const [seenTitle, seenValue, dueTitle, dueValue] = rows;
	void seenOnce()
		.then((answer) => {
			const seen = answer.seen[findingKey(repo, finding)];
			if (!seen || !seenTitle || !seenValue || !dueTitle || !dueValue) return;
			replace(seenValue, seenWords(seen));
			seenTitle.hidden = false;
			seenValue.hidden = false;
			const state = dueState(seen.first, finding.severity, answer.policy);
			if (!state) return;
			replace(dueValue, h("span", { class: state.overdue ? "due overdue" : "due" }, dueWords(state)));
			dueTitle.hidden = false;
			dueValue.hidden = false;
		})
		.catch(() => {});
	return rows;
}

/** Settings → Due dates: how many days a finding of each severity may stay open. */
export function dueSection() {
	const body = h("div", null, h("p", { class: "loading" }, "Loading…"));
	const section = h(
		"section",
		{ id: "settings-due", tabindex: "-1", class: "card full", "aria-labelledby": "settings-due-title" },
		h("h2", { id: "settings-due-title" }, "Due dates"),
		h("p", { class: "sub" }, "How long a finding of each severity may stay open, counted from the day a scan first found it. A due date is shown beside the finding; it never changes its severity, a count or an export."),
		body,
	);
	void draw();
	return section;

	async function draw() {
		try {
			const answer = /** @type {{ policy: DuePolicy, defaults: DuePolicy }} */ (await api("GET", "/findings/due-policy"));
			/** @type {Record<string, HTMLInputElement>} */
			const inputs = {};
			const fields = DUE_SEVERITIES.map((severity) => {
				const input = /** @type {HTMLInputElement} */ (
					h("input", { type: "number", min: "1", max: String(MAX_DUE_DAYS), step: "1", inputmode: "numeric", id: `due-${severity}`, value: answer.policy[severity] === null ? "" : String(answer.policy[severity]), placeholder: "No due date" })
				);
				inputs[severity] = input;
				return h("div", { class: "field" }, h("label", { for: `due-${severity}` }, `${severity[0]?.toUpperCase()}${severity.slice(1)}: days`), input);
			});
			const save = async (/** @type {boolean} */ reset) => {
				/** @type {Record<string, number | null>} */
				const policy = {};
				for (const severity of DUE_SEVERITIES) {
					const text = inputs[severity]?.value.trim() ?? "";
					policy[severity] = text === "" ? null : Number(text);
				}
				try {
					await api("POST", "/findings/due-policy", reset ? { reset: true } : { policy });
					forgetSeen();
					toast(reset ? "Due dates: back to the defaults" : "Due dates saved");
					await draw();
				} catch (err) {
					toast(err instanceof Error ? err.message : String(err), "error");
				}
			};
			replace(
				body,
				h("div", { class: "due-fields" }, ...fields),
				h(
					"div",
					{ class: "actions" },
					h("button", { type: "button", class: "button primary", onclick: () => void save(false) }, "Save due dates"),
					h("button", { type: "button", class: "button", onclick: () => void save(true) }, "Use the defaults"),
				),
				h("p", { class: "hint" }, `Defaults: ${DUE_SEVERITIES.map((severity) => `${severity} ${answer.defaults[severity] === null ? "none" : `${answer.defaults[severity]} days`}`).join(", ")}.`),
			);
		} catch (err) {
			replace(body, h("p", { class: "form-error" }, err instanceof Error ? err.message : String(err)));
		}
	}
}
