// @ts-check
import { api, download } from "./api.js";
import { announce, h, icon, replace, setOff, stepNodes, toast } from "./dom.js";
import { isFiltering } from "./filter.js";
import { paramsFromFilter } from "./list.js";
import { announceSaved } from "./projects.js";
import { openSendDialog, sendTargets } from "./send.js";
import { currentProject, store } from "./store.js";
import { modelFields } from "./generated.js";
import { isStopped, waitUntil } from "./poller.js";

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
	// A mural already written for this scan and these filters is used again, unless asked for anew (C-Q1).
	const againBox = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", name: "mural-again" }));
	// With a project in use, the file goes into its folder; downloading stays a choice.
	const project = currentProject();
	// Not a live region: its clock moves every two seconds. That the mural is being written is said once.
	const progress = h("p", { class: "hint", hidden: true });
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
								["filtered", `Only what the filters show (${target.shown.toLocaleString("en-GB")} findings)`, "The file says at the top that it is partial."],
								["all", `Everything in the scan (${target.total.toLocaleString("en-GB")} findings)`, ""],
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
									"A one-page board at the top: what was found, what to fix first, what has been done and what to do next, beside figures Porchlight counts itself. It is written when you press Export, after any Deeper analysis has finished. A model on a processor takes a few minutes. For HTML, Markdown and JSON.",
								),
								assistant?.hosted
									? h("span", { class: "hint" }, `It sends the roadmap's actions, the counts and the findings the model judged real to ${assistant.host}. Never secret values, authors or emails.`)
									: null,
							),
						),
						h(
							"label",
							{ class: "choice" },
							againBox,
							h("span", null, h("strong", null, "Write the mural again"), h("span", { class: "hint" }, "Otherwise a mural already written for this scan and these filters is used, without asking the model again.")),
						),
					)
				: null,
			project
				? h(
						"fieldset",
						null,
						h("legend", null, "Where"),
						...choices(
							"where",
							[
								["project", `Save in ${project.name}`, `Into ${project.folder}/Porchlight/Exports, named with the date, the time and what it is.`],
								["download", "Download", "Your browser saves it, usually to Downloads."],
							],
							"project",
						),
					)
				: h("p", { class: "hint" }, ...stepNodes("To keep exports in one folder of your choosing, add a project under Settings → Projects.")),
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
	/** Whether a mural is being written for this dialog: closing it then stops the model (AI-B8). */
	let writing = false;
	/**
	 * Cancel or Escape ends the export: the wait for a mural stops, and nothing is downloaded or
	 * saved afterwards (UI-B9).
	 */
	const cancel = new AbortController();
	const dialog = /** @type {HTMLDialogElement} */ (
		h("dialog", {
			class: "dialog wide",
			"aria-labelledby": "export-title",
			onclose: () => {
				cancel.abort();
				if (writing) void api("POST", "/repos/mural/stop").catch(() => {});
				dialog.remove();
			},
		}, form)
	);

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
			replace(error, "A mural cannot go in a spreadsheet. Choose HTML, Markdown or JSON.");
			error.hidden = false;
			return;
		}
		setOff(submit, true);
		submit.textContent = "Exporting…";
		error.hidden = true;
		try {
			if (withMural) {
				submit.textContent = "Writing the mural…";
				await writeMural(settings);
				settings.set("mural", "1");
			}
			if (cancel.signal.aborted) return;
			const path = forDomain ? `/domains/${encodeURIComponent(target.domain)}/export?${settings}` : `/repos/export?${settings}`;
			if (project && chosen.get("where") === "project") {
				// The server writes it into the project's folder under a name of its own, and says where.
				const { saved } = await api("POST", path);
				dialog.close();
				announceSaved(saved);
				return;
			}
			const filename = await download(path);
			dialog.close();
			toast(`Saved ${filename}`);
		} catch (err) {
			// Cancelled: the dialog is gone, and nothing more is said.
			if (cancel.signal.aborted || isStopped(err)) return;
			// Stay open: the choices are still there to change or retry.
			progress.hidden = true;
			replace(error, err instanceof Error ? err.message : String(err));
			error.hidden = false;
			setOff(submit, false);
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
		// One already written for this scan and these filters is used as it is (C-Q1).
		if (!againBox.checked) {
			const kept = await api("GET", `/repos/mural?${query}`, undefined, { signal: cancel.signal });
			if (kept.state === "done" && kept.current) return;
		}
		const started = Date.now();
		await api("POST", `/repos/mural?${query}`, modelFields(assistant), { signal: cancel.signal });
		writing = true;
		progress.hidden = false;
		announce(`${assistant?.model ?? "The model"} is writing the mural. Cancel stops it.`);
		try {
			await waitUntil({
				every: 2000,
				signal: cancel.signal,
				check: async () => {
					const job = await api("GET", `/repos/mural?${query}`, undefined, { signal: cancel.signal });
					if (job.state === "done" && job.current) return { done: true, value: null };
					if (job.state === "failed") throw new Error(job.error);
					// Another tab's mural replaced this one: it will not finish here, so the wait ends rather than going on for ever.
					if (job.state !== "running" || !job.current) throw new Error("The mural was replaced or stopped elsewhere. Export again to write a new one.");
					const seconds = Math.round((Date.now() - started) / 1000);
					replace(progress, `${assistant?.model} is writing the mural: ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} so far. Cancel stops it.`);
					return { done: false };
				},
			});
		} finally {
			writing = false;
		}
		progress.hidden = true;
	}

	document.body.append(dialog);
	dialog.showModal();
}

/**
 * The button that opens the dialog. `off`: nothing to export; it stays focusable, saying so.
 *
 * @param {() => void} onClick
 * @param {boolean} [off]
 */
export function exportButton(onClick, off = false) {
	return h("button", { type: "button", class: "button", "aria-disabled": off ? "true" : null, title: off ? "Nothing to export yet" : null, onclick: onClick }, icon("download"), "Export");
}
