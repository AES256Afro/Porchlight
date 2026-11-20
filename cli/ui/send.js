// @ts-check
// "Send to a model": the roadmap or the findings go to a model the owner picks (one on this
// computer, one of theirs on another, or a hosted one such as Claude), for a deeper analysis or a
// repair plan. The page names the model by Porchlight's own id and what to send; the server builds
// the data from its own copy of the report. The answer is shown as generated text and never acted on:
// to carry out a repair plan, the owner copies it to a coding assistant or follows it by hand.
import { api } from "./api.js";
import { generatedText } from "./assist.js";
import { followUpBox } from "./discussion.js";
import { banner, h, icon, replace, stepNodes, toast } from "./dom.js";
import { isFiltering } from "./filter.js";
import { paramsFromFilter } from "./list.js";
import { sendFilename, sendTargetNote, sendText } from "./send-text.js";
import { store } from "./store.js";

/** @typedef {import("./filter.js").FindingFilter} FindingFilter */
/** @typedef {import("./send-text.js").SendTarget} SendTarget */

const CONTENTS = /** @type {const} */ ([
	["roadmap", "Repair roadmap", "The actions, most pressing first, with the steps for each and the findings it clears."],
	["findings", "Findings with suggested fixes", "Every finding, most severe first, each with its repair."],
]);

const PURPOSES = /** @type {const} */ ([
	["analyse", "Deeper analysis", "Overall risk, patterns across repositories, what looks real and what looks like noise, and what to do first."],
	["repair", "Repair plan", "Step by step: the file, the command or the edit, what could break and how to check it. Copy it to a coding assistant such as Claude Code to carry it out."],
]);

/** The models the server offers, the one in use first. */
export function sendTargets() {
	return /** @type {SendTarget[]} */ (store.settings?.sendTargets ?? []);
}

/**
 * The button beside Export.
 *
 * @param {() => void} onClick
 * @param {boolean} [disabled]
 */
export function sendButton(onClick, disabled = false) {
	const none = sendTargets().length === 0;
	return h(
		"button",
		{ type: "button", class: "button", disabled: disabled || none, title: none ? "Set up a model under Settings → Model first" : null, onclick: onClick },
		icon("spark"),
		"Send to model",
	);
}

/**
 * Asks which model, what to send and what to ask for, then shows the answer in the dialog.
 *
 * @param {{ filter: FindingFilter, shown: number, total: number }} target the scan with the page's current filter
 * @param {"roadmap" | "findings"} [initialContent]
 */
export function openSendDialog(target, initialContent = "roadmap") {
	const filtering = isFiltering(target.filter);
	const models = sendTargets();
	const preferred = models.find((model) => model.current) ?? models[0];

	/**
	 * @param {string} name
	 * @param {readonly (readonly [string, string, string])[]} options
	 * @param {string} checked
	 */
	const choices = (name, options, checked) =>
		options.map(([value, label, hint]) =>
			h(
				"label",
				{ class: "choice" },
				h("input", { type: "radio", name, value, checked: value === checked }),
				h("span", null, h("strong", null, label), hint ? h("span", { class: "hint" }, hint) : null),
			),
		);

	const error = h("p", { class: "form-error", role: "alert", hidden: true });
	const result = h("section", { class: "assist send-result", "aria-live": "polite", "aria-label": "Answer from the model", hidden: true });
	const submit = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "button primary" }, icon("spark"), "Send"));
	const form = /** @type {HTMLFormElement} */ (
		h(
			"form",
			{ method: "dialog", onsubmit: send },
			h("h2", { id: "send-title" }, "Send to a model"),
			models.length === 0
				? h("p", null, ...stepNodes("No model is set up yet. Choose one under Settings → Model; every model you set up there is offered here."))
				: h(
						"fieldset",
						null,
						h("legend", null, "Model"),
						...models.map((model) =>
							h(
								"label",
								{ class: "choice" },
								h("input", { type: "radio", name: "target", value: model.id, checked: model === preferred }),
								h("span", null, h("strong", null, model.label), h("span", { class: "hint" }, sendTargetNote(model))),
							),
						),
						h("p", { class: "hint" }, ...stepNodes("Every model you set up under Settings → Model is offered here.")),
					),
			h("fieldset", null, h("legend", null, "What to send"), ...choices("content", CONTENTS, initialContent)),
			filtering
				? h(
						"fieldset",
						null,
						h("legend", null, "How much"),
						...choices(
							"scope",
							[
								["filtered", `Only what the filters show (${target.shown.toLocaleString()} findings)`, "The model is told it sees only part of the scan."],
								["all", `Everything in the scan (${target.total.toLocaleString()} findings)`, ""],
							],
							"filtered",
						),
					)
				: null,
			h("fieldset", null, h("legend", null, "Ask for"), ...choices("purpose", PURPOSES, "analyse")),
			h("p", { class: "hint" }, "It sees what these pages show: never secret values, authors or emails. Its answer is advice to check; Porchlight changes nothing."),
			error,
			result,
			h("div", { class: "actions" }, h("button", { type: "button", class: "button", onclick: () => dialog.close() }, "Close"), models.length > 0 ? submit : null),
		)
	);
	const dialog = /** @type {HTMLDialogElement} */ (h("dialog", { class: "dialog wide send", "aria-labelledby": "send-title", onclose: () => dialog.remove(),
			// A link to Settings leaves the dialog for that page.
			onclick: (/** @type {MouseEvent} */ event) => {
				if (event.target instanceof Element && event.target.closest("a[href^='#']")) dialog.close();
			},
		}, form));

	/** @param {SubmitEvent} event */
	async function send(event) {
		event.preventDefault();
		const chosen = new FormData(form);
		const model = models.find((candidate) => candidate.id === chosen.get("target"));
		if (!model) return;
		/** @type {Record<string, string>} */
		const request = { target: model.id, content: String(chosen.get("content")), purpose: String(chosen.get("purpose")) };
		if (filtering && chosen.get("scope") === "filtered") Object.assign(request, paramsFromFilter(target.filter));
		submit.disabled = true;
		replace(submit, icon("pending"), "Sending…");
		error.hidden = true;
		result.hidden = false;
		const started = Date.now();
		const tick = () => {
			const seconds = Math.round((Date.now() - started) / 1000);
			replace(
				result,
				h(
					"p",
					{ class: "assist-wait" },
					icon("pending"),
					`Waiting for ${model.model}: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} so far.${model.hosted ? "" : " A model on a processor can take several minutes."} Keep this open until it answers.`,
				),
			);
		};
		tick();
		const timer = setInterval(tick, 1000);
		try {
			const answer = await api("POST", "/repos/send", request);
			const text = typeof answer.text === "string" ? answer.text : "";
			const notes = [
				typeof answer.partial === "string" ? `Sent only part of the scan: ${answer.partial}.` : undefined,
				typeof answer.cut === "string" ? answer.cut : undefined,
			];
			const saved = sendText(text, { model: model.model, label: model.label, content: request.content, purpose: request.purpose, notes, scannedAt: store.report?.scannedAt ?? "" });
			replace(
				result,
				generatedText(text, model.model, notes),
				h(
					"div",
					{ class: "actions" },
					h("button", { type: "button", class: "button", onclick: () => void copy(saved) }, icon("copy"), "Copy"),
					h("button", { type: "button", class: "button", onclick: () => save(saved, request.purpose) }, icon("download"), "Save as text"),
				),
				// Kept as a discussion: follow-up questions about this answer go to the same model.
				typeof answer.discussion === "string" ? followUpBox({ id: answer.discussion, model: model.model, host: model.host, hosted: model.hosted }, { link: true }) : null,
			);
		} catch (err) {
			replace(result, banner("error", "The model could not answer", [err instanceof Error ? err.message : String(err)]));
		} finally {
			clearInterval(timer);
			submit.disabled = false;
			replace(submit, icon("spark"), "Send again");
		}
	}

	/** @param {string} text */
	async function copy(text) {
		try {
			await navigator.clipboard.writeText(text);
			toast("Copied");
		} catch {
			toast("Could not copy. Select the text and copy it instead", "error");
		}
	}

	/**
	 * Plain text, so nothing in the model's words is rendered as markup where it is opened.
	 *
	 * @param {string} text
	 * @param {string} purpose
	 */
	function save(text, purpose) {
		const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = sendFilename(purpose, store.report?.scannedAt ?? "");
		document.body.append(link);
		link.click();
		link.remove();
		setTimeout(() => URL.revokeObjectURL(url), 10_000);
		toast(`Saved ${link.download}`);
	}

	document.body.append(dialog);
	dialog.showModal();
}
