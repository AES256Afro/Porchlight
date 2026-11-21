// Downloading a local model through Ollama: /api/model/local and beneath it.
import type { ServerResponse } from "node:http";
import { cpus, totalmem } from "node:os";
import { DEFAULT_OLLAMA, describeMachine, DownloadError, HUB_FORMATS, HUB_HOST, HUB_SIZES, HUB_SORTS, HUB_TASKS, installedModels, modelNameProblem, pullModel, searchHub } from "../../assist/download.ts";
import type { ServerContext } from "../context.ts";
import { onComputerPage, type Gate } from "../gate.ts";
import { bodyObject, HttpError, sendJson } from "../http.ts";
import type { DownloadStatus } from "../types.ts";

export function createDownload(ctx: ServerContext) {
	const { options, log, note } = ctx;
	// Downloading a local model: Ollama does it, at the address chosen under Settings → Model or on
	// this computer. One at a time, and only from this computer's page: it fills a disk.
	let download: DownloadStatus = { state: "idle" };
	// What this computer can run, from its memory: read once, from the system, never from a request.
	const machine = describeMachine(totalmem(), cpus()[0]?.model ?? "", process.platform, process.arch);
	let downloadStop: AbortController | null = null;
	function ollamaBase(): URL {
		const config = ctx.model().config;
		return config && (config.provider ?? "ollama") === "ollama" ? config.url : new URL(DEFAULT_OLLAMA);
	}

	async function downloadRoute(res: ServerResponse, route: string, url: URL, body: unknown, gate: Gate): Promise<void> {
		const here = onComputerPage(gate);
		try {
			if (route === "GET /api/model/local") {
				const base = ollamaBase();
				let installed: Awaited<ReturnType<typeof installedModels>> = [];
				let problem: string | undefined;
				try {
					installed = await installedModels(base, options.fetchFn);
				} catch (err) {
					problem = err instanceof Error ? err.message : String(err);
				}
				// Its whole address, so "Use this model" keeps https and the port (AI-B9); and whether it runs on this
				// computer, since only then does this computer's memory say which models fit (H-F5).
				const onThisComputer = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(base.hostname) || base.hostname.startsWith("127.");
				return sendJson(res, 200, { ollama: { host: base.host, origin: base.origin, onThisComputer, reachable: problem === undefined, ...(problem ? { problem } : {}) }, installed, download, canChange: here, hub: HUB_HOST, tasks: HUB_TASKS, sorts: HUB_SORTS, formats: HUB_FORMATS, sizes: HUB_SIZES, machine });
			}
			if (!here) throw new HttpError(403, "Models are searched for and downloaded from the page on the computer that runs Porchlight");
			if (route === "GET /api/model/local/search") {
				const asked = (name: string) => url.searchParams.get(name) ?? "";
				const fits = asked("fits");
				if (fits !== "" && fits !== "1") throw new HttpError(400, "fits is 1 or left out");
				return sendJson(res, 200, {
					models: await searchHub(
						{ q: asked("q"), task: asked("task"), sort: asked("sort"), author: asked("author"), tag: asked("tag"), format: asked("format"), size: asked("size"), ...(fits === "1" ? { fitsUpTo: machine.fitsUpTo } : {}) },
						options.fetchFn,
					),
				});
			}
			if (route === "POST /api/model/local/stop") {
				downloadStop?.abort();
				return sendJson(res, 200, { stopped: downloadStop !== null });
			}
			if (route !== "POST /api/model/local/download") throw new HttpError(404, "Not found");
			if (download.state === "running") throw new HttpError(409, `${download.name} is being downloaded. Wait for it, or stop it first`);
			const name = bodyObject(body).name;
			const problem = modelNameProblem(name);
			if (problem) throw new HttpError(400, problem);
			const chosen = String(name).trim();
			const base = ollamaBase();
			const stop = new AbortController();
			downloadStop = stop;
			const startedAt = new Date().toISOString();
			download = { state: "running", name: chosen, startedAt, step: "Asking Ollama", total: 0, completed: 0 };
			log(`Model download started: ${chosen}, through Ollama at ${base.host}`);
			// Not awaited: a model is gigabytes, and the page follows it.
			void pullModel(base, chosen, {
				fetchFn: options.fetchFn,
				signal: stop.signal,
				onProgress: (progress) => {
					if (download.state === "running") download = { ...download, ...progress };
				},
			})
				.then(() => {
					download = { state: "done", name: chosen, startedAt, finishedAt: new Date().toISOString() };
					log(`Model downloaded: ${chosen}`);
				})
				.catch((err) => {
					const error = stop.signal.aborted ? "Stopped by you. Ollama keeps what it already has, so starting again picks up from there." : err instanceof Error ? err.message : String(err);
					download = { state: "failed", name: chosen, startedAt, finishedAt: new Date().toISOString(), error };
					log(stop.signal.aborted ? `Model download stopped: ${chosen}` : `Model download failed: ${chosen}`);
					if (!stop.signal.aborted) note(error, "warning");
				})
				.finally(() => {
					if (downloadStop === stop) downloadStop = null;
				});
			return sendJson(res, 202, { download });
		} catch (err) {
			if (err instanceof DownloadError) throw new HttpError(502, err.message);
			throw err;
		}
	}

	return { downloadRoute };
}
