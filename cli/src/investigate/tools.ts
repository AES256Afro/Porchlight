/**
 * The fixed tools an investigation may use. There is no shell and no free-form command: each tool
 * takes a small set of named arguments, checked strictly here, and every target is checked against
 * the scope before anything is sent. Each run is kept whole as evidence, request and response.
 *
 * Host names are resolved once with the system's resolver and the connection is made to that
 * address, so a DNS change between the check and the request cannot send it elsewhere. An address
 * on a private, loopback or otherwise non-public network is refused: a name under the owner's domain
 * that points into a home or office network is not something to probe from here.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, connect, isIP, type LookupFunction } from "node:net";
import { CHALLENGE_LABEL, RECORD_TYPES, resolveDoh, type RecordType } from "./ownership.ts";
import { Scope, ScopeError } from "./scope.ts";

export const HTTP_METHODS = ["GET", "HEAD", "OPTIONS"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];
export type ToolName = "dns_lookup" | "http_request" | "tcp_connect";

/** The longest response body kept as evidence. */
export const MAX_BODY = 32 * 1024;
const MAX_URL = 2000;
const TIMEOUT_MS = 15_000;
export const USER_AGENT = "SecurityX-investigation (owner-verified; see _securityx-challenge TXT)";

export interface ToolSpec {
	name: ToolName;
	description: string;
	args: Record<string, string>;
	/** Touches the target itself, so the owner approves each one first. */
	needsApproval: boolean;
}

export const TOOLS: readonly ToolSpec[] = [
	{
		name: "dns_lookup",
		description: "Look up DNS records for an in-scope host, over DNS-over-HTTPS. Does not contact the host.",
		args: { host: "host name under the verified domain", record_type: RECORD_TYPES.join("|") },
		needsApproval: false,
	},
	{
		name: "http_request",
		description: "Send one HTTP request to an in-scope URL, with no body and no cookies. Redirects are not followed: a redirect is reported with its Location.",
		args: { url: "http:// or https:// URL on an in-scope host", method: HTTP_METHODS.join("|") },
		needsApproval: true,
	},
	{
		name: "tcp_connect",
		description: "Check whether one TCP port on an in-scope host accepts a connection. Nothing is sent.",
		args: { host: "host name under the verified domain", port: "1-65535" },
		needsApproval: true,
	},
];

export type Action =
	| { tool: "dns_lookup"; host: string; recordType: RecordType }
	| { tool: "http_request"; url: string; method: HttpMethod; host: string }
	| { tool: "tcp_connect"; host: string; port: number };

export class ToolError extends Error {}

const ALLOWED_ARGS: Record<ToolName, readonly string[]> = {
	dns_lookup: ["host", "record_type"],
	http_request: ["url", "method"],
	tcp_connect: ["host", "port"],
};

export function toolSpec(name: string): ToolSpec | undefined {
	return TOOLS.find((tool) => tool.name === name);
}

/**
 * Checks a tool call as the model wrote it and returns it in SecurityX's own shape. Anything not
 * exactly right is refused with a reason the model is shown: an unknown tool, an argument that is
 * not listed, a value of the wrong type, a target out of scope. Nothing is guessed or repaired.
 */
export function parseAction(tool: unknown, args: unknown, scope: Scope): Action {
	if (typeof tool !== "string" || !toolSpec(tool)) throw new ToolError(`unknown tool ${JSON.stringify(String(tool).slice(0, 40))}: use one of ${TOOLS.map((spec) => spec.name).join(", ")}`);
	const name = tool as ToolName;
	if (args === null || typeof args !== "object" || Array.isArray(args)) throw new ToolError("args must be an object");
	const fields = args as Record<string, unknown>;
	const extra = Object.keys(fields).filter((key) => !ALLOWED_ARGS[name].includes(key));
	if (extra.length > 0) throw new ToolError(`${name} takes only ${ALLOWED_ARGS[name].join(" and ")}, not ${extra.slice(0, 3).join(", ")}`);

	if (name === "dns_lookup") {
		const host = scope.check(fields.host);
		if (host.split(".").includes(CHALLENGE_LABEL)) throw new ToolError("the ownership record is not part of the investigation");
		const recordType = fields.record_type ?? "A";
		if (typeof recordType !== "string" || !(RECORD_TYPES as readonly string[]).includes(recordType.toUpperCase())) {
			throw new ToolError(`record_type must be one of ${RECORD_TYPES.join(", ")}`);
		}
		return { tool: name, host, recordType: recordType.toUpperCase() as RecordType };
	}

	if (name === "http_request") {
		const raw = fields.url;
		if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_URL) throw new ToolError(`url must be a URL of at most ${MAX_URL} characters`);
		if (/[\s\x00-\x1f\x7f]/.test(raw)) throw new ToolError("url must not contain spaces or control characters");
		let url: URL;
		try {
			url = new URL(raw);
		} catch {
			throw new ToolError("url is not a URL");
		}
		if (url.protocol !== "http:" && url.protocol !== "https:") throw new ToolError("url must start with http:// or https://");
		if (url.username || url.password) throw new ToolError("url must not carry a user name or password");
		const host = scope.check(url.hostname);
		const method = fields.method ?? "GET";
		if (typeof method !== "string" || !(HTTP_METHODS as readonly string[]).includes(method.toUpperCase())) throw new ToolError(`method must be one of ${HTTP_METHODS.join(", ")}`);
		url.hash = "";
		return { tool: name, url: url.href, method: method.toUpperCase() as HttpMethod, host };
	}

	const host = scope.check(fields.host);
	const port = fields.port;
	if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) throw new ToolError("port must be a whole number from 1 to 65535");
	return { tool: name, host, port };
}

/** The action in words, as the approval prompt and the log show it. */
export function describeAction(action: Action): string {
	if (action.tool === "dns_lookup") return `dns_lookup ${action.recordType} ${action.host}`;
	if (action.tool === "http_request") return `http_request ${action.method} ${action.url}`;
	return `tcp_connect ${action.host}:${action.port}`;
}

/** The action's arguments as the model gave them, normalised. */
export function actionArgs(action: Action): Record<string, string | number> {
	if (action.tool === "dns_lookup") return { host: action.host, record_type: action.recordType };
	if (action.tool === "http_request") return { url: action.url, method: action.method };
	return { host: action.host, port: action.port };
}

export interface HttpResult {
	status: number;
	statusText: string;
	httpVersion: string;
	headers: [string, string][];
	body: string;
	truncated: boolean;
}

/** The network, injected: tests pass a scripted one and nothing leaves the machine. */
export interface Net {
	/** For DNS-over-HTTPS only. */
	fetch: typeof fetch;
	/** The system resolver: every address a name has. */
	lookup(host: string): Promise<string[]>;
	http(request: { url: URL; method: HttpMethod; address: string; signal?: AbortSignal }): Promise<HttpResult>;
	tcp(request: { host: string; address: string; port: number; signal?: AbortSignal }): Promise<{ open: boolean; detail: string }>;
}

export interface ToolOutcome {
	ok: boolean;
	request: string;
	response: string;
}

/** Runs an already checked action. Failures to reach a host are outcomes, kept as evidence; only a refusal throws. */
export async function runAction(action: Action, net: Net, signal?: AbortSignal): Promise<ToolOutcome> {
	if (action.tool === "dns_lookup") {
		const request = `DNS-over-HTTPS query: ${action.recordType} ${action.host} (asked of cloudflare-dns.com; the host itself is not contacted)`;
		try {
			const { status, answers } = await resolveDoh(action.host, action.recordType, net.fetch, signal);
			const lines = answers.map((answer) => `${answer.name} ${answer.TTL ?? ""} type=${answer.type} ${answer.data}`.replace(/\s+/g, " "));
			return { ok: true, request, response: `DNS status ${status === 3 ? "NXDOMAIN (no such name)" : "NOERROR"}\n${lines.length ? lines.join("\n") : "(no records)"}` };
		} catch (err) {
			return { ok: false, request, response: `lookup failed: ${message(err)}` };
		}
	}

	const address = await pinnedAddress(action.host, net);
	if (action.tool === "tcp_connect") {
		const request = `TCP connect ${action.host}:${action.port} (address ${address}); nothing is sent`;
		try {
			const { open, detail } = await net.tcp({ host: action.host, address, port: action.port, signal });
			return { ok: true, request, response: open ? `open: the port accepted a connection` : `closed or filtered: ${detail}` };
		} catch (err) {
			return { ok: false, request, response: `connect failed: ${message(err)}` };
		}
	}

	const url = new URL(action.url);
	const request = [`${action.method} ${url.pathname}${url.search} HTTP/1.1`, `Host: ${url.host}`, `User-Agent: ${USER_AGENT}`, "Accept: */*", `(connected to ${address}; redirects not followed)`].join("\n");
	try {
		const result = await net.http({ url, method: action.method, address, signal });
		const head = [`HTTP/${result.httpVersion} ${result.status} ${result.statusText}`, ...result.headers.map(([name, value]) => `${name}: ${value}`)].join("\n");
		const body = result.body + (result.truncated ? `\n…[cut at ${MAX_BODY} bytes]` : "");
		return { ok: true, request, response: `${head}\n\n${body}` };
	} catch (err) {
		return { ok: false, request, response: `request failed: ${message(err)}` };
	}
}

/**
 * The one address an action connects to. Refused (a ToolError, so the model is told) when the name
 * does not resolve or any of its addresses is not on the public internet.
 */
async function pinnedAddress(host: string, net: Net): Promise<string> {
	let addresses: string[];
	try {
		addresses = await net.lookup(host);
	} catch (err) {
		throw new ToolError(`${host} does not resolve: ${message(err)}`);
	}
	if (addresses.length === 0) throw new ToolError(`${host} has no address`);
	const inside = addresses.find((address) => !isPublicAddress(address));
	if (inside) throw new ToolError(`${host} points at ${inside}, which is not a public address; private, loopback and local networks are not investigated`);
	return addresses[0]!;
}

const NOT_PUBLIC = new BlockList();
for (const [network, prefix] of [
	["0.0.0.0", 8],
	["10.0.0.0", 8],
	["100.64.0.0", 10],
	["127.0.0.0", 8],
	["169.254.0.0", 16],
	["172.16.0.0", 12],
	["192.0.0.0", 24],
	["192.0.2.0", 24],
	["192.168.0.0", 16],
	["198.18.0.0", 15],
	["198.51.100.0", 24],
	["203.0.113.0", 24],
	["224.0.0.0", 3],
] as const) {
	NOT_PUBLIC.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
	["::", 127],
	["64:ff9b::", 96],
	["100::", 64],
	["2001:db8::", 32],
	["fc00::", 7],
	["fe80::", 10],
	["ff00::", 8],
] as const) {
	NOT_PUBLIC.addSubnet(network, prefix, "ipv6");
}

export function isPublicAddress(address: string): boolean {
	const family = isIP(address);
	if (family === 0) return false;
	// An IPv4 address written as IPv6 (::ffff:10.0.0.1) is judged as the IPv4 address it is.
	const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
	if (mapped) return isPublicAddress(mapped);
	if (family === 6 && /^::ffff:/i.test(address)) return false;
	// BlockList also tests an IPv4 address against IPv6 rules through its mapped form, which is what is wanted here.
	return !NOT_PUBLIC.check(address, family === 4 ? "ipv4" : "ipv6");
}

function message(err: unknown): string {
	const code = (err as { code?: unknown; cause?: { code?: unknown } })?.code ?? (err as { cause?: { code?: unknown } })?.cause?.code;
	const text = err instanceof Error ? err.message : String(err);
	return (typeof code === "string" && !text.includes(code) ? `${code}: ${text}` : text).slice(0, 300);
}

/** The real network: the system resolver, Node's HTTP client and a plain TCP socket. */
export const liveNet: Net = {
	fetch: (input, init) => fetch(input, init),
	async lookup(host) {
		const found = await dnsLookup(host, { all: true, verbatim: true });
		return found.map((entry) => entry.address);
	},
	http({ url, method, address, signal }) {
		return new Promise<HttpResult>((resolve, reject) => {
			const family = isIP(address);
			const send = url.protocol === "https:" ? httpsRequest : httpRequest;
			const req = send({
				host: url.hostname,
				port: url.port || (url.protocol === "https:" ? 443 : 80),
				path: `${url.pathname}${url.search}`,
				method,
				headers: { host: url.host, "user-agent": USER_AGENT, accept: "*/*" },
				servername: isIP(url.hostname) ? undefined : url.hostname,
				// The address checked above, and no other: the name is not resolved again.
				lookup: ((_hostname: string, lookupOptions: { all?: boolean }, callback: (...args: unknown[]) => void) => {
					if (lookupOptions?.all) callback(null, [{ address, family }]);
					else callback(null, address, family);
				}) as unknown as LookupFunction,
				timeout: TIMEOUT_MS,
				signal,
				agent: false,
			});
			req.on("timeout", () => req.destroy(new Error(`no answer within ${TIMEOUT_MS / 1000} seconds`)));
			req.on("error", reject);
			req.on("response", (res: IncomingMessage) => {
				const chunks: Buffer[] = [];
				let size = 0;
				let truncated = false;
				const finish = () =>
					resolve({
						status: res.statusCode ?? 0,
						statusText: res.statusMessage ?? "",
						httpVersion: res.httpVersion,
						headers: pairs(res.rawHeaders),
						body: Buffer.concat(chunks).toString("utf8"),
						truncated,
					});
				res.on("data", (chunk: Buffer) => {
					if (truncated) return;
					const room = MAX_BODY - size;
					if (chunk.length > room) {
						chunks.push(chunk.subarray(0, room));
						size = MAX_BODY;
						truncated = true;
						finish();
						res.destroy();
						return;
					}
					chunks.push(chunk);
					size += chunk.length;
				});
				res.on("end", () => {
					if (!truncated) finish();
				});
				res.on("error", (err) => {
					if (!truncated) reject(err);
				});
			});
			req.end();
		});
	},
	tcp({ address, port, signal }) {
		return new Promise((resolve) => {
			const socket = connect({ host: address, port, timeout: 10_000 });
			const done = (open: boolean, detail: string) => {
				socket.destroy();
				signal?.removeEventListener("abort", abort);
				resolve({ open, detail });
			};
			const abort = () => done(false, "stopped");
			signal?.addEventListener("abort", abort, { once: true });
			socket.once("connect", () => done(true, "connected"));
			socket.once("timeout", () => done(false, "no answer within 10 seconds"));
			socket.once("error", (err: NodeJS.ErrnoException) => done(false, err.code ?? err.message));
		});
	},
};

function pairs(raw: string[]): [string, string][] {
	const result: [string, string][] = [];
	for (let index = 0; index + 1 < raw.length; index += 2) result.push([raw[index]!, raw[index + 1]!]);
	return result;
}

export { ScopeError };
