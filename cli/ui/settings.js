// @ts-check
// Settings: the model, projects, access from other devices, the look of the interface, and what Porchlight is connected to.
import { api, download } from "./api.js";
import { h, icon, replace, scrollMotion, toast } from "./dom.js";
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
import { dueSection } from "./seen.js";
import { modelTasksSection } from "./model-tasks.js";
import { load, store, subscribe } from "./store.js";
import { connectionsCheck } from "./glance.js";
import { formatNumber, formatWhen, isOff, plural, setOff } from "./dom.js";

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
	/** What is connected, at the top as an index of the page (I-D2); drawn again when a connection changes (UI-B12). */
	const index = h("section", { class: "card full settings-index", "aria-labelledby": "settings-index-title" });
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
	const unsubscribe = subscribe((change) => {
		if (change === "settings" || change === "cloudflare" || change === "projects") replace(index, ...connections());
	});
	return () => unsubscribe();

	function draw() {
		const chosen = currentLook();
		const chosenPlace = store.settings?.answers ?? DEFAULT_ANSWER_PLACE;
		replace(
			view,
			h(
				"section",
				{ class: "page" },
				h("div", { class: "page-head" }, h("div", null, h("h1", null, "Settings"), h("p", { class: "sub" }, "Which model Porchlight uses, where it keeps your files, how it looks, and what it's connected to."))),
				(replace(index, ...connections()), index),
				model,
				store.settings?.service ? null : modelTasksSection(),
				downloads,
				projects,
				cloudflare,
				monitor,
				access,
				dataSection(),
				dueSection(),
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
			),
		);
	}
}

/**
 * A link to a section of this page: it scrolls there and moves focus there without drawing the page
 * again, so nothing half-typed in another section is lost.
 *
 * @param {string} name the section's part of the address, as `settingsAnchor` knows it
 * @param {string} text
 */
function sectionLink(name, text) {
	return h(
		"a",
		{
			href: `#/settings/${name}`,
			onclick: (/** @type {MouseEvent} */ event) => {
				const target = document.getElementById(`settings-${name}`);
				if (!target) return;
				event.preventDefault();
				history.replaceState(null, "", `#/settings/${name}`);
				target.scrollIntoView({ block: "start", behavior: scrollMotion() });
				target.focus({ preventScroll: true });
			},
		},
		text,
	);
}

/** Read-only: where each connection is set, never its secret, with a link to the section that sets it. */
function connections() {
	const settings = store.settings;
	if (!settings) return [];
	/** @param {boolean} ok @param {string} text @param {string | null} section */
	const line = (ok, text, section) => h("li", null, h("span", { class: `severity ${ok ? "status-good" : "status-pending"}` }, icon(ok ? "good" : "pending")), " ", section ? sectionLink(section, text) : text);
	return [
		h("h2", { id: "settings-index-title" }, "Connections"),
		h("p", { class: "hint" }, `Porchlight ${settings.version || "(version unknown)"}. Set up is not the same as working: Check connections asks each one now.`),
		connectionsCheck(),
		h(
			"ul",
			{ class: "plain-list" },
			line(settings.monitor.configured, settings.monitor.configured ? `Monitor: ${settings.monitor.host}` : "Monitor: not connected", settings.service ? null : "monitor"),
			line(
				settings.assistant.configured,
				settings.assistant.configured ? `Model: ${settings.assistant.model} at ${settings.assistant.host}` : "Model: not connected",
				settings.service ? null : "model",
			),
			line(settings.github.token, settings.github.token ? "GitHub: token set, private repositories can be fetched" : "GitHub: public repositories only", null),
			line(settings.cloudflare.configured, settings.cloudflare.configured ? "Cloudflare: token saved, your account can be audited" : "Cloudflare: not connected", "cloudflare"),
		),
		h(
			"p",
			{ class: "settings-jump" },
			"On this page: ",
			...[
				["model", "Model"],
				["download", "Download a model"],
				["projects", "Projects"],
				["cloudflare", "Cloudflare"],
				["monitor", "Monitor"],
				["access", "Access from other devices"],
				["data", "Data"],
				["appearance", "Appearance"],
			]
				// A service sets its model and access where it is managed, so those sections are not here.
				.filter(([name]) => !settings.service || !["model", "download", "access"].includes(name))
				.flatMap(([name, text], index) => [index > 0 ? " · " : null, sectionLink(name, text)]),
		),
		h(
			"p",
			{ class: "hint" },
			settings.service
				? "These are set in the service's settings."
				: "The model, the monitor and Cloudflare are connected in their sections below. A GitHub token is set when Porchlight starts: in the Mac app, in ~/.porchlight/app.env; in a terminal, with PORCHLIGHT_GITHUB_TOKEN.",
		),
	];
}

/**
 * Settings → Data: the notes that match no finding of any kept scan (R6Q-12), with Remove, and what to
 * copy to a new computer (US-10). Only the page on this computer, or a service's own page, may remove.
 */
function dataSection() {
	const body = h("div", null, h("p", { class: "loading" }, "Counting…"));
	const section = h(
		"section",
		{ id: "settings-data", tabindex: "-1", class: "card full", "aria-labelledby": "settings-data-title" },
		h("h2", { id: "settings-data-title" }, "Data"),
		h(
			"p",
			{ class: "sub" },
			"To move to a new computer, copy the data folder (~/.porchlight): your notes, the scan history, keys and tokens, and the ownership tokens for investigated domains. Scan the same folder there, so each repository keeps its name and its notes match. porchlight forget lists everything kept here, and removes it when asked.",
		),
		body,
	);
	void draw();
	return section;

	async function draw() {
		try {
			const answer = await api("GET", "/findings/orphans");
			if (answer.count === 0) return replace(body, h("p", null, "Every status and note you set matches a finding of a kept scan."));
			const remove = /** @type {HTMLButtonElement} */ (
				h(
					"button",
					{
						type: "button",
						class: "button",
						"aria-disabled": store.settings?.remote ? "true" : null,
						title: store.settings?.remote ? "Removed from the page on the computer that runs Porchlight" : null,
						onclick: async () => {
							if (isOff(remove) || store.settings?.remote) return;
							setOff(remove, true);
							try {
								const done = await api("POST", "/findings/orphans/remove", {});
								toast(`Removed ${plural(done.removed, "note", "notes")}`);
								await draw();
							} catch (err) {
								toast(err instanceof Error ? err.message : String(err), "error");
								setOff(remove, false);
							}
						},
					},
					`Remove ${plural(answer.count, "note", "notes")}`,
				)
			);
			replace(
				body,
				h("p", null, `${plural(answer.count, "note matches", "notes match")} no finding of any kept scan: their repositories were renamed, removed, or scanned from another folder. They change nothing; removing them only tidies the file.`),
				h(
					"details",
					null,
					h("summary", null, `Show ${answer.notes.length < answer.count ? `the first ${formatNumber(answer.notes.length)}` : "them"}`),
					h(
						"ul",
						{ class: "plain-list" },
						.../** @type {{ repo: string, ruleId: string, location: string, status: string, updatedAt: string }[]} */ (answer.notes).map((note) =>
							h("li", null, h("strong", null, note.repo), ` ${note.ruleId} `, h("span", { class: "mono" }, note.location), h("span", { class: "hint" }, ` · ${note.status}, ${formatWhen(note.updatedAt)}`)),
						),
					),
				),
				h(
					"div",
					{ class: "actions" },
					// Kept as a spreadsheet before they go, or to match them by hand after a move (M15).
					h(
						"button",
						{
							type: "button",
							class: "button quiet",
							onclick: () => void download("/findings/orphans/export").catch((err) => toast(err instanceof Error ? err.message : String(err), "error")),
						},
						icon("download"),
						"Export them (CSV)",
					),
					remove,
				),
			);
		} catch (err) {
			replace(body, h("p", { class: "form-error" }, err instanceof Error ? err.message : String(err)));
		}
	}
}
