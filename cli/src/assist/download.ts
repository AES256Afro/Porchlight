/**
 * Finding and downloading local models. Porchlight runs no model itself: Ollama does, so a download
 * is a request to the owner's Ollama to pull a model, and the search is a question to Hugging Face
 * about which models exist in the format Ollama reads (GGUF).
 *
 * - The search sends the owner's search words to `HUB_SEARCH`, a fixed address, and nothing else:
 *   no key, no cookie, nothing from a scan. The page says so before anything is sent.
 * - A model's name is checked against a strict pattern before it goes anywhere; nothing from the
 *   Hub's answer is used as an address.
 * - Everything the Hub returns is someone else's text. The page shows it as text, never as HTML.
 * - A download changes nothing but Ollama's own model folder, and only on the owner's say-so.
 */

/** Where models are searched for. Fixed here; nothing from a request becomes part of the host or path. */
export const HUB_SEARCH = "https://huggingface.co/api/models";
export const HUB_HOST = "huggingface.co";
/** Where Ollama listens unless the owner chose another address under Settings → Model. */
export const DEFAULT_OLLAMA = "http://127.0.0.1:11434";
const MAX_QUERY = 80;
const MAX_RESULTS = 20;
/** How many are asked for when the answer is narrowed here by size. */
const MAX_FETCHED = 100;
const SEARCH_TIMEOUT_MS = 15_000;

export class DownloadError extends Error {}

/** A model on the Hub, as far as the page shows it. `pull` is the name Ollama downloads it by. */
export interface HubModel {
	id: string;
	pull: string;
	/** Its page on the Hub, built here from the checked id: the page never builds an address from the search's answer (S37). */
	page: string;
	downloads: number;
	likes: number;
	/** What kind of model the Hub says it is, when it is one of `HUB_TASKS`. */
	task?: string;
	/** When it was last changed, as an ISO date, when the Hub gives one. */
	updated?: string;
	format: HubFormat;
	/** Billions of parameters, when the name says. */
	params?: number;
}

/** The kinds of model the search can be narrowed to: the Hub's own names for them, and ours. */
export const HUB_TASKS = [
	["", "Any kind"],
	["text-generation", "Text and chat"],
	["image-text-to-text", "Reads images too"],
	["feature-extraction", "Embeddings"],
] as const;

/**
 * The formats the search can be narrowed to. Ollama runs GGUF. MLX is Apple's format for Apple
 * silicon: Ollama cannot run it, so an MLX model is found here and downloaded in LM Studio or mlx-lm.
 */
export const HUB_FORMATS = [
	["gguf", "GGUF, for Ollama"],
	["mlx", "MLX, for Apple silicon"],
] as const;
export type HubFormat = (typeof HUB_FORMATS)[number][0];

/** Sizes to narrow to, by how many billion parameters the model's name says it has: the most each allows. */
export const HUB_SIZES = [
	["", "Any size"],
	["4", "Up to 4B"],
	["9", "5B to 9B"],
	["16", "10B to 16B"],
	["35", "17B to 35B"],
	["1000", "Over 35B"],
] as const;
const SIZE_FLOORS: Record<string, number> = { "4": 0, "9": 4, "16": 9, "35": 16, "1000": 35 };

/**
 * How many billion parameters a model has, read from its name (`Qwen3-8B`, `gemma-3-270m`), or null
 * when the name does not say. The Hub's search does not filter by this, so the name is what there is.
 */
export function paramsFromName(id: string): number | null {
	const name = id.slice(id.indexOf("/") + 1);
	const found = /(?:^|[-_.])(\d{1,4}(?:\.\d{1,2})?)([bBmM])(?![A-Za-z0-9])/.exec(name);
	if (!found) return null;
	const value = Number(found[1]) / (found[2]!.toLowerCase() === "m" ? 1000 : 1);
	return value > 0 && value < 2000 ? value : null;
}

/** The computer Porchlight runs on, as far as choosing a model goes. */
export interface Machine {
	/** Memory, in gigabytes. */
	memoryGb: number;
	/** The processor as the system names it, such as "Apple M3 Max". */
	chip: string;
	appleSilicon: boolean;
	/** The largest model, in billions of parameters, that should run comfortably here. */
	fitsUpTo: number;
}

/**
 * The largest model that should run comfortably in this much memory. A model at the usual 4-bit
 * size takes a little over half a gigabyte for each billion parameters, and the system and
 * everything else open need the rest, so about half the memory is counted. A guide, not a promise.
 */
export function fitsUpTo(memoryGb: number): number {
	return Math.max(1, Math.floor(memoryGb * 0.55));
}

export function describeMachine(memoryBytes: number, chip: string, platform: string, arch: string): Machine {
	const memoryGb = Math.max(1, Math.round(memoryBytes / 1024 ** 3));
	return { memoryGb, chip: chip.replace(/\s+/g, " ").trim().slice(0, 80), appleSilicon: platform === "darwin" && arch === "arm64", fitsUpTo: fitsUpTo(memoryGb) };
}

/** The orders the search can come back in. */
export const HUB_SORTS = [
	["downloads", "Most downloaded"],
	["likes", "Most liked"],
	["trendingScore", "Trending now"],
	["lastModified", "Recently updated"],
	["createdAt", "Newest"],
] as const;

/** What the owner chose to search by. Every field is checked here; none becomes part of an address as typed. */
export interface HubQuery {
	q?: unknown;
	task?: unknown;
	sort?: unknown;
	/** A publisher on the Hub, such as `unsloth` or `bartowski`. */
	author?: unknown;
	/** One of the Hub's tags, such as `conversational`, `code` or `license:apache-2.0`. */
	tag?: unknown;
	/** One of `HUB_FORMATS`. GGUF when not given. */
	format?: unknown;
	/** One of `HUB_SIZES`. */
	size?: unknown;
	/** Keep only models whose name gives a size this large or smaller, in billions of parameters. */
	fitsUpTo?: number;
}

const HUB_AUTHOR = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const HUB_TAG = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,63}$/;

/** A model Ollama already has. */
export interface InstalledModel {
	name: string;
	size: number;
}

/** One of Ollama's own models (`qwen3:8b`), or a Hub repository in the form Ollama pulls (`hf.co/owner/name`, with an optional `:quantization`). */
const OLLAMA_NAME = /^[a-z0-9][a-z0-9._-]{0,79}(\/[a-z0-9][a-z0-9._-]{0,79})?(:[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$/;
const HUB_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const HUB_PULL = /^hf\.co\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}(:[A-Za-z0-9][A-Za-z0-9._-]{0,63})?$/;

/** Null when the name is one Ollama can be asked to download; otherwise what is wrong with it. */
export function modelNameProblem(name: unknown): string | null {
	if (typeof name !== "string" || name.trim() === "") return "Name the model to download, such as qwen3:8b";
	const typed = name.trim();
	if (typed.length > 260) return "That name is too long";
	if (typed.includes("..")) return "That is not a model name";
	if (HUB_PULL.test(typed) || (!typed.startsWith("hf.co/") && OLLAMA_NAME.test(typed))) return null;
	return "That is not a model name. Use one of Ollama's, such as qwen3:8b, or one found by the search";
}

/**
 * Models on the Hub that match the owner's words and come in the format Ollama reads, most downloaded first.
 */
export async function searchHub(query: HubQuery, fetchFn: typeof fetch = fetch): Promise<HubModel[]> {
	const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
	const words = text(query.q).slice(0, MAX_QUERY);
	const task = text(query.task);
	const sort = text(query.sort) || "downloads";
	const author = text(query.author);
	const tag = text(query.tag);
	if (!HUB_TASKS.some(([id]) => id === task)) throw new DownloadError("Choose one of the kinds of model listed");
	if (!HUB_SORTS.some(([id]) => id === sort)) throw new DownloadError("Choose one of the orders listed");
	if (author && !HUB_AUTHOR.test(author)) throw new DownloadError("A publisher is one name, such as unsloth, with no spaces or slashes");
	if (tag && !HUB_TAG.test(tag)) throw new DownloadError("A tag is one word, such as conversational or license:apache-2.0");
	const format = text(query.format) || "gguf";
	const size = text(query.size);
	if (!HUB_FORMATS.some(([id]) => id === format)) throw new DownloadError("Choose one of the formats listed");
	if (!HUB_SIZES.some(([id]) => id === size)) throw new DownloadError("Choose one of the sizes listed");
	const fits = typeof query.fitsUpTo === "number" && query.fitsUpTo > 0 ? query.fitsUpTo : null;
	const narrowed = size !== "" || fits !== null;
	if (words.length < 2 && !task && !author && !tag && !narrowed) throw new DownloadError("Type at least two letters, or choose a kind, a size, a publisher or a tag");
	const url = new URL(HUB_SEARCH);
	// Always one format; a tag the owner names is asked for as well. Size is not something the Hub
	// filters by, so more are asked for and the ones whose name gives another size are left out here.
	const params = new URLSearchParams({ filter: format, sort, direction: "-1", limit: String(narrowed ? MAX_FETCHED : MAX_RESULTS) });
	if (tag) params.append("filter", tag);
	if (words) params.set("search", words);
	if (task) params.set("pipeline_tag", task);
	if (author) params.set("author", author);
	url.search = params.toString();
	let response: Response;
	let body: unknown;
	try {
		response = await fetchFn(url, { redirect: "error", signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
		// An answer that is not JSON is an answer all the same: it is reported below with its status.
		body = await response.json().catch(() => null);
	} catch {
		throw new DownloadError(`Could not reach ${HUB_HOST} to search. Check the connection and try again`);
	}
	if (!response.ok || !Array.isArray(body)) throw new DownloadError(`${HUB_HOST} did not answer the search (HTTP ${response.status})`);
	const found: HubModel[] = [];
	for (const item of body.slice(0, MAX_FETCHED)) {
		if (found.length >= MAX_RESULTS) break;
		const id = (item as { id?: unknown })?.id;
		// A name that does not look like owner/name is left out, never repaired.
		if (typeof id !== "string" || !HUB_ID.test(id) || id.includes("..")) continue;
		const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0);
		const kind = (item as { pipeline_tag?: unknown }).pipeline_tag;
		const changed = (item as { lastModified?: unknown }).lastModified;
		const billions = paramsFromName(id);
		// With a size asked for, a model whose name gives none is left out: it cannot be said to fit.
		if (narrowed && billions === null) continue;
		if (billions !== null && size !== "" && (billions > Number(size) || billions <= (SIZE_FLOORS[size] ?? 0))) continue;
		if (billions !== null && fits !== null && billions > fits) continue;
		found.push({
			id,
			format: format as HubFormat,
			...(billions !== null ? { params: billions } : {}),
			pull: `hf.co/${id}`,
			page: new URL(`https://${HUB_HOST}/${id.split("/").map(encodeURIComponent).join("/")}`).href,
			downloads: count((item as { downloads?: unknown }).downloads),
			likes: count((item as { likes?: unknown }).likes),
			...(typeof kind === "string" && HUB_TASKS.some(([known]) => known !== "" && known === kind) ? { task: kind } : {}),
			...(typeof changed === "string" && !Number.isNaN(Date.parse(changed)) ? { updated: new Date(changed).toISOString() } : {}),
		});
	}
	return found;
}

function reach(base: URL, err: unknown): DownloadError {
	const code = (err as { cause?: { code?: unknown } })?.cause?.code;
	return new DownloadError(`Could not reach Ollama at ${base.host}${typeof code === "string" ? ` (${code})` : ""}. Open the Ollama app, or run \`ollama serve\`, and try again`);
}

/** The models Ollama has, largest first. Throws when Ollama does not answer. */
export async function installedModels(base: URL, fetchFn: typeof fetch = fetch): Promise<InstalledModel[]> {
	let body: { models?: { name?: unknown; size?: unknown }[] };
	try {
		const response = await fetchFn(new URL("api/tags", base), { redirect: "error", signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
		if (!response.ok) throw new DownloadError(`Ollama at ${base.host} did not list its models (HTTP ${response.status})`);
		body = (await response.json()) as typeof body;
	} catch (err) {
		if (err instanceof DownloadError) throw err;
		throw reach(base, err);
	}
	return (Array.isArray(body?.models) ? body.models : [])
		.filter((model): model is { name: string; size?: unknown } => typeof model?.name === "string" && model.name.length <= 260)
		.map((model) => ({ name: model.name, size: typeof model.size === "number" && model.size >= 0 ? model.size : 0 }))
		.sort((a, b) => b.size - a.size)
		.slice(0, 300);
}

export interface PullProgress {
	/** What Ollama says it is doing, cut short. Ollama's words, shown as text. */
	step: string;
	/** Bytes of the part being downloaded, when Ollama says. */
	total: number;
	completed: number;
}

/**
 * Asks Ollama to download a model and follows it to the end. Resolves when Ollama says it is done;
 * throws with Ollama's reason when it fails, and when `signal` stops it.
 */
export async function pullModel(base: URL, name: string, options: { fetchFn?: typeof fetch; signal?: AbortSignal; onProgress?: (progress: PullProgress) => void } = {}): Promise<void> {
	const problem = modelNameProblem(name);
	if (problem) throw new DownloadError(problem);
	const fetchFn = options.fetchFn ?? fetch;
	let response: Response;
	try {
		response = await fetchFn(new URL("api/pull", base), {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model: name.trim(), stream: true }),
			redirect: "error",
			signal: options.signal,
		});
	} catch (err) {
		if (options.signal?.aborted) throw new DownloadError("Stopped");
		throw reach(base, err);
	}
	if (!response.ok || !response.body) {
		const text = await response.text().catch(() => "");
		throw new DownloadError(`Ollama refused the download (HTTP ${response.status})${ollamaError(text) ? `: ${ollamaError(text)}` : ""}`);
	}
	// One JSON object a line, as Ollama streams them.
	const decoder = new TextDecoder();
	let pending = "";
	let finished = false;
	const read = (line: string) => {
		if (line.trim() === "") return;
		let event: { status?: unknown; total?: unknown; completed?: unknown; error?: unknown };
		try {
			event = JSON.parse(line);
		} catch {
			return;
		}
		if (typeof event.error === "string") throw new DownloadError(`Ollama could not download it: ${event.error.replace(/\s+/g, " ").slice(0, 300)}`);
		const step = typeof event.status === "string" ? event.status.replace(/\s+/g, " ").slice(0, 120) : "";
		if (step === "success") finished = true;
		const number = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0);
		options.onProgress?.({ step, total: number(event.total), completed: number(event.completed) });
	};
	try {
		for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
			pending += decoder.decode(chunk, { stream: true });
			// A line that never ends is not a progress line.
			if (pending.length > 1_000_000) throw new DownloadError("Ollama's answer could not be read");
			const lines = pending.split("\n");
			pending = lines.pop() ?? "";
			for (const line of lines) read(line);
		}
		read(pending);
	} catch (err) {
		if (err instanceof DownloadError) throw err;
		if (options.signal?.aborted) throw new DownloadError("Stopped");
		throw new DownloadError(`The download was cut off: ${err instanceof Error ? err.message : String(err)}`);
	}
	if (!finished) throw new DownloadError("The download ended before Ollama said it was complete. Try again: Ollama keeps what it already has");
}

function ollamaError(text: string): string {
	try {
		const error = (JSON.parse(text) as { error?: unknown }).error;
		return typeof error === "string" ? error.replace(/\s+/g, " ").slice(0, 300) : "";
	} catch {
		return "";
	}
}
