// The egress log (R6F-3): GET /api/egress, every request the server sent out since it started, by
// host and purpose. Hosts, methods, purposes, times and statuses only: never a path, a body, a key or
// a token (cli/src/egress.ts).
import type { EgressLog } from "../../egress.ts";
import type { Call } from "../gate.ts";
import { HttpError, sendJson } from "../http.ts";

export function claimsEgress(call: Call): boolean {
	return call.url.pathname === "/api/egress";
}

export function egressRoute(log: EgressLog, call: Call): void {
	if (call.req.method !== "GET") throw new HttpError(405, "Method not allowed");
	const since = Number.parseInt(call.url.searchParams.get("since") ?? "0", 10);
	sendJson(call.res, 200, { records: log.list(Number.isInteger(since) && since > 0 ? since : 0), byHost: log.byHost() });
}
