// The gate every request passes: who sent it, through which listener, and what it may change.
import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { networkInterfaces } from "node:os";

/** A request that is past the gate: who sent it is settled, and its body is read. */
export interface Call {
	req: IncomingMessage;
	res: ServerResponse;
	url: URL;
	/** The method and the path, as in "GET /api/state". */
	route: string;
	/** The JSON body of a POST; undefined for anything else. */
	body: unknown;
	gate: Gate;
}

/**
 * Who may change something through a route (any method but GET): "here", the page on the computer that
 * runs Porchlight only; "owner", that page or a service's own page, never another device on the tailnet;
 * "any", every page that holds its listener's key. A handler can be stricter still for one action.
 */
export type Changes = "here" | "owner" | "any";

/** Which requests an entry of the route table answers, what answers them, and who may change things through it (default "any"). */
export type Route = [claims: (call: Call) => boolean, answer: (call: Call) => void | Promise<void>, changes?: Changes];

/** Whether this gate may change things through a route that allows `changes`. */
export function mayChange(changes: Changes, gate: { loopbackOnly: boolean; tailnet: boolean }): boolean {
	return changes === "any" || (changes === "owner" ? onOwnPage(gate) : onComputerPage(gate));
}

/**
 * Who a request came in through. The page on this computer uses the per-run session key on loopback;
 * other devices use the access key on the tailnet address alone. Each listener takes only its own key.
 */
export interface Gate {
	loopbackOnly: boolean;
	key: () => string;
	port: () => number;
	tailnet: boolean;
}

export const SESSION_HEADER = "x-porchlight-session";
/** A fixed key guards a page other machines can reach; BoxPilot generates 32 characters. */
export const MIN_KEY_LENGTH = 32;
export const KEY_PATTERN = /^[\x21-\x7e]+$/;
export const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
/** A host name or bracketed IPv6 address, with an optional port. */
export const HOST_HEADER_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;

/** Refuses a fixed key that is too short to guard a page, or that cannot travel in a header. */
export function checkKey(key: string): void {
	if (key.length < MIN_KEY_LENGTH || !KEY_PATTERN.test(key)) {
		throw new Error(`PORCHLIGHT_UI_KEY must be at least ${MIN_KEY_LENGTH} characters, with no spaces or control characters`);
	}
}

/** This machine's Tailscale IPv4 address (100.64.0.0/10), or null when Tailscale is not up. */
export function tailnetAddress(): string | null {
	for (const addresses of Object.values(networkInterfaces())) {
		for (const entry of addresses ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			const [a, b] = entry.address.split(".").map(Number);
			if (a === 100 && b !== undefined && b >= 64 && b <= 127) return entry.address;
		}
	}
	return null;
}

/**
 * On loopback, only the server's own loopback names, which defeats DNS rebinding. Beyond it, any
 * well-formed name: people reach the page by a Tailscale name or a LAN address.
 */
export function hostAllowed(host: string, port: number, loopbackOnly: boolean): boolean {
	if (loopbackOnly) return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
	return HOST_HEADER_PATTERN.test(host);
}

/**
 * A cross-site Origin is refused. Beyond loopback, an HTTPS proxy such as Tailscale Serve sits in
 * front, so the browser's scheme differs from this server's and only the host part is compared.
 */
export function originAllowed(origin: string | undefined, host: string, loopbackOnly: boolean): boolean {
	if (origin === undefined) return true;
	if (loopbackOnly) return origin === `http://${host}`;
	try {
		return new URL(origin).host === host.toLowerCase();
	} catch {
		return false;
	}
}

export function sessionMatches(presented: string | string[] | undefined, expected: string): boolean {
	// No key set means nobody gets in, never that anybody does.
	if (typeof presented !== "string" || expected === "") return false;
	const a = Buffer.from(presented);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

/** The page on the computer that runs Porchlight: the loopback listener, never another device on the tailnet. */
export function onComputerPage(gate: { loopbackOnly: boolean; tailnet: boolean }): boolean {
	return gate.loopbackOnly && !gate.tailnet;
}

/**
 * The owner's own page: the one on the computer that runs Porchlight, or a service's own page. Never
 * another device over the tailnet. Looser than onComputerPage on purpose (invariant 23, projects).
 */
export function onOwnPage(gate: { tailnet: boolean }): boolean {
	return !gate.tailnet;
}
