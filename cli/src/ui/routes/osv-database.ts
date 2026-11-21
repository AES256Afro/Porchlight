// How old the OSV databases kept beside the data are (GET /api/repos/osv-database), shown where the scan
// form says whether the scanners are ready. Only with PORCHLIGHT_OSV_OFFLINE: otherwise osv-scanner
// asks api.osv.dev at each scan and there is nothing kept to be old. Reads one file Porchlight wrote
// itself; contacts nothing.
import { join } from "node:path";
import { osvDatabaseRefreshedAt } from "../../repos/osv.ts";
import type { ServerContext } from "../context.ts";
import type { Call } from "../gate.ts";
import { sendJson } from "../http.ts";
import { otherMethods, type Route } from "../router.ts";

/** The databases' age, and nothing else at that path. */
export function osvDatabaseRoutes(ctx: ServerContext): Route[] {
	return [["GET /api/repos/osv-database", (call) => osvDatabaseRoute(ctx, call)], otherMethods(["/api/repos/osv-database"])];
}

async function osvDatabaseRoute(ctx: ServerContext, call: Call): Promise<void> {
	if (!ctx.options.osvOffline) return sendJson(call.res, 200, { offline: false, refreshedAt: null });
	// The same folder the scans use (`osv-db` in the data folder).
	const at = await osvDatabaseRefreshedAt(join(ctx.dataDir, "osv-db"));
	return sendJson(call.res, 200, { offline: true, refreshedAt: at ? at.toISOString() : null });
}
