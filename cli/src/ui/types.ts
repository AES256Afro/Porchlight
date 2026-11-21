// The states the server reports to the page, one type each. The page imports them through server.ts.
import type { AssistantConfig } from "../assist/ollama.ts";
import type { RescanChange } from "../repos/history.ts";

/** The model in use: chosen in Settings, or given at start-up. */
export interface ModelInUse {
	config: AssistantConfig | null;
	error?: string;
	/** No model was asked for: the features are simply off. */
	unset: boolean;
	source: "settings" | "startup";
}

export interface AccessStatus {
	enabled: boolean;
	listening: boolean;
	/** The address other devices open, once listening. */
	url?: string;
	error?: string;
}

export type ScanStatus =
	| { state: "idle" }
	| { state: "running"; root: string; startedAt: string; done: number; total: number; current: string | null }
	| {
			state: "done";
			root: string;
			finishedAt: string;
			/** After scanning one repository again: what that changed (US-4). */
			rescan?: RescanChange;
			/** After a full scan: new and fixed since the scan before it, when there was one to compare with. */
			change?: { newCount: number; fixedCount: number; uncheckedCount: number };
	  }
	| {
			state: "failed";
			root: string;
			finishedAt: string;
			error: string;
			/** The scan ran and found no repository: the folder or the depth is wrong, not the scanners. */
			noRepositories?: boolean;
			/** How many folder levels it looked down. */
			depth?: number;
	  };

/** What the schedule did last and does next (QL-5). Never the notice's address, only its host. */
export interface ScheduleState {
	everyHours: number;
	root: string;
	lastRun?: { at: string; ok: boolean; summary: string };
	nextRun: string;
	notify: { host: string; last?: { at: string; delivered: boolean; detail: string } } | null;
}

/** Fetching repositories from GitHub: one batch at a time, each repository's failure kept beside the rest. */
/** The check of this computer (`cli/src/host/`), run in the background like a scan. */
export type HostStatus =
	| { state: "idle" }
	| { state: "running"; startedAt: string; done: number; total: number; current: string }
	| { state: "done"; finishedAt: string }
	| { state: "failed"; finishedAt: string; error: string };

/** The audit of the owner's Cloudflare account, run in the background like a scan. */
export type CloudflareStatus =
	| { state: "idle" }
	| { state: "running"; startedAt: string; done: number; total: number; current: string }
	| { state: "done"; finishedAt: string }
	| { state: "failed"; finishedAt: string; error: string };

export type FetchStatus =
	| { state: "idle" }
	| { state: "running"; done: number; total: number; current: string | null; errors: { repo: string; message: string }[] }
	| { state: "done"; finishedAt: string; total: number; errors: { repo: string; message: string }[] };

/** The model judging findings one at a time, in the background. */
export type AnalysisStatus =
	| { state: "idle" }
	| { state: "running"; done: number; total: number; current: string | null; failed: number }
	| { state: "done" | "stopped"; finishedAt: string; done: number; total: number; failed: number; lastError?: string; gaveUp?: boolean };

/** A local model being downloaded through Ollama. `step` is Ollama's own word for what it is doing. */
export type DownloadStatus =
	| { state: "idle" }
	| { state: "running"; name: string; startedAt: string; step: string; total: number; completed: number }
	| { state: "done"; name: string; startedAt: string; finishedAt: string }
	| { state: "failed"; name: string; startedAt: string; finishedAt: string; error: string };

/** One line of the Activity view. `n` counts up, so the page asks only for what it has not seen. */
export interface ActivityLine {
	n: number;
	at: string;
	kind: "info" | "good" | "warning";
	text: string;
}

/** A set of Cloudflare changes the owner approved at once, as it is sent. */
export type BatchStatus =
	| { state: "idle" }
	| { state: "running"; startedAt: string; total: number; done: number; applied: number; failed: number; skipped: number; current: string }
	| { state: "finished"; startedAt: string; finishedAt: string; total: number; applied: number; failed: number; skipped: number; stopped: boolean };
