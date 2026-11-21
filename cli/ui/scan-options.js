// @ts-check
// The scan form's Options: a preset, the switches under it, and what Deep hands to the model. The
// controls are made once and kept in step with the choices, so a change never moves keyboard focus.
import { h, replace, stepNodes } from "./dom.js";
import { analysisNotice } from "./generated.js";
import { MAX_HISTORY_COMMITS, parseSkip, PRESETS, presetChoices, presetOf } from "./scan-choices.js";
import { store } from "./store.js";

/** @typedef {import("../src/repos/types.ts").ScanChoices} ScanChoices */

/** How many commits "the latest commits" offers before the owner types another number. */
const RECENT_DEFAULT = 200;

/**
 * @param {ScanChoices} initial
 * @param {HTMLElement} depthField the folder-levels field the form already has, placed among the switches
 * @param {(choices: ScanChoices) => void} onChange called after every change, with the choices as they now are
 */
export function scanOptions(initial, depthField, onChange) {
	let choices = { ...initial, skip: [...initial.skip] };

	const presetInputs = PRESETS.map(({ key }) => /** @type {HTMLInputElement} */ (h("input", { type: "radio", name: "scan-preset", value: key })));
	const customNote = h("p", { class: "hint" }, "The switches below no longer match a preset, so this scan is Custom.");
	const secretsBox = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", name: "secrets" }));
	const dependenciesBox = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", name: "dependencies" }));
	const privateBox = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", name: "private-data" }));
	const historySelect = /** @type {HTMLSelectElement} */ (
		h(
			"select",
			{ name: "history" },
			h("option", { value: "all" }, "Every commit on every branch"),
			h("option", { value: "recent" }, "The latest commits, and the files as they are now"),
			h("option", { value: "none" }, "No history: the files as they are now"),
		)
	);
	const countInput = /** @type {HTMLInputElement} */ (h("input", { type: "number", name: "commits", min: "1", max: String(MAX_HISTORY_COMMITS), class: "narrow", value: String(RECENT_DEFAULT) }));
	const countField = h("label", { class: "field" }, h("span", null, "How many of the latest commits"), countInput);
	const localBox = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", name: "local-files" }));
	const analyseBox = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", name: "analyse" }));
	const analyseNote = h("div", { class: "hint", "aria-live": "polite" });
	const skipInput = /** @type {HTMLInputElement} */ (h("input", { type: "text", name: "skip", spellcheck: false, autocomplete: "off", placeholder: "old-site, github/me/archive" }));

	for (const input of presetInputs) input.addEventListener("change", () => input.checked && setPreset(/** @type {import("./scan-choices.js").Preset} */ (input.value)));
	for (const control of [secretsBox, dependenciesBox, privateBox, historySelect, countInput, localBox, analyseBox]) control.addEventListener("change", fromControls);
	// A half-typed name is not acted on: the list is read once the box is left or Enter is pressed.
	skipInput.addEventListener("change", fromControls);

	const node = h(
		"div",
		{ class: "scan-options" },
		h(
			"fieldset",
			null,
			h("legend", null, "How deep to look"),
			...PRESETS.map(({ label, words }, index) => h("label", { class: "choice" }, presetInputs[index], h("span", null, h("strong", null, label), h("span", { class: "hint" }, words)))),
			customNote,
		),
		h(
			"fieldset",
			null,
			h("legend", null, "Checks"),
			h("label", { class: "choice" }, secretsBox, h("span", null, h("strong", null, "Secrets"), h("span", { class: "hint" }, "Passwords and keys, with gitleaks."))),
			h("label", { class: "choice" }, dependenciesBox, h("span", null, h("strong", null, "Dependencies"), h("span", { class: "hint" }, "Packages with published security advisories, with osv-scanner."))),
			h(
				"label",
				{ class: "choice" },
				privateBox,
				h(
					"span",
					null,
					h("strong", null, "Private data"),
					h(
						"span",
						{ class: "hint" },
						"Email addresses and phone numbers, ID and account numbers, GPS positions, internal network names, data dumps, and files named like personal documents. Each is counted per file; no value is ever kept or shown.",
					),
				),
			),
		),
		h("label", { class: "field" }, h("span", null, "Git history to read for secrets and private data"), historySelect),
		countField,
		h(
			"fieldset",
			null,
			h("legend", null, "Also"),
			h(
				"label",
				{ class: "choice" },
				localBox,
				h(
					"span",
					null,
					h("strong", null, "Files git does not track, and changes not yet committed"),
					h("span", { class: "hint" }, "Such as .env files. They hold real keys that have never left this computer, so what is found there is marked as on this computer only and ranked one step lower."),
				),
			),
			h("label", { class: "choice" }, analyseBox, h("span", null, h("strong", null, "Then start the model's deeper analysis"), analyseNote)),
		),
		depthField,
		h("label", { class: "field" }, h("span", null, "Repositories to skip, by name, separated by commas"), skipInput),
	);
	sync();

	return {
		node,
		/** The choices as they are now. */
		choices: () => choices,
		/** Says again what Deep would send, for when the model changes. */
		refresh: sync,
	};

	/** @param {import("./scan-choices.js").Preset} key */
	function setPreset(key) {
		// The separate switches stay as they were: a preset says how deep to look, not what to leave out.
		choices = { ...presetChoices(key), localFiles: choices.localFiles, skip: choices.skip };
		sync();
		onChange(choices);
	}

	function fromControls() {
		if (!secretsBox.checked && !dependenciesBox.checked && !privateBox.checked) {
			// At least one check runs: the one just unticked is ticked again.
			(choices.secrets ? secretsBox : choices.dependencies ? dependenciesBox : privateBox).checked = true;
		}
		const count = Number(countInput.value);
		const recent = Number.isInteger(count) && count >= 1 && count <= MAX_HISTORY_COMMITS ? count : RECENT_DEFAULT;
		const history = historySelect.value === "all" ? "all" : historySelect.value === "none" ? "none" : recent;
		const next = {
			secrets: secretsBox.checked,
			dependencies: dependenciesBox.checked,
			privateData: privateBox.checked,
			history: /** @type {ScanChoices["history"]} */ (history),
			localFiles: localBox.checked,
			skip: parseSkip(skipInput.value) ?? choices.skip,
			analyse: analyseBox.checked,
		};
		choices = { preset: presetOf(next), ...next };
		sync();
		onChange(choices);
	}

	function sync() {
		presetInputs.forEach((input) => (input.checked = input.value === choices.preset));
		customNote.hidden = choices.preset !== "custom";
		secretsBox.checked = choices.secrets;
		dependenciesBox.checked = choices.dependencies;
		privateBox.checked = choices.privateData;
		historySelect.value = typeof choices.history === "number" ? "recent" : choices.history;
		if (typeof choices.history === "number") countInput.value = String(choices.history);
		countField.hidden = typeof choices.history !== "number";
		// History and files git does not track are read by gitleaks, for secrets and private data alike.
		const gitleaks = choices.secrets || choices.privateData;
		historySelect.disabled = !gitleaks;
		localBox.checked = choices.localFiles;
		localBox.disabled = !gitleaks;
		analyseBox.checked = choices.analyse;
		if (document.activeElement !== skipInput) skipInput.value = choices.skip.join(", ");
		replace(analyseNote, ...analyseWords(choices.analyse));
	}
}

/**
 * What the deeper analysis after a scan would do, and where it would send things: said before the
 * scan is started, so pressing the button is the yes to it (invariant 13).
 *
 * @param {boolean} chosen
 * @returns {(Node | string)[]}
 */
function analyseWords(chosen) {
	const assistant = store.settings?.assistant;
	if (!assistant?.configured) return stepNodes("No model is set up, so this would not start. Choose one in Settings → Model.");
	const what = `${assistant.model} judges up to 25 critical and high findings once the scan has finished. ${analysisNotice(assistant)}`;
	return chosen && assistant.hosted ? [h("strong", null, "Checking with this ticked sends findings outside your machines. "), what] : [what];
}

/** Whether a scan with these choices hands findings to a hosted model afterwards, which the request has to say yes to. @param {ScanChoices} choices */
export function sendsToHosted(choices) {
	return choices.analyse && store.settings?.assistant?.configured === true && store.settings.assistant.hosted === true;
}
