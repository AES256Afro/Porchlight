/**
 * The GitHub settings audit as a file (Markdown, CSV or JSON) and as text for a terminal. Repository
 * names, alert types, deploy key titles and webhook hosts come from GitHub, where others can set some of
 * them, so everything goes through `roadmap/escape.ts` for its format (invariant 11). The file name is a
 * fixed stem and the audit's date. The token is never in a report, so it cannot be in an export.
 */
import { csvNoteRows, csvRow, forTerminal, jsonText, mdCode, mdText } from "../roadmap/escape.ts";
import { utcTime } from "../roadmap/style.ts";
import { PORCHLIGHT_VERSION } from "../version.ts";
import { allChecks, ghCounts } from "./audit.ts";
import type { GhReport } from "./audit-types.ts";

export const GH_FORMATS = ["md", "csv", "json"] as const;
export type GhFormat = (typeof GH_FORMATS)[number];

export interface GhExportFile {
	filename: string;
	contentType: string;
	body: string;
}

export const STATUS_WORDS = { passed: "Passed", failed: "Problem", unknown: "Could not check", unavailable: "Not available" };
const SEVERITY_WORDS = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };
export const AREA_WORDS = { branches: "Branch protection", secrets: "Secret scanning", dependencies: "Dependabot", actions: "Actions", access: "Deploy keys and webhooks" };

export function exportGithubAudit(report: GhReport, format: GhFormat): GhExportFile {
	const stem = `porchlight-github-settings-${report.checkedAt.slice(0, 10).replace(/[^0-9-]/g, "")}`;
	if (format === "json") return { filename: `${stem}.json`, contentType: "application/json; charset=utf-8", body: jsonText(report) };
	if (format === "csv") return { filename: `${stem}.csv`, contentType: "text/csv; charset=utf-8", body: csv(report) };
	return { filename: `${stem}.md`, contentType: "text/markdown; charset=utf-8", body: markdown(report) };
}

export function summary(report: GhReport): string {
	const counts = ghCounts(allChecks(report));
	const severities = (["critical", "high", "medium", "low"] as const).map((severity) => `${counts.bySeverity[severity] ?? 0} ${SEVERITY_WORDS[severity].toLowerCase()}`).join(", ");
	return `${counts.failed} ${counts.failed === 1 ? "finding" : "findings"} (${severities}), ${counts.unknown} could not be checked, ${counts.passed} passed, ${counts.unavailable} not available`;
}

function mark(status: keyof typeof STATUS_WORDS, severity: keyof typeof SEVERITY_WORDS): string {
	return status === "failed" ? `${STATUS_WORDS.failed}, ${SEVERITY_WORDS[severity]}` : STATUS_WORDS[status];
}

function repoLine(repo: GhReport["repos"][number]): string {
	return `${repo.private ? "Private" : "Public"}${repo.fork ? " fork" : ""}${repo.defaultBranch ? `, default branch ${repo.defaultBranch}` : ", no branch yet"}`;
}

function markdown(report: GhReport): string {
	const out: string[] = ["# GitHub settings audit", ""];
	out.push(`- Checked: ${mdText(report.checkedAt)}`, `- Repositories: ${report.repos.length}${report.reposSkipped ? ` (${report.reposSkipped} more not audited)` : ""}`, `- ${mdText(summary(report))}`);
	out.push("", '> Built-in rules, no model. It only reads. A check Porchlight could not make is "Could not check", never a pass.', "");
	for (const repo of report.repos) {
		out.push(`## ${mdCode(repo.name)}`, "", mdText(repoLine(repo)), "");
		for (const item of repo.checks) {
			out.push(`### ${mdText(item.title)} (${mdText(mark(item.status, item.severity))})`, "", `- Area: ${AREA_WORDS[item.area]}`, `- Seen: ${mdText(item.detail)}`, `- Why it matters: ${mdText(item.why)}`);
			for (const line of item.items ?? []) out.push(`  - ${mdCode(line)}`);
			for (const step of item.fix ?? []) out.push(`- Fix: ${mdStep(step)}`);
			out.push("");
		}
	}
	out.push("## Permissions", "", ...report.permissions.map((permission) => `- ${mdText(permission.name)} (classic: ${mdText(permission.classic)}): ${permission.granted === null ? "not needed by this audit" : permission.granted ? "answered" : "refused"}`), "");
	out.push("## Not covered", "", ...report.notCovered.map((line) => `- ${mdText(line)}`), "");
	out.push("---", "", `*${mdText(`Porchlight ${PORCHLIGHT_VERSION} · GitHub settings audit · checked ${utcTime(report.checkedAt)}`)}*`, "");
	return `${out.join("\n")}\n`;
}

/** A fix step: backticks mark values, which become code; the rest is text. */
function mdStep(step: string): string {
	return step
		.split("`")
		.map((part, index) => (index % 2 === 1 ? mdCode(part) : mdText(part)))
		.join("");
}

function csv(report: GhReport): string {
	const rows = [csvRow(["repository", "area", "check", "status", "severity", "detail", "items", "fix", "permission"])];
	for (const repo of report.repos) {
		for (const item of repo.checks) {
			rows.push(
				csvRow([
					repo.name,
					AREA_WORDS[item.area],
					item.title,
					STATUS_WORDS[item.status],
					item.status === "failed" ? SEVERITY_WORDS[item.severity] : "",
					item.detail,
					(item.items ?? []).join("; "),
					(item.fix ?? []).join(" "),
					item.permission ?? "",
				]),
			);
		}
	}
	rows.push(...csvNoteRows(9, 5, null, report.notCovered));
	return `${rows.join("\r\n")}\r\n`;
}

/** The audit as text for a terminal, problems first. Control characters never reach it. */
export function renderGithubAuditText(report: GhReport): string {
	const plain = (text: string) => forTerminal(text).replace(/`/g, "");
	const lines: string[] = [`GitHub settings audit, ${report.checkedAt}`, plain(summary(report)), ""];
	for (const repo of report.repos) {
		lines.push(`## ${plain(repo.name)} (${plain(repoLine(repo))})`);
		for (const item of repo.checks) {
			lines.push(`- [${mark(item.status, item.severity)}] ${plain(item.title)}`, `    ${plain(item.detail)}`);
			if (item.status === "passed" || item.status === "unavailable") continue;
			for (const line of (item.items ?? []).slice(0, 20)) lines.push(`      · ${plain(line)}`);
			for (const step of item.fix ?? []) lines.push(`    Fix: ${plain(step)}`);
		}
		lines.push("");
	}
	if (report.repos.length === 0) lines.push("No repository was audited.", "");
	lines.push("## Not covered", ...report.notCovered.map((line) => `- ${plain(line)}`), "");
	return lines.join("\n");
}
