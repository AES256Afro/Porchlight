// What the Mac app's menu-bar item shows (FT-15): GET /api/menu-status, counts and times only, from the
// files Porchlight keeps (`readStatus`, as `porchlight status` reads them). No finding's title, place
// or value, no path of this computer and no address beyond the monitor's host: the app builds its
// menu and its notifications from these numbers in its own words.
import { readStatus } from "../../status.ts";
import type { ServerContext } from "../context.ts";
import type { Call } from "../gate.ts";
import { sendJson } from "../http.ts";
import { otherMethods, type Route } from "../router.ts";

export function menuStatusRoutes(ctx: ServerContext, scanning: () => boolean): Route[] {
	return [["GET /api/menu-status", (call) => menuStatusRoute(ctx, call, scanning)], otherMethods(["/api/menu-status"])];
}

async function menuStatusRoute(ctx: ServerContext, call: Call, scanning: () => boolean): Promise<void> {
	const status = await readStatus(ctx.dataDir, ctx.options.reportPath);
	const repos = status.repos.state === "read" ? { state: "read" as const, scannedAt: status.repos.scannedAt, findings: status.repos.findings, bySeverity: status.repos.bySeverity, complete: status.repos.complete } : { state: status.repos.state };
	const host = status.host.state === "read" ? { state: "read" as const, checkedAt: status.host.checkedAt, failed: status.host.failed, couldNotCheck: status.host.couldNotCheck } : { state: status.host.state };
	return sendJson(call.res, 200, { repos, host, scanning: scanning() });
}
