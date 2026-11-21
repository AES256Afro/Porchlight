// The route table and its one dispatch (RD-2). Each route module returns its entries; the server puts
// them in one table in order, and the first entry that claims a request answers it. A handler answers
// one route: it never looks at the route again to decide what to do.
import { mayChange, type Call, type Changes } from "./gate.ts";
import { HttpError } from "./http.ts";

export type Answer = (call: Call) => void | Promise<void>;

/**
 * Which requests an entry answers, what answers them, and who may change things through it (default
 * "any"). A string claims exactly that method and path ("POST /api/projects"); a function claims a
 * family of paths, and its handler then says which methods it takes.
 */
export type Route = [claims: string | ((call: Call) => boolean), answer: Answer, changes?: Changes];

/** A path and everything beneath it, whatever the method. */
export function under(path: string): (call: Call) => boolean {
	return (call) => call.url.pathname === path || call.url.pathname.startsWith(`${path}/`);
}

/** Exactly these paths, whatever the method. */
export function paths(...names: string[]): (call: Call) => boolean {
	return (call) => names.includes(call.url.pathname);
}

/**
 * What answers a request under `path` that no route of the area claimed, after the area's own check:
 * "Not found", as the area always said for a route it does not have.
 */
export function notFoundUnder(path: string, changes: Changes = "any", check?: (call: Call) => void): Route {
	return [
		under(path),
		(call) => {
			check?.(call);
			throw new HttpError(404, "Not found");
		},
		changes,
	];
}

/** A method these paths do not take: "Method not allowed", after the same access check as their routes. */
export function otherMethods(names: string[], changes: Changes = "any"): Route {
	return [
		paths(...names),
		() => {
			throw new HttpError(405, "Method not allowed");
		},
		changes,
	];
}

/**
 * The one dispatch: the first entry that claims the request answers it. Anything but a GET through a
 * route that limits who changes things is refused first (S20).
 */
export function dispatch(table: Route[], call: Call): void | Promise<void> {
	for (const [claims, answer, changes = "any"] of table) {
		if (typeof claims === "string" ? claims !== call.route : !claims(call)) continue;
		// Settings that decide where data goes or what is kept are changed from the owner's own page (S20).
		if (call.req.method !== "GET" && !mayChange(changes, call.gate)) throw new HttpError(403, "This is changed from the page on the computer that runs Porchlight");
		return answer(call);
	}
	throw new HttpError(404, "Not found");
}
