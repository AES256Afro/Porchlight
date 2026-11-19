// @ts-check
import { api, download } from "./api.js";
import { h, icon, toast } from "./dom.js";
import { isFiltering } from "./filter.js";
import { paramsFromFilter } from "./list.js";
import { openSendDialog, sendTargets } from "./send.js";
import { store } from "./store.js";

/** @typedef {import("./filter.js").FindingFilter} FindingFilter */

const CONTENTS = /** @type {const} */ ([
	["roadmap", "Repair roadmap", "What to repair, in order. One entry per action, such as a package to upgrade, with the findings it clears."],
	["findings", "Findings with suggested fixes", "Every finding, most severe first, each with the repair that clears it."],
]);

const FORMATS = /** @type {const} */ ([
	["md", "Markdown (.md)", "A checklist to paste into an issue or keep in a repository."],
	["html", "Printable page (.html)", "Opens in any browser. Print it, or save it as a PDF from the print dialog."],
	["csv", "Spreadsheet (.csv)", "One row per entry, for a tracker or a spreadsheet."],
	["json", "JSON (.json)", "For scripts and other tools."],
]);

/**
 * Asks what to export and in which format, then saves the file.
 *
 * @param {{ domain: string } | { filter: FindingFilter, shown: number, total: number }} target
 *   a monitored domain, or the repository scan with the page's current filter
 * @param {"roadmap" | "findings"} [initialContent]
 */
export function openExportDialog(target, initialContent = "roadmap") {
	const forDomain = "domain" in target;
	const filtering = !forDomain && isFiltering(target.filter);

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
				h("span", null, h("strong", null, label), h("span", { class: "hint" }, hint)),
			),
		);

	// A mural needs a model, and is made for the repository scan, not for one domain.
	const assistant = store.settings?.assistant;
	const muralOffered = !forDomain && assistant?.configured === true;
	const muralBox = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", name: "mural" }));
	const progress = h("p", { class: "hint", role: "status", hidden: true });
	const error = h("p", { class: "form-error", role: "alert", hidden: true });
	const submit = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "button primary" }, "Export"));
	const form = /** @type {HTMLFormElement} */ (
		h(
			"form",
			{ method: "dialog", onsubmit: save },
			h("h2", { id: "export-title" }, forDomain ? `Export for ${target.domain}` : "Export"),
			h("fieldset", null, h("legend", null, "What to export"), ...choices("content", CONTENTS, initialContent)),
			h("fieldset", null, h("legend", null, "Format"), ...choices("format", FORMATS, "md")),
			filtering
				? h(
						"fieldset",
						null,
						h("legend", null, "How much"),
						...choices(
							"scope",
							[
								["filtered", `Only what the filters show (${target.shown.toLocaleString()} findings)`, "The file says at the top that it is partial."],
								["all", `Everything in the scan (${target.total.toLocaleString()} findings)`, ""],
							],
							"filtered",
						),
					)
				: null,
			muralOffered
				? h(
						"fieldset",
						null,
						h("legend", null, "Mural"),
						h(
							"label",
							{ class: "choice" },
							muralBox,
							h(
								"span",
								null,
								h("strong", null, `Add a mural written by ${assistant?.model}`),
								h(
									"span",
									{ class: "hint" },
									"A one-page board at the top: what was found, what to fix first, what has been done and what to do next, beside figures SecurityX counts itself. It is written when you press Export, after any Deeper analysis has finished. A model on a processor takes a few minutes. For HTML, Markdown and JSON.",
								),
								assistant?.hosted
									? h("span", { class: "hint" }, `It sends the roadmap's actions, the counts and the findings the model judged real to ${assistant.host}. Never secret values, authors or emails.`)
									: null,
							),
						),
					)
				: null,
			progress,
			error,
			h(
				"div",
				{ class: "actions" },
				// The same choices, sent to a model for analysis or a repair plan instead of saved as a file.
				!forDomain && sendTargets().length > 0
					? h(
							"button",
							{
								type: "button",
								class: "button push-left",
								onclick: () => {
									const content = new FormData(form).get("content") === "findings" ? "findings" : "roadmap";
									dialog.close();
									openSendDialog(target, content);
								},
							},
							icon("spark"),
							"Send to a model instead…",
						)
					: null,
				h("button", { type: "button", class: "button", onclick: () => dialog.close() }, "Cancel"),
				submit,
			),
		)
	);
	const dialog = /** @type {HTMLDialogElement} */ (h("dialog", { class: "dialog wide", "aria-labelledby": "export-title", onclose: () => dialog.remove() }, form));

	/** @param {SubmitEvent} event */
	async function save(event) {
		event.preventDefault();
		const chosen = new FormData(form);
		const settings = new URLSearchParams({ content: String(chosen.get("content")), format: String(chosen.get("format")) });
		if (!forDomain && filtering && chosen.get("scope") === "filtered") {
			for (const [key, value] of Object.entries(paramsFromFilter(target.filter))) settings.set(key, value);
		}
		const withMural = muralOffered && muralBox.checked;
		if (withMural && settings.get("format") === "csv") {
			error.textContent = "A mural cannot go in a spreadsheet. Choose HTML, Markdown or JSON.";
			error.hidden = false;
			return;
		}
		submit.disabled = true;
		submit.textContent = "Exporting…";
		error.hidden = true;
		try {
			if (withMural) {
				submit.textContent = "Writing the mural…";
				await writeMural(settings);
				settings.set("mural", "1");
			}
			const path = forDomain ? `/domains/${encodeURIComponent(target.domain)}/export?${settings}` : `/repos/export?${settings}`;
			const filename = await download(path);
			dialog.close();
			toast(`Saved ${filename}`);
		} catch (err) {
			// Stay open: the choices are still there to change or retry.
			progress.hidden = true;
			error.textContent = err instanceof Error ? err.message : String(err);
			error.hidden = false;
			submit.disabled = false;
			submit.textContent = "Export";
		}
	}

	/**
	 * Asks the server to write the mural for these filters, and waits for it. The filters travel the
	 * same way as the export's, so the mural describes exactly what the file covers.
	 *
	 * @param {URLSearchParams} settings
	 */
	async function writeMural(settings) {
		const query = new URLSearchParams(settings);
		query.delete("content");
		query.delete("format");
		const started = Date.now();
		await api("POST", `/repos/mural?${query}`);
		progress.hidden = false;
		for (;;) {
			await new Promise((resolve) => setTimeout(resolve, 2000));
			const job = await api("GET", `/repos/mural?${query}`);
			if (job.state === "done" && job.current) break;
			if (job.state === "failed") throw new Error(job.error);
			const seconds = Math.round((Date.now() - started) / 1000);
			progress.textContent = `${assistant?.model} is writing the mural: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} so far. You can leave this open.`;
		}
		progress.hidden = true;
	}

	document.body.append(dialog);
	dialog.showModal();
}

/**
 * The button that opens the dialog.
 *
 * @param {() => void} onClick
 * @param {boolean} [disabled]
 */
export function exportButton(onClick, disabled = false) {
	return h("button", { type: "button", class: "button", disabled, onclick: onClick }, icon("download"), "Export");
}
