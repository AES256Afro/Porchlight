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
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { oneAtATime, readPrivateGzipJson, readPrivateJson, UnreadableFileError, updatePrivateJson, writePrivateGzipJson, writePrivateJson } from "../private-files.ts";
import { looksFor, presetOf } from "../../ui/scan-choices.js";
import { findingKey, isDay, isNoteSource, isStatus, MAX_NOTE, type FindingNote, type NoteSource } from "../../ui/tracking.js";
import { countBySeverity, rank, repoName } from "./report.ts";
import type { Finding, RepoResult, ScanChoices, ScanReport, Severity, ToolName, ToolStatus } from "./types.ts";

/** How many past scans are kept. */
export const HISTORY_KEEP = 50;
/** A kept scan's file name: gzipped JSON, or plain JSON from before OP-9. */
const KEPT_NAME = /^scan-[\w-]+\.json(?:\.gz)?$/;
/** How many fixed findings the comparison lists by name; the rest are counted. */
const MAX_FIXED_LISTED = 300;

export interface HistoryEntry {
	file: string;
	scannedAt: string;
	root: string;
	/** Further folders the scan covered (fetched repositories). Missing from entries made before M10. */
	otherRoots?: string[];
	repositories: number;
	findings: number;
	counts: Record<Severity, number>;
	/**
	 * What the scan covered: its preset, or "custom" (VS-12). A narrower scan finds less, so the trend draws
	 * it apart instead of as an improvement. Missing from entries made before M17, which were Standard
	 * unless the report says otherwise.
	 */
	preset?: ScanChoices["preset"];
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
 * Each repository and scanner a scan actually looked with: the scanner was installed, its check was
 * chosen, and it did not fail on that repository. A finding outside these was not looked for, so its
 * absence says nothing.
 */
function checked(report: ScanReport): Set<string> {
	const ran = report.tools.filter((tool) => tool.status === "ok").map((tool) => tool.tool);
	const pairs = new Set<string>();
	for (const repo of report.repos) {
		const name = repoName(report, repo);
		for (const tool of ran) {
			const looked = !repo.errors.some((error) => error.tool === tool) && !repo.notCovered?.some((note) => note.tool === tool);
			if (looked) pairs.add(`${name}\n${tool}`);
		}
	}
	return pairs;
}

/**
 * Whether `report` looked for this finding: in that repository, with that scanner, and where the
 * finding was (a Quick scan reads no history, so a secret found in an old commit was not looked for).
 */
function lookedFor(report: ScanReport): (repo: string, finding: Finding) => boolean {
	const pairs = checked(report);
	return (repo, finding) => pairs.has(`${repo}\n${finding.tool}`) && looksFor(report.choices, finding);
}

/**
 * What is new in `current`, and what `previous` had that `current` looked for and did not find. A
 * finding counts as fixed only where the later scan checked again, and as new only where the earlier
 * one had checked: a scanner that was missing or failed, a check switched off or history not read
 * never makes a finding look fixed or new.
 */
export function compareScans(previous: ScanReport, current: ScanReport): Comparison {
	const before = keyed(previous);
	const after = keyed(current);
	const checkedBefore = lookedFor(previous);
	const checkedAfter = lookedFor(current);
	const newKeys = [...after.entries()].filter(([key, { repo, finding }]) => !before.has(key) && checkedBefore(repo, finding)).map(([key]) => key);
	const missing = [...before.entries()].filter(([key]) => !after.has(key)).map(([, value]) => value);
	const gone = missing.filter(({ repo, finding }) => checkedAfter(repo, finding));
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

/** Whether two scans covered the same folders, so comparing them says what changed rather than where they looked. */
function sameFolders(a: { root: string; otherRoots?: string[] }, b: { root: string; otherRoots?: string[] }, known = true): boolean {
	if (a.root !== b.root) return false;
	// An entry kept before M10 does not say which further folders it covered: its root decides.
	if (!known) return true;
	return [...(a.otherRoots ?? [])].sort().join("\n") === [...(b.otherRoots ?? [])].sort().join("\n");
}

/** The latest scan against the kept scan before it: none to compare with, one that could not be read, or the comparison. */
export type LatestChange = { state: "first" } | { state: "unreadable"; reason: string } | { state: "compared"; change: Comparison };

export class History {
	readonly dir: string;
	private readonly indexPath: string;

	constructor(stateDir: string) {
		this.dir = join(stateDir, "history");
		this.indexPath = join(this.dir, "index.json");
	}

	/** The kept scans. An index that is there but cannot be read throws: it is never taken for an empty one (invariant 5). */
	async list(): Promise<HistoryEntry[]> {
		const read = await readPrivateJson(this.indexPath);
		if (read.state === "missing") return [];
		if (read.state === "unreadable" || !Array.isArray(read.value)) throw new UnreadableFileError("The scan history's index", read.state === "unreadable" ? read.reason : "it is not a list");
		return (read.value as HistoryEntry[]).filter((entry) => typeof entry?.file === "string" && typeof entry.scannedAt === "string");
	}

	/** A kept scan, by the name in the index only: never a path from a request. */
	async read(file: string): Promise<ScanReport | null> {
		const kept = await this.readKept(file);
		return kept.state === "read" ? (kept.value as ScanReport) : null;
	}

	private async readKept(file: string): Promise<{ state: "missing" } | { state: "read"; value: unknown } | { state: "unreadable"; reason: string }> {
		const entries = await this.list();
		if (!entries.some((entry) => entry.file === file) || !KEPT_NAME.test(file)) return { state: "missing" };
		// Kept gzipped since OP-9; a scan kept before is plain JSON, and read as it is.
		const read = file.endsWith(".gz") ? await readPrivateGzipJson(join(this.dir, file)) : await readPrivateJson(join(this.dir, file));
		if (read.state === "read" && !Array.isArray((read.value as ScanReport | null)?.repos)) return { state: "unreadable", reason: "it is not a scan report" };
		return read;
	}

	/**
	 * Keeps a finished scan, and counts what changed since the one before it. A scan already kept (the
	 * same `scannedAt`) is not kept twice.
	 */
	add(report: ScanReport): Promise<HistoryEntry> {
		// One at a time: two scans finishing together each add their entry, and neither is lost.
		return oneAtATime(this.indexPath, async () => {
			// An index that cannot be read throws here, before anything is written or pruned (B25).
			const entries = await this.list();
			const existing = entries.find((entry) => entry.scannedAt === report.scannedAt);
			if (existing) return existing;
			await mkdir(this.dir, { recursive: true, mode: 0o700 });
			const file = `scan-${report.scannedAt.replace(/[^\dT]/g, "")}.json.gz`;
			await writePrivateGzipJson(join(this.dir, file), report);
			const findings = report.repos.flatMap((repo) => repo.findings);
			const entry: HistoryEntry = {
				file,
				scannedAt: report.scannedAt,
				root: report.root,
				...(report.otherRoots?.length ? { otherRoots: report.otherRoots } : {}),
				repositories: report.repos.length,
				findings: findings.length,
				counts: countBySeverity(findings),
				...(report.choices ? { preset: presetOf(report.choices) } : {}),
			};
			const change = await this.compareWith(entries, report);
			if (change.state === "compared") {
				entry.newCount = change.change.newCount;
				entry.fixedCount = change.change.fixedCount;
			}
			const kept = [...entries, entry];
			const removed = kept.splice(0, Math.max(0, kept.length - HISTORY_KEEP));
			await writePrivateJson(this.indexPath, kept);
			for (const old of removed) await rm(join(this.dir, old.file), { force: true });
			await this.prune(kept);
			return entry;
		});
	}

	/** The latest scan against the kept scan before it, or null when there is none or it could not be read. */
	async latestChange(current: ScanReport): Promise<Comparison | null> {
		const change = await this.compare(current);
		return change.state === "compared" ? change.change : null;
	}

	/**
	 * The latest scan against the kept scan of the same folders before it (B27). Scans of another folder
	 * are passed over: their repositories share names with these, so comparing them would count every
	 * difference as new or fixed. A kept scan that cannot be read is said, never taken for none (B68).
	 */
	async compare(current: ScanReport): Promise<LatestChange> {
		let entries: HistoryEntry[];
		try {
			entries = await this.list();
		} catch (err) {
			return { state: "unreadable", reason: err instanceof Error ? err.message : String(err) };
		}
		const index = entries.findIndex((entry) => entry.scannedAt === current.scannedAt);
		return this.compareWith(index === -1 ? entries : entries.slice(0, index), current);
	}

	private async compareWith(earlier: HistoryEntry[], current: ScanReport): Promise<LatestChange> {
		const before = [...earlier].reverse().find((entry) => entry.scannedAt !== current.scannedAt && sameFolders(entry, current, entry.otherRoots !== undefined || !current.otherRoots?.length));
		if (!before) return { state: "first" };
		const kept = await this.readKept(before.file);
		if (kept.state !== "read") return { state: "unreadable", reason: `The scan of ${before.scannedAt} ${kept.state === "missing" ? "is no longer kept" : `could not be read (${kept.reason})`}` };
		return { state: "compared", change: compareScans(kept.value as ScanReport, current) };
	}

	/** Removes kept files the index no longer names, such as ones left by a crash. */
	private async prune(kept: HistoryEntry[]): Promise<void> {
		const names = new Set(kept.map((entry) => entry.file));
		for (const name of await readdir(this.dir).catch(() => [] as string[])) {
			if (KEPT_NAME.test(name) && !names.has(name)) await rm(join(this.dir, name), { force: true });
		}
	}
}

/** What scanning one repository again changed: found again, gone, new, and kept because not looked at again. */
export interface RescanChange {
	repo: string;
	fixedCount: number;
	newCount: number;
	/** Findings kept from before because their scanner did not look this time (invariant 5): never counted as fixed. */
	uncheckedCount: number;
}

/**
 * One repository scanned again, put together with what it had before (US-4, R6Q-6). Where a scanner did
 * not look this time (not chosen, not installed any more, or failed on the repository), what it found
 * before is kept: not looking again never clears a finding (invariant 5). Shared by "Scan again" on the
 * page and `repos scan --again`, so both count fixed and new the same way, by `findingKey`.
 */
export function mergeRescan(name: string, before: RepoResult, now: { repo: RepoResult; tools: ToolStatus[] }, choices: ScanChoices, at: Date = new Date()): { merged: RepoResult; change: RescanChange } {
	const { repo, tools } = now;
	const chosen = (tool: ToolName) => (tool === "gitleaks" ? choices.secrets || choices.privateData === true : choices.dependencies);
	const looked = (tool: ToolName) => chosen(tool) && tools.some((entry) => entry.tool === tool && entry.status === "ok") && !repo.errors.some((error) => error.tool === tool);
	const kept = before.findings.filter((finding) => !looked(finding.tool));
	const found = repo.findings.filter((finding) => looked(finding.tool));
	const merged: RepoResult = {
		...repo,
		findings: [...kept, ...found],
		// A scanner that failed before and did not run now is still a gap.
		errors: [...repo.errors, ...before.errors.filter((error) => !tools.some((entry) => entry.tool === error.tool && entry.status === "ok"))],
		rescannedAt: at.toISOString(),
	};
	const key = (finding: Finding) => findingKey(name, finding);
	const earlier = new Set(before.findings.map(key));
	const later = new Set(found.map(key));
	return {
		merged,
		change: {
			repo: name,
			fixedCount: before.findings.filter((finding) => looked(finding.tool) && !later.has(key(finding))).length,
			newCount: found.filter((finding) => !earlier.has(key(finding))).length,
			uncheckedCount: kept.length,
		},
	};
}

export type NotesFile = Record<string, FindingNote>;

const NOTES = "Your finding notes";

/** The notes this version understands, out of the file's value. Entries it does not understand are left out here and kept in the file. */
function notesOf(parsed: unknown): NotesFile {
	if (typeof parsed !== "object" || parsed === null) return {};
	const notes: NotesFile = {};
	for (const [key, value] of Object.entries(parsed as Record<string, Partial<FindingNote>>)) {
		if (isStatus(value?.status) && typeof value.note === "string") {
			const previous = value.previous;
			notes[key] = {
				status: value.status,
				note: value.note.slice(0, MAX_NOTE),
				updatedAt: String(value.updatedAt ?? ""),
				...(value.status === "accepted" && isDay(value.until) ? { until: value.until } : {}),
				...(isNoteSource(value.by) ? { by: value.by } : {}),
				...(previous && isStatus(previous.status) ? { previous: { status: previous.status, updatedAt: String(previous.updatedAt ?? ""), ...(isNoteSource(previous.by) ? { by: previous.by } : {}) } } : {}),
			};
		}
	}
	return notes;
}

/** The owner's notes. A file that is there but cannot be read throws: it is never taken for none (B25). */
export async function readNotes(path: string): Promise<NotesFile> {
	const read = await readPrivateJson(path);
	if (read.state === "missing") return {};
	if (read.state === "unreadable") throw new UnreadableFileError(NOTES, read.reason);
	return notesOf(read.value);
}

/** The notes, or none with the reason they could not be read, for a page that must still show the report. */
export async function notesForPage(path: string): Promise<{ notes: NotesFile; problem?: string }> {
	try {
		return { notes: await readNotes(path) };
	} catch (err) {
		return { notes: {}, problem: err instanceof Error ? err.message : String(err) };
	}
}

/** Identifies a secret apart from the commit its finding names: the repository, the rule and the place. */
function placeOf(key: string): string {
	return key.split("\n").slice(0, 3).join("\n");
}

/**
 * Moves each note on a secret to that secret's finding when its key no longer matches one: which commit
 * a secret's finding names changed once, when its matches began to be put in a fixed order (B20). Only
 * where one note and one secret share the repository, the rule and the place, and that secret has no
 * note of its own, so no note ever moves to another finding. Returns how many moved.
 */
export async function carryNotes(path: string, report: ScanReport): Promise<number> {
	let moved = 0;
	await updatePrivateJson(path, NOTES, (current) => {
		if (typeof current !== "object" || current === null) return undefined;
		const all = { ...(current as Record<string, unknown>) };
		const secrets = new Map<string, string[]>();
		for (const repo of report.repos) {
			const name = repoName(report, repo);
			for (const finding of repo.findings) {
				if (finding.kind !== "secret") continue;
				const key = findingKey(name, finding);
				secrets.set(placeOf(key), [...(secrets.get(placeOf(key)) ?? []), key]);
			}
		}
		const currentKeys = new Set([...secrets.values()].flat());
		const orphans = new Map<string, string[]>();
		for (const key of Object.keys(all)) if (!currentKeys.has(key) && secrets.has(placeOf(key))) orphans.set(placeOf(key), [...(orphans.get(placeOf(key)) ?? []), key]);
		for (const [place, keys] of orphans) {
			const targets = secrets.get(place) ?? [];
			if (keys.length !== 1 || targets.length !== 1 || all[targets[0]!] !== undefined) continue;
			all[targets[0]!] = all[keys[0]!];
			delete all[keys[0]!];
			moved++;
		}
		return moved > 0 ? all : undefined;
	});
	return moved;
}

/**
 * Sets one finding's status and note. Back to "open" with no note removes the entry, so the file
 * holds only what the owner said.
 */
export async function setNote(path: string, key: string, status: FindingNote["status"], note: string, now: Date = new Date(), until?: string, by?: NoteSource): Promise<FindingNote | null> {
	const saved = await setNotes(path, [key], status, note, now, until, by);
	return saved[0] ?? null;
}

/**
 * Sets the same status and note on several findings at once (B-Q2), in one change to the file. Each
 * keeps the status it replaced and where the change came from (R6U-7).
 */
export async function setNotes(path: string, keys: string[], status: FindingNote["status"], note: string, now: Date = new Date(), until?: string, by?: NoteSource): Promise<(FindingNote | null)[]> {
	const trimmed = note.trim();
	const saved: (FindingNote | null)[] = [];
	// One change at a time, on the file as it is: every other entry is kept as written, including any
	// an older or newer Porchlight wrote that this one does not understand (B21, B26).
	await updatePrivateJson(path, NOTES, (current) => {
		const all = typeof current === "object" && current !== null && !Array.isArray(current) ? { ...(current as Record<string, unknown>) } : {};
		const known = notesOf(all);
		for (const key of keys) {
			const before = known[key];
			if (status === "open" && trimmed === "") {
				delete all[key];
				saved.push(null);
				continue;
			}
			// An end date belongs to an accepted risk alone; any other status drops it.
			const next: FindingNote = {
				status,
				note: trimmed,
				updatedAt: now.toISOString(),
				...(status === "accepted" && until ? { until } : {}),
				...(by ? { by } : {}),
				// The status this one replaced, when it was another: a change from elsewhere is never silent.
				...(before && before.status !== status ? { previous: { status: before.status, updatedAt: before.updatedAt, ...(before.by ? { by: before.by } : {}) } } : before?.previous ? { previous: before.previous } : {}),
			};
			all[key] = next;
			saved.push(next);
		}
		return all;
	});
	return saved;
}

/** The notes that name no finding of any kept scan, nor of the latest report (R6Q-12). */
export async function orphanNotes(notes: NotesFile, history: History, latest: ScanReport | null): Promise<string[]> {
	const known = new Set(latest ? keyed(latest).keys() : []);
	for (const entry of await history.list()) {
		const report = await history.read(entry.file);
		if (report) for (const key of keyed(report).keys()) known.add(key);
	}
	return Object.keys(notes).filter((key) => !known.has(key));
}

/** Removes the named notes, and only those (R6Q-12). Returns how many went. */
export async function removeNotes(path: string, keys: string[]): Promise<number> {
	let removed = 0;
	await updatePrivateJson(path, NOTES, (current) => {
		if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
		const all = { ...(current as Record<string, unknown>) };
		for (const key of keys) {
			if (Object.hasOwn(all, key)) {
				delete all[key];
				removed++;
			}
		}
		return removed > 0 ? all : undefined;
	});
	return removed;
}
