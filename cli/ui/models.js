// @ts-check
// Where a model can run, as offered under Settings → Model. The server accepts only these ids, and
// takes each choice's provider (and so a hosted provider's fixed address) from here, never from a request.

/** @typedef {"ollama" | "compatible" | "anthropic" | "openai" | "gemini" | "deepseek"} ModelProvider */

/**
 * `url`: the address offered first; the owner can change it, except for a hosted provider, which has none.
 * `key`: whether the choice needs an API key.
 *
 * @typedef {{
 *   id: string,
 *   name: string,
 *   group: "mac" | "server" | "hosted" | "off",
 *   provider: ModelProvider | null,
 *   url: string,
 *   key: "required" | "optional" | "none",
 *   help: string,
 *   placeholder: string,
 * }} ModelChoice
 */

/** @type {readonly ModelChoice[]} */
export const MODEL_CHOICES = [
	{
		id: "ollama-mac",
		name: "Ollama on this Mac",
		group: "mac",
		provider: "ollama",
		url: "http://localhost:11434",
		key: "none",
		help: "Ollama's app, or `ollama serve`, with a model pulled into it.",
		placeholder: "qwen3:8b",
	},
	{
		id: "unsloth-mac",
		name: "Unsloth Studio on this Mac",
		group: "mac",
		provider: "compatible",
		url: "http://localhost:8888/v1",
		key: "optional",
		help: "Start it with `unsloth studio`. If Studio asks for a key, make one under Settings → API in Studio and paste it here.",
		placeholder: "the model loaded in Studio",
	},
	{
		id: "lmstudio-mac",
		name: "LM Studio on this Mac",
		group: "mac",
		provider: "compatible",
		url: "http://localhost:1234/v1",
		key: "optional",
		help: "Turn on LM Studio's local server and load a model.",
		placeholder: "the model loaded in LM Studio",
	},
	{
		id: "ollama-server",
		name: "Ollama on another computer",
		group: "server",
		provider: "ollama",
		url: "http://bigbox:11434",
		key: "none",
		help: "Any computer you can reach, such as one on your tailnet.",
		placeholder: "qwen3:8b",
	},
	{
		id: "openai-server",
		name: "Other model server",
		group: "server",
		provider: "compatible",
		url: "",
		key: "optional",
		help: "Anything that speaks OpenAI's format: llama.cpp, vLLM, Unsloth or LM Studio on another computer, or a service such as OpenRouter. Give the address its API lives at, usually ending in /v1.",
		placeholder: "the model's name on that server",
	},
	{
		id: "anthropic",
		name: "Claude",
		group: "hosted",
		provider: "anthropic",
		url: "",
		key: "required",
		help: "Anthropic's API, with a key from console.anthropic.com.",
		placeholder: "claude-opus-5-5",
	},
	{
		id: "openai",
		name: "ChatGPT",
		group: "hosted",
		provider: "openai",
		url: "",
		key: "required",
		help: "OpenAI's API, with a key from platform.openai.com. A ChatGPT subscription is not an API key.",
		placeholder: "a model from Find models",
	},
	{
		id: "gemini",
		name: "Gemini",
		group: "hosted",
		provider: "gemini",
		url: "",
		key: "required",
		help: "Google's Gemini API, with a key from aistudio.google.com.",
		placeholder: "a model from Find models",
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		group: "hosted",
		provider: "deepseek",
		url: "",
		key: "required",
		help: "DeepSeek's API, with a key from platform.deepseek.com.",
		placeholder: "deepseek-chat",
	},
	{ id: "off", name: "No model", group: "off", provider: null, url: "", key: "none", help: "Explain, Summarise, Ask and Deeper analysis are hidden.", placeholder: "" },
];

/** @param {unknown} id */
export function modelChoice(id) {
	return MODEL_CHOICES.find((choice) => choice.id === id) ?? null;
}
