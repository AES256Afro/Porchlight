// How much a model on the owner's machines can read (R6F-8). Ollama says each model's real context
// length through /api/show; the token budgets of the prompts (B37) are sized from it, never above the
// caps they had before, so a small model gets a smaller data block instead of having the start of its
// prompt, where the rules are, trimmed away.
import { MODEL_OPTIONS, type AssistantConfig } from "./ollama.ts";
import { DATA_CAP } from "./prompts.ts";

/** Room for the rules, the task and an owner's question, in estimated tokens. */
export const PROMPT_OVERHEAD = 1_500;
/** The smallest data block worth sending: one finding and its fix. */
export const MIN_DATA_CAP = 300;
/** How long to wait for Ollama to describe a model. */
const SHOW_TIMEOUT_MS = 10_000;

/** What a model answered, per address and model. Only answers are kept: a failed lookup is asked again next time (invariant 5). */
const lengths = new Map<string, number>();

function cacheKey(config: AssistantConfig): string {
	return `${config.url.href}\n${config.model}`;
}

/** Whether the model is Ollama's, the one kind whose context length can be asked for. */
function isOllama(config: AssistantConfig): boolean {
	return config.provider === undefined || config.provider === "ollama";
}

/**
 * The model's context length in tokens, as Ollama reports it, asked once per address and model and
 * then remembered. Null for any other provider, or when Ollama could not say: the budgets then stay
 * as they were. Only the model's name is sent, to the address the owner chose.
 */
export async function modelContextLength(config: AssistantConfig, fetchFn: typeof fetch = fetch): Promise<number | null> {
	if (!isOllama(config)) return null;
	const key = cacheKey(config);
	const known = lengths.get(key);
	if (known !== undefined) return known;
	try {
		const response = await fetchFn(new URL("api/show", config.url), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model: config.model }),
			redirect: "error",
			signal: AbortSignal.timeout(SHOW_TIMEOUT_MS),
		});
		if (!response.ok) return null;
		const length = contextLengthOf(await response.json());
		if (length !== null) lengths.set(key, length);
		return length;
	} catch {
		return null;
	}
}

/** The context length already known for this model, without asking: null when it has not been asked, or could not say. */
export function knownContextLength(config: AssistantConfig): number | null {
	return isOllama(config) ? (lengths.get(cacheKey(config)) ?? null) : null;
}

/** The context length in an answer from /api/show: `model_info`'s `<architecture>.context_length`. */
export function contextLengthOf(body: unknown): number | null {
	const info = (body as { model_info?: unknown } | null)?.model_info;
	if (typeof info !== "object" || info === null) return null;
	for (const [name, value] of Object.entries(info)) {
		if (/(?:^|\.)context_length$/.test(name) && typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
	}
	return null;
}

/** Forgets every remembered length; for tests, and when a model is downloaded again. */
export function forgetContextLengths(): void {
	lengths.clear();
}

export interface LocalBudget {
	/** The context Ollama is asked to use: the usual one, or the model's own when that is smaller. */
	numCtx: number;
	/** The data block's cap, in estimated tokens, never above `DATA_CAP`. */
	dataCap: number;
	/** The longest answer, in tokens, never above what was asked for. */
	maxTokens: number;
}

/**
 * The budgets for a local model of `contextLength` tokens (null: not known, so the usual ones). The
 * rules, the data and the answer together stay inside what the model reads.
 */
export function localBudget(contextLength: number | null, answerTokens: number = MODEL_OPTIONS.num_predict): LocalBudget {
	const numCtx = Math.min(MODEL_OPTIONS.num_ctx, contextLength ?? MODEL_OPTIONS.num_ctx);
	// A model that reads very little still answers, more briefly: at most a quarter of what it reads.
	const maxTokens = Math.max(1, Math.min(answerTokens, Math.floor(numCtx / 4)));
	const dataCap = Math.min(DATA_CAP, Math.max(MIN_DATA_CAP, numCtx - PROMPT_OVERHEAD - maxTokens));
	return { numCtx, dataCap, maxTokens };
}

/**
 * The budgets for this model, asking Ollama the first time: what a caller needs before it builds a
 * prompt (`dataCap`) and sends it (`contextLength` and `maxTokens` for `chat`). Any other provider
 * keeps the usual budgets.
 */
export async function budgetFor(config: AssistantConfig, fetchFn: typeof fetch | undefined, answerTokens: number = MODEL_OPTIONS.num_predict): Promise<LocalBudget & { contextLength: number | null }> {
	const contextLength = await modelContextLength(config, fetchFn);
	return { ...localBudget(contextLength, answerTokens), contextLength };
}

/**
 * What a caller sends a model with, sized from the model's own context length when Ollama says it
 * (R6F-8): the data block's cap and the longest answer, each never above what the caller had before.
 * When the length is not known (another provider, or Ollama could not say), both stay exactly as given.
 */
export function sizedFor(config: AssistantConfig, usual: { cap: number; maxTokens?: number }): { cap: number; maxTokens?: number; contextLength: number | null } {
	// Asked of Ollama when the model is chosen (Settings → Model's test), never in the middle of a
	// request: what is known is used, and a model never asked keeps the usual budgets.
	const contextLength = knownContextLength(config);
	if (contextLength === null) return { ...usual, contextLength };
	const budget = localBudget(contextLength, usual.maxTokens ?? MODEL_OPTIONS.num_predict);
	return { cap: Math.min(usual.cap, budget.dataCap), maxTokens: budget.maxTokens, contextLength };
}
