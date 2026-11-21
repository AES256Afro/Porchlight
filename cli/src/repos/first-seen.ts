/**
 * When each finding was first seen (R6Q-9), from the kept scan history, kept beside the report in
 * `first-seen.json` (0600). It feeds the due dates (FT-14) and is shown beside a finding.
 *
 * A date is set only from a scan that holds the finding: an observation, never an absence (invariant
 * 5). A finding already in the earliest scan read is marked "on or before", since it may be older.
 * A finding gone from the latest scan keeps its date while any kept scan could still hold it, so one
 * that a failed scanner missed comes back with its first date, not a new one. Entries older than every
 * kept scan are dropped, so the file stays the size of what is kept.
 *
 * Like history and notes, none of it changes a finding, a severity, a count, the roadmap, an export
 * or the exit code (invariant 17).
 */
import { join } from "node:path";
import { updatePrivateJson, readPrivateJson, UnreadableFileError } from "../private-files.ts";
import { findingKey } from "../../ui/tracking.js";
import { History, keyed } from "./history.ts";
import { repoName } from "./report.ts";
import type { ScanReport } from "./types.ts";

export interface Seen {
	/** When a scan first held it: the scan's time, or a repository's own when it was scanned again. */
	first: string;
	/** When a scan last held it. */
	last: string;
	/** It was in the earliest scan read, so it may be older than `first`. */
	onOrBefore?: true;
}

export interface SeenFile {
	/** The latest kept scan read into it. */
	through: string | null;
	seen: Record<string, Seen>;
}

const WHAT = "When your findings were first seen";

export function firstSeenPath(reportDir: string): string {
	return join(reportDir, "first-seen.json");
}

function fileOf(value: unknown): SeenFile {
	const file = value as Partial<SeenFile> | null;
	const seen: Record<string, Seen> = {};
	if (file && typeof file.seen === "object" && file.seen !== null) {
		for (const [key, entry] of Object.entries(file.seen)) {
			if (typeof entry?.first === "string" && typeof entry.last === "string") seen[key] = { first: entry.first, last: entry.last, ...(entry.onOrBefore ? { onOrBefore: true as const } : {}) };
		}
	}
	return { through: typeof file?.through === "string" ? file.through : null, seen };
}

/** Records what `report` holds, seen at `at`. `onOrBefore`: this is the earliest scan read. */
function observe(seen: Record<string, Seen>, report: ScanReport, onOrBefore: boolean): boolean {
	let changed = false;
	for (const repo of report.repos) {
		const name = repoName(report, repo);
		// A repository scanned again on its own was looked at then, not at the report's time.
		const at = repo.rescannedAt && repo.rescannedAt > report.scannedAt ? repo.rescannedAt : report.scannedAt;
		for (const finding of repo.findings) {
			const key = findingKey(name, finding);
			const entry = seen[key];
			if (!entry) {
				seen[key] = { first: at, last: at, ...(onOrBefore ? { onOrBefore: true as const } : {}) };
				changed = true;
			} else if (at > entry.last) {
				entry.last = at;
				changed = true;
			}
		}
	}
	return changed;
}

/**
 * Reads every kept scan the file has not yet read, and the latest report (which may hold a repository
 * scanned again since it was kept), and saves what changed. Returns the file as it now is. A file that
 * is there but cannot be read is never written over: this throws UnreadableFileError.
 */
export async function updateFirstSeen(path: string, history: History, latest: ScanReport | null): Promise<SeenFile> {
	let result: SeenFile = { through: null, seen: {} };
	await updatePrivateJson(path, WHAT, async (current) => {
		const file = fileOf(current);
		const firstBuild = current === undefined;
		const entries = await history.list();
		let changed = false;
		let earliest = firstBuild;
		for (const entry of entries) {
			if (file.through !== null && entry.scannedAt <= file.through) continue;
			const report = await history.read(entry.file);
			// A kept scan that cannot be read is passed over: no date is taken from what was not read.
			if (report) changed = observe(file.seen, report, earliest) || changed;
			earliest = false;
			file.through = entry.scannedAt;
			changed = true;
		}
		if (latest) changed = observe(file.seen, latest, earliest && entries.length === 0) || changed;
		// Older than every kept scan, and not in the latest: no kept scan can hold it any more.
		const oldest = entries[0]?.scannedAt;
		const now = latest ? new Set(keyed(latest).keys()) : new Set<string>();
		if (oldest) {
			for (const [key, entry] of Object.entries(file.seen)) {
				if (entry.last < oldest && !now.has(key)) {
					delete file.seen[key];
					changed = true;
				}
			}
		}
		result = file;
		return changed ? file : undefined;
	});
	return result;
}

/** The file as it is, without reading the history: for a reader that only shows dates. */
export async function readFirstSeen(path: string): Promise<SeenFile> {
	const read = await readPrivateJson(path);
	if (read.state === "missing") return { through: null, seen: {} };
	if (read.state === "unreadable") throw new UnreadableFileError(WHAT, read.reason);
	return fileOf(read.value);
}

/** The dates for the findings of `report` alone, by key, as the page needs them. */
export function datesFor(file: SeenFile, report: ScanReport): Record<string, { first: string; onOrBefore?: true }> {
	const dates: Record<string, { first: string; onOrBefore?: true }> = {};
	for (const key of keyed(report).keys()) {
		const entry = file.seen[key];
		if (entry) dates[key] = { first: entry.first, ...(entry.onOrBefore ? { onOrBefore: true as const } : {}) };
	}
	return dates;
}
