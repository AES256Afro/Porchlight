/**
 * The scope file: the domains the monitor has proved the owner controls, and the names its latest scan
 * holds under each, for another tool of the owner's to take as the scope it may test
 * (`porchlight domains scope`, `GET /api/domains/scope`). Names and dates only: no address, DNS value,
 * certificate, HTTP answer, finding, challenge or token goes in (invariant 3). It is read from the
 * monitor's database, so making it sends no request about a domain (invariant 1).
 *
 * A file that lists a domain is a promise that the names under it are all the monitor holds. So every
 * read must succeed and every answer must be whole: a domain whose names cannot be read, an inventory
 * that changed while it was read, or a name outside its domain makes the export fail and say why, and
 * no partial file is written (invariant 5). A value of the wrong shape is refused, never repaired.
 */
import { join } from "node:path";
import { parseArgs } from "node:util";
import type { DomainView, HostsPage } from "../../../monitor/src/types.ts";
import { jsonText } from "../roadmap/escape.ts";
import type { MonitorResponse } from "./client.ts";

export const SCOPE_FORMAT = "porchlight-scope";
export const SCOPE_VERSION = 1;
/** The download's name before the date, and its type. */
export const SCOPE_STEM = "porchlight-scope";
export const SCOPE_CONTENT_TYPE = "application/json; charset=utf-8";

/** The monitor keeps at most 12,000 names a domain, 200 a page. */
const MAX_PAGES = 60;
/** The monitor's own limit on what it watches is far below this; past it the answer is not a domain list. */
const MAX_DOMAINS = 10_000;

export interface ScopeHost {
	name: string;
	/** When the monitor last probed it; null when never, or not known (invariant 5). */
	checkedAt: string | null;
}

export interface ScopeDomain {
	name: string;
	verifiedAt: string;
	hosts: ScopeHost[];
}

export interface ScopeFile {
	format: typeof SCOPE_FORMAT;
	version: typeof SCOPE_VERSION;
	exportedAt: string;
	domains: ScopeDomain[];
}

/** Why no scope file was made. The message is meant for the owner. */
export class ScopeError extends Error {
	/** What the server answers: 502 when the monitor failed or answered oddly, 409 when a domain is not ready. */
	status: number;
	constructor(message: string, status = 502) {
		super(message);
		this.status = status;
	}
}

const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** A date as the monitor writes one: `toISOString()`, in UTC. */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;

/** A DNS name as the monitor keeps one: lower case, two labels or more, no address. */
export function isDnsName(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 253) return false;
	const labels = value.split(".");
	return labels.length >= 2 && labels.every((label) => LABEL.test(label)) && !/^\d+$/.test(labels.at(-1)!);
}

/** True when `host` is `domain` itself or a name beneath it. */
export function isWithin(host: string, domain: string): boolean {
	return host === domain || host.endsWith(`.${domain}`);
}

function isIsoUtc(value: unknown): value is string {
	return typeof value === "string" && ISO_UTC.test(value) && !Number.isNaN(Date.parse(value));
}

/** Sorted by code point, as the monitor sorts names, so the same inventory always gives the same file. */
function byName<T extends { name: string }>(a: T, b: T): number {
	return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function monitorError(status: number, body: Record<string, unknown>): string {
	return typeof body.error === "string" ? body.error.slice(0, 300) : `HTTP ${status}`;
}

/** Asks the monitor, turning a failure to reach it into a ScopeError that says what was being read. */
async function ask(get: (path: string) => Promise<MonitorResponse>, path: string, what: string): Promise<MonitorResponse> {
	try {
		return await get(path);
	} catch (err) {
		throw new ScopeError(`Could not reach the monitor to read ${what}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

/** The verified domains of the monitor's list, sorted by name. Throws unless the list is whole. */
async function verifiedDomains(get: (path: string) => Promise<MonitorResponse>): Promise<{ name: string; verifiedAt: string }[]> {
	const { status, body } = await ask(get, "/domains", "its domains");
	if (status >= 400) throw new ScopeError(`The monitor refused to list its domains: ${monitorError(status, body)}`);
	const listed: unknown = body.domains;
	if (!Array.isArray(listed) || listed.length > MAX_DOMAINS) throw new ScopeError("The monitor's answer is not a list of domains; it may need updating");
	const verified: { name: string; verifiedAt: string }[] = [];
	for (const item of listed as Partial<DomainView>[]) {
		if (typeof item !== "object" || item === null || !isDnsName(item.name) || typeof item.verified !== "boolean") throw new ScopeError("The monitor's answer is not a list of domains; it may need updating");
		if (item.verified !== true) continue;
		if (!isIsoUtc(item.verifiedAt)) throw new ScopeError(`The monitor lists ${item.name} as verified without the date it was verified; it may need updating`);
		verified.push({ name: item.name, verifiedAt: item.verifiedAt });
	}
	if (new Set(verified.map((domain) => domain.name)).size !== verified.length) throw new ScopeError("The monitor listed a domain twice; it may need updating");
	return verified.sort(byName);
}

/**
 * Every name the latest scan of `domain` holds, read page by page and sorted. Names the certificate
 * log still lists but DNS showed gone (`gone`) are not in the inventory and stay out.
 */
async function domainHosts(domain: string, get: (path: string) => Promise<MonitorResponse>): Promise<ScopeHost[]> {
	const path = `/domains/${encodeURIComponent(domain)}/hosts`;
	const notInventory = new ScopeError(`The monitor's answer about the names under ${domain} is not an inventory; it may need updating`);
	const hosts: ScopeHost[] = [];
	let takenAt: string | null = null;
	let total = -1;
	for (let page = 1; ; page++) {
		if (page > MAX_PAGES) throw new ScopeError(`The monitor holds more names under ${domain} than Porchlight reads (${MAX_PAGES} pages), so its scope cannot be exported whole`);
		const { status, body } = await ask(get, page === 1 ? path : `${path}?page=${page}`, `the names under ${domain}`);
		// 404: not scanned yet, so there is no inventory to list. Either way nothing is exported without it.
		if (status === 404) throw new ScopeError(`Could not read the names under ${domain}: ${monitorError(status, body)}. Scan it, then export again.`, 409);
		if (status >= 400) throw new ScopeError(`Could not read the names under ${domain}: ${monitorError(status, body)}`);
		const answer = body as Partial<HostsPage>;
		if (answer.domain !== domain || !isIsoUtc(answer.takenAt) || !Array.isArray(answer.hosts) || !Number.isInteger(answer.total) || (answer.total as number) < 0) throw notInventory;
		// Every page from the same scan, or the pages are of two inventories.
		if (takenAt === null) {
			takenAt = answer.takenAt;
			total = answer.total as number;
		} else if (answer.takenAt !== takenAt || answer.total !== total) {
			throw new ScopeError(`The monitor scanned ${domain} again while its names were being read. Export again.`);
		}
		for (const host of answer.hosts as unknown[]) {
			const name = (host as { name?: unknown } | null)?.name;
			const checkedAt = (host as { checkedAt?: unknown } | null)?.checkedAt;
			if (!isDnsName(name)) throw notInventory;
			if (!isWithin(name, domain)) throw new ScopeError(`The monitor listed ${name} under ${domain}, which is neither ${domain} nor a subdomain of it, so no scope was exported`);
			if (checkedAt !== null && !isIsoUtc(checkedAt)) throw notInventory;
			hosts.push({ name, checkedAt });
		}
		if (hosts.length >= total || answer.hosts.length === 0) break;
	}
	if (hosts.length !== total) throw new ScopeError(`The monitor said it holds ${total} names under ${domain} but sent ${hosts.length}, so its scope cannot be exported whole`);
	if (new Set(hosts.map((host) => host.name)).size !== hosts.length) throw new ScopeError(`The monitor listed a name under ${domain} twice. Export again.`);
	return hosts.sort(byName);
}

/**
 * The scope file, from the monitor `get` asks (the admin token is added there). Throws a ScopeError
 * rather than return anything less than every verified domain with every name its latest scan holds.
 */
export async function buildScope(get: (path: string) => Promise<MonitorResponse>, now: Date): Promise<ScopeFile> {
	const verified = await verifiedDomains(get);
	// An empty scope is never the answer to "export my scope": it would be a file that permits nothing.
	if (verified.length === 0) throw new ScopeError("No domain is verified at the monitor yet, so there is no scope to export. Prove one is yours first.", 409);
	const domains: ScopeDomain[] = [];
	for (const domain of verified) {
		domains.push({ name: domain.name, verifiedAt: domain.verifiedAt, hosts: await domainHosts(domain.name, get) });
	}
	return { format: SCOPE_FORMAT, version: SCOPE_VERSION, exportedAt: now.toISOString(), domains };
}

/** `porchlight-scope-<YYYY-MM-DD>.json`: a fixed stem and the date in UTC, never anything from the monitor or a request (invariant 11). */
export function scopeFilename(now: Date): string {
	return `${SCOPE_STEM}-${now.toISOString().slice(0, 10)}.json`;
}

/** The file to save or download. Its date is the export's own, so the name and `exportedAt` agree. */
export function scopeExport(scope: ScopeFile): { body: string; filename: string; contentType: string; extension: "json" } {
	return { body: jsonText(scope), filename: scopeFilename(new Date(scope.exportedAt)), contentType: SCOPE_CONTENT_TYPE, extension: "json" };
}

/** Counts for a line in the log or the terminal: Porchlight's own figures, never a name. */
export function scopeCounts(scope: ScopeFile): string {
	const hosts = scope.domains.reduce((sum, domain) => sum + domain.hosts.length, 0);
	return `${scope.domains.length} proven domain${scope.domains.length === 1 ? "" : "s"}, ${hosts} name${hosts === 1 ? "" : "s"}`;
}

export interface ScopeCommandDeps {
	now(): Date;
	/** The file's text, to standard output. */
	print(text: string): void;
	/** A line for the owner, to the error stream, so standard output stays the file alone. */
	warn(text: string): void;
	/** Whether `path` is a folder that exists. */
	isFolder(path: string): Promise<boolean>;
	/** Writes the file, readable by the owner alone. */
	write(path: string, text: string): Promise<void>;
}

export const SCOPE_USAGE = "Usage: porchlight domains scope [--out <file or folder>]";

/**
 * `porchlight domains scope [--out <file or folder>]`: the scope file, printed, or written to a file,
 * or into a folder under its own name. `get` asks the monitor.
 */
export async function domainsScope(args: string[], get: (path: string) => Promise<MonitorResponse>, deps: ScopeCommandDeps): Promise<number> {
	const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { out: { type: "string" } } });
	if (positionals.length > 0 || values.out === "") throw new Error(SCOPE_USAGE);
	const scope = await buildScope(get, deps.now());
	const file = scopeExport(scope);
	if (values.out === undefined) {
		deps.print(file.body);
		return 0;
	}
	const path = (await deps.isFolder(values.out)) ? join(values.out, file.filename) : values.out;
	await deps.write(path, file.body);
	deps.warn(`Written to ${path}: ${scopeCounts(scope)}`);
	return 0;
}
