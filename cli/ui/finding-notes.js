// @ts-check
// The owner's own tracking beside a finding: "New since the last scan", and a status and note they
// set. Built with h() like everything else; the note is the owner's text, shown as text.
import { h, replace, toast } from "./dom.js";
import { isNew, noteFor, saveFindingNote } from "./store.js";
import { acceptanceEnded, localDay, MAX_NOTE, statusesFor, statusLabel } from "./tracking.js";

/** @typedef {{ ruleId: string, location: string, detail: string, kind?: string }} FindingId */

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
		// An accepted risk past its end date is said to have ended, so it is looked at again.
		acceptanceEnded(note)
			? h("span", { class: "tag tag-status status-ended", title: `Accepted until ${note?.until}` }, "Acceptance ended")
			: note && note.status !== "open"
				? h("span", { class: `tag tag-status status-${note.status}`, title: note.status === "accepted" && note.until ? `Until ${note.until}` : null }, statusLabel(note.status))
				: null,
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
	const until = /** @type {HTMLInputElement} */ (h("input", { type: "date", min: localDay(), value: saved?.until ?? "", "aria-label": "Accept this risk until" }));
	const untilField = h("label", { class: "field" }, h("span", { class: "hint" }, "Until (optional)"), until);
	const status = /** @type {HTMLSelectElement} */ (
		h(
			"select",
			{ "aria-label": "Status", onchange: () => showUntil() },
			...statusesFor(finding.kind ?? "").map(([value, label]) => h("option", { value, selected: value === (saved?.status ?? "open") }, label)),
		)
	);
	// The end date belongs to an accepted risk alone.
	const showUntil = () => {
		untilField.hidden = status.value !== "accepted";
	};
	showUntil();
	const ended = acceptanceEnded(saved)
		? h("p", { class: "form-error", role: "note" }, `You accepted this risk until ${saved?.until}. That day has passed: look at it again, then set a new date or another status.`)
		: null;
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
						await saveFindingNote(repo, finding, status.value, note.value, until.value);
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
		ended,
		h("div", { class: "note-row" }, h("label", { class: "field" }, h("span", { class: "hint" }, "Status"), status), untilField, button, when),
		note,
		h(
			"p",
			{ class: "hint" },
			finding.kind === "secret"
				? "Kept for this finding in later scans too. It never changes the finding's severity or the counts: a rotated secret stays in git history, so it stays listed."
				: "Kept for this finding in later scans too. It never changes the finding's severity or the counts.",
		),
	);
}
