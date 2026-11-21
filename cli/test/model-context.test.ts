// A local model's real context length sizes its budgets, never above the usual caps (R6F-8).
import assert from "node:assert/strict";
import { test } from "node:test";
import { budgetFor, contextLengthOf, forgetContextLengths, localBudget, MIN_DATA_CAP, modelContextLength } from "../src/assist/context.ts";
import { assistantConfig, chat, MODEL_OPTIONS } from "../src/assist/ollama.ts";
import { DATA_CAP } from "../src/assist/prompts.ts";
import { fakeFetch } from "./helpers.ts";

const config = assistantConfig({ PORCHLIGHT_LLM_URL: "http://ollama.test:11434", PORCHLIGHT_LLM_MODEL: "small-test:1b" });
const show = (length: number) => Response.json({ details: { family: "llama" }, model_info: { "general.architecture": "llama", "llama.context_length": length, "llama.embedding_length": 2048 } });

test("asks Ollama for the model's context length once, sending only its name to the chosen address", async () => {
	forgetContextLengths();
	const fetchFn = fakeFetch(() => show(4096));
	assert.equal(await modelContextLength(config, fetchFn), 4096);
	assert.equal(await modelContextLength(config, fetchFn), 4096);
	assert.equal(fetchFn.calls.length, 1, "remembered per address and model");
	const [call] = fetchFn.calls;
	assert.equal(call!.url, "http://ollama.test:11434/api/show");
	assert.equal(call!.init.method, "POST");
	assert.equal(call!.init.redirect, "error");
	assert.deepEqual(JSON.parse(String(call!.init.body)), { model: "small-test:1b" });

	const other = assistantConfig({ PORCHLIGHT_LLM_URL: "http://ollama.test:11434", PORCHLIGHT_LLM_MODEL: "other:9b" });
	assert.equal(await modelContextLength(other, fakeFetch(() => show(32768))), 32768);
});

test("a lookup that fails is not remembered and leaves the usual budgets (invariant 5)", async () => {
	forgetContextLengths();
	assert.equal(await modelContextLength(config, fakeFetch(() => new Response("nope", { status: 404 }))), null);
	assert.equal(await modelContextLength(config, fakeFetch(() => Response.json({ model_info: {} }))), null);
	assert.equal(
		await modelContextLength(
			config,
			fakeFetch(() => {
				throw new TypeError("fetch failed");
			}),
		),
		null,
	);
	const later = fakeFetch(() => show(2048));
	assert.equal(await modelContextLength(config, later), 2048);
	assert.equal(later.calls.length, 1, "asked again after a failure");
	assert.deepEqual(localBudget(null), { numCtx: MODEL_OPTIONS.num_ctx, dataCap: DATA_CAP, maxTokens: MODEL_OPTIONS.num_predict });
});

test("other providers are never asked", async () => {
	const claude = assistantConfig({ PORCHLIGHT_LLM_PROVIDER: "anthropic", PORCHLIGHT_LLM_API_KEY: "k".repeat(30) });
	const fetchFn = fakeFetch(() => show(4096));
	assert.equal(await modelContextLength(claude, fetchFn), null);
	assert.equal(fetchFn.calls.length, 0);
});

test("reads only a positive whole context_length from model_info", () => {
	assert.equal(contextLengthOf({ model_info: { "qwen3.context_length": 40960 } }), 40960);
	assert.equal(contextLengthOf({ model_info: { "qwen3.context_length": "40960" } }), null);
	assert.equal(contextLengthOf({ model_info: { "qwen3.context_length": -1 } }), null);
	assert.equal(contextLengthOf({ model_info: { "qwen3.context_length_extra": 99 } }), null);
	assert.equal(contextLengthOf(null), null);
});

test("budgets shrink for a small model and never grow past the usual caps", () => {
	assert.deepEqual(localBudget(131072), { numCtx: MODEL_OPTIONS.num_ctx, dataCap: DATA_CAP, maxTokens: MODEL_OPTIONS.num_predict });
	const small = localBudget(4096);
	assert.equal(small.numCtx, 4096);
	assert.ok(small.dataCap < DATA_CAP);
	assert.ok(small.dataCap + small.maxTokens + 1_500 <= 4096, "the rules, the data and the answer fit");
	const mural = localBudget(4096, 1_500);
	assert.equal(mural.maxTokens, 1_024, "an answer at most a quarter of what the model reads");
	assert.ok(mural.dataCap <= small.dataCap);
	assert.equal(localBudget(1024).dataCap, MIN_DATA_CAP);
	assert.ok(localBudget(8192, 1_500).dataCap <= DATA_CAP);
});

test("budgetFor asks once and chat uses the smaller context", async () => {
	forgetContextLengths();
	const fetchFn = fakeFetch((url) => (String(url).endsWith("/api/show") ? show(4096) : Response.json({ message: { content: "ok" }, done: true })));
	const budget = await budgetFor(config, fetchFn);
	assert.equal(budget.contextLength, 4096);
	assert.equal(await chat(config, [{ role: "user", content: "hi" }], { fetchFn, contextLength: budget.contextLength, maxTokens: budget.maxTokens }), "ok");
	const sent = JSON.parse(String(fetchFn.calls[1]!.init.body));
	assert.equal(sent.options.num_ctx, 4096);
	assert.equal(sent.options.num_predict, budget.maxTokens);

	// A model that reads more than usual still gets the usual context: never above the current caps.
	await chat(config, [{ role: "user", content: "hi" }], { fetchFn, contextLength: 131072 });
	assert.deepEqual(JSON.parse(String(fetchFn.calls[2]!.init.body)).options, MODEL_OPTIONS);
});
