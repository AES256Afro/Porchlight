/**
 * Scan history and the owner's own tracking of findings, kept beside the report:
 *
 * - `history/`: a copy of every finished scan (0600), and `history/index.json`, a summary of each with
 *   how many findings were new and how many fixed since the scan before it. The oldest are removed
 *   past HISTORY_KEEP.
 * - `finding-notes.json` (0600): the status and note the owner gave each finding, by `findingKey`, so
 *   they carry over to later scans.
 *
 * Neither changes a finding, a severity, a count, the roadmap, an export or the CLI's exit code.
 */
import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { findingKey, isDay, isStatus, MAX_NOTE, type FindingNote } from "../../ui/tracking.js";
import { countBySeverity, rank, repoName } from "./report.ts";
import type { Finding, ScanReport, Severity } from "./types.ts";

/** How many past scans are kept. */
export const HISTORY_KEEP = 50;
/** How many fixed findings the comparison lists by name; the rest are counted. */
const MAX_FIXED_LISTED = 300;

export interface HistoryEntry {
	file: string;
	scannedAt: string;
	root: string;
	repositories: number;
	findings: number;
	counts: Record<Severity, number>;
	/** Against the scan before it; absent for the first scan kept. */
	newCount?: number;
	fixedCount?: number;
}

/** A finding the latest scan no longer has, with what the page shows of it. */
export interface FixedFinding {
	repo: string;
	severity: Severity;
	kind: Finding["kind"];
	ruleId: string;
	title: string;
	location: string;
	detail: string;
}

export interface Comparison {
	previousScannedAt: string;
	newCount: number;
	fixedCount: number;
	/**
	 * Findings of the previous scan that this one could not look for again: its scanner was missing
	 * or failed, or the repository was not in this scan. Not found is not fixed, so they are counted here.
	 */
	uncheckedCount: number;
	/** Keys of the findings that are new, for the page to mark. */
	newKeys: string[];
	/** The fixed findings, most severe first, up to MAX_FIXED_LISTED. */
	fixed: FixedFinding[];
}

/** Every finding of a report by its key. */
export function keyed(report: ScanReport): Map<string, { repo: string; finding: Finding }> {
	const map = new Map<string, { repo: string; finding: Finding }>();
	for (const repo of report.repos) {
		const name = repoName(report, repo);
		for (const finding of repo.findings) map.set(findingKey(name, finding), { repo: name, finding });
	}
	return map;
}

/**
 * Each repository and scanner a scan actually looked with: the scanner was installed and did not
 * fail on that repository. A finding outside these was not looked for, so its absence says nothing.
 */
function checked(report: ScanReport): Set<string> {
	const ran = report.tools.filter((tool) => tool.status === "ok").map((tool) => tool.tool);
	const pairs = new Set<string>();
	for (const repo of report.repos) {
		const name = repoName(report, repo);
		for (const tool of ran) if (!repo.errors.some((error) => error.tool === tool)) pairs.add(`${name}\n${tool}`);
	}
	return pairs;
}

/**
 * What is new in `current`, and what `previous` had that `current` looked for and did not find. A
 * finding counts as fixed only where the later scan checked again, and as new only where the earlier
 * one had checked: a scanner that was missing or failed never makes a finding look fixed or new.
 */
export function compareScans(previous: ScanReport, current: ScanReport): Comparison {
	const before = keyed(previous);
	const after = keyed(current);
	const checkedBefore = checked(previous);
	const checkedAfter = checked(current);
	const newKeys = [...after.entries()].filter(([key, { repo, finding }]) => !before.has(key) && checkedBefore.has(`${repo}\n${finding.tool}`)).map(([key]) => key);
	const missing = [...before.entries()].filter(([key]) => !after.has(key)).map(([, value]) => value);
	const gone = missing.filter(({ repo, finding }) => checkedAfter.has(`${repo}\n${finding.tool}`));
	const order = new Map(rank(gone.map((entry) => entry.finding)).map((finding, index) => [finding, index]));
	gone.sort((a, b) => order.get(a.finding)! - order.get(b.finding)!);
	return {
		previousScannedAt: previous.scannedAt,
		newCount: newKeys.length,
		fixedCount: gone.length,
		uncheckedCount: missing.length - gone.length,
		newKeys,
		fixed: gone.slice(0, MAX_FIXED_LISTED).map(({ repo, finding }) => ({
			repo,
			severity: finding.severity,
			kind: finding.kind,
			ruleId: finding.ruleId,
			title: finding.title,
			location: finding.location,
			detail: finding.detail,
		})),
	};
}

export class History {
	readonly dir: string;
	private readonly indexPath: string;

	constructor(stateDir: string) {
		this.dir = join(stateDir, "history");
		this.indexPath = join(this.dir, "index.json");
	}

	async list(): Promise<HistoryEntry[]> {
		try {
			const entries = JSON.parse(await readFile(this.indexPath, "utf8"));
			return Array.isArray(entries) ? (entries as HistoryEntry[]).filter((entry) => typeof entry?.file === "string" && typeof entry.scannedAt === "string") : [];
		} catch {
			return [];
		}
	}

	/** A kept scan, by the name in the index only: never a path from a request. */
	async read(file: string): Promise<ScanReport | null> {
		const entries = await this.list();
		if (!entries.some((entry) => entry.file === file) || !/^scan-[\w.-]+\.json$/.test(file)) return null;
		try {
			return JSON.parse(await readFile(join(this.dir, file), "utf8")) as ScanReport;
		} catch {
			return null;
		}
	}

	/**
	 * Keeps a finished scan, and counts what changed since the one before it. A scan already kept (the
	 * same `scannedAt`) is not kept twice.
	 */
	async add(report: ScanReport): Promise<HistoryEntry> {
		const entries = await this.list();
		const existing = entries.find((entry) => entry.scannedAt === report.scannedAt);
		if (existing) return existing;
		await mkdir(this.dir, { recursive: true, mode: 0o700 });
		const file = `scan-${report.scannedAt.replace(/[^\dT]/g, "")}.json`;
		await writePrivate(join(this.dir, file), report);
		const previous = entries.at(-1) ? await this.read(entries.at(-1)!.file) : null;
		const findings = report.repos.flatMap((repo) => repo.findings);
		const entry: HistoryEntry = {
			file,
			scannedAt: report.scannedAt,
			root: report.root,
			repositories: report.repos.length,
			findings: findings.length,
			counts: countBySeverity(findings),
		};
		if (previous) {
			const change = compareScans(previous, report);
			entry.newCount = change.newCount;
			entry.fixedCount = change.fixedCount;
		}
		const kept = [...entries, entry];
		const removed = kept.splice(0, Math.max(0, kept.length - HISTORY_KEEP));
		await writePrivate(this.indexPath, kept);
		for (const old of removed) await rm(join(this.dir, old.file), { force: true });
		await this.prune(kept);
		return entry;
	}

	/** The latest scan against the kept scan before it, or null when there is none. */
	async latestChange(current: ScanReport): Promise<Comparison | null> {
		const entries = await this.list();
		const index = entries.findIndex((entry) => entry.scannedAt === current.scannedAt);
		const before = index > 0 ? entries[index - 1] : index === -1 ? entries.at(-1) : undefined;
		if (!before || before.scannedAt === current.scannedAt) return null;
		const previous = await this.read(before.file);
		return previous ? compareScans(previous, current) : null;
	}

	/** Removes kept files the index no longer names, such as ones left by a crash. */
	private async prune(kept: HistoryEntry[]): Promise<void> {
		const names = new Set(kept.map((entry) => entry.file));
		for (const name of await readdir(this.dir).catch(() => [] as string[])) {
			if (/^scan-[\w.-]+\.json$/.test(name) && !names.has(name)) await rm(join(this.dir, name), { force: true });
		}
	}
}

export type NotesFile = Record<string, FindingNote>;

export async function readNotes(path: string): Promise<NotesFile> {
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		if (typeof parsed !== "object" || parsed === null) return {};
		const notes: NotesFile = {};
		for (const [key, value] of Object.entries(parsed as Record<string, Partial<FindingNote>>)) {
			if (isStatus(value?.status) && typeof value.note === "string") {
				notes[key] = { status: value.status, note: value.note.slice(0, MAX_NOTE), updatedAt: String(value.updatedAt ?? ""), ...(value.status === "accepted" && isDay(value.until) ? { until: value.until } : {}) };
			}
		}
		return notes;
	} catch {
		return {};
	}
}

/**
 * Sets one finding's status and note. Back to "open" with no note removes the entry, so the file
 * holds only what the owner said.
 */
export async function setNote(path: string, key: string, status: FindingNote["status"], note: string, now: Date = new Date(), until?: string): Promise<FindingNote | null> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const notes = await readNotes(path);
	const trimmed = note.trim();
	if (status === "open" && trimmed === "") delete notes[key];
	// An end date belongs to an accepted risk alone; any other status drops it.
	else notes[key] = { status, note: trimmed, updatedAt: now.toISOString(), ...(status === "accepted" && until ? { until } : {}) };
	await writePrivate(path, notes);
	return notes[key] ?? null;
}

/** Holds what the owner wrote about their own findings, so it is readable only by them, like the report. */
async function writePrivate(path: string, value: unknown): Promise<void> {
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(value, null, "\t")}\n`, { mode: 0o600 });
	await chmod(temporary, 0o600);
	await rename(temporary, path);
}
