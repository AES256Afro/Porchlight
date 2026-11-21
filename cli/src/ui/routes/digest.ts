// The weekly digest (FT-13): sent only by the schedule, after a scheduled scan, once a week, and only
// when the owner turned it on (PORCHLIGHT_NOTIFY_DIGEST=weekly) and set where notices go
// (PORCHLIGHT_NOTIFY_URL). It is built from Porchlight's own files: the latest report, the scan
// history, the owner's notes and due dates, and the last check of this computer.
import { dirname, join } from "node:path";
import { digestDue, digestNotice } from "../../notify/digest.ts";
import { noticeRequest } from "../../notify/format.ts";
import { readPrivateJson, writePrivateJson } from "../../private-files.ts";
import { datesFor, firstSeenPath, updateFirstSeen } from "../../repos/first-seen.ts";
import { History, notesForPage } from "../../repos/history.ts";
import type { Project } from "../../projects/projects.ts";
import type { ServerContext } from "../context.ts";
import { readHostReport } from "../kept-files.ts";
import { readReport } from "../report-cache.ts";
import { duePolicyPath, readDuePolicy } from "./seen.ts";
import { DEFAULT_DUE } from "../../../ui/due.js";

/** Whether the environment asks for a weekly digest. */
export function digestWanted(value: string | undefined): boolean {
	return /^(?:weekly|1|true|yes)$/i.test(value?.trim() ?? "");
}

export function createDigest(ctx: ServerContext) {
	const statePath = join(ctx.dataDir, "digest.json");

	/**
	 * After a scheduled scan: sends the digest when it is on and a week has passed since the last one
	 * delivered. A digest that is not delivered is tried again after the next scheduled scan. Never throws.
	 */
	async function afterScheduledScan(project: Project | null, now: Date = new Date()): Promise<void> {
		const { options } = ctx;
		if (!options.digest || !options.notify) return;
		try {
			const state = await readPrivateJson(statePath);
			// A state file that cannot be read is not written over, and no digest is sent on a guess.
			if (state.state === "unreadable") return ctx.note(`The weekly digest's record could not be read (${state.reason}), so none was sent`, "warning");
			const lastSentAt = state.state === "read" ? (state.value as { lastSentAt?: unknown } | null)?.lastSentAt : undefined;
			if (!digestDue(typeof lastSentAt === "string" ? lastSentAt : null, now)) return;

			const report = await readReport(options.reportPath).catch(() => null);
			const reportDir = dirname(options.reportPath);
			const history = new History(reportDir);
			const entries = await history.list().catch(() => []);
			const notes = (await notesForPage(join(reportDir, "finding-notes.json"))).notes;
			const seen = report ? datesFor(await updateFirstSeen(firstSeenPath(reportDir), history, report).catch(() => ({ through: null, seen: {} })), report) : {};
			const policy = await readDuePolicy(duePolicyPath(ctx.dataDir)).catch(() => DEFAULT_DUE);
			const host = ctx.loopbackOnly ? await readHostReport(join(ctx.dataDir, "host-check.json")) : null;
			const notice = digestNotice({
				now,
				report,
				history: entries,
				notes,
				seen,
				policy,
				host: host ? { checkedAt: host.checkedAt, failed: host.checks.filter((check) => check.status === "failed").length, unknown: host.checks.filter((check) => check.status === "unknown").length } : null,
			});
			const { headers, body } = noticeRequest(options.notify.format, notice);
			const response = await (options.fetchFn ?? fetch)(options.notify.url, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(15_000) });
			await response.body?.cancel();
			if (!response.ok) return ctx.log(`${options.notify.url.host} refused the weekly digest (HTTP ${response.status})`, project);
			await writePrivateJson(statePath, { lastSentAt: now.toISOString() });
			ctx.log(`Sent the weekly digest to ${options.notify.url.host}`, project);
		} catch (err) {
			ctx.log(`Could not send the weekly digest to ${options.notify.url.host}: ${err instanceof Error ? err.message : String(err)}`, project);
		}
	}

	return { afterScheduledScan };
}
