// The owner's status and note for findings of the latest scan (invariant 17): one, many at once (B-Q2),
// and the notes that name no finding any more (R6Q-12). Kept by the finding's identity, so they carry
// over to later scans; they never change the finding itself.
import { locateFinding } from "../../assist/prompts.ts";
import { orphanNotes, readNotes, removeNotes, setNote, setNotes } from "../../repos/history.ts";
import { findingKey, isDay, isStatus, MAX_NOTE, type NoteSource } from "../../../ui/tracking.js";
import type { ServerContext } from "../context.ts";
import type { Call, Gate } from "../gate.ts";
import { bodyObject, HttpError, sendJson, textField } from "../http.ts";
import { readReport } from "../report-cache.ts";
import { otherMethods, type Route } from "../router.ts";

/** The most findings one "Set status for N" changes at once (B-Q2). */
const MAX_BULK_NOTES = 500;

/** Where a status is set from, recorded beside it (R6U-7). */
function noteSource(gate: Gate): NoteSource {
	return gate.tailnet ? "device" : gate.loopbackOnly ? "here" : "service";
}

/** The note's text, checked as for one finding or many. */
function noteText(fields: Record<string, unknown>): string {
	const note = fields.note ?? "";
	if (typeof note !== "string" || note.length > MAX_NOTE) throw new HttpError(400, `Keep the note to ${MAX_NOTE} characters`);
	return note;
}

/** An accepted risk may carry the last day it is accepted for: a day from today on, so it cannot be saved already ended. */
function untilField(fields: Record<string, unknown>): string | undefined {
	const until = fields.until === undefined || fields.until === "" ? undefined : fields.until;
	if (until !== undefined) {
		if (fields.status !== "accepted") throw new HttpError(400, "Only an accepted risk has an end date");
		if (!isDay(until)) throw new HttpError(400, "Give the end date as a day, such as 2027-06-30");
		if (until < new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)) throw new HttpError(400, "Choose an end date that has not passed");
	}
	return until as string | undefined;
}

export function noteRoutes(ctx: ServerContext): Route[] {
	const { options, history, notesPath, log } = ctx;

	async function oneNote({ res, body, gate }: Call): Promise<void> {
		const fields = bodyObject(body);
		const target = {
			repo: textField(fields, "repo", 1000),
			ruleId: textField(fields, "ruleId", 500),
			location: textField(fields, "location", 2000),
			detail: textField(fields, "detail", 2000),
		};
		if (!isStatus(fields.status)) throw new HttpError(400, "Choose a status");
		const note = noteText(fields);
		const report = await ctx.storedReport();
		const found = locateFinding(report, target);
		if (!found) throw new HttpError(404, "That finding is not in the latest scan. Reload the page to see the current one.");
		// A credential can be rotated; a vulnerable package is upgraded, which the next scan sees for itself.
		if (fields.status === "rotated" && found.finding.kind !== "secret") throw new HttpError(400, "Only a secret can be marked rotated");
		const until = untilField(fields);
		const key = findingKey(target.repo, target);
		return sendJson(res, 200, { key, note: await setNote(notesPath, key, fields.status, note, new Date(), until, noteSource(gate)) });
	}

	/**
	 * One status and note for many findings of the latest scan at once (B-Q2): each is found in the
	 * report as for one, and all are saved in one change, or none when any is not there.
	 */
	async function manyNotes({ res, body, gate }: Call): Promise<void> {
		const fields = bodyObject(body);
		if (!isStatus(fields.status)) throw new HttpError(400, "Choose a status");
		const note = noteText(fields);
		const items = fields.findings;
		if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BULK_NOTES) throw new HttpError(400, `Choose from 1 to ${MAX_BULK_NOTES} findings`);
		const until = untilField(fields);
		const report = await ctx.storedReport();
		const keys: string[] = [];
		for (const item of items) {
			const one = bodyObject(item);
			const target = { repo: textField(one, "repo", 1000), ruleId: textField(one, "ruleId", 500), location: textField(one, "location", 2000), detail: textField(one, "detail", 2000) };
			const found = locateFinding(report, target);
			if (!found) throw new HttpError(404, "A chosen finding is not in the latest scan. Reload the page to see the current one.");
			if (fields.status === "rotated" && found.finding.kind !== "secret") throw new HttpError(400, "Only a secret can be marked rotated. Leave out the findings that are not secrets.");
			keys.push(findingKey(target.repo, target));
		}
		const saved = await setNotes(notesPath, keys, fields.status, note, new Date(), until, noteSource(gate));
		return sendJson(res, 200, { notes: keys.map((key, index) => ({ key, note: saved[index] ?? null })) });
	}

	/** Notes that name no finding of any kept scan (R6Q-12): counted, listed by place and status. */
	async function orphans({ res }: Call): Promise<void> {
		const notes = await readNotes(notesPath);
		const found = await orphanNotes(notes, history, await readReport(options.reportPath));
		return sendJson(res, 200, {
			count: found.length,
			notes: found.slice(0, 200).map((key) => {
				const [repo = "", ruleId = "", location = ""] = key.split("\n");
				const entry = notes[key]!;
				return { repo, ruleId, location, status: entry.status, updatedAt: entry.updatedAt, ...(entry.until ? { until: entry.until } : {}) };
			}),
		});
	}

	/** Removed only when the owner asks, and only those. */
	async function removeOrphans({ res }: Call): Promise<void> {
		const notes = await readNotes(notesPath);
		const found = await orphanNotes(notes, history, await readReport(options.reportPath));
		const removed = await removeNotes(notesPath, found);
		log(`Removed ${removed === 1 ? "1 note" : `${removed} notes`} that matched no kept finding`);
		return sendJson(res, 200, { removed });
	}

	return [
		["POST /api/findings/note", oneNote],
		["POST /api/findings/notes", manyNotes],
		["GET /api/findings/orphans", orphans, "owner"],
		["POST /api/findings/orphans/remove", removeOrphans, "owner"],
		otherMethods(["/api/findings/orphans", "/api/findings/orphans/remove"], "owner"),
	];
}
