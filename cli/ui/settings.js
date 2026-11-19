// @ts-check
// Settings: the look of the interface, and what SecurityX is connected to.
import { api } from "./api.js";
import { h, icon, replace, toast } from "./dom.js";
import { applyLook, currentLook } from "./appearance.js";
import { LOOKS } from "./looks.js";
import { load, store } from "./store.js";

/**
 * @param {HTMLElement} view
 * @returns {Promise<() => void>}
 */
export async function renderSettings(view) {
	await load();
	let saving = Promise.resolve();

	/** @param {string} id */
	const choose = (id) => {
		const before = currentLook();
		if (id === before) return;
		applyLook(id);
		if (store.settings) store.settings.appearance = id;
		saving = saving.then(async () => {
			try {
				await api("POST", "/settings", { appearance: id });
				toast(`Appearance: ${LOOKS.find((look) => look.id === id)?.name}`);
			} catch (err) {
				applyLook(before);
				if (store.settings) store.settings.appearance = before;
				draw();
				toast(`Appearance not saved: ${err instanceof Error ? err.message : String(err)}`, "error");
			}
		});
	};

	draw();
	return () => {};

	function draw() {
		const chosen = currentLook();
		replace(
			view,
			h(
				"section",
				{ class: "page" },
				h("div", { class: "page-head" }, h("div", null, h("h1", null, "Settings"), h("p", { class: "sub" }, "How SecurityX looks, and what it's connected to."))),
				h(
					"fieldset",
					{ class: "card full looks" },
					h("legend", null, h("h2", null, "Appearance")),
					h("p", { class: "sub" }, "Saved on this computer and used every time SecurityX opens."),
					h(
						"div",
						{ class: "look-grid" },
						...LOOKS.map((look, index) => {
							const input = /** @type {HTMLInputElement} */ (
								h("input", { type: "radio", name: "look", value: look.id, checked: look.id === chosen, onchange: () => choose(look.id) })
							);
							return h(
								"label",
								{ class: "look-option" },
								h(
									"span",
									{ class: "look-preview", dataset: { preview: look.id }, "aria-hidden": "true" },
									h("span", { class: "pv-side" }, h("i"), h("i"), h("i")),
									h("span", { class: "pv-main" }, h("b"), h("i"), h("i"), h("em")),
								),
								h("span", { class: "look-name" }, input, `${index + 1}. ${look.name}`),
								h("span", { class: "look-text" }, look.description),
							);
						}),
					),
				),
				connections(),
			),
		);
	}
}

/** Read-only: where each connection is set, never its secret. */
function connections() {
	const settings = store.settings;
	if (!settings) return null;
	/** @param {boolean} ok @param {string} text */
	const line = (ok, text) => h("li", null, h("span", { class: `severity ${ok ? "status-good" : "status-pending"}` }, icon(ok ? "good" : "pending")), " ", text);
	return h(
		"section",
		{ class: "card full" },
		h("h2", null, "Connections"),
		h(
			"ul",
			{ class: "plain-list" },
			line(settings.monitor.configured, settings.monitor.configured ? `Monitor: ${settings.monitor.host}` : "Monitor: not connected"),
			line(
				settings.assistant.configured,
				settings.assistant.configured ? `Model: ${settings.assistant.model} at ${settings.assistant.host}` : "Model: not connected",
			),
			line(settings.github.token, settings.github.token ? "GitHub: token set, private repositories can be fetched" : "GitHub: public repositories only"),
		),
		h(
			"p",
			{ class: "hint" },
			settings.service
				? "These are set in the service's settings."
				: "These are set when SecurityX starts: in the Mac app, in ~/.securityx/app.env; in a terminal, with the SECURITYX_ environment variables.",
		),
	);
}
