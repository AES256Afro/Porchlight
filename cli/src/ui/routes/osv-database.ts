// How old the OSV databases kept beside the data are (GET /api/repos/osv-database), shown where the scan
// form says whether the scanners are ready. Only with PORCHLIGHT_OSV_OFFLINE: otherwise osv-scanner
// asks api.osv.dev at each scan and there is nothing kept to be old. Reads one file Porchlight wrote
// itself; contacts nothing.
import { join } from "node:path";
import { osvDatabaseRefreshedAt } from "../../repos/osv.ts";
import type { ServerContext } from "../context.ts";
import type { Call } from "../gate.ts";
import { HttpError, sendJson } from "../http.ts";

/** Whether a request asks for the databases' age. */
export function claimsOsvDatabase(call: Call): boolean {
	return call.url.pathname === "/api/repos/osv-database";
}

export async function osvDatabaseRoute(ctx: ServerContext, call: Call): Promise<void> {
	if (call.req.method !== "GET") throw new HttpError(405, "Method not allowed");
	if (!ctx.options.osvOffline) return sendJson(call.res, 200, { offline: false, refreshedAt: null });
	// The same folder the scans use (`osv-db` in the data folder).
	const at = await osvDatabaseRefreshedAt(join(ctx.dataDir, "osv-db"));
	return sendJson(call.res, 200, { offline: true, refreshedAt: at ? at.toISOString() : null });
}
