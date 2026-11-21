// The egress log (R6F-3): GET /api/egress, every request the server sent out since it started, by
// host and purpose. Hosts, methods, purposes, times and statuses only: never a path, a body, a key or
// a token (cli/src/egress.ts).
import type { EgressLog } from "../../egress.ts";
import type { Call } from "../gate.ts";
import { sendJson } from "../http.ts";
import { otherMethods, type Route } from "../router.ts";

export function egressRoutes(log: EgressLog): Route[] {
	return [["GET /api/egress", (call) => egressRoute(log, call)], otherMethods(["/api/egress"])];
}

function egressRoute(log: EgressLog, call: Call): void {
	const since = Number.parseInt(call.url.searchParams.get("since") ?? "0", 10);
	sendJson(call.res, 200, { records: log.list(Number.isInteger(since) && since > 0 ? since : 0), byHost: log.byHost() });
}
