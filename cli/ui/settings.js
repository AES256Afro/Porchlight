// @ts-check
// Settings: the model, projects, access from other devices, the look of the interface, and what Porchlight is connected to.
import { api } from "./api.js";
import { h, icon, replace, toast } from "./dom.js";
import { applyLook, currentLook } from "./appearance.js";
import { redrawAnswers } from "./assist.js";
import { ANSWER_PLACES, DEFAULT_ANSWER_PLACE, LOOKS } from "./looks.js";
import { answersPlaceChanged } from "./panel.js";
import { accessSection } from "./access-settings.js";
import { cloudflareSection } from "./cloudflare-settings.js";
import { modelDownloadSection } from "./model-download.js";
import { monitorSection } from "./monitor-settings.js";
import { modelSection } from "./model-settings.js";
import { projectsSection } from "./projects.js";
import { load, store } from "./store.js";

/**
 * @param {HTMLElement} view
 * @returns {Promise<() => void>}
 */
export async function renderSettings(view) {
	await load();
	// Kept across redraws, so changing the look leaves a half-filled model form as it is.
	const model = store.settings?.service ? null : await modelSection();
	// A service's models are set where it is managed, so it offers no download.
	const downloads = store.settings?.service ? null : await modelDownloadSection().catch(() => null);
	const access = store.settings?.service ? null : await accessSection();
	const projects = projectsSection();
	const cloudflare = await cloudflareSection();
	const monitor = monitorSection();
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

	/** @param {string} id */
	const placeAnswers = (id) => {
		const before = store.settings?.answers ?? DEFAULT_ANSWER_PLACE;
		if (id === before || !store.settings) return;
		const settings = store.settings;
		const move = (/** @type {string} */ place) => {
			settings.answers = place;
			answersPlaceChanged();
			redrawAnswers();
		};
		move(id);
		saving = saving.then(async () => {
			try {
				await api("POST", "/settings", { answers: id });
				toast(`Answers: ${ANSWER_PLACES.find((place) => place.id === id)?.name}`);
			} catch (err) {
				move(before);
				draw();
				toast(`Not saved: ${err instanceof Error ? err.message : String(err)}`, "error");
			}
		});
	};

	draw();
	return () => {};

	function draw() {
		const chosen = currentLook();
		const chosenPlace = store.settings?.answers ?? DEFAULT_ANSWER_PLACE;
		replace(
			view,
			h(
				"section",
				{ class: "page" },
				h("div", { class: "page-head" }, h("div", null, h("h1", null, "Settings"), h("p", { class: "sub" }, "Which model Porchlight uses, where it keeps your files, how it looks, and what it's connected to."))),
				model,
				downloads,
				projects,
				cloudflare,
				monitor,
				access,
				h(
					"fieldset",
					{ id: "settings-appearance", tabindex: "-1", class: "card full looks" },
					h("legend", null, h("h2", null, "Appearance")),
					h("p", { class: "sub" }, "Saved on this computer and used every time Porchlight opens."),
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
				h(
					"fieldset",
					{ id: "settings-answers", tabindex: "-1", class: "card full answer-places" },
					h("legend", null, h("h2", null, "Where answers appear")),
					h("p", { class: "sub" }, "Where a model's answers, and your follow-up questions, show. Saved on this computer. Every answer is also kept under Discussions."),
					...ANSWER_PLACES.map((place) =>
						h(
							"label",
							{ class: "choice" },
							h("input", { type: "radio", name: "answers", value: place.id, checked: place.id === chosenPlace, onchange: () => placeAnswers(place.id) }),
							h("span", null, h("strong", null, place.name), h("span", { class: "hint" }, place.description)),
						),
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
			line(settings.cloudflare.configured, settings.cloudflare.configured ? "Cloudflare: token saved, your account can be audited" : "Cloudflare: not connected"),
		),
		h(
			"p",
			{ class: "hint" },
			settings.service
				? "These are set in the service's settings."
				: "The model, the monitor and Cloudflare are connected in the sections above. A GitHub token is set when Porchlight starts: in the Mac app, in ~/.porchlight/app.env; in a terminal, with PORCHLIGHT_GITHUB_TOKEN.",
		),
	);
}
