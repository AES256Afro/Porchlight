import { ALL_SEVERITIES, isFiltering, noFilter, type FindingFilter } from "../../ui/filter.js";
import type { Mural } from "../assist/mural.ts";
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
export function parseFilter(input: { severity?: string | null; kind?: string | null; match?: string | null; repo?: string | null }): FindingFilter {
	const filter = noFilter();
	if (input.severity != null) {
		const wanted = input.severity.split(",").map((part) => part.trim()).filter(Boolean);
		const unknown = wanted.filter((part) => !(ALL_SEVERITIES as string[]).includes(part));
		if (unknown.length > 0) throw new ExportError(`Unknown severity "${unknown[0]}". Choose from: ${ALL_SEVERITIES.join(", ")}`);
		filter.severities = ALL_SEVERITIES.filter((severity) => wanted.includes(severity));
	}
	if (input.kind != null && input.kind !== "all") {
		if (input.kind !== "secret" && input.kind !== "vulnerability") throw new ExportError(`Unknown type "${input.kind}". Choose secret or vulnerability`);
		filter.kind = input.kind;
	}
	if (input.match != null) filter.query = input.match;
	if (input.repo != null) filter.repo = input.repo;
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
