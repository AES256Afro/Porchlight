// The model behind Explain, Summarise, Ask, Send, Deeper analysis and investigations: the one in use,
// the one chosen for each task (R6F-10), and Settings → Model (/api/model). Keys are kept 0600 in
// model-settings.json and never sent to the page (invariant 13).
import { join } from "node:path";
import { AssistantError, chat, HOSTED, isHosted, listModels, type AssistantConfig, type HostedProvider } from "../../assist/ollama.ts";
import { addressFromConfig, choiceFromConfig, configFor, forgetModel, ModelSettingError, nextSaved, readSavedModel, saveModel, sendTargets, type ModelRequest, type ModelTask, type SavedModel, type SendTarget } from "../../assist/settings.ts";
import { modelContextLength } from "../../assist/context.ts";
import { oneAtATime, readPrivateJson, UnreadableFileError } from "../../private-files.ts";
import { hostedName, type ServerContext } from "../context.ts";
import type { Call } from "../gate.ts";
import { bodyObject, HttpError, sendJson } from "../http.ts";
import { notFoundUnder, type Answer, type Route } from "../router.ts";
import type { UiOptions } from "../server.ts";
import type { ModelInUse } from "../types.ts";
import { createModelTasks } from "./model-tasks.ts";

export async function createModels(options: UiOptions, dataDir: string) {
	const modelPath = join(dataDir, "model-settings.json");
	const startup: ModelInUse = { config: options.assistant ?? null, error: options.assistantError, unset: options.assistantUnset ?? false, source: "startup" };
	/** A key given at start-up for a hosted provider, used for that provider when Settings has none. */
	const startupKeys: Partial<Record<HostedProvider, string>> =
		startup.config && startup.config.provider !== undefined && startup.config.provider in HOSTED && startup.config.apiKey ? { [startup.config.provider as HostedProvider]: startup.config.apiKey } : {};
	let savedModel = await readSavedModel(modelPath);
	let model: ModelInUse = savedModel ? inUse(savedModel) : startup;
	/** Ollama on a small server answers one request at a time, so this asks it one at a time. */
	let modelBusy = false;
	/** Sends to a model still waiting for an answer, hosted ones included, so quitting can warn about them. */
	let sending = 0;
	// A model per task (R6F-10): chosen in Settings from the models set up, never from a request.
	const modelTasks = await createModelTasks(dataDir, () => targets());

	/** The model a task uses: its own when one is chosen, else the one in use. */
	function modelFor(task: ModelTask): ModelInUse {
		return modelTasks.modelFor(task) ?? model;
	}

	function inUse(saved: SavedModel): ModelInUse {
		try {
			const config = configFor(saved, { fallbackKeys: startupKeys });
			return { config, unset: config === null, source: "settings" };
		} catch (err) {
			return { config: null, error: err instanceof Error ? err.message : String(err), unset: false, source: "settings" };
		}
	}

	function targets(): SendTarget[] {
		return sendTargets(savedModel, startup.config, startupKeys);
	}

	/** The model and where it runs, for the log: a hosted one is said to be outside the owner's machines. */
	function modelWords(config: AssistantConfig): string {
		return isHosted(config) ? `${config.model} (${hostedName(config)}, outside your machines)` : `${config.model} at ${config.url.host}`;
	}

	/**
	 * A request to a model names the model the page showed, since another tab or device may have
	 * switched it since (S22): one that names another is refused. A hosted model also needs the page's
	 * word that it showed what is sent there; with none named, nothing is sent to a hosted model.
	 */
	function confirmModel(fields: Record<string, unknown>, config: AssistantConfig): void {
		const shown = fields.shown;
		const named = typeof shown === "object" && shown !== null && typeof (shown as { model?: unknown }).model === "string" && typeof (shown as { host?: unknown }).host === "string";
		if (shown !== undefined && (!named || (shown as { model: string }).model !== config.model || (shown as { host: string }).host !== config.url.host)) {
			throw new HttpError(409, `The model is now ${modelWords(config)}, not the one this page showed. Reload the page to see what it sends there.`);
		}
		if (isHosted(config) && (!named || fields.sendsToHosted !== true)) {
			throw new HttpError(409, `${modelWords(config)} is outside your machines. Reload the page: it says what is sent there before you ask.`);
		}
	}

	function assistantSummary(task?: ModelTask) {
		const using = task ? modelFor(task) : model;
		const config = using.config;
		return config
			? { configured: true, model: config.model, host: config.url.host, hosted: isHosted(config) }
			: {
					configured: false,
					error: using.error ?? "No model is connected",
					// No model asked for: the features are off, the usual state rather than a value to correct.
					unset: using.unset,
				};
	}

	/** What Settings shows: the choice, its address and model, and which keys are saved. Never a key. */
	function modelState() {
		const saved = savedModel;
		return {
			source: model.source,
			choice: saved?.choice ?? choiceFromConfig(startup.config),
			url: saved ? (saved.url ?? "") : addressFromConfig(startup.config),
			model: saved ? (saved.model ?? "") : (startup.config?.model ?? ""),
			keys: {
				...Object.fromEntries((Object.keys(HOSTED) as HostedProvider[]).map((provider) => [provider, Boolean(saved?.keys?.[provider] ?? startupKeys[provider])])),
				// Which of the owner's own server addresses have a key saved.
				servers: Object.keys(saved?.keys?.servers ?? {}),
			},
			startup: startup.config ? { choice: choiceFromConfig(startup.config), model: startup.config.model, host: startup.config.url.host } : null,
			assistant: assistantSummary(),
		};
	}

	/** A request from Settings, checked, as the connection it describes. The saved copy is not changed. */
	function requestedConfig(body: unknown, requireModel: boolean): AssistantConfig | null {
		return configFor(nextSaved(savedModel, modelRequest(body)), { fallbackKeys: startupKeys, requireModel });
	}

	function modelRequest(body: unknown): ModelRequest {
		const fields = bodyObject(body);
		return {
			choice: String(fields.choice ?? ""),
			...(typeof fields.url === "string" ? { url: fields.url } : {}),
			...(typeof fields.model === "string" ? { model: fields.model } : {}),
			...(typeof fields.apiKey === "string" ? { apiKey: fields.apiKey } : {}),
			removeKey: fields.removeKey === true,
		};
	}

	/** A setting that cannot be used, or a model that answered with an error, said to the page as such. */
	function modelErrors(answer: Answer): Answer {
		return async (call) => {
			try {
				return await answer(call);
			} catch (err) {
				if (err instanceof ModelSettingError) throw new HttpError(400, err.message);
				if (err instanceof AssistantError) throw new HttpError(err.status, err.message);
				throw err;
			}
		};
	}

	async function save({ res, body }: Call): Promise<void> {
		// One save at a time, each from the file as it is now, so two saves for different providers
		// keep both keys (B21); a file that cannot be read is never written over, which would lose every key (B25).
		await oneAtATime(modelPath, async () => {
			const read = await readPrivateJson(modelPath);
			if (read.state === "unreadable") throw new HttpError(409, new UnreadableFileError("Your model settings", read.reason).message);
			const next = nextSaved(read.state === "read" ? await readSavedModel(modelPath) : null, modelRequest(body));
			// Checked before it is saved, so a mistake never replaces a working choice.
			configFor(next, { fallbackKeys: startupKeys });
			await saveModel(modelPath, next);
			savedModel = next;
			model = inUse(next);
		});
		return sendJson(res, 200, modelState());
	}

	async function useStartup({ res }: Call): Promise<void> {
		await oneAtATime(modelPath, async () => {
			await forgetModel(modelPath);
			savedModel = null;
			model = startup;
		});
		return sendJson(res, 200, modelState());
	}

	async function listRoute({ res, body }: Call): Promise<void> {
		const config = requestedConfig(body, false);
		if (!config) return sendJson(res, 200, { models: [] });
		return sendJson(res, 200, { models: await listModels(config, { fetchFn: options.fetchFn }) });
	}

	async function testRoute({ res, body }: Call): Promise<void> {
		const config = requestedConfig(body, true);
		if (!config) throw new ModelSettingError("Choose a model first");
		const started = Date.now();
		const text = await chat(config, [{ role: "user", content: "Reply with the single word: ready" }], { fetchFn: options.fetchFn, timeoutMs: 120_000 });
		// The model answers, so how much it reads is asked now, while it is being chosen (R6F-8).
		await modelContextLength(config, options.fetchFn);
		return sendJson(res, 200, { text: text.slice(0, 200), model: config.model, seconds: Math.round((Date.now() - started) / 100) / 10 });
	}

	/** Where the owner's data is sent, under which key, and a probe of any address: never from another device (S20). */
	function routes(ctx: ServerContext): Route[] {
		return [
			["GET /api/model", modelErrors(({ res }) => sendJson(res, 200, modelState())), "owner"],
			["POST /api/model", modelErrors(save), "owner"],
			["POST /api/model/startup", modelErrors(useStartup), "owner"],
			["POST /api/model/models", modelErrors(listRoute), "owner"],
			["POST /api/model/test", modelErrors(testRoute), "owner"],
			notFoundUnder("/api/model", "owner"),
			...modelTasks.routes(ctx),
		];
	}

	return {
		model: () => model,
		modelFor,
		targets,
		modelWords,
		confirmModel,
		assistantSummary,
		modelBusy: () => modelBusy,
		setModelBusy: (busy: boolean) => {
			modelBusy = busy;
		},
		/** A send to a model begun (1) or ended (-1). */
		sending: (delta: 1 | -1) => {
			sending += delta;
		},
		sendingNow: () => sending,
		routes,
	};
}
