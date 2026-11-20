/**
 * What the Cloudflare audit keeps beside the report, each file readable by its owner alone (0600):
 *
 * - `cloudflare-settings.json`: the API token pasted under Settings → Cloudflare. Like the model keys
 *   (`cli/src/assist/settings.ts`) it is sent once to Porchlight's own server, kept here, and never
 *   sent back to the page, a log, a report or a model. It travels only to `CLOUDFLARE_API`.
 * - `cloudflare-audit.json`: the latest audit. It names records and masked members, never the token.
 * - `cloudflare-changes.json`: every change applied after the owner approved it, with the exact request.
 */
import { readFile, rm } from "node:fs/promises";
import { writePrivate } from "../investigate/ownership.ts";
import { tokenShapeProblem } from "./client.ts";
import type { CfReport } from "./types.ts";

export interface SavedToken {
	token: string;
	savedAt: string;
}

export async function readSavedToken(path: string): Promise<SavedToken | null> {
	try {
		const saved = JSON.parse(await readFile(path, "utf8")) as Partial<SavedToken>;
		if (typeof saved.token !== "string" || tokenShapeProblem(saved.token)) return null;
		return { token: saved.token, savedAt: typeof saved.savedAt === "string" ? saved.savedAt : "" };
	} catch {
		return null;
	}
}

export async function saveToken(path: string, token: string): Promise<SavedToken> {
	const problem = tokenShapeProblem(token);
	if (problem) throw new Error(problem);
	const saved = { token, savedAt: new Date().toISOString() };
	await writePrivate(path, `${JSON.stringify(saved, null, "\t")}\n`);
	return saved;
}

export async function forgetToken(path: string): Promise<void> {
	await rm(path, { force: true });
}

export async function readAudit(path: string): Promise<CfReport | null> {
	try {
		const report = JSON.parse(await readFile(path, "utf8")) as CfReport;
		return Array.isArray(report?.zones) && Array.isArray(report?.accounts) ? { ...report, userChecks: Array.isArray(report.userChecks) ? report.userChecks : [] } : null;
	} catch {
		return null;
	}
}

export async function saveAudit(path: string, report: CfReport): Promise<void> {
	await writePrivate(path, `${JSON.stringify(report, null, "\t")}\n`);
}

/** One change Porchlight made in the owner's Cloudflare account, after they approved it. */
export interface AppliedChange {
	at: string;
	zone: string;
	zoneId: string;
	change: string;
	title: string;
	/** Exactly what was sent, without the Authorization header. */
	request: { method: string; url: string; body: unknown };
	ok: boolean;
	/** What Cloudflare answered, in words. */
	result: string;
}

/** Changes kept in the log; older ones are dropped. */
const MAX_CHANGES = 500;

export async function readChanges(path: string): Promise<AppliedChange[]> {
	try {
		const saved = JSON.parse(await readFile(path, "utf8")) as { changes?: unknown };
		return Array.isArray(saved.changes) ? (saved.changes as AppliedChange[]) : [];
	} catch {
		return [];
	}
}

export async function recordChange(path: string, change: AppliedChange): Promise<AppliedChange[]> {
	const changes = [...(await readChanges(path)), change].slice(-MAX_CHANGES);
	await writePrivate(path, `${JSON.stringify({ changes }, null, "\t")}\n`);
	return changes;
}
