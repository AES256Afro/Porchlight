// The stored report, read once for each version of its file, and its response for the page (OP-5, R6O-1).
import { readFile, stat } from "node:fs/promises";
import { readAnalysis, unitKey, type AnalysisFile } from "../analysis/analyse.ts";
import { coverageNotes, rank, rankRepos, repoName, settingNotes } from "../repos/report.ts";
import type { Finding, RepoResult, ScanReport } from "../repos/types.ts";
import { suggestionsFor } from "../roadmap/repos.ts";
import { HttpError } from "./http.ts";

/** A repair as the page shows it beside a finding. */
export type Suggestion = ReturnType<typeof suggestionsFor> extends Map<Finding, infer S> ? S : never;

/**
 * The report's response: the stored report, ordered worst first, each finding with the place of its
 * suggested fix in `suggestions` and the model's judgement, what the scan did not cover, what
 * repositories told the scanners to leave out, and the owner's notes.
 *
 * Each repair is sent once and each finding names it by its place (OP-5): a package's advisories share
 * one upgrade, so repeating it on each made the answer twice the report. The repairs are still planned
 * from the whole report (invariant 12); only how they are sent changed. The text is built a repository
 * at a time, so a large report never makes a second copy of itself in objects (R6O-1).
 */
export async function reportResponseBody(path: string, analysisPath: string, notes: { notes: unknown; problem?: string }): Promise<Buffer[]> {
	const tail = { findingNotes: notes.notes, ...(notes.problem ? { notesProblem: notes.problem } : {}) };
	const report = await readReport(path);
	if (!report) return [Buffer.from(JSON.stringify({ report: null, notes: [], settingNotes: [], ...tail }))];
	const prepared = prepareReport(report);
	const analysis: AnalysisFile = await readAnalysis(analysisPath, report);
	const judged = Object.keys(analysis.items).length > 0;
	const chunks: Buffer[] = [prepared.opening];
	prepared.repos.forEach((repo, index) => {
		// A repository none of whose findings is judged is sent as it was prepared; only the others are written again.
		if (!judged || !repo.units.some((unit) => analysis.items[unit])) return chunks.push(repo.text);
		chunks.push(Buffer.from(repoText(repo, index, prepared.fix, analysis)));
	});
	chunks.push(Buffer.from(`]},${JSON.stringify({ suggestions: prepared.suggestions, ...tail }).slice(1)}`));
	return chunks;
}

/** A report's response as far as the report alone decides it, worked out once for each report (R6O-1). */
export interface PreparedReport {
	/** Everything before the first repository. */
	opening: Buffer;
	repos: PreparedRepo[];
	suggestions: Suggestion[];
	/** Each finding's place in `suggestions`. */
	fix: Map<Finding, number>;
}

export interface PreparedRepo {
	repo: RepoResult;
	name: string;
	/** Worst first. */
	findings: Finding[];
	/** The analysis's key for each of `findings`. */
	units: string[];
	/** The repository as sent when none of its findings is judged, with the comma before it. */
	text: Buffer;
}

export const preparedReports = new WeakMap<ScanReport, PreparedReport>();

export function prepareReport(report: ScanReport): PreparedReport {
	const kept = preparedReports.get(report);
	if (kept) return kept;
	const planned = suggestionsFor(report);
	const suggestions: Suggestion[] = [];
	const fix = new Map<Finding, number>();
	// Repairs alike in every word are one. Each action's steps are one list, so its text is worked out once.
	const indexes = new Map<string, number>();
	const stepsText = new Map<string[], string>();
	for (const [finding, suggestion] of planned) {
		let steps = stepsText.get(suggestion.how);
		if (steps === undefined) stepsText.set(suggestion.how, (steps = JSON.stringify(suggestion.how)));
		const key = `${suggestion.phase}\n${suggestion.title}\n${steps}`;
		let index = indexes.get(key);
		if (index === undefined) {
			index = suggestions.push(suggestion) - 1;
			indexes.set(key, index);
		}
		fix.set(finding, index);
	}
	const { repos, ...head } = report;
	const opening = JSON.stringify({ notes: coverageNotes(report), settingNotes: settingNotes(report), report: { ...head, repos: [] } });
	if (!opening.endsWith("[]}}")) throw new Error("The report's response could not be built");
	const empty: AnalysisFile = { scannedAt: report.scannedAt, items: {} };
	const prepared: PreparedReport = {
		opening: Buffer.from(opening.slice(0, -3)),
		suggestions,
		fix,
		repos: rankRepos(repos).map((repo, index) => {
			const name = repoName(report, repo);
			const findings = rank(repo.findings);
			const entry = { repo, name, findings, units: findings.map((finding) => unitKey(name, finding)), text: Buffer.alloc(0) };
			entry.text = Buffer.from(repoText(entry, index, fix, empty));
			return entry;
		}),
	};
	preparedReports.set(report, prepared);
	return prepared;
}

/** One repository of the response, with the comma before it after the first. */
export function repoText(repo: Omit<PreparedRepo, "text">, index: number, fix: Map<Finding, number>, analysis: AnalysisFile): string {
	const text = JSON.stringify({
		...repo.repo,
		name: repo.name,
		// The model's judgement rides beside the finding; it changes nothing about it.
		findings: repo.findings.map((finding, at) => ({ ...finding, fix: fix.get(finding), analysis: analysis.items[repo.units[at]!] })),
	});
	return index === 0 ? text : `,${text}`;
}

/** The report last parsed from each path, with what identified the file then. */
export const parsedReports = new Map<string, { stamp: string; report: ScanReport }>();

/**
 * The stored report as it was written, or null when there is none yet. Most requests read it, and a
 * large one takes a while to parse, so the parsed report is kept until the file changes: every save
 * writes a new file and renames it into place, which changes its identity, size or time. The kept
 * report is frozen, so no caller can change what the next one is given.
 */
export async function readReport(path: string): Promise<ScanReport | null> {
	let stamp: string;
	try {
		const info = await stat(path, { bigint: true });
		stamp = `${info.ino}:${info.size}:${info.mtimeNs}`;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			parsedReports.delete(path);
			return null;
		}
		throw err;
	}
	const kept = parsedReports.get(path);
	if (kept?.stamp === stamp) return kept.report;

	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
	let report: ScanReport;
	try {
		report = JSON.parse(text) as ScanReport;
	} catch {
		throw new HttpError(500, `The report file is not valid JSON: ${path}`);
	}
	if (!Array.isArray(report?.repos) || !Array.isArray(report?.tools) || typeof report.root !== "string") {
		throw new HttpError(500, `The report file is not a Porchlight scan report: ${path}`);
	}
	parsedReports.set(path, { stamp, report: deepFreeze(report) });
	return report;
}

export function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const inner of Object.values(value)) deepFreeze(inner);
	}
	return value;
}
