/** Who answers: Ollama on the owner's own machine or server, or a hosted model reached with the owner's API key. */
/** `compatible`: any server that speaks OpenAI's chat format at an address the owner gives, such as LM Studio or a llama.cpp server. */
export type Provider = "ollama" | "anthropic" | "openai" | "gemini" | "deepseek" | "compatible";
export type HostedProvider = "anthropic" | "openai" | "gemini" | "deepseek";

/** Where the model is and which one to use. Read from the environment, never from the command line. */
export interface AssistantConfig {
	/** Ollama's base address, ending in "/" so the API path is added beneath it. For a hosted model, the provider's API. */
	url: URL;
	model: string;
	/** Absent means Ollama. */
	provider?: Provider;
	/** A hosted provider's key. Sent to that provider's fixed address only; never to the browser, a log or a report. */
	apiKey?: string;
}

/**
 * The hosted providers. Each address is fixed here, so a key can only ever be sent to the provider
 * it belongs to: no setting moves it.
 */
export const HOSTED: Record<HostedProvider, { name: string; url: string; modelsUrl: string; defaultModel?: string }> = {
	anthropic: { name: "Claude", url: "https://api.anthropic.com/v1/messages", modelsUrl: "https://api.anthropic.com/v1/models", defaultModel: "claude-opus-5-5" },
	openai: { name: "OpenAI", url: "https://api.openai.com/v1/chat/completions", modelsUrl: "https://api.openai.com/v1/models" },
	// Gemini's OpenAI-compatible endpoint: the same request and answer as OpenAI's, under Google's address.
	gemini: {
		name: "Gemini",
		url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
		modelsUrl: "https://generativelanguage.googleapis.com/v1beta/openai/models",
	},
	deepseek: { name: "DeepSeek", url: "https://api.deepseek.com/chat/completions", modelsUrl: "https://api.deepseek.com/models" },
};

/** Whether what is sent leaves the owner's own machines. */
export function isHosted(config: AssistantConfig): boolean {
	return config.provider !== undefined && config.provider in HOSTED;
}

export interface ChatMessage {
	role: "system" | "user";
	content: string;
}

export interface ChatOptions {
	fetchFn?: typeof fetch;
	/** How long to wait for the whole answer. A 9B model on a CPU takes tens of seconds. */
	timeoutMs?: number;
	/** Aborts the request, for example when the page that asked has gone. */
	signal?: AbortSignal;
	/** The longest answer, in tokens, for a local model; longer than usual for a mural. */
	maxTokens?: number;
}

/** A failure talking to the model, in words for the page. `status` is the HTTP status to answer with. */
export class AssistantError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** Reading a few thousand tokens and writing 500 on a CPU, at a few tokens a second, takes minutes. */
export const DEFAULT_TIMEOUT_MS = 300_000;

/** The same for every request: short, steady answers that fit a small model's memory. */
export const MODEL_OPTIONS = { temperature: 0.2, num_ctx: 8192, num_predict: 500 } as const;

const MODEL_NAME = /^[\w.\-/:@+]{1,200}$/;
const API_KEY = /^[\x21-\x7e]{20,400}$/;
const ANTHROPIC_VERSION = "2026-10-21";
/** Room for the model's reasoning as well as its answer; an answer cut short by the limit is worse than a long wait. */
const HOSTED_MAX_TOKENS = 16_000;
/** Claude models that take a fallback model when a safety classifier declines: security findings can trip one. */
const TAKES_FALLBACK = /^claude-(?:opus-5|fable-5|sonnet-5-5)/;
const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/**
 * Reads the local model's settings. An empty address means the features are off; the caller tells
 * that apart from a mistake by checking whether PORCHLIGHT_LLM_URL was given at all. Plain http is
 * allowed: Ollama runs on this machine or this server, and nothing secret is sent to it.
 */
export function assistantConfig(env: Record<string, string | undefined>, options: { exactModel?: boolean } = {}): AssistantConfig {
	const provider = (env.PORCHLIGHT_LLM_PROVIDER?.trim().toLowerCase() || "ollama") as Provider;
	const model = env.PORCHLIGHT_LLM_MODEL?.trim();
	if (provider !== "ollama" && provider !== "compatible") {
		const hosted = HOSTED[provider];
		if (!hosted) throw new Error("PORCHLIGHT_LLM_PROVIDER must be one of: ollama, compatible, anthropic, openai, gemini, deepseek");
		const apiKey = env.PORCHLIGHT_LLM_API_KEY?.trim();
		if (!apiKey) throw new Error(`Set PORCHLIGHT_LLM_API_KEY to your ${hosted.name} API key`);
		if (!API_KEY.test(apiKey)) throw new Error("PORCHLIGHT_LLM_API_KEY is not an API key: expected 20 or more characters with no spaces");
		// A name shaped like Ollama's (`hf.co/…:Q4`) is a setting left over from a local model, not this provider's.
		// A name chosen for this provider in Settings is taken as it is.
		const named = model && (options.exactModel || !/[/:]/.test(model)) ? model : undefined;
		if (named && !MODEL_NAME.test(named)) throw new Error("PORCHLIGHT_LLM_MODEL is not a model name");
		const chosen = named ?? hosted.defaultModel;
		if (!chosen) throw new Error(`Set PORCHLIGHT_LLM_MODEL to the ${hosted.name} model to use, as ${hosted.name} names it`);
		return { provider, url: new URL(hosted.url), model: chosen, apiKey };
	}
	const rawUrl = env.PORCHLIGHT_LLM_URL?.trim();
	if (provider === "compatible") {
		if (!rawUrl) throw new Error("Set PORCHLIGHT_LLM_URL to the model server's address, for example http://localhost:1234/v1 for LM Studio");
		let base: URL;
		try {
			base = new URL(rawUrl);
		} catch {
			throw new Error("PORCHLIGHT_LLM_URL is not an address. Give the model server's, for example http://localhost:1234/v1");
		}
		if (base.protocol !== "http:" && base.protocol !== "https:") throw new Error("PORCHLIGHT_LLM_URL must start with http:// or https://");
		if (base.username || base.password) throw new Error("PORCHLIGHT_LLM_URL must not carry a user name or password");
		if (!model) throw new Error("Set PORCHLIGHT_LLM_MODEL to the model's name, as the model server lists it");
		if (!MODEL_NAME.test(model)) throw new Error("PORCHLIGHT_LLM_MODEL is not a model name");
		const apiKey = env.PORCHLIGHT_LLM_API_KEY?.trim() || undefined;
		if (apiKey && !/^[\x21-\x7e]{1,400}$/.test(apiKey)) throw new Error("PORCHLIGHT_LLM_API_KEY must have no spaces");
		base.search = "";
		base.hash = "";
		if (!base.pathname.endsWith("/")) base.pathname += "/";
		// LM Studio and llama.cpp serve the API under /v1; an address given without it gets it.
		if (base.pathname === "/") base.pathname = "/v1/";
		return { provider, url: new URL("chat/completions", base), model, ...(apiKey ? { apiKey } : {}) };
	}
	if (!rawUrl) throw new Error("Set PORCHLIGHT_LLM_URL to Ollama's address, for example http://localhost:11434, to turn on the local model");
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error("PORCHLIGHT_LLM_URL is not an address. Give Ollama's, for example http://localhost:11434");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("PORCHLIGHT_LLM_URL must start with http:// or https://, for example http://localhost:11434");
	}
	if (url.username || url.password) throw new Error("PORCHLIGHT_LLM_URL must not carry a user name or password");
	if (!model) throw new Error("Set PORCHLIGHT_LLM_MODEL to the model's name in Ollama, as `ollama list` shows it");
	if (!MODEL_NAME.test(model)) throw new Error("PORCHLIGHT_LLM_MODEL is not a model name: use the name `ollama list` shows");
	url.search = "";
	url.hash = "";
	if (!url.pathname.endsWith("/")) url.pathname += "/";
	return { url, model };
}

/**
 * Asks the model and returns its answer as text, without any reasoning it wrote first. Every
 * failure becomes an AssistantError that says what to change; none of them repeats the prompt.
 */
export async function chat(config: AssistantConfig, messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
	const fetchFn = options.fetchFn ?? fetch;
	const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const timeout = AbortSignal.timeout(timeoutMs);
	const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
	const host = config.url.host;
	const failed = (err: unknown): AssistantError => {
		if (timeout.aborted) return new AssistantError(504, `The model took longer than ${timeoutMs / 1000} seconds. Try again, or use a smaller model`);
		if (options.signal?.aborted) return new AssistantError(499, "The request was cancelled");
		const code = (err as { cause?: { code?: unknown } })?.cause?.code;
		const where = config.provider === undefined || config.provider === "ollama" ? "Is Ollama running there?" : config.provider === "compatible" ? "Is the model server running there?" : "Is this computer online?";
		return new AssistantError(502, `Could not reach the model at ${host}${typeof code === "string" ? ` (${code})` : ""}. ${where}`);
	};

	if (config.provider !== undefined && config.provider !== "ollama") return hostedChat(config, messages, fetchFn, signal, failed);

	let response: Response;
	let text: string;
	try {
		response = await fetchFn(new URL("api/chat", config.url), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model: config.model, messages, stream: false, think: false, options: options.maxTokens ? { ...MODEL_OPTIONS, num_predict: options.maxTokens } : MODEL_OPTIONS }),
			redirect: "error",
			signal,
		});
		text = await response.text();
	} catch (err) {
		throw failed(err);
	}

	let body: { error?: unknown; message?: { content?: unknown } } | null = null;
	try {
		body = JSON.parse(text);
	} catch {
		// Not Ollama's JSON: handled by status below.
	}
	const ollamaError = typeof body?.error === "string" ? body.error : null;
	if (!response.ok) {
		if (ollamaError !== null && /model\b.*\bnot found|not found.*\bmodel/i.test(ollamaError)) {
			throw new AssistantError(502, `Ollama has no model ${config.model}: add it in Ollama first`);
		}
		if (response.status === 404) {
			// Ollama answers a missing model with its own JSON error; a bare 404 means there is no Ollama API here.
			throw new AssistantError(502, `${host} has no Ollama API at /api/chat (HTTP 404). Check PORCHLIGHT_LLM_URL`);
		}
		const detail = ollamaError ? `: ${ollamaError.slice(0, 200)}` : "";
		throw new AssistantError(502, `The model at ${host} failed (HTTP ${response.status})${detail}`);
	}
	const content = body?.message?.content;
	if (typeof content !== "string") throw new AssistantError(502, `The answer from ${host} is not one Porchlight can read. Is it Ollama?`);
	const answer = withoutThinking(content);
	if (answer === "") throw new AssistantError(502, "The model gave an empty answer. Try again");
	return answer;
}

/**
 * Asks a hosted model, or a server of the owner's that speaks OpenAI's chat format. The key travels in a header to the provider's fixed address and nowhere
 * else; redirects are refused so it cannot be passed on. A refusal or an empty answer is an error
 * that says so, never an answer.
 */
async function hostedChat(config: AssistantConfig, messages: ChatMessage[], fetchFn: typeof fetch, signal: AbortSignal, failed: (err: unknown) => AssistantError): Promise<string> {
	const name = config.provider === "compatible" || config.provider === undefined || config.provider === "ollama" ? `The model server at ${config.url.host}` : HOSTED[config.provider].name;
	const claude = config.provider === "anthropic";
	const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
	const user = messages.filter((message) => message.role === "user").map((message) => ({ role: "user", content: message.content }));
	const fallback = claude && TAKES_FALLBACK.test(config.model);
	const headers: Record<string, string> = claude
		? { "content-type": "application/json", "x-api-key": config.apiKey ?? "", "anthropic-version": ANTHROPIC_VERSION, ...(fallback ? { "anthropic-beta": FALLBACK_BETA } : {}) }
		: { "content-type": "application/json", ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}) };
	const body = claude
		? { model: config.model, max_tokens: HOSTED_MAX_TOKENS, system, messages: user, output_config: { effort: "medium" }, ...(fallback ? { fallbacks: "default" } : {}) }
		: { model: config.model, messages };

	let response: Response;
	let text: string;
	try {
		response = await fetchFn(config.url, { method: "POST", headers, body: JSON.stringify(body), redirect: "error", signal });
		text = await response.text();
	} catch (err) {
		throw failed(err);
	}
	let answer: Record<string, unknown> | null = null;
	try {
		answer = JSON.parse(text);
	} catch {
		// Not JSON: handled by status below.
	}
	if (!response.ok) {
		const detail = (answer?.error as { message?: unknown } | undefined)?.message;
		const why = typeof detail === "string" ? `: ${scrub(detail, config.apiKey).slice(0, 200)}` : "";
		if (response.status === 401 || response.status === 403) throw new AssistantError(502, `${name} refused the API key. Check the key in Settings → Model`);
		if (response.status === 404) throw new AssistantError(502, `${name} has no model ${config.model}. Choose one with Find models in Settings → Model`);
		if (response.status === 429) throw new AssistantError(502, `${name} is limiting requests, or the account is out of credit. Try again later${why}`);
		throw new AssistantError(502, `${name} failed (HTTP ${response.status})${why}`);
	}
	let content = "";
	if (claude) {
		if (answer?.stop_reason === "refusal") throw new AssistantError(502, `${name} declined to answer this request`);
		const blocks = Array.isArray(answer?.content) ? (answer.content as { type?: unknown; text?: unknown }[]) : [];
		content = blocks.filter((block) => block?.type === "text" && typeof block.text === "string").map((block) => block.text).join("");
	} else {
		const choice = (Array.isArray(answer?.choices) ? answer.choices[0] : null) as { message?: { content?: unknown } } | null;
		if (typeof choice?.message?.content === "string") content = choice.message.content;
	}
	const cleaned = withoutThinking(content);
	if (cleaned === "") throw new AssistantError(502, `${name} gave an empty answer. Try again`);
	return cleaned;
}

/** Model names a server or an account offers, for choosing one in Settings. */
const NOT_FOR_CHAT = /embed|whisper|tts|dall-e|moderation|transcribe|audio|image|realtime|search|computer-use|davinci|babbage/i;
const MAX_LISTED = 300;
const LIST_TIMEOUT_MS = 15_000;

/**
 * Lists the models where `config` points, by name. Asks the same address chat requests go to (for a
 * hosted provider its fixed models address), with the same key in the same header, and nothing else.
 */
export async function listModels(config: Omit<AssistantConfig, "model">, options: { fetchFn?: typeof fetch } = {}): Promise<string[]> {
	const fetchFn = options.fetchFn ?? fetch;
	const provider = config.provider ?? "ollama";
	const hosted = provider !== "ollama" && provider !== "compatible" ? HOSTED[provider] : null;
	const url =
		provider === "ollama" ? new URL("api/tags", config.url) : hosted ? new URL(hosted.modelsUrl) : new URL("../models", config.url);
	const name = hosted ? hosted.name : `The model server at ${config.url.host}`;
	const headers: Record<string, string> =
		provider === "anthropic"
			? { "x-api-key": config.apiKey ?? "", "anthropic-version": ANTHROPIC_VERSION }
			: config.apiKey
				? { authorization: `Bearer ${config.apiKey}` }
				: {};
	let response: Response;
	let text: string;
	try {
		response = await fetchFn(url, { headers, redirect: "error", signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
		text = await response.text();
	} catch (err) {
		const code = (err as { cause?: { code?: unknown } })?.cause?.code;
		throw new AssistantError(502, `Could not reach ${url.host}${typeof code === "string" ? ` (${code})` : ""}. Check the address, and that it is running`);
	}
	if (response.status === 401 || response.status === 403) throw new AssistantError(502, `${name} refused the API key`);
	if (!response.ok) throw new AssistantError(502, `${name} did not list its models (HTTP ${response.status}). Check the address`);
	let body: { models?: { name?: unknown }[]; data?: { id?: unknown }[] } | null = null;
	try {
		body = JSON.parse(text);
	} catch {
		// Handled below.
	}
	const names =
		provider === "ollama"
			? (body?.models ?? []).map((model) => model?.name)
			: (body?.data ?? []).map((model) => (typeof model?.id === "string" ? model.id.replace(/^models\//, "") : undefined));
	const usable = names.filter((model): model is string => typeof model === "string" && MODEL_NAME.test(model));
	if (usable.length === 0 && !Array.isArray(provider === "ollama" ? body?.models : body?.data)) {
		throw new AssistantError(502, `The answer from ${url.host} is not a list of models. Check the address`);
	}
	const chat = hosted ? usable.filter((model) => !NOT_FOR_CHAT.test(model)) : usable;
	return [...new Set(chat)].sort().slice(0, MAX_LISTED);
}

/** An error message from a provider, with the key taken out in case it was echoed back. */
function scrub(text: string, apiKey: string | undefined): string {
	return apiKey ? text.replaceAll(apiKey, "[key]") : text;
}

/**
 * Removes the reasoning a Qwen model may write before its answer, even with thinking turned off:
 * every <think>…</think> block, an opening block the length limit cut short, and everything before
 * a closing tag whose opening tag was part of the prompt template.
 */
export function withoutThinking(content: string): string {
	let text = content.replace(/<think>[\s\S]*?<\/think>/gi, "");
	const unclosed = text.search(/<think>/i);
	if (unclosed !== -1) text = text.slice(0, unclosed);
	const close = text.toLowerCase().lastIndexOf("</think>");
	if (close !== -1) text = text.slice(close + "</think>".length);
	return text.trim();
}
