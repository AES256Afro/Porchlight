import type { Severity } from "../repos/types.ts";

export type Counts = Record<Severity, number>;

/** One thing to do. It may clear many findings: upgrading a package clears every advisory against it. */
export interface Action {
	kind: "upgrade" | "replace" | "rotate" | "review" | "dns" | "certificate" | "headers";
	/** The worst severity among the findings this action clears. */
	priority: Severity;
	/** What to do, as an instruction. */
	title: string;
	/** The file, lockfile or host the work happens in. */
	where: string;
	/** How to do it, in order. Short; never more than a few lines. */
	how: string[];
	/** What it clears: advisory IDs, or the findings in words. */
	clears: string[];
	/** Findings cleared, by severity. */
	counts: Counts;
}

export type PhaseKey = "now" | "next" | "schedule" | "later";

export interface Phase {
	key: PhaseKey;
	title: string;
	/** What belongs in this phase, in one sentence. */
	summary: string;
	/** Actions grouped by the repository or host they belong to, most pressing group first. */
	groups: { name: string; actions: Action[] }[];
}

/** A scan turned into an ordered list of repairs. */
export interface Roadmap {
	title: string;
	/** The folder or domain the scan covered. */
	source: string;
	scannedAt: string;
	/** What was left out on purpose, in words; null when the roadmap covers the whole scan. */
	scope: string | null;
	/** What the scan could not check. A roadmap with caveats is not the whole job. */
	caveats: string[];
	/** Always all four phases, in order; a phase with nothing to do has no groups. */
	phases: Phase[];
	totals: { actions: number; findings: number; groups: number };
}

/** One finding and what to do about it. */
export interface FindingRow {
	/** The repository or host it was found in. */
	place: string;
	severity: Severity;
	/** In words: Secret, Vulnerability, DNS, Certificate, Headers. */
	type: string;
	/** The scanner rule or advisory ID. */
	id: string;
	title: string;
	where: string;
	detail: string;
	/** Why it was ranked lower, when it was. */
	note?: string;
	phase: PhaseKey;
	/** The repair that clears it: the title of its action in the roadmap. */
	suggestion: string;
	how: string[];
}

/** Every finding of a scan with its suggested fix, most severe first. */
export interface FindingsList {
	title: string;
	source: string;
	scannedAt: string;
	scope: string | null;
	caveats: string[];
	rows: FindingRow[];
}

/** An action together with the findings it clears, before either is put in order. */
export interface Planned<F> {
	group: string;
	phase: PhaseKey;
	action: Action;
	findings: F[];
}

export function phaseTitle(key: PhaseKey): string {
	return PHASES.find((phase) => phase.key === key)!.title;
}

export const PHASES: { key: PhaseKey; title: string }[] = [
	{ key: "now", title: "Fix now" },
	{ key: "next", title: "Fix next" },
	{ key: "schedule", title: "Schedule" },
	{ key: "later", title: "When convenient" },
];

export function emptyCounts(): Counts {
	return { critical: 0, high: 0, medium: 0, low: 0 };
}

export function totalOf(counts: Counts): number {
	return counts.critical + counts.high + counts.medium + counts.low;
}

/** Puts actions into phases and orders everything most pressing first. */
export function assemble(
	base: Pick<Roadmap, "title" | "source" | "scannedAt" | "scope" | "caveats">,
	summaries: Record<PhaseKey, string>,
	entries: { group: string; phase: PhaseKey; action: Action }[],
): Roadmap {
	const phases: Phase[] = PHASES.map(({ key, title }) => {
		const byGroup = new Map<string, Action[]>();
		for (const entry of entries) {
			if (entry.phase !== key) continue;
			byGroup.set(entry.group, [...(byGroup.get(entry.group) ?? []), entry.action]);
		}
		const groups = [...byGroup].map(([name, actions]) => ({ name, actions: actions.sort(byUrgency) }));
		groups.sort((a, b) => compareCounts(sumCounts(b.actions), sumCounts(a.actions)) || a.name.localeCompare(b.name));
		return { key, title, summary: summaries[key], groups };
	});
	return {
		...base,
		phases,
		totals: {
			actions: entries.length,
			findings: entries.reduce((sum, entry) => sum + totalOf(entry.action.counts), 0),
			groups: new Set(entries.map((entry) => entry.group)).size,
		},
	};
}

export function sumCounts(actions: Action[]): Counts {
	const total = emptyCounts();
	for (const action of actions) {
		for (const severity of Object.keys(total) as Severity[]) total[severity] += action.counts[severity];
	}
	return total;
}

/** Positive when `a` is the heavier load: more critical first, then high, and so on. */
function compareCounts(a: Counts, b: Counts): number {
	return a.critical - b.critical || a.high - b.high || a.medium - b.medium || a.low - b.low;
}

/** Credentials to rotate lead; then whatever clears the most severe findings. */
function byUrgency(a: Action, b: Action): number {
	const rotateFirst = Number(b.kind === "rotate") - Number(a.kind === "rotate");
	return rotateFirst || compareCounts(b.counts, a.counts) || a.title.localeCompare(b.title);
}
