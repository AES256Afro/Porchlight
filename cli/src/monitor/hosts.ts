/**
 * `porchlight domains hosts <domain>` (R6F-5): the names the monitor knows under a domain, learnt
 * passively from the certificate log and DNS, as its latest scan holds them. The monitor answers from
 * its database: asking makes no request about the domain. Names, addresses and errors come from DNS
 * and other people's servers, so each is escaped for the format it is written in (invariant 11).
 */
import { parseArgs } from "node:util";
import type { HostsPage, HostView } from "../../../monitor/src/types.ts";
import { csvRow, jsonText, mdText } from "../roadmap/escape.ts";
import type { MonitorResponse } from "./client.ts";

/** At most this many pages are asked for: the monitor keeps at most 12,000 names, 200 a page. */
const MAX_PAGES = 60;

/** Every page of the inventory, asked for one after another. Throws with the monitor's own error. */
export async function fetchHosts(domain: string, get: (path: string) => Promise<MonitorResponse>): Promise<HostsPage> {
	const path = `/domains/${encodeURIComponent(domain)}/hosts`;
	let first: HostsPage | null = null;
	for (let page = 1; page <= MAX_PAGES; page++) {
		const { status, body } = await get(page === 1 ? path : `${path}?page=${page}`);
		if (status >= 400) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${status}`);
		const answer = body as HostsPage;
		if (!Array.isArray(answer.hosts) || typeof answer.total !== "number") throw new Error("The monitor's answer is not an inventory; it may need updating");
		if (!first) first = { ...answer, hosts: [...answer.hosts] };
		else first.hosts.push(...answer.hosts);
		if (answer.hosts.length === 0 || first.hosts.length >= answer.total) break;
	}
	return first!;
}

function https(host: HostView): string {
	if (host.https === null) return host.probed ? "no address" : "not checked";
	return host.https.ok ? `HTTP ${host.https.status}` : "failed";
}

function addresses(host: HostView): string {
	if (host.dns === null) return host.probed ? "lookup failed" : "not checked";
	const parts = [...host.dns.cname.map((name) => `→ ${name}`), ...host.dns.a, ...host.dns.aaaa];
	return parts.length > 0 ? parts.join(" ") : "none";
}

/** The inventory as a table for a terminal. */
export function renderHosts(inventory: HostsPage): string {
	const lines = [`${inventory.domain}: ${inventory.total} name${inventory.total === 1 ? "" : "s"}, from the scan of ${inventory.takenAt}`, ""];
	const width = Math.min(60, Math.max(4, ...inventory.hosts.map((host) => host.name.length)));
	for (const host of inventory.hosts) {
		const findings = host.findings > 0 ? `  ${host.findings} finding${host.findings === 1 ? "" : "s"}` : "";
		const cert = host.cert ? `  certificate to ${host.cert.notAfter.slice(0, 10)}` : "";
		lines.push(`  ${host.name.padEnd(width)}  ${https(host).padEnd(11)}  ${addresses(host)}${cert}${findings}`);
	}
	if (inventory.hosts.length < inventory.total) lines.push(`  … ${inventory.total - inventory.hosts.length} more not fetched`);
	if (inventory.gone.length > 0) {
		lines.push("", "Gone (still in the certificate log, no longer in DNS):");
		for (const gone of inventory.gone) lines.push(`  ${gone.name}  since ${gone.since.slice(0, 10)}`);
	}
	return `${lines.join("\n")}\n`;
}

const COLUMNS = ["Name", "HTTPS", "DNS", "Certificate until", "Open findings", "Last checked"];

function cells(host: HostView): string[] {
	return [host.name, https(host), addresses(host), host.cert?.notAfter.slice(0, 10) ?? "", String(host.findings), host.checkedAt ?? ""];
}

/** The inventory as CSV, each cell escaped against formulas (escape.ts). */
export function hostsCsv(inventory: HostsPage): string {
	return `${[csvRow(COLUMNS), ...inventory.hosts.map((host) => csvRow(cells(host)))].join("\n")}\n`;
}

/** The inventory as a Markdown table, each cell escaped (escape.ts). */
export function hostsMarkdown(inventory: HostsPage): string {
	const row = (values: string[]) => `| ${values.map((value) => (value === "" ? " " : mdText(value))).join(" | ")} |`;
	return [
		`# Hosts under ${mdText(inventory.domain)}`,
		"",
		`${inventory.total} names, from the monitor's scan of ${mdText(inventory.takenAt)}. Learnt from the certificate log and DNS; no name was guessed.`,
		"",
		row(COLUMNS),
		`|${COLUMNS.map(() => " --- ").join("|")}|`,
		...inventory.hosts.map((host) => row(cells(host))),
		"",
	].join("\n");
}

/** The command: `porchlight domains hosts <domain> [--format text|csv|md|json]`. `get` asks the monitor. */
export async function domainsHosts(args: string[], get: (path: string) => Promise<MonitorResponse>, print: (text: string) => void): Promise<number> {
	const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { format: { type: "string", default: "text" }, json: { type: "boolean", default: false } } });
	const [domain, ...extra] = positionals;
	if (!domain || extra.length > 0) throw new Error("Usage: porchlight domains hosts <domain> [--format text|csv|md|json]");
	const format = values.json ? "json" : values.format;
	if (!["text", "csv", "md", "json"].includes(format)) throw new Error("--format must be one of: text, csv, md, json");
	const inventory = await fetchHosts(domain, get);
	print(format === "json" ? jsonText(inventory) : format === "csv" ? hostsCsv(inventory) : format === "md" ? hostsMarkdown(inventory) : renderHosts(inventory));
	return 0;
}
