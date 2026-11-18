/** Where the local model is and which one to use. Read from the environment, never from the command line. */
export interface AssistantConfig {
	/** Ollama's base address, ending in "/" so the API path is added beneath it. */
	url: URL;
	model: string;
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

/**
 * Reads the local model's settings. An empty address means the features are off; the caller tells
 * that apart from a mistake by checking whether SECURITYX_LLM_URL was given at all. Plain http is
 * allowed: Ollama runs on this machine or this server, and nothing secret is sent to it.
 */
export function assistantConfig(env: Record<string, string | undefined>): AssistantConfig {
	const rawUrl = env.SECURITYX_LLM_URL?.trim();
	const model = env.SECURITYX_LLM_MODEL?.trim();
	if (!rawUrl) throw new Error("Set SECURITYX_LLM_URL to Ollama's address, for example http://localhost:11434, to turn on the local model");
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error("SECURITYX_LLM_URL is not an address. Give Ollama's, for example http://localhost:11434");
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("SECURITYX_LLM_URL must start with http:// or https://, for example http://localhost:11434");
	}
	if (url.username || url.password) throw new Error("SECURITYX_LLM_URL must not carry a user name or password");
	if (!model) throw new Error("Set SECURITYX_LLM_MODEL to the model's name in Ollama, as `ollama list` shows it");
	if (!MODEL_NAME.test(model)) throw new Error("SECURITYX_LLM_MODEL is not a model name: use the name `ollama list` shows");
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
		return new AssistantError(502, `Could not reach the model at ${host}${typeof code === "string" ? ` (${code})` : ""}. Is Ollama running there?`);
	};

	let response: Response;
	let text: string;
	try {
		response = await fetchFn(new URL("api/chat", config.url), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model: config.model, messages, stream: false, think: false, options: MODEL_OPTIONS }),
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
			throw new AssistantError(502, `${host} has no Ollama API at /api/chat (HTTP 404). Check SECURITYX_LLM_URL`);
		}
		const detail = ollamaError ? `: ${ollamaError.slice(0, 200)}` : "";
		throw new AssistantError(502, `The model at ${host} failed (HTTP ${response.status})${detail}`);
	}
	const content = body?.message?.content;
	if (typeof content !== "string") throw new AssistantError(502, `The answer from ${host} is not one SecurityX can read. Is it Ollama?`);
	const answer = withoutThinking(content);
	if (answer === "") throw new AssistantError(502, "The model gave an empty answer. Try again");
	return answer;
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
