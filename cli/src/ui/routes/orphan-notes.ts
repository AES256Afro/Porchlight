// The owner's notes that match no finding of any kept scan (R6Q-12), as a CSV to keep before they are
// removed or after moving to another computer (M15): GET /api/findings/orphans/export. Each cell is
// escaped against formulas (invariant 11), and the file's name is a fixed stem and the date, never
// anything from the request. The notes are the owner's own words; they carry no secret value (invariant 3).
import { dirname, join } from "node:path";
import { History, orphanNotes, readNotes } from "../../repos/history.ts";
import { csvRow } from "../../roadmap/escape.ts";
import { statusLabel } from "../../../ui/tracking.js";
import type { ServerContext } from "../context.ts";
import type { Call } from "../gate.ts";
import { HttpError, sendDownload } from "../http.ts";
import { readReport } from "../report-cache.ts";

const COLUMNS = ["Repository", "Rule or advisory", "Location", "Detail", "Status", "Accepted until", "Note", "Updated"];

/** Whether a request asks for the export. */
export function claimsOrphanExport(call: Call): boolean {
	return call.url.pathname === "/api/findings/orphans/export";
}

export async function orphanExportRoute(ctx: ServerContext, call: Call): Promise<void> {
	if (call.req.method !== "GET") throw new HttpError(405, "Method not allowed");
	// The same files the server keeps beside the report: its history and the owner's notes.
	const reportDir = dirname(ctx.options.reportPath);
	const notes = await readNotes(join(reportDir, "finding-notes.json"));
	const orphans = await orphanNotes(notes, new History(reportDir), await readReport(ctx.options.reportPath));
	const body = `${orphanNotesCsv(orphans.map((key) => ({ key, note: notes[key]! })))}\n`;
	sendDownload(call.res, { contentType: "text/csv; charset=utf-8", filename: `porchlight-unmatched-notes-${new Date().toISOString().slice(0, 10)}.csv`, body });
}

/** The notes as CSV rows, each cell escaped for a spreadsheet (escape.ts). */
export function orphanNotesCsv(entries: { key: string; note: { status: string; note: string; updatedAt: string; until?: string } }[]): string {
	return [
		csvRow(COLUMNS),
		...entries.map(({ key, note }) => {
			const [repo = "", ruleId = "", location = "", detail = ""] = key.split("\n");
			return csvRow([repo, ruleId, location, detail, statusLabel(note.status), note.until ?? "", note.note, note.updatedAt]);
		}),
	].join("\n");
}
