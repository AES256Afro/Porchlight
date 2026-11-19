/**
 * The model chosen under Settings → Model, kept beside the report in model-settings.json (0600).
 *
 * A choice names one of MODEL_CHOICES; its provider, and for a hosted provider its fixed address,
 * come from there, never from a request. API keys are kept per provider, so switching from Claude to
 * a local server never sends Claude's key anywhere. A key for an owner's own server is kept with the
 * address it was given for and is only sent there. Keys are never returned to the page.
 */
import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { MODEL_CHOICES, modelChoice } from "../../ui/models.js";
import { assistantConfig, HOSTED, type AssistantConfig, type HostedProvider } from "./ollama.ts";

export interface SavedModel {
	choice: string;
	/** The address, for a choice that has one. */
	url?: string;
	model?: string;
	keys?: Partial<Record<HostedProvider, string>> & { servers?: Record<string, string> };
	/**
	 * Every choice set up before, by id, with its address and model: what "Send to a model" offers
	 * beside the one in use. Keys stay in `keys`, so a remembered choice uses the same key rules.
	 */
	remembered?: Record<string, { url?: string; model?: string }>;
}

/** What the page sends to choose a model. `apiKey` replaces the saved key for this choice; `removeKey` deletes it. */
export interface ModelRequest {
	choice: string;
	url?: string;
	model?: string;
	apiKey?: string;
	removeKey?: boolean;
}

/** A setting to correct, in the words of the Settings page. */
export class ModelSettingError extends Error {}

const KEY_SHAPE = /^[\x21-\x7e]{1,400}$/;
const HOSTED_KEY_SHAPE = /^[\x21-\x7e]{20,400}$/;
const MAX_FIELD = 500;

export async function readSavedModel(path: string): Promise<SavedModel | null> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return null;
	}
	try {
		const saved = JSON.parse(text) as SavedModel;
		return modelChoice(saved?.choice) ? saved : null;
	} catch {
		return null;
	}
}

/** Holds API keys, so it is readable only by its owner, like the report. */
export async function saveModel(path: string, saved: SavedModel): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(saved, null, "\t")}\n`, { mode: 0o600 });
	await chmod(temporary, 0o600);
	await rename(temporary, path);
}

export async function forgetModel(path: string): Promise<void> {
	await rm(path, { force: true });
}

/** An address as the key for a saved server key: its origin and path, without a trailing slash. */
export function serverKeyFor(url: string): string {
	try {
		const parsed = new URL(url.trim());
		return `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
	} catch {
		return url.trim();
	}
}

/**
 * Applies a request to what was saved, checking each field. Keys for other choices are kept.
 * `fallbackKeys`: keys given when Porchlight started (PORCHLIGHT_LLM_API_KEY), used when none is saved.
 */
export function nextSaved(previous: SavedModel | null, request: ModelRequest): SavedModel {
	const choice = modelChoice(request.choice);
	if (!choice) throw new ModelSettingError("Choose where the model runs");
	for (const field of [request.url, request.model, request.apiKey]) {
		if (field !== undefined && (typeof field !== "string" || field.length > MAX_FIELD)) throw new ModelSettingError("A setting is too long");
	}
	const keys: NonNullable<SavedModel["keys"]> = { ...previous?.keys, servers: { ...previous?.keys?.servers } };
	// The choice being replaced is remembered, so it can still be picked when sending to a model.
	const remembered: NonNullable<SavedModel["remembered"]> = { ...previous?.remembered };
	if (previous && modelChoice(previous.choice)?.provider) remembered[previous.choice] = setupOf(previous);
	const next: SavedModel = { choice: choice.id, keys, remembered };
	if (choice.provider === "ollama" || choice.provider === "compatible") next.url = (request.url ?? choice.url).trim();
	const model = request.model?.trim();
	if (model) next.model = model;

	const apiKey = request.apiKey?.trim();
	if (choice.provider !== null && choice.provider !== "ollama") {
		const slot = choice.provider === "compatible" ? null : choice.provider;
		if (request.removeKey) {
			if (slot) delete keys[slot];
			else delete keys.servers?.[serverKeyFor(next.url ?? "")];
		} else if (apiKey) {
			if (slot && !HOSTED_KEY_SHAPE.test(apiKey)) throw new ModelSettingError("That is not an API key: it should be 20 or more characters with no spaces");
			if (!slot && !KEY_SHAPE.test(apiKey)) throw new ModelSettingError("An API key has no spaces");
			if (slot) keys[slot] = apiKey;
			else keys.servers = { ...keys.servers, [serverKeyFor(next.url ?? "")]: apiKey };
		}
	}
	if (keys.servers && Object.keys(keys.servers).length === 0) delete keys.servers;
	if (choice.provider !== null) remembered[choice.id] = setupOf(next);
	return next;
}

/** A choice's address and model, without its keys. */
function setupOf(saved: SavedModel): { url?: string; model?: string } {
	return { ...(saved.url !== undefined ? { url: saved.url } : {}), ...(saved.model !== undefined ? { model: saved.model } : {}) };
}

/** A model "Send to a model" can use. `id` is Porchlight's own: a choice id, or "startup". */
export interface SendTarget {
	id: string;
	/** As the page shows it: where it runs and which model. */
	label: string;
	config: AssistantConfig;
	hosted: boolean;
	/** The one in use for Explain, Summarise and Ask. */
	current: boolean;
}

/**
 * The models the owner can send to: the one in use, every other choice set up before that still
 * connects, a hosted provider whose key is saved and that has a default model, and the one given at
 * start-up. Each comes from the saved settings or the environment, never from a request.
 */
export function sendTargets(
	saved: SavedModel | null,
	startup: AssistantConfig | null,
	fallbackKeys: Partial<Record<HostedProvider, string>> = {},
): SendTarget[] {
	const targets: SendTarget[] = [];
	const seen = new Set<string>();
	const add = (id: string, choiceName: string, config: AssistantConfig, current: boolean) => {
		const hosted = config.provider !== undefined && config.provider !== "ollama" && config.provider !== "compatible";
		const where = hosted ? choiceName : `${choiceName} (${config.url.host})`;
		const fingerprint = `${config.provider ?? "ollama"} ${config.url.href} ${config.model}`;
		if (seen.has(fingerprint)) return;
		seen.add(fingerprint);
		targets.push({ id, label: `${config.model} · ${where}`, config, hosted, current });
	};
	for (const choice of MODEL_CHOICES) {
		if (choice.provider === null) continue;
		const inUse = saved?.choice === choice.id;
		const setup = inUse ? setupOf(saved!) : saved?.remembered?.[choice.id];
		const hostedProvider = choice.provider !== "ollama" && choice.provider !== "compatible" ? choice.provider : null;
		const keyed = hostedProvider !== null && Boolean(saved?.keys?.[hostedProvider] ?? fallbackKeys[hostedProvider]);
		if (!setup && !(keyed && hostedProvider && HOSTED[hostedProvider].defaultModel)) continue;
		try {
			const config = configFor({ choice: choice.id, keys: saved?.keys, ...(setup ?? {}) }, { fallbackKeys });
			if (config) add(choice.id, choice.name, config, inUse);
		} catch {
			// A choice that no longer connects (its key removed, say) is simply not offered.
		}
	}
	if (startup) add("startup", "set when Porchlight started", startup, !saved);
	return targets.sort((a, b) => Number(b.current) - Number(a.current));
}

/** The key saved for a choice, or the one given at start-up for the same provider. */
export function keyFor(saved: SavedModel, fallbackKeys: Partial<Record<HostedProvider, string>> = {}): string | undefined {
	const choice = modelChoice(saved.choice);
	if (!choice?.provider || choice.provider === "ollama") return undefined;
	if (choice.provider === "compatible") return saved.keys?.servers?.[serverKeyFor(saved.url ?? "")];
	return saved.keys?.[choice.provider] ?? fallbackKeys[choice.provider];
}

/**
 * The connection a saved choice describes, or null for "No model". Throws ModelSettingError for a
 * setting to correct. `requireModel: false` checks only where to connect, for listing models.
 */
export function configFor(saved: SavedModel, options: { fallbackKeys?: Partial<Record<HostedProvider, string>>; requireModel?: boolean } = {}): AssistantConfig | null {
	const choice = modelChoice(saved.choice);
	if (!choice) throw new ModelSettingError("Choose where the model runs");
	if (choice.provider === null) return null;
	const requireModel = options.requireModel ?? true;
	const apiKey = keyFor(saved, options.fallbackKeys);
	const hosted = choice.provider === "ollama" || choice.provider === "compatible" ? null : HOSTED[choice.provider];
	if (choice.key === "required" && !apiKey) throw new ModelSettingError(`Enter your ${hosted?.name ?? choice.name} API key`);
	if (!hosted && !saved.url) throw new ModelSettingError("Enter the address the model is at");
	const model = saved.model ?? (requireModel ? hosted?.defaultModel : undefined) ?? (requireModel ? undefined : "any");
	if (!model) throw new ModelSettingError(choice.provider === "ollama" ? "Choose a model: Find models lists the ones Ollama has" : "Choose a model: Find models lists them");
	try {
		return assistantConfig(
			{ PORCHLIGHT_LLM_PROVIDER: choice.provider, PORCHLIGHT_LLM_URL: saved.url, PORCHLIGHT_LLM_MODEL: model, PORCHLIGHT_LLM_API_KEY: apiKey },
			{ exactModel: true },
		);
	} catch (err) {
		throw new ModelSettingError(inSettingsWords(err instanceof Error ? err.message : String(err)));
	}
}

/** Start-up messages name environment variables; the Settings page names its own fields. */
function inSettingsWords(message: string): string {
	return message
		.replace(/^PORCHLIGHT_LLM_URL is not an address\..*$/, "That is not an address. Give one such as http://localhost:11434")
		.replace(/^PORCHLIGHT_LLM_URL must start with .*$/, "The address must start with http:// or https://")
		.replace(/^PORCHLIGHT_LLM_URL must not carry .*$/, "Leave the user name and password out of the address")
		.replace(/^PORCHLIGHT_LLM_MODEL is not a model name.*$/, "That is not a model name")
		.replace(/PORCHLIGHT_LLM_\w+/g, "this setting");
}

/** Which choice a start-up configuration amounts to, to show it in Settings. */
export function choiceFromConfig(config: AssistantConfig | null): string {
	if (!config) return "off";
	const provider = config.provider ?? "ollama";
	if (provider === "ollama") return ["localhost", "127.0.0.1", "[::1]"].includes(config.url.hostname) ? "ollama-mac" : "ollama-server";
	if (provider === "compatible") {
		const local = ["localhost", "127.0.0.1", "[::1]"].includes(config.url.hostname);
		const match = MODEL_CHOICES.find((choice) => choice.group === "mac" && choice.provider === "compatible" && local && new URL(choice.url).port === config.url.port);
		return match?.id ?? "openai-server";
	}
	return provider;
}

/** The address of a start-up configuration as the Settings page shows it. */
export function addressFromConfig(config: AssistantConfig | null): string {
	if (!config || (config.provider !== undefined && config.provider !== "ollama" && config.provider !== "compatible")) return "";
	if (config.provider === "compatible") return new URL("..", config.url).href.replace(/\/$/, "");
	return config.url.href.replace(/\/$/, "");
}
