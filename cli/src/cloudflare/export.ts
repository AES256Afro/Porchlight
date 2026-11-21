/**
 * The Cloudflare audit as a file (Markdown, HTML, CSV or JSON) and as text for a terminal. Record
 * names and contents, token names and plan names come from the account and its DNS, which others can
 * influence, so everything is escaped for its format (invariant 11). The HTML has no script and loads
 * nothing. The file name is a fixed stem and the audit's date. The token is never in a report, so it
 * cannot be in an export.
 */
import { csvNoteRows, csvRow, html, jsonText, mdCode, mdText } from "../roadmap/escape.ts";
import { allChecks, cfCounts } from "./audit.ts";
import type { CfCheck, CfReport, CfZoneReport } from "./types.ts";
import { EXPORT_TOKENS, utcTime } from "../roadmap/style.ts";
import { PORCHLIGHT_VERSION } from "../version.ts";

export const CF_FORMATS = ["md", "html", "csv", "json"] as const;
export type CfFormat = (typeof CF_FORMATS)[number];

export interface CfExportFile {
	filename: string;
	contentType: string;
	body: string;
}

const STATUS_WORDS = { passed: "Passed", failed: "Problem", unknown: "Could not check", unavailable: "Not on this plan" };
const SEVERITY_WORDS = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
const AREA_WORDS = { tls: "SSL/TLS", dns: "DNS", email: "Email", firewall: "Firewall and bots", ownership: "Proof of ownership", account: "Account" };

/** A report narrowed to one zone, which then says so. Account checks are left out of a one-zone export. */
export function forZone(report: CfReport, zoneId: string | null): { report: CfReport; partial: string | null } {
	if (!zoneId) return { report, partial: null };
	const zone = report.zones.find((candidate) => candidate.id === zoneId);
	if (!zone) throw new Error("That zone is not in the latest audit");
	return { report: { ...report, zones: [zone], accounts: [], userChecks: [] }, partial: `This export covers one zone, ${zone.name}, of the ${report.zones.length} audited, and leaves out the account checks.` };
}

export function exportCloudflare(full: CfReport, format: CfFormat, zoneId: string | null = null): CfExportFile {
	const { report, partial } = forZone(full, zoneId);
	// A one-zone export is named as a part, never as the full audit (B67).
	const stem = `porchlight-cloudflare-${partial ? "zone-" : ""}${report.checkedAt.slice(0, 10).replace(/[^0-9-]/g, "")}`;
	if (format === "json") return { filename: `${stem}.json`, contentType: "application/json; charset=utf-8", body: jsonText(partial ? { partial, ...report } : report) };
	if (format === "csv") return { filename: `${stem}.csv`, contentType: "text/csv; charset=utf-8", body: csv(report, partial) };
	if (format === "html") return { filename: `${stem}.html`, contentType: "text/html; charset=utf-8", body: htmlDoc(report, partial) };
	return { filename: `${stem}.md`, contentType: "text/markdown; charset=utf-8", body: markdown(report, partial) };
}

function sections(report: CfReport): { title: string; plan?: string; checks: CfCheck[] }[] {
	return [
		...report.zones.map((zone) => ({ title: zone.name, plan: planLine(zone), checks: zone.checks })),
		...report.accounts.map((account) => ({ title: `Account: ${account.name}`, checks: account.checks })),
		...(report.userChecks.length > 0 ? [{ title: "Your user", checks: report.userChecks }] : []),
	];
}

function planLine(zone: CfZoneReport): string {
	return `${zone.planName} plan${zone.paused ? ", paused" : ""}${zone.status !== "active" ? `, ${zone.status}` : ""}`;
}

function summary(report: CfReport): string {
	const counts = cfCounts(allChecks(report));
	const severities = (["critical", "high", "medium", "low"] as const).map((severity) => `${counts.bySeverity[severity] ?? 0} ${SEVERITY_WORDS[severity].toLowerCase()}`).join(", ");
	return `${counts.failed} ${counts.failed === 1 ? "finding" : "findings"} (${severities}), ${counts.unknown} could not be checked, ${counts.passed} passed, ${counts.unavailable} not on the zone's plan`;
}

function markdown(report: CfReport, partial: string | null): string {
	const out: string[] = ["# Cloudflare audit", ""];
	out.push(`- Checked: ${mdText(report.checkedAt)}`, `- Zones: ${report.zones.length}${report.zonesSkipped ? ` (${report.zonesSkipped} more not audited)` : ""}`, `- ${mdText(summary(report))}`);
	if (partial) out.push(`- **${mdText(partial)}**`);
	out.push("", "> Built-in rules, no model. A check Porchlight could not make is \"Could not check\", never a pass.", "");
	for (const section of sections(report)) {
		out.push(`## ${mdText(section.title)}`, "");
		if (section.plan) out.push(mdText(section.plan), "");
		for (const item of section.checks) {
			const mark = item.status === "failed" ? `${STATUS_WORDS.failed}, ${SEVERITY_WORDS[item.severity]}` : STATUS_WORDS[item.status];
			out.push(`### ${mdText(item.title)} (${mdText(mark)})`, "", `- Area: ${AREA_WORDS[item.area]}`, `- Seen: ${mdText(item.detail)}`, `- Why it matters: ${mdText(item.why)}`);
			for (const line of item.items ?? []) out.push(`  - ${mdCode(line)}`);
			for (const step of item.fix ?? []) out.push(`- Fix: ${mdStep(step)}`);
			if (item.api) out.push(`- API: ${mdCode(item.api)}`);
			out.push("");
		}
	}
	out.push("## Not covered", "", ...report.notCovered.map((line) => `- ${mdText(line)}`), "");
	out.push("---", "", `*${mdText(`Porchlight ${PORCHLIGHT_VERSION} · Cloudflare audit · checked ${utcTime(report.checkedAt)}`)}*`, "");
	return `${out.join("\n")}\n`;
}

/** A fix step: backticks mark commands and values, which become code; the rest is text. */
function mdStep(step: string): string {
	return step
		.split("`")
		.map((part, index) => (index % 2 === 1 ? mdCode(part) : mdText(part)))
		.join("");
}

function csv(report: CfReport, partial: string | null): string {
	const rows = [csvRow(["section", "area", "check", "status", "severity", "detail", "items", "fix", "api"])];
	for (const section of sections(report)) {
		for (const item of section.checks) {
			rows.push(
				csvRow([
					section.title,
					AREA_WORDS[item.area],
					item.title,
					STATUS_WORDS[item.status],
					item.status === "failed" ? SEVERITY_WORDS[item.severity] : "",
					item.detail,
					(item.items ?? []).join("; "),
					(item.fix ?? []).join(" "),
					item.api ?? "",
				]),
			);
		}
	}
	rows.push(...csvNoteRows(9, 5, partial, report.notCovered));
	return `${rows.join("\r\n")}\r\n`;
}

/** The page's colour list (cli/ui/tokens.css), shared with the other exports, and light when printed (VS-11, R6V-1). */
const STYLE =
	`${EXPORT_TOKENS}` +
	"body{font:15px/1.5 var(--sans);max-width:62rem;margin:2rem auto;padding:0 1rem;color:var(--ink);background:var(--page)}" +
	"h1{font-size:1.6rem}h2{margin-top:2rem;border-bottom:1px solid var(--border);padding-bottom:.3rem}.check{border:1px solid var(--hairline);border-radius:8px;padding:.6rem .9rem;margin:.6rem 0;background:var(--surface)}" +
	".mark{font-weight:600}.sub{color:var(--ink-2)}code{font-size:.9em;overflow-wrap:anywhere}ul{margin:.3rem 0}" +
	".foot{margin-top:3rem;padding-top:.6rem;border-top:1px solid var(--hairline);color:var(--ink-2);font-size:.8rem}";

function htmlDoc(report: CfReport, partial: string | null): string {
	const body: string[] = [];
	body.push(`<h1>Cloudflare audit</h1>`, `<p class="sub">Checked ${html(report.checkedAt)}. ${html(summary(report))}.</p>`);
	if (partial) body.push(`<p><strong>${html(partial)}</strong></p>`);
	body.push(`<p class="sub">Built-in rules, no model. A check Porchlight could not make is "Could not check", never a pass.</p>`);
	for (const section of sections(report)) {
		body.push(`<h2>${html(section.title)}</h2>`);
		if (section.plan) body.push(`<p class="sub">${html(section.plan)}</p>`);
		for (const item of section.checks) {
			const mark = item.status === "failed" ? `${STATUS_WORDS.failed}, ${SEVERITY_WORDS[item.severity]}` : STATUS_WORDS[item.status];
			body.push(
				`<div class="check"><p><span class="mark">${html(mark)}</span> · ${html(item.title)} <span class="sub">(${html(AREA_WORDS[item.area])})</span></p>`,
				`<p>${html(item.detail)}</p><p class="sub">${html(item.why)}</p>`,
				item.items?.length ? `<ul>${item.items.map((line) => `<li><code>${html(line)}</code></li>`).join("")}</ul>` : "",
				item.fix?.length ? `<ol>${item.fix.map((step) => `<li>${htmlStep(step)}</li>`).join("")}</ol>` : "",
				item.api ? `<p class="sub">API: <code>${html(item.api)}</code></p>` : "",
				"</div>",
			);
		}
	}
	body.push(`<h2>Not covered</h2><ul>${report.notCovered.map((line) => `<li>${html(line)}</li>`).join("")}</ul>`);
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="color-scheme" content="light dark">
<title>Cloudflare audit, ${html(utcTime(report.checkedAt).slice(0, 10))}</title>
<style>${STYLE}</style>
</head>
<body>
${body.join("\n")}
<footer class="foot">${html(`Porchlight ${PORCHLIGHT_VERSION} · Cloudflare audit · checked ${utcTime(report.checkedAt)}`)}</footer>
</body>
</html>
`;
}

function htmlStep(step: string): string {
	return step
		.split("`")
		.map((part, index) => (index % 2 === 1 ? `<code>${html(part)}</code>` : html(part)))
		.join("");
}

/** Names and values come from the account; control characters never reach the terminal. */
function plain(text: string): string {
	return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "").replace(/`/g, "");
}

/** The audit as text for a terminal, problems first. */
export function renderCloudflareText(report: CfReport): string {
	const lines: string[] = [`Cloudflare audit, ${report.checkedAt}`, plain(summary(report)), ""];
	for (const section of sections(report)) {
		lines.push(`## ${plain(section.title)}${section.plan ? ` (${plain(section.plan)})` : ""}`);
		for (const item of section.checks) {
			const mark = item.status === "failed" ? `${STATUS_WORDS.failed}, ${SEVERITY_WORDS[item.severity]}` : STATUS_WORDS[item.status];
			lines.push(`- [${mark}] ${plain(item.title)}`, `    ${plain(item.detail)}`);
			if (item.status === "passed" || item.status === "unavailable") continue;
			for (const line of (item.items ?? []).slice(0, 20)) lines.push(`      · ${plain(line)}`);
			for (const step of item.fix ?? []) lines.push(`    Fix: ${plain(step)}`);
			if (item.api) lines.push(`    API: ${plain(item.api)}`);
		}
		lines.push("");
	}
	lines.push("## Not covered", ...report.notCovered.map((line) => `- ${plain(line)}`), "");
	return lines.join("\n");
}
