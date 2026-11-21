// What the route modules under routes/ share with the server that creates them. Values that change
// while the server runs (the model in use, whether it is busy, the monitor) are read through functions,
// so each area sees them as they are at the time of the request.
import type { ServerResponse } from "node:http";
import { HOSTED, type AssistantConfig, type HostedProvider } from "../assist/ollama.ts";
import type { MonitorConfig } from "../monitor/client.ts";
import type { FileTitle, Project, ProjectStore } from "../projects/projects.ts";
import type { UiOptions } from "./server.ts";
import type { ActivityLine, ModelInUse } from "./types.ts";

export interface ServerContext {
	options: UiOptions;
	loopbackOnly: boolean;
	/** Settings, keys, tokens, audits and investigations (S34). */
	dataDir: string;
	projects: ProjectStore;
	/** A line for the Activity view and the project's log. */
	log(text: string, project?: Project | null): void;
	/** A line for the Activity view alone. */
	note(text: string, kind?: ActivityLine["kind"]): void;
	saveExport(res: ServerResponse, file: { body: string; filename: string }, title: FileTitle): Promise<void>;
	assistantSummary(): unknown;
	confirmModel(fields: Record<string, unknown>, config: AssistantConfig): void;
	modelWords(config: AssistantConfig): string;
	/** The model in use now. */
	model(): ModelInUse;
	/** Whether the owner's own model is answering a request now: it answers one at a time. */
	modelBusy(): boolean;
	setModelBusy(busy: boolean): void;
	/** The monitor connected now, or null. */
	monitor(): MonitorConfig | null;
}

/** Who runs a hosted model: its provider's name, or the server's address for one of the owner's servers reached over the internet. */
export function hostedName(config: AssistantConfig): string {
	return config.provider !== undefined && config.provider in HOSTED ? HOSTED[config.provider as HostedProvider].name : `the model server at ${config.url.host}`;
}
