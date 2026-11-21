// When each finding was first seen (R6Q-9) and the due dates the owner sets by severity (FT-14):
// GET /api/findings/seen, GET and POST /api/findings/due-policy. Both are shown beside a finding and
// change nothing else: not a severity, a count, the roadmap, an export or the exit code (invariant 17).
import { dirname, join } from "node:path";
import { readPrivateJson, UnreadableFileError, updatePrivateJson } from "../../private-files.ts";
import { datesFor, firstSeenPath, updateFirstSeen } from "../../repos/first-seen.ts";
import { History } from "../../repos/history.ts";
import { DEFAULT_DUE, duePolicyOf, type DuePolicy } from "../../../ui/due.js";
import type { ServerContext } from "../context.ts";
import type { Call } from "../gate.ts";
import { bodyObject, HttpError, sendJson } from "../http.ts";
import { otherMethods, type Route } from "../router.ts";
import { readReport } from "../report-cache.ts";

const PATHS = new Set(["/api/findings/seen", "/api/findings/due-policy"]);
const POLICY = "Your due dates";

/** First-seen dates and the owner's due dates; changed from the owner's own page. */
export function seenRoutes(ctx: ServerContext): Route[] {
	return [
		["GET /api/findings/due-policy", (call) => duePolicyRoute(ctx, call), "owner"],
		["POST /api/findings/due-policy", (call) => setDuePolicyRoute(ctx, call), "owner"],
		["GET /api/findings/seen", (call) => seenRoute(ctx, call), "owner"],
		otherMethods([...PATHS], "owner"),
	];
}

export function duePolicyPath(dataDir: string): string {
	return join(dataDir, "due-dates.json");
}

/** The owner's due dates, or the defaults when none are saved. A file that cannot be read is said, never taken for the defaults. */
export async function readDuePolicy(path: string): Promise<DuePolicy> {
	const read = await readPrivateJson(path);
	if (read.state === "missing") return DEFAULT_DUE;
	if (read.state === "unreadable") throw new UnreadableFileError(POLICY, read.reason);
	return duePolicyOf(read.value) ?? DEFAULT_DUE;
}

async function duePolicyRoute(ctx: ServerContext, { res }: Call): Promise<void> {
	return sendJson(res, 200, { policy: await readDuePolicy(duePolicyPath(ctx.dataDir)), defaults: DEFAULT_DUE });
}

async function setDuePolicyRoute(ctx: ServerContext, { res, body }: Call): Promise<void> {
	const fields = bodyObject(body);
	const policy = fields.reset === true ? DEFAULT_DUE : duePolicyOf(fields.policy);
	if (!policy) throw new HttpError(400, "Give each severity a whole number of days from 1 to 1000, or leave it empty for no due date");
	await updatePrivateJson(duePolicyPath(ctx.dataDir), POLICY, () => policy);
	ctx.log(`Due dates set: ${Object.entries(policy).map(([severity, days]) => `${severity} ${days === null ? "none" : `${days} days`}`).join(", ")}`);
	return sendJson(res, 200, { policy, defaults: DEFAULT_DUE });
}

async function seenRoute(ctx: ServerContext, { res }: Call): Promise<void> {
	const policyPath = duePolicyPath(ctx.dataDir);
	const report = await readReport(ctx.options.reportPath);
	if (!report) return sendJson(res, 200, { scannedAt: null, seen: {}, policy: await readDuePolicy(policyPath) });
	const reportDir = dirname(ctx.options.reportPath);
	const file = await updateFirstSeen(firstSeenPath(reportDir), new History(reportDir), report);
	return sendJson(res, 200, { scannedAt: report.scannedAt, seen: datesFor(file, report), policy: await readDuePolicy(policyPath) });
}
