import { ALL_SEVERITIES, isFiltering, noFilter, type FindingFilter } from "../../ui/filter.js";
import type { Mural } from "../assist/mural.ts";
import { repoName } from "../repos/report.ts";
import type { ScanReport } from "../repos/types.ts";
import { buildDomainRoadmap, listDomainFindings, type MonitorReport } from "./domains.ts";
import { fileStem, FORMATS, isFormat, renderFindings, renderRoadmap, type Format, type Rendered } from "./render.ts";
import { buildRepoRoadmap, listRepoFindings } from "./repos.ts";

/** What an export contains: the ordered repairs, or every finding with its suggested fix. */
export const CONTENTS = ["roadmap", "findings"] as const;
export type Content = (typeof CONTENTS)[number];

export function checkContent(value: string): Content {
	if (!(CONTENTS as readonly string[]).includes(value)) throw new ExportError(`Unknown content "${value}". Choose one of: ${CONTENTS.join(", ")}`);
	return value as Content;
}

export interface ExportFile extends Rendered {
	/** A name safe to save under and to send in a download header. */
	filename: string;
}

/** A request for something that cannot be exported. The message is meant for the person who asked. */
export class ExportError extends Error {}

export function checkFormat(value: string): Format {
	if (!isFormat(value)) throw new ExportError(`Unknown format "${value}". Choose one of: ${FORMATS.join(", ")}`);
	return value;
}

/**
 * Builds the filter from what a command line or a query string supplies.
 * An absent part means "do not filter on this".
 */
export function parseFilter(input: { severity?: string | null; kind?: string | null; match?: string | null; repo?: string | null; new?: string | null }, newKeys?: ReadonlySet<string>): FindingFilter {
	const filter = noFilter();
	// The page writes "none" when every severity is unticked (cli/ui/list.js), so a link to that view exports it too.
	if (input.severity === "none") {
		filter.severities = [];
	} else if (input.severity != null) {
		const wanted = input.severity.split(",").map((part) => part.trim()).filter(Boolean);
		const unknown = wanted.filter((part) => !(ALL_SEVERITIES as string[]).includes(part));
		if (unknown.length > 0) throw new ExportError(`Unknown severity "${unknown[0]}". Choose from: ${ALL_SEVERITIES.join(", ")}`);
		filter.severities = ALL_SEVERITIES.filter((severity) => wanted.includes(severity));
	}
	if (input.kind != null && input.kind !== "all") {
		if (input.kind !== "secret" && input.kind !== "vulnerability" && input.kind !== "private-data") throw new ExportError(`Unknown type "${input.kind}". Choose secret, vulnerability or private-data`);
		filter.kind = input.kind;
	}
	if (input.match != null) filter.query = input.match;
	if (input.repo != null) filter.repo = input.repo;
	// "New since the last scan" (B-Q1): the keys come from the caller's own comparison of kept scans, never from the request.
	if (input.new === "1" || input.new === "true") {
		filter.newOnly = true;
		filter.newKeys = newKeys ?? new Set();
	}
	return filter;
}

export interface ExportChoice {
	content?: string;
	format?: string;
}

/**
 * A repository scan as a file: the roadmap by default, as a Markdown checklist by default. `mural`, a
 * board a model wrote, is added in its own labelled section; CSV has no room for one.
 */
export function exportRepos(report: ScanReport, choice: ExportChoice = {}, filter: FindingFilter = noFilter(), mural?: Mural): ExportFile {
	const content = checkContent(choice.content ?? "roadmap");
	const format = checkFormat(choice.format ?? "md");
	if (mural && format === "csv") throw new ExportError("A mural cannot go in a spreadsheet. Choose HTML, Markdown or JSON");
	// A repository the report does not have (a mistyped --repo) is refused, never exported as "no problems" (B50).
	if (filter.repo && !report.repos.some((repo) => repoName(report, repo) === filter.repo)) {
		const names = report.repos.map((repo) => repoName(report, repo));
		throw new ExportError(`No repository in this scan is named ${filter.repo}. ${names.length === 0 ? "It has none." : `Its repositories: ${names.slice(0, 10).join(", ")}${names.length > 10 ? ` and ${names.length - 10} more` : ""}.`}`);
	}
	const rendered = content === "roadmap" ? renderRoadmap(buildRepoRoadmap(report, filter), format, mural) : renderFindings(listRepoFindings(report, filter), format, mural);
	const partial = isFiltering(filter);
	return { ...rendered, filename: `${fileStem(content, report.scannedAt, partial ? "partial" : undefined)}.${rendered.extension}` };
}

/** A monitor scan of one domain as a file. */
export function exportDomain(report: MonitorReport, choice: ExportChoice = {}): ExportFile {
	const content = checkContent(choice.content ?? "roadmap");
	const format = checkFormat(choice.format ?? "md");
	const rendered = content === "roadmap" ? renderRoadmap(buildDomainRoadmap(report), format) : renderFindings(listDomainFindings(report), format);
	return { ...rendered, filename: `${fileStem(content, report.takenAt, report.domain)}.${rendered.extension}` };
}
