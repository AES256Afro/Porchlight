// @ts-check
import { download } from "./api.js";
import { h, icon, toast } from "./dom.js";
import { isFiltering } from "./filter.js";
import { paramsFromFilter } from "./list.js";

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
			error,
			h("div", { class: "actions" }, h("button", { type: "button", class: "button", onclick: () => dialog.close() }, "Cancel"), submit),
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
		const path = forDomain ? `/domains/${encodeURIComponent(target.domain)}/export?${settings}` : `/repos/export?${settings}`;
		submit.disabled = true;
		submit.textContent = "Exporting…";
		error.hidden = true;
		try {
			const filename = await download(path);
			dialog.close();
			toast(`Saved ${filename}`);
		} catch (err) {
			// Stay open: the choices are still there to change or retry.
			error.textContent = err instanceof Error ? err.message : String(err);
			error.hidden = false;
			submit.disabled = false;
			submit.textContent = "Export";
		}
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
