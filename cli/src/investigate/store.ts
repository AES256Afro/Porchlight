/**
 * Investigation runs, kept beside the report under `investigations/` (folder 0700, files 0600):
 * every step, every piece of evidence and every finding. A run is read only by an id Porchlight
 * made, matched against a fixed pattern, never by a path from a request.
 */
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Run } from "./engine.ts";
import { writePrivate } from "./ownership.ts";

const RUN_ID = /^inv_[0-9a-f]{16}$/;
/** Runs kept; the oldest go first. */
export const MAX_RUNS = 50;

export function isRunId(value: unknown): value is string {
	return typeof value === "string" && RUN_ID.test(value);
}

export interface RunSummary {
	id: string;
	domain: string;
	goal: string;
	model: string;
	hosted: boolean;
	status: Run["status"];
	ended?: string;
	startedAt: string;
	finishedAt?: string;
	turns: number;
	maxTurns: number;
	findings: number;
	evidence: number;
}

export function summarise(run: Run): RunSummary {
	return {
		id: run.id,
		domain: run.domain,
		goal: run.goal,
		model: run.model,
		hosted: run.hosted,
		status: run.status,
		...(run.ended ? { ended: run.ended } : {}),
		startedAt: run.startedAt,
		...(run.finishedAt ? { finishedAt: run.finishedAt } : {}),
		turns: run.turns,
		maxTurns: run.maxTurns,
		findings: run.findings.length,
		evidence: run.evidence.length,
	};
}

export class RunStore {
	readonly dir: string;

	constructor(dir: string) {
		this.dir = dir;
	}

	private path(id: string): string {
		if (!isRunId(id)) throw new Error("not a run id");
		return join(this.dir, `${id}.json`);
	}

	async save(run: Run): Promise<void> {
		await writePrivate(this.path(run.id), `${JSON.stringify(run, null, "\t")}\n`);
	}

	async read(id: string): Promise<Run | null> {
		if (!isRunId(id)) return null;
		try {
			const run = JSON.parse(await readFile(this.path(id), "utf8")) as Run;
			return run?.version === 1 && run.id === id ? run : null;
		} catch {
			return null;
		}
	}

	/** Every kept run, newest first. A run left "running" by a Porchlight that quit is shown as stopped. */
	async list(): Promise<RunSummary[]> {
		let names: string[];
		try {
			names = await readdir(this.dir);
		} catch {
			return [];
		}
		const runs: Run[] = [];
		for (const name of names) {
			const id = name.replace(/\.json$/, "");
			if (!name.endsWith(".json") || !isRunId(id)) continue;
			const run = await this.read(id);
			if (run) runs.push(run);
		}
		return runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).map(summarise);
	}

	/** Removes the oldest runs beyond MAX_RUNS. */
	async prune(): Promise<void> {
		const runs = await this.list();
		for (const old of runs.slice(MAX_RUNS)) await rm(this.path(old.id), { force: true });
	}
}

/** A run that was saved while running, read after Porchlight restarted: it is not running any more. */
export function settled(run: Run): Run {
	if (run.status !== "running" && run.status !== "waiting") return run;
	const { pending: _pending, ...rest } = run;
	return { ...rest, status: "stopped", ended: run.ended ?? "Porchlight stopped while this was running." };
}
