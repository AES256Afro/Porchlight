// What the route modules under routes/ share with the server that creates them. Values that change
// while the server runs (the model in use, whether it is busy, the monitor, what is running) are read
// through functions, so each area sees them as they are at the time of the request.
import type { ServerResponse } from "node:http";
import { HOSTED, type AssistantConfig, type HostedProvider } from "../assist/ollama.ts";
import type { ModelTask, SendTarget } from "../assist/settings.ts";
import type { MonitorConfig } from "../monitor/client.ts";
import type { FileTitle, Project, ProjectStore } from "../projects/projects.ts";
import type { History } from "../repos/history.ts";
import type { ScanReport } from "../repos/types.ts";
import type { UiOptions } from "./server.ts";
import type { ActivityLine, AnalysisStatus, FetchStatus, ModelInUse, ScanStatus } from "./types.ts";

export interface ServerContext {
	options: UiOptions;
	loopbackOnly: boolean;
	/** Settings, keys, tokens, audits and investigations (S34). */
	dataDir: string;
	/** The folder of the report, where its history, notes, judgements and mural are kept (S34). */
	reportDir: string;
	/** Every finished scan, kept beside the report. */
	history: History;
	/** The owner's status and note per finding (invariant 17). */
	notesPath: string;
	/** The model's judgements of the latest scan (invariant 16). */
	analysisPath: string;
	projects: ProjectStore;
	/** A line for the Activity view and the project's log. */
	log(text: string, project?: Project | null): void;
	/** A line for the Activity view alone. */
	note(text: string, kind?: ActivityLine["kind"]): void;
	saveExport(res: ServerResponse, file: { body: string; filename: string }, title: FileTitle): Promise<void>;
	/** The model in use, or the one chosen for `task` (R6F-10), as the page shows it. */
	assistantSummary(task?: ModelTask): unknown;
	confirmModel(fields: Record<string, unknown>, config: AssistantConfig): void;
	modelWords(config: AssistantConfig): string;
	/** The model in use now. */
	model(): ModelInUse;
	/** The model a task uses now: its own when one is chosen in Settings (R6F-10), else the one in use. */
	modelFor(task: ModelTask): ModelInUse;
	/** The models "Send to a model" offers, by Porchlight's own id. */
	targets(): SendTarget[];
	/** Whether the owner's own model is answering a request now: it answers one at a time. */
	modelBusy(): boolean;
	setModelBusy(busy: boolean): void;
	/** A send to a model begun (1) or answered (-1), so quitting can warn about one still waiting. */
	sending(delta: 1 | -1): void;
	/** The monitor connected now, or null. */
	monitor(): MonitorConfig | null;
	/** The latest scan, or a 404 that says there is none yet. */
	storedReport(): Promise<ScanReport>;
	/** The keys of the findings new in `report` since the kept scan before it (B-Q1). */
	newKeysOf(report: ScanReport): Promise<Set<string>>;
	/** What is running now: a scan, a fetch from GitHub, the model's analysis. */
	scanStatus(): ScanStatus;
	fetchStatus(): FetchStatus;
	analysisStatus(): AnalysisStatus;
}

/** Who runs a hosted model: its provider's name, or the server's address for one of the owner's servers reached over the internet. */
export function hostedName(config: AssistantConfig): string {
	return config.provider !== undefined && config.provider in HOSTED ? HOSTED[config.provider as HostedProvider].name : `the model server at ${config.url.host}`;
}
