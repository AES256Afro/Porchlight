import { readFile } from "node:fs/promises";
import { chat, type AssistantConfig, type ChatOptions } from "../assist/ollama.ts";
import { analysisPrompt } from "../assist/prompts.ts";
import { repoName } from "../repos/report.ts";
import { severityRank, type Finding, type RepoResult, type ScanReport, type Severity } from "../repos/types.ts";
import { suggestionsFor } from "../roadmap/repos.ts";
import { gatherEvidence, packageName, type Evidence } from "./evidence.ts";
import { writePrivateJson } from "../private-files.ts";

/**
 * The model as a step of the analysis: for each finding it is given the evidence Porchlight gathered
 * and asked how likely the problem is real here, and how to repair it in this repository.
 *
 * Its answer is advice, kept apart from the scan. It is stored in its own file, shown labelled with
 * the model's name, and never changes a severity, a count, the roadmap or an export: a model that
 * is wrong about a real key must not be able to hide it.
 */
export const VERDICTS = ["confirmed", "likely", "unlikely", "unclear"] as const;
export type Verdict = (typeof VERDICTS)[number];

export interface Judgement {
	verdict: Verdict;
	reason: string;
	steps: string[];
	/** What the model was given beyond the finding itself. Absent for a secret. */
	evidence?: Evidence;
	/**
	 * Porchlight's own words, when plain code set the model's verdict aside: "unlikely" where the
	 * search for imports could not find one by the package's name (B39). The model's reason is kept as
	 * it wrote it.
	 */
	overruled?: string;
	model: string;
	at: string;
}

/** One thing to judge: a secret, or all the advisories against one package in one place. */
export interface Unit {
	key: string;
	repo: RepoResult;
	repoName: string;
	kind: Finding["kind"];
	/** The worst severity among its findings. */
	severity: Severity;
	findings: Finding[];
}

export interface AnalysisFile {
	/** The scan these judgements are about. A newer scan makes them stale, and they are not shown. */
	scannedAt: string;
	items: Record<string, Judgement>;
}

const MAX_REASON = 500;
const MAX_STEP = 400;
const MAX_STEPS = 5;
/** Advisory IDs named for one package; the rest are counted. */
const MAX_ADVISORIES = 12;

/** A finding's unit: a secret or private data stands alone; a package's advisories at one place are judged together. */
export function unitKey(repo: string, finding: Finding): string {
	return finding.kind === "vulnerability" ? [repo, "vulnerability", finding.location, finding.detail].join("\n") : [repo, finding.kind, finding.ruleId, finding.location, finding.detail].join("\n");
}

/** Everything to judge in a report, worst first, then in report order. */
export function unitsOf(report: ScanReport): Unit[] {
	const units = new Map<string, Unit>();
	for (const repo of report.repos) {
		const name = repoName(report, repo);
		for (const finding of repo.findings) {
			const key = unitKey(name, finding);
			const unit = units.get(key);
			if (!unit) units.set(key, { key, repo, repoName: name, kind: finding.kind, severity: finding.severity, findings: [finding] });
			else {
				unit.findings.push(finding);
				if (severityRank(finding.severity) < severityRank(unit.severity)) unit.severity = finding.severity;
			}
		}
	}
	return [...units.values()].sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

/** Gathers the evidence for one unit, asks the model, and returns its judgement. */
export async function judge(report: ScanReport, unit: Unit, config: AssistantConfig, options: ChatOptions & { now?: () => Date } = {}): Promise<Judgement> {
	const [first] = unit.findings as [Finding, ...Finding[]];
	const suggestion = suggestionsFor(report).get(first);
	const evidence = unit.kind === "vulnerability" ? await gatherEvidence(unit.repo.path, first.location, packageName(first.detail)) : undefined;
	const item = {
		repo: unit.repoName,
		kind: unit.kind,
		severity: unit.severity,
		location: first.location,
		...(unit.kind === "vulnerability"
			? {
					package: first.detail,
					advisories: unit.findings.slice(0, MAX_ADVISORIES).map((finding) => ({ id: finding.ruleId, severity: finding.severity, title: finding.title, ...(finding.fixedIn ? { fixedIn: finding.fixedIn } : {}) })),
					...(unit.findings.length > MAX_ADVISORIES ? { moreAdvisories: unit.findings.length - MAX_ADVISORIES } : {}),
					evidence,
				}
			: { rule: first.ruleId, title: first.title, foundIn: first.detail, ...(first.count ? { count: first.count } : {}), ...(first.note ? { rankingNote: first.note } : {}) }),
		...(suggestion ? { suggestedFix: { title: suggestion.title, steps: suggestion.how } } : {}),
	};
	const answer = await chat(config, analysisPrompt(item).messages, { ...options, json: true });
	const judged = parseJudgement(answer);
	// "Unlikely" from no import found stands only where the search could find one: a Maven artifact or a
	// package imported under another name is not found by name, and Log4Shell would sort last (B39).
	// Plain code decides this, not the model (invariant 16).
	const unfounded = judged.verdict === "unlikely" && evidence?.searched?.reliable === false && evidence.usedInFiles === 0;
	const settled = unfounded
		? { ...judged, verdict: "unclear" as const, overruled: `The model said unlikely, but ${evidence!.searched!.ecosystem} packages are often imported under another name than they are installed by, so finding no import does not show this one is unused.` }
		: judged;
	return { ...settled, ...(evidence ? { evidence } : {}), model: config.model, at: (options.now?.() ?? new Date()).toISOString() };
}

/**
 * The model's answer as a judgement. Anything that is not the JSON asked for becomes "unclear" with
 * the reason saying so: what a model writes is never trusted to be well formed, and never executed.
 */
export function parseJudgement(answer: string): Pick<Judgement, "verdict" | "reason" | "steps"> {
	const start = answer.indexOf("{");
	const end = answer.lastIndexOf("}");
	let parsed: Record<string, unknown> | null = null;
	if (start !== -1 && end > start) {
		try {
			const value: unknown = JSON.parse(answer.slice(start, end + 1));
			if (typeof value === "object" && value !== null && !Array.isArray(value)) parsed = value as Record<string, unknown>;
		} catch {
			// Not JSON: reported below.
		}
	}
	if (!parsed || !VERDICTS.includes(parsed.verdict as Verdict)) {
		return { verdict: "unclear", reason: "The model's answer was not in the form asked for, so it is not shown.", steps: [] };
	}
	const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
	const steps = Array.isArray(parsed.steps) ? parsed.steps.map((step) => text(step, MAX_STEP)).filter((step) => step !== "") : [];
	return { verdict: parsed.verdict as Verdict, reason: text(parsed.reason, MAX_REASON), steps: steps.slice(0, MAX_STEPS) };
}

/** The stored judgements for this scan; none when there is no file, or it is about another scan. */
export async function readAnalysis(path: string, report: ScanReport): Promise<AnalysisFile> {
	const empty: AnalysisFile = { scannedAt: report.scannedAt, items: {} };
	try {
		const file = JSON.parse(await readFile(path, "utf8")) as AnalysisFile;
		if (file?.scannedAt !== report.scannedAt || typeof file.items !== "object" || file.items === null) return empty;
		return file;
	} catch {
		return empty;
	}
}

/** Judgements name files and say what is wrong with them, so the file is readable only by its owner. */
export async function saveAnalysis(path: string, file: AnalysisFile): Promise<void> {
	await writePrivateJson(path, file);
}
