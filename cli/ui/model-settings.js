// @ts-check
// Settings → Model: where the model behind Explain, Summarise, Ask and Deeper analysis runs.
// Keys are typed here and sent to Porchlight's own server once; the server never sends one back.
import { api } from "./api.js";
import { banner, h, icon, replace, stepNodes, toast } from "./dom.js";
import { MODEL_CHOICES, modelChoice } from "./models.js";
import { setAssistant } from "./store.js";

/**
 * @typedef {{
 *   source: "settings" | "startup",
 *   choice: string,
 *   url: string,
 *   model: string,
 *   keys: Record<string, boolean> & { servers: string[] },
 *   startup: { choice: string, model: string, host: string } | null,
 *   assistant: import("./generated.js").AssistantSettings,
 * }} ModelState
 */

const GROUPS = /** @type {const} */ ([
	["mac", "On this Mac"],
	["server", "On another computer"],
	["hosted", "Through an API"],
	["off", "None"],
]);

/** The same address form the server keys a saved server key by. */
function serverKey(/** @type {string} */ url) {
	try {
		const parsed = new URL(url.trim());
		return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
	} catch {
		return url.trim();
	}
}

/** @returns {Promise<HTMLElement>} */
export async function modelSection() {
	const section = h("section", { id: "settings-model", tabindex: "-1", class: "card full model-settings", "aria-labelledby": "model-title" });
	/** @type {ModelState} */
	let state = /** @type {ModelState} */ (await api("GET", "/model"));
	let form = fromState(state);
	/** @type {string[]} */
	let found = [];
	let busy = "";
	/** @type {Node | null} */
	let result = null;

	/** @param {ModelState} from */
	function fromState(from) {
		return { choice: from.choice, url: from.url, model: from.model, apiKey: "", removeKey: false };
	}

	/** @param {string} id */
	function pick(id) {
		const choice = modelChoice(id);
		if (!choice || id === form.choice) return;
		const same = id === state.choice;
		form = { choice: id, url: same ? state.url : choice.url, model: same ? state.model : "", apiKey: "", removeKey: false };
		found = [];
		result = null;
		draw();
	}

	function request() {
		return {
			choice: form.choice,
			url: form.url,
			model: form.model,
			...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
			...(form.removeKey ? { removeKey: true } : {}),
		};
	}

	/**
	 * @param {string} label
	 * @param {() => Promise<void>} work
	 */
	async function run(label, work) {
		if (busy) return;
		busy = label;
		result = null;
		draw();
		try {
			await work();
		} catch (err) {
			result = h("p", { class: "model-result error", role: "alert" }, icon("warning"), " ", err instanceof Error ? err.message : String(err));
		} finally {
			busy = "";
			draw();
		}
	}

	const findModels = () =>
		run("Finding models…", async () => {
			const answer = await api("POST", "/model/models", request());
			found = Array.isArray(answer.models) ? answer.models : [];
			result = h("p", { class: "model-result" }, found.length === 0 ? "No models were listed there." : `${found.length} found. Pick one below.`);
		});

	const test = () =>
		run("Waiting for the model…", async () => {
			const answer = await api("POST", "/model/test", request());
			result = h(
				"p",
				{ class: "model-result ok" },
				h("span", { class: "severity status-good" }, icon("good"), "It answered"),
				` in ${answer.seconds} s: `,
				h("q", null, String(answer.text)),
			);
		});

	const save = () =>
		run("Saving…", async () => {
			state = /** @type {ModelState} */ (await api("POST", "/model", request()));
			form = fromState(state);
			setAssistant(state.assistant);
			const name = modelChoice(state.choice)?.name;
			toast(state.assistant.configured ? `Model: ${state.assistant.model} (${name})` : `Model: ${name}`);
		});

	const useStartup = () =>
		run("Switching…", async () => {
			state = /** @type {ModelState} */ (await api("POST", "/model/startup"));
			form = fromState(state);
			found = [];
			setAssistant(state.assistant);
			toast("Using the model Porchlight was started with");
		});

	draw();
	return section;

	function draw() {
		const choice = modelChoice(form.choice) ?? MODEL_CHOICES[MODEL_CHOICES.length - 1];
		const hasAddress = choice.provider === "ollama" || choice.provider === "compatible";
		const keySaved = choice.provider === "compatible" ? state.keys.servers.includes(serverKey(form.url)) : Boolean(choice.provider && state.keys[choice.provider]);
		const unsaved =
			form.choice !== state.choice || form.url !== state.url || form.model !== state.model || form.apiKey.trim() !== "" || form.removeKey;

		replace(
			section,
			h("h2", { id: "model-title" }, "Model"),
			h("p", { class: "sub" }, "Explains findings, summarises the roadmap, answers questions and runs Deeper analysis. Use any model you like, and change it whenever you want."),
			inUse(),
			h(
				"fieldset",
				{ class: "model-choices" },
				h("legend", { class: "visually-hidden" }, "Where the model runs"),
				...GROUPS.map(([group, title]) =>
					h(
						"div",
						{ class: "model-group" },
						h("h3", null, title, group === "hosted" ? h("span", { class: "hint" }, " · sends data off your machines when you ask") : null),
						h(
							"div",
							{ class: "choice-grid" },
							...MODEL_CHOICES.filter((option) => option.group === group).map((option) =>
								h(
									"label",
									{ class: "choice-option" },
									h("span", { class: "look-name" }, h("input", { type: "radio", name: "model-choice", value: option.id, checked: option.id === form.choice, onchange: () => pick(option.id) }), option.name),
									option.id === state.choice && state.source === "settings" ? h("span", { class: "chip-note" }, "In use") : null,
								),
							),
						),
					),
				),
			),
			h("div", { class: "model-help" }, ...stepNodes(choice.help)),
			choice.group === "hosted"
				? banner("warning", `This sends data to ${choice.name}`, [
						`Only when you click Explain, Summarise, Ask or Deeper analysis: what the page shows about those findings, and for Deeper analysis the lines of your code that import a vulnerable package. It is billed to your key.`,
						"Never secret values, author names, emails, the monitor's token or a domain's verification record. Saving this choice sends nothing.",
					])
				: null,
			choice.provider === null ? null : fields(choice, hasAddress, keySaved),
			h(
				"div",
				{ class: "actions" },
				h("button", { type: "button", class: "button primary", disabled: Boolean(busy) || !unsaved, onclick: save }, busy === "Saving…" ? busy : "Save and use"),
				choice.provider === null
					? null
					: h("button", { type: "button", class: "button", disabled: Boolean(busy), onclick: test }, busy === "Waiting for the model…" ? busy : "Send a test message"),
				state.source === "settings" && state.startup
					? h("button", { type: "button", class: "button quiet", disabled: Boolean(busy), onclick: useStartup }, "Use the start-up model")
					: null,
			),
			h("div", { "aria-live": "polite" }, result),
		);
	}

	function inUse() {
		const assistant = state.assistant;
		const from =
			state.source === "settings"
				? "Chosen here."
				: "Given when Porchlight started (in the Mac app, ~/.porchlight/app.env). Saving a choice here replaces it.";
		if (assistant.configured) {
			return h(
				"p",
				{ class: "model-now" },
				h("span", { class: "severity status-good" }, icon("good"), "In use"),
				" ",
				h("strong", null, assistant.model ?? ""),
				` at ${assistant.host}${assistant.hosted ? " (hosted)" : ""}. `,
				h("span", { class: "hint" }, from),
			);
		}
		return h(
			"p",
			{ class: "model-now" },
			h("span", { class: "severity status-pending" }, icon("pending"), assistant.unset ? "Off" : "Not connected"),
			" ",
			assistant.unset ? "No model is in use. " : `${assistant.error}. `,
			h("span", { class: "hint" }, from),
		);
	}

	/**
	 * @param {import("./models.js").ModelChoice} choice
	 * @param {boolean} hasAddress
	 * @param {boolean} keySaved
	 */
	function fields(choice, hasAddress, keySaved) {
		const modelInput = /** @type {HTMLInputElement} */ (
			h("input", { type: "text", name: "model", value: form.model, placeholder: choice.placeholder, autocomplete: "off", spellcheck: false, oninput: (/** @type {Event} */ event) => {
				form.model = /** @type {HTMLInputElement} */ (event.target).value;
				refreshSave();
			} })
		);
		return h(
			"div",
			{ class: "model-fields" },
			hasAddress
				? h(
						"label",
						{ class: "field" },
						h("span", null, "Address"),
						h("input", { type: "url", name: "url", value: form.url, placeholder: "http://computer:port", autocomplete: "off", spellcheck: false, oninput: (/** @type {Event} */ event) => {
							form.url = /** @type {HTMLInputElement} */ (event.target).value;
							refreshSave();
						} }),
					)
				: null,
			choice.key === "none"
				? null
				: h(
						"div",
						{ class: "field" },
						h("label", { for: "model-key" }, h("span", null, choice.key === "required" ? "API key" : "API key (if the server asks for one)")),
						h("input", {
							id: "model-key",
							type: "password",
							name: "apiKey",
							value: form.apiKey,
							autocomplete: "off",
							placeholder: keySaved && !form.removeKey ? "A key is saved. Type a new one to replace it" : "Paste the key",
							oninput: (/** @type {Event} */ event) => {
								form.apiKey = /** @type {HTMLInputElement} */ (event.target).value;
								refreshSave();
							},
						}),
						keySaved
							? h(
									"label",
									{ class: "check-line" },
									h("input", { type: "checkbox", checked: form.removeKey, onchange: (/** @type {Event} */ event) => {
										form.removeKey = /** @type {HTMLInputElement} */ (event.target).checked;
										draw();
									} }),
									" Remove the saved key",
								)
							: null,
						h("span", { class: "hint" }, "Kept on this computer beside your scan report, readable only by you. It is never shown again or sent to this page."),
					),
			h(
				"div",
				{ class: "field" },
				h("label", { for: "model-name" }, h("span", null, "Model")),
				h(
					"div",
					{ class: "inline-form" },
					Object.assign(modelInput, { id: "model-name" }),
					h("button", { type: "button", class: "button", disabled: Boolean(busy), onclick: findModels }, busy === "Finding models…" ? busy : "Find models"),
				),
				found.length > 0
					? h(
							"select",
							{
								"aria-label": "Models found",
								onchange: (/** @type {Event} */ event) => {
									form.model = /** @type {HTMLSelectElement} */ (event.target).value;
									draw();
								},
							},
							h("option", { value: "" }, `Pick one of ${found.length}`),
							...found.map((name) => h("option", { value: name, selected: name === form.model }, name)),
						)
					: null,
			),
		);
	}

	/** Typing changes only whether Save is offered; the rest of the form stays as it is, focus included. */
	function refreshSave() {
		const button = /** @type {HTMLButtonElement | null} */ (section.querySelector(".actions .button.primary"));
		if (button && !busy) button.disabled = false;
	}
}
