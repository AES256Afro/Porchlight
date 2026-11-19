// @ts-check
// The owner's own tracking beside a finding: "New since the last scan", and a status and note they
// set. Built with h() like everything else; the note is the owner's text, shown as text.
import { h, replace, toast } from "./dom.js";
import { isNew, noteFor, saveFindingNote } from "./store.js";
import { MAX_NOTE, STATUSES, statusLabel } from "./tracking.js";

/** @typedef {{ ruleId: string, location: string, detail: string }} FindingId */

/**
 * Small marks for a finding's row: new since the previous scan, and the owner's status when it is
 * not "Open". Words, not colour alone.
 *
 * @param {string} repo
 * @param {FindingId} finding
 */
export function trackingMarks(repo, finding) {
	const note = noteFor(repo, finding);
	const marks = [
		isNew(repo, finding) ? h("span", { class: "tag tag-new", title: "Not in the previous scan" }, "New") : null,
		note && note.status !== "open" ? h("span", { class: `tag tag-status status-${note.status}` }, statusLabel(note.status)) : null,
		note?.note ? h("span", { class: "tag", title: note.note }, "Note") : null,
	].filter(Boolean);
	return marks.length > 0 ? h("div", { class: "tags" }, ...marks) : null;
}

/**
 * The status and note editor in a finding's detail. Saved when the owner presses Save; kept by the
 * finding's identity, so it is still there after the next scan.
 *
 * @param {string} repo
 * @param {FindingId} finding
 */
export function noteEditor(repo, finding) {
	const saved = noteFor(repo, finding);
	const status = /** @type {HTMLSelectElement} */ (
		h("select", { "aria-label": "Status" }, ...STATUSES.map(([value, label]) => h("option", { value, selected: value === (saved?.status ?? "open") }, label)))
	);
	const note = /** @type {HTMLTextAreaElement} */ (
		h("textarea", { rows: 2, maxLength: MAX_NOTE, "aria-label": "Note", placeholder: "Your note: a ticket, who is on it, why the risk is accepted…" })
	);
	note.value = saved?.note ?? "";
	const when = h("span", { class: "hint" }, saved?.updatedAt ? `Saved ${new Date(saved.updatedAt).toLocaleString()}` : "");
	const button = /** @type {HTMLButtonElement} */ (
		h(
			"button",
			{
				type: "button",
				class: "button",
				onclick: async () => {
					button.disabled = true;
					try {
						await saveFindingNote(repo, finding, status.value, note.value);
						replace(when, "Saved just now");
						toast("Saved");
					} catch (err) {
						toast(err instanceof Error ? err.message : String(err), "error");
					} finally {
						button.disabled = false;
					}
				},
			},
			"Save",
		)
	);
	return h(
		"div",
		{ class: "note-editor", onclick: (/** @type {MouseEvent} */ event) => event.stopPropagation() },
		h("h3", null, "Your status and note"),
		h("div", { class: "note-row" }, h("label", { class: "field" }, h("span", { class: "hint" }, "Status"), status), button, when),
		note,
		h("p", { class: "hint" }, "Kept for this finding in later scans too. It never changes the finding's severity or the counts."),
	);
}
