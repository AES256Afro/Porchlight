/**
 * The mural: a one-page board a model writes for an export, so the owner can see, and show others,
 * what a scan found, what the plan is, what has been done and what comes next.
 *
 * The model writes words only. The numbers beside them (`MuralFacts`) are counted by SecurityX from
 * the report, so a reader can check the words against them. The mural is added to an export only
 * when asked for, in its own section labelled with the model's name; it never changes the findings,
 * the counts or the roadmap of the export it sits in.
 */
import { unitKey, unitsOf, VERDICTS, type AnalysisFile, type Verdict } from "../analysis/analyse.ts";
import type { ScanReport, Severity } from "../repos/types.ts";
import type { FindingsList, Roadmap } from "../roadmap/types.ts";

/** What SecurityX itself counted, shown beside the model's words. */
export interface MuralFacts {
	source: string;
	scannedAt: string;
	/** Set when the export covers only part of the scan. */
	scope: string | null;
	notCovered: string[];
	repositories: number;
	repositoriesAffected: number;
	findings: Record<Severity, number> & { total: number; secrets: number; vulnerabilities: number };
	actions: { phase: string; actions: number }[];
	/** The model's Deeper analysis of this scan, across the whole scan. */
	analysis: { items: number; judged: number; verdicts: Record<Verdict, number> };
}

/** What the model wrote, checked. */
export interface MuralText {
	headline: string;
	found: string[];
	decided: string[];
	done: string[];
	next: string[];
}

export interface Mural extends MuralText {
	model: string;
	generatedAt: string;
	facts: MuralFacts;
	/** What was left out of what the model read, in words; null when nothing was. */
	cut: string | null;
}

export const MURAL_COLUMNS = [
	["found", "What was found"],
	["decided", "What to fix, and in what order"],
	["done", "What has been done"],
	["next", "What to do next"],
] as const;

const MAX_ITEMS = 6;
const MAX_ITEM = 300;
const MAX_HEADLINE = 200;

export function muralFacts(report: ScanReport, roadmap: Roadmap, list: FindingsList, analysis: AnalysisFile): MuralFacts {
	const findings = { critical: 0, high: 0, medium: 0, low: 0, total: list.rows.length, secrets: 0, vulnerabilities: 0 };
	for (const row of list.rows) {
		findings[row.severity]++;
		if (row.type === "Secret") findings.secrets++;
		else findings.vulnerabilities++;
	}
	const units = unitsOf(report);
	const verdicts = Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0])) as Record<Verdict, number>;
	let judged = 0;
	for (const unit of units) {
		const judgement = analysis.items[unit.key];
		if (!judgement) continue;
		judged++;
		verdicts[judgement.verdict]++;
	}
	return {
		source: report.root,
		scannedAt: report.scannedAt,
		scope: roadmap.scope,
		notCovered: roadmap.caveats,
		repositories: report.repos.length,
		repositoriesAffected: new Set(list.rows.map((row) => row.place)).size,
		findings,
		actions: roadmap.phases.map((phase) => ({ phase: phase.title, actions: phase.groups.reduce((sum, group) => sum + group.actions.length, 0) })),
		analysis: { items: units.length, judged, verdicts },
	};
}

/** The findings the model judged as real, most severe first, for the mural's data. Never a reason or evidence. */
export function judgedHighlights(report: ScanReport, analysis: AnalysisFile): { repo: string; title: string; severity: Severity; verdict: Verdict }[] {
	const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
	return unitsOf(report)
		.map((unit) => ({ unit, judgement: analysis.items[unitKey(unit.repoName, unit.findings[0]!)] }))
		.filter(({ judgement }) => judgement?.verdict === "confirmed" || judgement?.verdict === "likely")
		.sort((a, b) => order[a.unit.severity] - order[b.unit.severity])
		.map(({ unit, judgement }) => ({ repo: unit.repoName, title: unit.findings[0]!.title, severity: unit.severity, verdict: judgement!.verdict }));
}

/** An answer that is not the object asked for is an error, never a mural. */
export class MuralError extends Error {}

export function parseMural(answer: string): MuralText {
	const text = answer.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
	const start = text.indexOf("{");
	const end = text.lastIndexOf("}");
	let value: Record<string, unknown> | null = null;
	try {
		value = start === -1 ? null : JSON.parse(text.slice(start, end + 1));
	} catch {
		value = null;
	}
	if (!value || typeof value !== "object") throw new MuralError("The model did not answer with the mural asked for. Try again, or use a larger model");
	const items = (key: string): string[] =>
		(Array.isArray(value[key]) ? value[key] : [])
			.filter((item): item is string => typeof item === "string" && item.trim() !== "")
			.slice(0, MAX_ITEMS)
			.map((item) => clipped(item, MAX_ITEM));
	const mural = {
		headline: typeof value.headline === "string" ? clipped(value.headline, MAX_HEADLINE) : "",
		found: items("found"),
		decided: items("decided"),
		done: items("done"),
		next: items("next"),
	};
	if (mural.found.length + mural.decided.length + mural.next.length === 0) {
		throw new MuralError("The model's mural was empty. Try again, or use a larger model");
	}
	return mural;
}

function clipped(text: string, max: number): string {
	const flat = text.replace(/\s+/g, " ").trim();
	return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}
