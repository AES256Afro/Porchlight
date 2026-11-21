// @ts-check
// Settings → Model → Download a model: find a model that runs on this computer and have Ollama
// download it. Porchlight runs no model itself. The search sends your search words to Hugging Face
// and nothing else; the names and numbers it returns are someone else's text, shown as text.
import { api } from "./api.js";
import { announce, banner, formatWhen, h, icon, pageVisibility, replace, select, toast } from "./dom.js";
import { poller } from "./poller.js";
import { downloadLine, formatBytes, machineLine } from "./hints.js";
import { setAssistant } from "./store.js";

/** @typedef {import("../src/assist/download.ts").HubModel} HubModel */
/** @typedef {import("../src/assist/download.ts").InstalledModel} InstalledModel */
/** @typedef {import("../src/ui/server.ts").DownloadStatus} DownloadStatus */
/** @typedef {{ ollama: { host: string, origin?: string, onThisComputer?: boolean, reachable: boolean, problem?: string }, installed: InstalledModel[], download: DownloadStatus, canChange: boolean, hub: string, tasks: [string, string][], sorts: [string, string][], formats: [string, string][], sizes: [string, string][], machine: import("../src/assist/download.ts").Machine }} LocalModels */

const POLL_MS = 1000;

/** @returns {Promise<HTMLElement>} */
export async function modelDownloadSection() {
	const section = h("section", { id: "settings-download", tabindex: "-1", class: "card full model-download", "aria-labelledby": "download-title" });
	/** @type {LocalModels} */
	let state = /** @type {any} */ (await api("GET", "/model/local"));
	/** @type {HubModel[] | null} */
	let found = null;
	let searching = false;
	/** @type {string} */
	let problem = "";
	/** The download last said to a screen reader. */
	let said = "";
	const query = /** @type {HTMLInputElement} */ (h("input", { type: "search", name: "model-search", autocomplete: "off", spellcheck: false, placeholder: "qwen, llama, security…", "aria-label": "Search for a model" }));
	const author = /** @type {HTMLInputElement} */ (h("input", { type: "text", name: "model-author", autocomplete: "off", spellcheck: false, placeholder: "unsloth", "aria-label": "Publisher" }));
	const tag = /** @type {HTMLInputElement} */ (h("input", { type: "text", name: "model-tag", autocomplete: "off", spellcheck: false, placeholder: "conversational", "aria-label": "Tag" }));
	/** The filters as chosen; kept across redraws. */
	const filters = { task: "", sort: "downloads", format: "gguf", size: "" };
	const fits = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", name: "model-fits", checked: true }));
	const named = /** @type {HTMLInputElement} */ (h("input", { type: "text", name: "model-name", autocomplete: "off", spellcheck: false, placeholder: "qwen3:8b", "aria-label": "Model name" }));

	/** Follows a download while it runs and this section is on screen; a missed poll is made up by the next one. */
	const follow = poller({
		every: POLL_MS,
		tries: Number.POSITIVE_INFINITY,
		maxWait: 10_000,
		visibility: pageVisibility(),
		run: async () => {
			if (!section.isConnected) return false;
			state = /** @type {any} */ (await api("GET", "/model/local"));
			draw();
			const download = state.download;
			const now = download.state === "idle" ? "idle" : `${download.state} ${download.name}`;
			if (now !== said) {
				if (download.state === "running") announce(`Downloading ${download.name}`);
				else if (download.state === "done") announce(`${download.name} is downloaded`);
				else if (download.state === "failed") announce(`${download.name} was not downloaded`);
				said = now;
			}
			return state.download.state === "running";
		},
	});
	const refresh = () => follow.now();

	/** @param {string} name */
	async function start(name) {
		problem = "";
		try {
			const answer = await api("POST", "/model/local/download", { name });
			state.download = answer.download;
			toast(`Downloading ${name}`);
			refresh();
		} catch (err) {
			problem = err instanceof Error ? err.message : String(err);
			draw();
		}
	}

	/** Makes a downloaded model the one Porchlight uses, through the same route as the form above. @param {string} name */
	async function use(name) {
		try {
			const saved = await api("POST", "/model", { choice: "ollama-mac", url: state.ollama.origin ?? `http://${state.ollama.host}`, model: name });
			setAssistant(saved.assistant);
			// The form above shows the choice it loaded; the page is drawn again so both agree.
			location.reload();
		} catch (err) {
			problem = err instanceof Error ? err.message : String(err);
			draw();
		}
	}

	async function search() {
		if (searching) return;
		searching = true;
		problem = "";
		draw();
		try {
			const asked = new URLSearchParams({ q: query.value, task: filters.task, sort: filters.sort, author: author.value, tag: tag.value, format: filters.format, size: filters.size, ...(fits.checked && state?.ollama.onThisComputer !== false ? { fits: "1" } : {}) });
			found = (await api("GET", `/model/local/search?${asked}`)).models;
		} catch (err) {
			problem = err instanceof Error ? err.message : String(err);
		} finally {
			searching = false;
			draw();
		}
	}

	/** What the Hub says about a model, in one line. @param {HubModel} model */
	const resultLine = (model) =>
		[
			model.params ? `${model.params}B` : "size not in the name",
			state.tasks.find(([id]) => id === model.task)?.[1],
			`${model.downloads.toLocaleString("en-GB")} downloads`,
			`${model.likes.toLocaleString("en-GB")} likes`,
			model.updated ? `updated ${formatWhen(model.updated)}` : "",
		]
			.filter(Boolean)
			.join(" · ");

	/** @param {string} name */
	const has = (name) => state.installed.some((model) => model.name === name || model.name === `${name}:latest`);

	/** @param {string} name @param {string} label */
	function getButton(name, label = "Download") {
		if (has(name)) return h("button", { type: "button", class: "button", onclick: () => void use(name) }, "Use this model");
		return h("button", { type: "button", class: "button", "aria-disabled": state.download.state === "running" || !state.ollama.reachable ? "true" : null, onclick: () => void start(name) }, icon("download"), label);
	}

	/**
	 * An MLX model is not Ollama's to download. Its name is copied for the program that runs it, and
	 * its page on the Hub is one click away; the address is built here from a name the server checked.
	 *
	 * @param {HubModel} model
	 */
	function mlxActions(model) {
		const copy = async () => {
			try {
				await navigator.clipboard.writeText(model.id);
				toast("Copied the model's name. Load it in Unsloth Studio or LM Studio, then choose that program in the model form above.");
			} catch {
				toast("Could not copy. Select the name and copy it by hand.", "error");
			}
		};
		return h(
			"span",
			{ class: "actions" },
			h("button", { type: "button", class: "button", onclick: () => void copy() }, icon("copy"), "Copy name"),
			// The address comes whole from Porchlight's server, which builds it from the checked id (S37).
			model.page?.startsWith(`https://${state.hub}/`) ? h("a", { class: "button quiet", href: model.page, target: "_blank", rel: "noopener noreferrer", title: `Opens ${state.hub} in your browser` }, "Open its page") : null,
		);
	}

	function progress() {
		const download = state.download;
		if (download.state === "idle") return null;
		if (download.state === "running") {
			const known = download.total > 0;
			return h(
				"div",
				{ class: "host-progress" },
				h("strong", null, downloadLine(download)),
				h("progress", { max: known ? download.total : null, value: known ? download.completed : null, "aria-label": "Download progress" }),
				h("div", { class: "actions" }, h("button", { type: "button", class: "button danger", onclick: () => void api("POST", "/model/local/stop").then(refresh, refresh) }, "Stop"), h("span", { class: "hint" }, "You can leave this page. The download carries on, and the Activity page says when it is done.")),
			);
		}
		if (download.state === "done") {
			return h(
				"p",
				null,
				h("span", { class: "severity status-good" }, icon("good"), `Downloaded ${download.name}`),
				" ",
				h("button", { type: "button", class: "button primary", onclick: () => void use(download.name) }, "Use this model"),
			);
		}
		return banner("error", `${download.name} was not downloaded`, [download.error]);
	}

	draw();
	if (state.download.state === "running") follow.start();
	return section;

	function draw() {
		const reachable = state.ollama.reachable;
		replace(
			section,
			h("h2", { id: "download-title" }, "Download a model"),
			h(
				"p",
				{ class: "sub" },
				"Get a model that runs on this computer, so nothing you ask leaves it. Ollama downloads and runs it; Porchlight asks Ollama to. A model is several gigabytes, so check your disk space first.",
			),
			reachable
				? h("p", null, h("span", { class: "severity status-good" }, icon("good"), `Ollama is running at ${state.ollama.host}`), ` with ${state.installed.length === 1 ? "1 model" : `${state.installed.length} models`}.`)
				: h(
						"div",
						null,
						banner("warning", "Ollama is not answering", [state.ollama.problem ?? "", "Porchlight needs Ollama to download and run a model."]),
						h(
							"ol",
							{ class: "host-fix" },
							h("li", null, "Get Ollama from ", h("a", { href: "https://ollama.com/download", target: "_blank", rel: "noopener noreferrer" }, "ollama.com/download"), " and open it. It shows in the menu bar when it is running."),
							h("li", null, h("button", { type: "button", class: "button", onclick: () => void refresh() }, "Check again")),
						),
					),
			!state.canChange ? h("p", { class: "hint" }, "Models are downloaded from the page on the computer that runs Porchlight.") : null,
			progress(),
			problem ? h("p", { class: "model-result error", role: "alert" }, icon("warning"), " ", problem) : null,
			state.canChange
				? h(
						"div",
						null,
						h("h3", null, "Search Hugging Face"),
						h("p", { class: "hint" }, `Sends only what you type and choose here to ${state.hub}. Anyone can publish a model there, so prefer publishers you recognise.`),
						h("p", null, machineLine(state.machine)),
						h(
							"form",
							{
								class: "model-search",
								onsubmit: (/** @type {SubmitEvent} */ event) => {
									event.preventDefault();
									void search();
								},
							},
							h("label", { class: "field grow" }, h("span", null, "Words"), query),
							h(
								"div",
								{ class: "filters" },
								select("Format", state.formats, filters.format, (value) => {
									filters.format = value;
								}),
								select("Size", state.sizes, filters.size, (value) => {
									filters.size = value;
								}),
								select("Kind", state.tasks, filters.task, (value) => {
									filters.task = value;
								}),
								select("Order", state.sorts, filters.sort, (value) => {
									filters.sort = value;
								}),
								h("label", { class: "field" }, h("span", null, "Publisher"), author),
								h("label", { class: "field" }, h("span", null, "Tag"), tag),
							),
							// This computer's memory says nothing about a model run by Ollama on another machine (H-F5).
							state.ollama.onThisComputer === false
								? h("p", { class: "hint" }, `Ollama runs at ${state.ollama.host}, not on this computer, so which models fit depends on that machine's memory.`)
								: h("label", { class: "check-line" }, fits, `Only models that fit this computer (up to about ${state.machine.fitsUpTo}B). Sizes are read from each model's name, so one that does not give its size is left out.`),
							h("div", { class: "actions" }, h("button", { type: "submit", class: "button primary", "aria-disabled": searching ? "true" : null }, searching ? "Searching…" : "Search")),
						),
						found !== null && filters.format === "mlx"
							? h("p", { class: "hint" }, "Ollama cannot run MLX models. Load one in Unsloth Studio, which can also train it, or in LM Studio, then choose that program in the model form above. Porchlight talks to either once the model is loaded.")
							: null,
						found === null
							? null
							: found.length === 0
								? h("p", { class: "hint" }, "Nothing matched. Try fewer or other words.")
								: h(
										"ul",
										{ class: "plain-list model-list" },
										...found.map((model) =>
											h("li", null, h("span", null, h("strong", null, model.id), h("span", { class: "hint block" }, resultLine(model))), model.format === "mlx" ? mlxActions(model) : getButton(model.pull)),
										),
									),
						h("h3", null, "Or name one"),
						h(
							"form",
							{
								class: "inline-form",
								onsubmit: (/** @type {SubmitEvent} */ event) => {
									event.preventDefault();
									if (named.value.trim()) void start(named.value.trim());
								},
							},
							h("div", { class: "field grow" }, named),
							h("button", { type: "submit", class: "button", "aria-disabled": state.download.state === "running" || !reachable ? "true" : null }, icon("download"), "Download"),
						),
					)
				: null,
			state.installed.length > 0
				? h(
						"details",
						{ class: "fix-details" },
						h("summary", null, `Already on ${state.ollama.host}: ${state.installed.length}`),
						h(
							"ul",
							{ class: "plain-list model-list" },
							...state.installed.map((model) =>
								h("li", null, h("span", null, h("strong", null, model.name), h("span", { class: "hint block" }, formatBytes(model.size))), state.canChange ? h("button", { type: "button", class: "button", onclick: () => void use(model.name) }, "Use this model") : null),
							),
						),
					)
				: null,
		);
	}
}
