/**
 * Earlier checks of this computer and earlier Cloudflare audits, kept so a later one can say what was
 * fixed and what is new since (G-Q1, F-Q3), and which Cloudflare checks a change has been made to since
 * the audit (F-Q2).
 *
 * Each kept run is a gzipped file (0600) in its own folder in the data folder, the last KEEP_RUNS of them,
 * read back only by a name this module made. A check counts as fixed only where the later run looked
 * again and it passed; one that could not be checked again is counted apart, never as fixed (invariant
 * 5). Nothing here changes a check, a severity or a count.
 */
import { mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { oneAtATime, readPrivateGzipJson, writePrivateGzipJson } from "./private-files.ts";

/** How many earlier runs are kept. */
export const KEEP_RUNS = 20;
const RUN_NAME = /^run-\d{8}T\d{6,9}\.json\.gz$/;

/** A run's file name, from when it was made: sorting the names sorts the runs. */
function runName(at: string): string {
	return `run-${at.replace(/[^\dT]/g, "").slice(0, 18)}.json.gz`;
}

export class KeptRuns<T extends object> {
	readonly dir: string;

	constructor(dir: string) {
		this.dir = dir;
	}

	/** The kept runs' names, oldest first. */
	async names(): Promise<string[]> {
		return (await readdir(this.dir).catch(() => [] as string[])).filter((name) => RUN_NAME.test(name)).sort();
	}

	/** Keeps a finished run; the oldest go past KEEP_RUNS. The same time is not kept twice. */
	add(run: T, at: string): Promise<void> {
		return oneAtATime(this.dir, async () => {
			await mkdir(this.dir, { recursive: true, mode: 0o700 });
			const name = runName(at);
			const names = await this.names();
			if (!names.includes(name)) await writePrivateGzipJson(join(this.dir, name), run);
			const all = [...new Set([...names, name])].sort();
			for (const old of all.slice(0, Math.max(0, all.length - KEEP_RUNS))) await rm(join(this.dir, old), { force: true });
		});
	}

	/** The run kept before the one made at `at`, or null when there is none or it cannot be read. */
	async before(at: string): Promise<T | null> {
		const name = runName(at);
		const earlier = (await this.names()).filter((candidate) => candidate < name);
		const last = earlier.at(-1);
		if (!last) return null;
		const read = await readPrivateGzipJson(join(this.dir, last));
		return read.state === "read" && typeof read.value === "object" && read.value !== null ? (read.value as T) : null;
	}

	/** How many runs are kept, for the page. */
	async count(): Promise<number> {
		return (await this.names()).length;
	}
}

/** One check, by what identifies it across runs, with its words. */
export interface ComparedCheck {
	/** The zone a Cloudflare check belongs to; empty for this computer. */
	place: string;
	id: string;
	title: string;
	severity: string;
}

export interface CheckComparison {
	previousAt: string;
	fixedCount: number;
	newCount: number;
	/** Failed before, and could not be checked this time: not counted as fixed. */
	uncheckedCount: number;
	fixed: ComparedCheck[];
	new: ComparedCheck[];
}

type Checked = { place: string; id: string; title: string; status: string; severity: string };

/**
 * What a later run fixed and found new against an earlier one, check by check. Fixed: failed before and
 * passed now. New: failed now, where the earlier run looked and it did not fail. A check that failed
 * before and could not be checked now (unknown, gone, or its zone not audited) is "could not be checked
 * again", never fixed.
 */
export function compareChecks(previous: { at: string; checks: Checked[] }, current: { checks: Checked[] }): CheckComparison {
	const key = (check: Checked) => `${check.place}\n${check.id}`;
	const before = new Map(previous.checks.map((check) => [key(check), check]));
	const after = new Map(current.checks.map((check) => [key(check), check]));
	const fixed: ComparedCheck[] = [];
	const found: ComparedCheck[] = [];
	let unchecked = 0;
	for (const [name, check] of before) {
		if (check.status !== "failed") continue;
		const now = after.get(name);
		if (now?.status === "passed") fixed.push(words(check));
		else if (!now || now.status === "unknown") unchecked++;
	}
	for (const [name, check] of after) {
		if (check.status !== "failed") continue;
		const then = before.get(name);
		// Only where the earlier run looked: a check it could not make, or did not have, is not "new".
		if (then && (then.status === "passed" || then.status === "unavailable")) found.push(words(check));
	}
	return { previousAt: previous.at, fixedCount: fixed.length, newCount: found.length, uncheckedCount: unchecked, fixed: fixed.slice(0, 50), new: found.slice(0, 50) };
}

function words(check: Checked): ComparedCheck {
	return { place: check.place, id: check.id, title: check.title, severity: check.severity };
}

/** The checks of a Cloudflare audit, each by its zone (zone checks) or its account (account and user checks). */
export function auditChecks(report: { zones: { name: string; checks: { id: string; title: string; status: string; severity: string }[] }[]; accounts?: { name?: string; id?: string; checks: { id: string; title: string; status: string; severity: string }[] }[]; userChecks?: { id: string; title: string; status: string; severity: string }[] }): Checked[] {
	return [
		...report.zones.flatMap((zone) => zone.checks.map((check) => ({ ...check, place: zone.name }))),
		...(report.accounts ?? []).flatMap((account) => account.checks.map((check) => ({ ...check, place: `account ${account.name ?? account.id ?? ""}` }))),
		...(report.userChecks ?? []).map((check) => ({ ...check, place: "your user" })),
	];
}

/**
 * The Cloudflare checks a change was made to after the audit (F-Q2): a change Cloudflare accepted,
 * recorded later than the audit, for that zone. They are marked "Changed since the audit" and left out of
 * "Fix these" until the next audit says how they stand. Keys are the zone's id and the change's id.
 */
export function changedSinceAudit(checkedAt: string, changes: readonly { at: string; zoneId: string; change: string; ok: boolean }[]): Set<string> {
	return new Set(changes.filter((change) => change.ok && change.at > checkedAt).map((change) => `${change.zoneId}\n${change.change}`));
}
