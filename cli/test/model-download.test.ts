import assert from "node:assert/strict";
import { request } from "node:http";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { DownloadError, HUB_SEARCH, installedModels, modelNameProblem, pullModel, searchHub } from "../src/assist/download.ts";
import { startUiServer, type UiServer } from "../src/ui/server.ts";
import { downloadLine, formatBytes } from "../ui/hints.js";
import { tempDir } from "./helpers.ts";

const OLLAMA = new URL("http://127.0.0.1:11434");

/** Ollama's answer to a pull: one JSON object a line, split across chunks as a network would. */
function pullStream(lines: unknown[], status = 200): Response {
	const text = lines.map((line) => JSON.stringify(line)).join("\n") + "\n";
	const half = Math.floor(text.length / 2);
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(text.slice(0, half)));
			controller.enqueue(new TextEncoder().encode(text.slice(half)));
			controller.close();
		},
	});
	return new Response(body, { status });
}

test("a model name is one of Ollama's or one the search gave, and nothing else", () => {
	for (const good of ["qwen3:8b", "gemma3", "library/llama3.2:3b-instruct-q4_K_M", "hf.co/unsloth/Qwen3-8B-GGUF", "hf.co/bartowski/Some_Model-GGUF:Q4_K_M"]) {
		assert.equal(modelNameProblem(good), null, good);
	}
	for (const bad of ["", "  ", 42, null, "http://evil.example/model", "hf.co/only-owner", "hf.co/a/b/c", "../../etc/passwd", "hf.co/a/..", "qwen3 8b", "qwen3;rm -rf", "$(id)", "a".repeat(300), "HF.CO/a/b", "hf.co//b"]) {
		assert.notEqual(modelNameProblem(bad), null, String(bad));
	}
});

test("the search asks Hugging Face only for what was typed and chosen, and keeps only names that look like models", async () => {
	const asked: URL[] = [];
	const fetchFn = (async (input: URL, init: RequestInit) => {
		asked.push(new URL(input));
		assert.equal(init.headers, undefined, "no key, no cookie, no header of ours");
		return Response.json([
			{ id: "unsloth/Qwen3-8B-GGUF", downloads: 1200, likes: 30, pipeline_tag: "text-generation", lastModified: "2026-10-01T10:00:00.000Z" },
			{ id: "someone/<script>alert(1)</script>", downloads: 5 },
			{ id: "../../etc/passwd" },
			{ id: "a/b/c" },
			{ id: 42 },
			{ id: "odd/Model", downloads: "many", likes: -3, pipeline_tag: "made-up-kind", lastModified: "not a date" },
		]);
	}) as unknown as typeof fetch;

	const found = await searchHub({ q: "  qwen security  ", task: "text-generation", sort: "likes", author: "unsloth", tag: "conversational" }, fetchFn);
	const url = asked[0]!;
	assert.equal(`${url.origin}${url.pathname}`, HUB_SEARCH);
	assert.deepEqual(url.searchParams.getAll("filter"), ["gguf", "conversational"], "always the format Ollama reads");
	assert.deepEqual(
		[url.searchParams.get("search"), url.searchParams.get("pipeline_tag"), url.searchParams.get("sort"), url.searchParams.get("author"), url.searchParams.get("limit")],
		["qwen security", "text-generation", "likes", "unsloth", "20"],
	);
	assert.deepEqual(found, [
		{ id: "unsloth/Qwen3-8B-GGUF", pull: "hf.co/unsloth/Qwen3-8B-GGUF", downloads: 1200, likes: 30, task: "text-generation", updated: "2026-10-01T10:00:00.000Z" },
		{ id: "odd/Model", pull: "hf.co/odd/Model", downloads: 0, likes: 0 },
	]);
	// Every name the search gives is one the download accepts.
	assert.ok(found.every((model) => modelNameProblem(model.pull) === null));

	// Filters alone are a search; nothing at all is not. A filter is one of the list, or one plain word.
	await searchHub({ q: "", task: "image-text-to-text" }, fetchFn);
	assert.equal(asked[1]!.searchParams.get("search"), null);
	const before = asked.length;
	for (const bad of [{ q: "q" }, {}, { q: "qwen", task: "anything" }, { q: "qwen", sort: "random" }, { q: "qwen", author: "a/b" }, { q: "qwen", author: "a b" }, { q: "qwen", tag: "x&filter=y" }, { q: "qwen", tag: "two words" }]) {
		await assert.rejects(searchHub(bad, fetchFn), DownloadError, JSON.stringify(bad));
	}
	assert.equal(asked.length, before, "a search that is refused asks nobody");
	await assert.rejects(searchHub({ q: "qwen" }, (async () => new Response("down", { status: 503 })) as unknown as typeof fetch), /did not answer the search/);
});

test("a download follows Ollama to the end, and anything short of success is a failure", async () => {
	const sent: { url: string; body: unknown }[] = [];
	const steps: string[] = [];
	const ok = (async (input: URL, init: RequestInit) => {
		sent.push({ url: String(input), body: JSON.parse(String(init.body)) });
		return pullStream([{ status: "pulling manifest" }, { status: "pulling 6a0746a1ec1a", total: 5_000_000_000, completed: 2_500_000_000 }, { status: "verifying sha256 digest" }, { status: "success" }]);
	}) as unknown as typeof fetch;
	await pullModel(OLLAMA, " qwen3:8b ", { fetchFn: ok, onProgress: (progress) => steps.push(`${progress.step} ${progress.completed}/${progress.total}`) });
	assert.deepEqual(sent, [{ url: "http://127.0.0.1:11434/api/pull", body: { model: "qwen3:8b", stream: true } }]);
	assert.deepEqual(steps, ["pulling manifest 0/0", "pulling 6a0746a1ec1a 2500000000/5000000000", "verifying sha256 digest 0/0", "success 0/0"]);

	const refused = (async () => pullStream([{ status: "pulling manifest" }, { error: "pull model manifest: file does not exist" }])) as unknown as typeof fetch;
	await assert.rejects(pullModel(OLLAMA, "nope:1b", { fetchFn: refused }), /Ollama could not download it: pull model manifest: file does not exist/);
	const cut = (async () => pullStream([{ status: "pulling manifest" }, { status: "pulling abc", total: 10, completed: 4 }])) as unknown as typeof fetch;
	await assert.rejects(pullModel(OLLAMA, "qwen3:8b", { fetchFn: cut }), /ended before Ollama said it was complete/);
	const down = (async () => {
		throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
	}) as unknown as typeof fetch;
	await assert.rejects(pullModel(OLLAMA, "qwen3:8b", { fetchFn: down }), /Could not reach Ollama at 127\.0\.0\.1:11434 \(ECONNREFUSED\)\. Open the Ollama app/);
	// A name that is not a model name is never sent anywhere.
	let called = 0;
	await assert.rejects(pullModel(OLLAMA, "http://evil.example/x", { fetchFn: (async () => (called++, new Response())) as unknown as typeof fetch }), DownloadError);
	assert.equal(called, 0);

	assert.deepEqual(
		await installedModels(OLLAMA, (async () => Response.json({ models: [{ name: "small:1b", size: 800_000_000 }, { name: "big:14b", size: 9_000_000_000 }, { name: 7 }] })) as unknown as typeof fetch),
		[
			{ name: "big:14b", size: 9_000_000_000 },
			{ name: "small:1b", size: 800_000_000 },
		],
	);
});

test("sizes and progress read the way a person would say them", () => {
	assert.equal(formatBytes(0), "size not given");
	assert.equal(formatBytes(512), "512 bytes");
	assert.equal(formatBytes(5_200_000_000), "5.2 GB");
	assert.equal(formatBytes(800_000_000), "800 MB");
	assert.equal(downloadLine({ name: "qwen3:8b", step: "pulling manifest", total: 0, completed: 0 }), "qwen3:8b: pulling manifest");
	assert.equal(downloadLine({ name: "qwen3:8b", step: "pulling 6a07", total: 5_000_000_000, completed: 2_500_000_000 }), "qwen3:8b: 50% of 5.0 GB (pulling 6a07)");
});

function send(server: UiServer, method: string, path: string, body?: unknown): Promise<{ status: number; text: string; json: any }> {
	const payload = body === undefined ? undefined : JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = request({ host: "127.0.0.1", port: server.port, method, path, headers: { "x-porchlight-session": server.sessionKey, ...(payload ? { "content-type": "application/json" } : {}) } }, (res) => {
			let text = "";
			res.setEncoding("utf8");
			res.on("data", (chunk) => (text += chunk));
			res.on("end", () => {
				let json;
				try {
					json = JSON.parse(text);
				} catch {
					json = undefined;
				}
				resolve({ status: res.statusCode ?? 0, text, json });
			});
		});
		req.on("error", reject);
		req.end(payload);
	});
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
	for (let attempt = 0; attempt < 300; attempt++) {
		const value = await read();
		if (done(value)) return value;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error("timed out waiting");
}

test("Settings downloads a model through Ollama, one at a time, and says what happened", async (t: TestContext) => {
	const dir = await tempDir();
	const calls: string[] = [];
	let installed = [{ name: "old:1b", size: 700_000_000 }];
	let release: () => void = () => {};
	const gate = new Promise<void>((resolve) => (release = resolve));
	const fetchFn = (async (input: URL | string, init?: RequestInit) => {
		const url = new URL(String(input));
		calls.push(`${init?.method ?? "GET"} ${url.host}${url.pathname}`);
		if (url.host === "huggingface.co") return Response.json([{ id: "unsloth/Qwen3-8B-GGUF", downloads: 9, likes: 1 }]);
		if (url.pathname === "/api/tags") return Response.json({ models: installed });
		if (url.pathname === "/api/pull") {
			const name = JSON.parse(String(init?.body)).model;
			if (name === "missing:1b") return pullStream([{ error: "file does not exist" }]);
			await gate;
			installed = [...installed, { name, size: 5_000_000_000 }];
			return pullStream([{ status: "pulling manifest" }, { status: "success" }]);
		}
		return new Response("not found", { status: 404 });
	}) as unknown as typeof fetch;
	const server = await startUiServer({ port: 0, reportPath: join(dir, "state", "repo-scan.json"), defaultRoot: dir, monitor: null, fetchFn });
	t.after(() => server.close());

	const local = (await send(server, "GET", "/api/model/local")).json;
	assert.deepEqual([local.ollama.host, local.ollama.reachable, local.canChange, local.hub], ["127.0.0.1:11434", true, true, "huggingface.co"]);
	assert.deepEqual(local.installed, [{ name: "old:1b", size: 700_000_000 }]);
	assert.deepEqual(local.download, { state: "idle" });
	assert.ok(local.tasks.some(([id]: [string]) => id === "text-generation") && local.sorts.some(([id]: [string]) => id === "downloads"));

	const found = await send(server, "GET", "/api/model/local/search?q=qwen&task=text-generation&sort=likes");
	assert.deepEqual(found.json.models.map((model: { pull: string }) => model.pull), ["hf.co/unsloth/Qwen3-8B-GGUF"]);
	assert.equal((await send(server, "GET", "/api/model/local/search?q=qwen&task=nonsense")).status, 502);

	// Not a model name: refused, and Ollama is never asked.
	for (const name of ["http://evil.example/x", "", "../x", 7]) {
		assert.equal((await send(server, "POST", "/api/model/local/download", { name })).status, 400, String(name));
	}
	assert.ok(!calls.includes("POST 127.0.0.1:11434/api/pull"));

	const started = await send(server, "POST", "/api/model/local/download", { name: "hf.co/unsloth/Qwen3-8B-GGUF" });
	assert.deepEqual([started.status, started.json.download.state, started.json.download.name], [202, "running", "hf.co/unsloth/Qwen3-8B-GGUF"]);
	// One at a time.
	assert.equal((await send(server, "POST", "/api/model/local/download", { name: "qwen3:8b" })).status, 409);
	release();
	const done = await until(() => send(server, "GET", "/api/model/local"), (reply) => reply.json.download.state !== "running");
	assert.equal(done.json.download.state, "done");
	assert.ok(done.json.installed.some((model: { name: string }) => model.name === "hf.co/unsloth/Qwen3-8B-GGUF"));

	// A model Ollama cannot find is a failure with its reason, never a success.
	await send(server, "POST", "/api/model/local/download", { name: "missing:1b" });
	const failed = await until(() => send(server, "GET", "/api/model/local"), (reply) => reply.json.download.state !== "running");
	assert.deepEqual([failed.json.download.state, /file does not exist/.test(failed.json.download.error)], ["failed", true]);

	const lines: string[] = (await send(server, "GET", "/api/activity?after=0")).json.lines.map((line: { text: string }) => line.text);
	assert.ok(lines.includes("Model download started: hf.co/unsloth/Qwen3-8B-GGUF, through Ollama at 127.0.0.1:11434"));
	assert.ok(lines.includes("Model downloaded: hf.co/unsloth/Qwen3-8B-GGUF"));
	assert.ok(lines.includes("Model download failed: missing:1b"));
});

test("a service, or Ollama not running, offers no download and says why", async (t: TestContext) => {
	const dir = await tempDir();
	const down = (async () => {
		throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
	}) as unknown as typeof fetch;
	const key = "k".repeat(40);
	const service = await startUiServer({ port: 0, host: "0.0.0.0", sessionKey: key, reportPath: join(dir, "state", "repo-scan.json"), defaultRoot: dir, monitor: null, fetchFn: down });
	t.after(() => service.close());
	const local = await send(service, "GET", "/api/model/local");
	assert.deepEqual([local.json.ollama.reachable, local.json.canChange, /Open the Ollama app/.test(local.json.ollama.problem)], [false, false, true]);
	assert.equal((await send(service, "POST", "/api/model/local/download", { name: "qwen3:8b" })).status, 403);
	assert.equal((await send(service, "GET", "/api/model/local/search?q=qwen")).status, 403);
});
