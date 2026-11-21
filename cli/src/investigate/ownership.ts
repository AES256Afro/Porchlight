/**
 * Proof that the owner controls a domain, checked from this computer.
 *
 * It is the monitor's challenge (`monitor/src/ownership.ts`): a TXT record at
 * `_porchlight-challenge.<domain>` holding `porchlight-verify=<token>`. Only someone who runs the
 * domain's DNS can publish it. A record published before the rename, under the earlier label and
 * prefix (`OLD_CHALLENGE_LABEL`), still proves it, so nobody has to publish a domain's record again. The check is a DNS-over-HTTPS lookup made here, so an investigation
 * works whether or not the monitor is deployed. When the monitor already watches the domain, its
 * token is adopted, so one record serves both.
 *
 * Tokens are kept in `investigate-domains.json` (0600) beside the report. They are not secret (anyone
 * can read the TXT record), but they are never sent to a model (invariant 13).
 */
import { randomBytes } from "node:crypto";
import { readFile, rename } from "node:fs/promises";
import { parseDomain } from "./scope.ts";
import { oneAtATime, readPrivateJson, UnreadableFileError, writePrivate } from "../private-files.ts";

export const CHALLENGE_LABEL = "_porchlight-challenge";
/** The label and value prefix records were published under before the rename. Still accepted. */
export const OLD_CHALLENGE_LABEL = "_securityx-challenge";
const OLD_VALUE_PREFIX = "securityx-verify=";
const DOH_URL = "https://cloudflare-dns.com/dns-query";
const DOH_TIMEOUT_MS = 8_000;
const TOKEN = /^[0-9a-f]{16,128}$/;

export const RECORD_TYPES = ["A", "AAAA", "CNAME", "MX", "NS", "TXT", "CAA", "SOA"] as const;
export type RecordType = (typeof RECORD_TYPES)[number];
const TYPE_CODE: Record<RecordType, number> = { A: 1, NS: 2, CNAME: 5, SOA: 6, MX: 15, TXT: 16, AAAA: 28, CAA: 257 };

export function challengeName(domain: string): string {
	return `${CHALLENGE_LABEL}.${domain}`;
}

export function challengeValue(token: string): string {
	return `porchlight-verify=${token}`;
}

/** The values that prove this token, under either prefix. */
function provingValues(token: string): string[] {
	return [challengeValue(token), `${OLD_VALUE_PREFIX}${token}`];
}

export function newToken(): string {
	return randomBytes(24).toString("hex");
}

export interface DnsAnswer {
	name: string;
	type: number;
	TTL?: number;
	data: string;
}

/** DNS answers that are answers: NOERROR (with or without records) and NXDOMAIN. */
const ANSWERED = new Set([0, 3]);

/**
 * Asks Cloudflare's DNS-over-HTTPS resolver. Throws when no answer came back (a SERVFAIL is not "no
 * records"), as the monitor's resolver does. Returns the status as well, for evidence.
 */
export async function resolveDoh(name: string, type: RecordType, fetchFn: typeof fetch, signal?: AbortSignal): Promise<{ status: number; answers: DnsAnswer[]; raw: string }> {
	const url = new URL(DOH_URL);
	url.searchParams.set("name", name);
	url.searchParams.set("type", type);
	const timeout = AbortSignal.timeout(DOH_TIMEOUT_MS);
	const response = await fetchFn(url, {
		headers: { accept: "application/dns-json" },
		redirect: "error",
		signal: signal ? AbortSignal.any([timeout, signal]) : timeout,
	});
	const raw = await response.text();
	if (!response.ok) throw new Error(`DNS lookup ${type} ${name}: HTTP ${response.status}`);
	let body: { Status?: unknown; Answer?: unknown };
	try {
		body = JSON.parse(raw);
	} catch {
		throw new Error(`DNS lookup ${type} ${name}: the resolver's answer is not JSON`);
	}
	if (typeof body.Status !== "number" || !ANSWERED.has(body.Status)) {
		throw new Error(`DNS lookup ${type} ${name}: no answer (DNS status ${String(body.Status)})`);
	}
	const answers = Array.isArray(body.Answer)
		? (body.Answer as DnsAnswer[]).filter((answer) => answer && typeof answer.data === "string" && typeof answer.type === "number")
		: [];
	return { status: body.Status, answers, raw };
}

/** TXT data arrives as quoted chunks: `"abc" "def"` means `abcdef`. */
export function unquoteTxt(data: string): string {
	const chunks = [...data.matchAll(/"((?:[^"\\]|\\.)*)"/g)];
	if (chunks.length === 0) return data;
	return chunks.map((chunk) => chunk[1]!.replace(/\\(.)/g, "$1")).join("");
}

export function recordsOf(answers: DnsAnswer[], type: RecordType): string[] {
	return answers.filter((answer) => answer.type === TYPE_CODE[type]).map((answer) => (type === "TXT" ? unquoteTxt(answer.data) : answer.data));
}

/**
 * Whether the challenge record holds this token. Throws when DNS could not be asked: a lookup that
 * failed is not proof either way, and the caller treats it as "not verified" (invariant 5).
 */
export async function checkOwnership(domain: string, token: string, fetchFn: typeof fetch, signal?: AbortSignal): Promise<boolean> {
	const values = provingValues(token);
	// The current record first; a record published before the rename only when that one does not prove it.
	for (const label of [CHALLENGE_LABEL, OLD_CHALLENGE_LABEL]) {
		const { answers } = await resolveDoh(`${label}.${domain}`, "TXT", fetchFn, signal);
		if (recordsOf(answers, "TXT").some((value) => values.includes(value))) return true;
	}
	return false;
}

/** A domain the owner has added for investigation, and the token its record must hold. */
export interface DomainEntry {
	token: string;
	addedAt: string;
	/** "monitor": the token was adopted from the monitor, which watches the same record. */
	source: "local" | "monitor";
	/** When the record last matched, as this computer saw it. */
	verifiedAt?: string;
}

export interface DomainsFile {
	domains: Record<string, DomainEntry>;
}

const DOMAINS_FILE = "The domains proven for investigations";

/** The proven domains. A file that is there but cannot be read throws: it holds tokens, and is never taken for none (B25). */
export async function readDomains(path: string): Promise<DomainsFile> {
	const read = await readPrivateJson(path);
	if (read.state === "missing") return { domains: {} };
	if (read.state === "unreadable") throw new UnreadableFileError(DOMAINS_FILE, read.reason);
	const parsed = read.value as DomainsFile | null;
	const domains: Record<string, DomainEntry> = {};
	for (const [name, entry] of Object.entries(parsed?.domains ?? {})) {
		if (parseDomain(name) === name && entry && typeof entry.token === "string" && TOKEN.test(entry.token)) domains[name] = entry;
	}
	return { domains };
}

/** Changes the proven domains one change at a time; `edit` says whether it changed anything to save. */
export function changeDomains(path: string, edit: (file: DomainsFile) => boolean): Promise<void> {
	return oneAtATime(path, async () => {
		const file = await readDomains(path);
		if (edit(file)) await saveDomains(path, file);
	});
}

export async function saveDomains(path: string, file: DomainsFile): Promise<void> {
	await writePrivate(path, `${JSON.stringify(file, null, "\t")}\n`);
}

/** A token taken from the monitor's challenge value, or null when it is not one. */
export function tokenFromChallenge(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const match = /^(?:porchlight|securityx)-verify=([0-9a-f]{16,128})$/.exec(value);
	return match?.[1] ?? null;
}

/** Written readable by the owner alone, through a temporary file so a crash leaves the old copy. */
export { writePrivate };
