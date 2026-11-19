import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir, hostname, networkInterfaces } from "node:os";
import { dirname, join, resolve } from "node:path";
import { judge, readAnalysis, saveAnalysis, unitKey, unitsOf, VERDICTS, type AnalysisFile } from "../analysis/analyse.ts";
import { AssistantError, chat, HOSTED, isHosted, listModels, type AssistantConfig, type HostedProvider } from "../assist/ollama.ts";
import {
	addressFromConfig,
	choiceFromConfig,
	configFor,
	forgetModel,
	ModelSettingError,
	nextSaved,
	readSavedModel,
	saveModel,
	sendTargets,
	type ModelRequest,
	type SavedModel,
} from "../assist/settings.ts";
import { judgedHighlights, muralFacts, MuralError, parseMural, type Mural } from "../assist/mural.ts";
import {
	askPrompt,
	DATA_CAP,
	domainPrompt,
	findingPrompt,
	HOSTED_DATA_CAP,
	locateFinding,
	muralPrompt,
	roadmapPrompt,
	SEND_CONTENTS,
	SEND_PURPOSES,
	sendPrompt,
	type Prompt,
	type SendContent,
	type SendPurpose,
} from "../assist/prompts.ts";
import { describeFilter } from "../../ui/filter.js";
import { MAX_QUESTION } from "../../ui/generated.js";
import { DEFAULT_LOOK, isLook } from "../../ui/looks.js";
import { fetchedRepos, fetchRepo, GithubError, listRepos, parseRepoName, removeFetched, validOwner, type GithubConfig } from "../github/github.ts";
import { callMonitor, type MonitorConfig } from "../monitor/client.ts";
import { discoverRepos } from "../repos/discover.ts";
import type { Runner } from "../repos/exec.ts";
import { coverageNotes, nameUnder, rank, rankRepos, repoName, settingNotes } from "../repos/report.ts";
import { History, readNotes, setNote } from "../repos/history.ts";
import { checkHost, type HostCheckOptions } from "../host/check.ts";
import type { HostReport } from "../host/types.ts";
import { run as runCommand } from "../repos/exec.ts";
import { scanRepos } from "../repos/scan.ts";
import { findingKey, isStatus, MAX_NOTE } from "../../ui/tracking.js";
import { SEVERITIES, type ScanReport, type Severity } from "../repos/types.ts";
import { domainSuggestions, type MonitorReport } from "../roadmap/domains.ts";
import { exportDomain, exportRepos, ExportError, parseFilter, type ExportFile } from "../roadmap/export.ts";
import { buildRepoRoadmap, listRepoFindings, suggestionsFor } from "../roadmap/repos.ts";
import { DEFAULT_GOAL, DEFAULT_MAX_TURNS, DEFAULT_MIN_GAP_MS, investigate, MAX_GOAL, MAX_TURNS_LIMIT, newRun, type Run } from "../investigate/engine.ts";
import { exportInvestigation, INVESTIGATION_FORMATS, type InvestigationFormat } from "../investigate/export.ts";
import { challengeName, challengeValue, checkOwnership, newToken, readDomains, saveDomains, tokenFromChallenge } from "../investigate/ownership.ts";
import { abortableSleep, parseDomain, RateLimiter } from "../investigate/scope.ts";
import { isRunId, RunStore, settled } from "../investigate/store.ts";
import { liveNet, TOOLS as INVESTIGATION_TOOLS, type Net } from "../investigate/tools.ts";

export interface UiOptions {
	/** 0 picks a free port. */
	port: number;
	/**
	 * Interface to listen on (default 127.0.0.1). Any other address makes the page reachable from
	 * other machines, as in a container, so it needs a fixed `sessionKey` of MIN_KEY_LENGTH or more.
	 */
	host?: string;
	/** File holding the latest repository scan. Scans started from the UI overwrite it. */
	reportPath: string;
	/** Folder offered in the scan form. */
	defaultRoot: string;
	monitor: MonitorConfig | null;
	/** Why `monitor` is null, shown in the UI. */
	monitorError?: string;
	/** `monitor` is null because neither its address nor its token was given at all. */
	monitorUnset?: boolean;
	/**
	 * The model behind Explain, Summarise, Ask and Deeper analysis, as given at start-up. Null or
	 * absent turns them off. A choice saved under Settings → Model replaces it.
	 */
	assistant?: AssistantConfig | null;
	/** Why `assistant` is null, shown in the UI. */
	assistantError?: string;
	/** `assistant` is null because no model address was given: the features are simply off. */
	assistantUnset?: boolean;
	/** Where repositories fetched from GitHub are kept, and the token to fetch them with. Defaults to a folder beside the report, with no token. */
	github?: GithubConfig;
	/** Why the GitHub token that was given is not used, shown in the UI. */
	githubError?: string;
	/** Runs git when fetching. Tests pass a fake. */
	run?: Runner;
	/** A fixed key (PORCHLIGHT_UI_KEY). Without one, each start makes its own. */
	sessionKey?: string;
	scan?: typeof scanRepos;
	/** Used for the monitor and the local model alike. Tests pass a fake. */
	fetchFn?: typeof fetch;
	/** This machine's Tailscale address, for "Access from other devices". Tests pass their own. */
	tailnetAddress?: () => string | null;
	/** The port other devices use (default 4747). Tests pass 0. */
	accessPort?: number;
	/** Checks the computer Porchlight runs on. Tests pass a fake. */
	hostCheck?: (options: Omit<HostCheckOptions, "run">) => Promise<HostReport>;
	/** The network "Investigate with a model" uses for HTTP and TCP. Tests pass a scripted one. */
	investigateNet?: Net;
	/** The least time between two actions on one host (default 1 s). Tests pass 0. */
	investigateMinGapMs?: number;
}

/** The model in use: chosen in Settings, or given at start-up. */
export interface ModelInUse {
	config: AssistantConfig | null;
	error?: string;
	/** No model was asked for: the features are simply off. */
	unset: boolean;
	source: "settings" | "startup";
}

export interface UiServer {
	port: number;
	sessionKey: string;
	/** The model in use now. Settings can change it while the server runs. */
	model(): ModelInUse;
	/** Whether other devices on the tailnet can open the page, and where. Never the key. */
	access(): AccessStatus;
	/** Address to open, carrying the session key in the fragment so it is never sent to a server or logged. */
	url: string;
	close(): Promise<void>;
}

export interface AccessStatus {
	enabled: boolean;
	listening: boolean;
	/** The address other devices open, once listening. */
	url?: string;
	error?: string;
}

/**
 * Who a request came in through. The page on this computer uses the per-run session key on loopback;
 * other devices use the access key on the tailnet address alone. Each listener takes only its own key.
 */
interface Gate {
	loopbackOnly: boolean;
	key: () => string;
	port: () => number;
	tailnet: boolean;
}

export type ScanStatus =
	| { state: "idle" }
	| { state: "running"; root: string; startedAt: string; done: number; total: number; current: string | null }
	| { state: "done"; root: string; finishedAt: string }
	| {
			state: "failed";
			root: string;
			finishedAt: string;
			error: string;
			/** The scan ran and found no repository: the folder or the depth is wrong, not the scanners. */
			noRepositories?: boolean;
			/** How many folder levels it looked down. */
			depth?: number;
	  };

/** Fetching repositories from GitHub: one batch at a time, each repository's failure kept beside the rest. */
/** The check of this computer (`cli/src/host/`), run in the background like a scan. */
export type HostStatus =
	| { state: "idle" }
	| { state: "running"; startedAt: string; done: number; total: number; current: string }
	| { state: "done"; finishedAt: string }
	| { state: "failed"; finishedAt: string; error: string };

export type FetchStatus =
	| { state: "idle" }
	| { state: "running"; done: number; total: number; current: string | null; errors: { repo: string; message: string }[] }
	| { state: "done"; finishedAt: string; total: number; errors: { repo: string; message: string }[] };

/** The model judging findings one at a time, in the background. */
export type AnalysisStatus =
	| { state: "idle" }
	| { state: "running"; done: number; total: number; current: string | null; failed: number }
	| { state: "done" | "stopped"; finishedAt: string; done: number; total: number; failed: number; lastError?: string };

const UI_DIR = join(import.meta.dirname, "../../ui");
/** The page's own modules. Nothing else in the folder is served. */
const SCRIPTS = ["app", "api", "dom", "filter", "list", "hints", "generated", "store", "export", "assist", "analysis", "github", "overview", "findings", "roadmap", "repos", "domains", "looks", "appearance", "settings", "models", "model-settings", "access-settings", "send", "send-text", "tracking", "finding-notes", "host", "host-areas", "paths", "investigate"];
const STATIC_FILES: Record<string, { file: string; type: string }> = {
	"/": { file: "index.html", type: "text/html; charset=utf-8" },
	"/styles.css": { file: "styles.css", type: "text/css; charset=utf-8" },
	"/favicon.svg": { file: "favicon.svg", type: "image/svg+xml" },
	...Object.fromEntries(SCRIPTS.map((name) => [`/${name}.js`, { file: `${name}.js`, type: "text/javascript; charset=utf-8" }])),
};

/** Sent on every response. The page loads nothing from anywhere but this server. */
const SECURITY_HEADERS = {
	"content-security-policy":
		"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; " +
		"base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
	"referrer-policy": "no-referrer",
	"cross-origin-resource-policy": "same-origin",
	"cache-control": "no-store",
};

const SESSION_HEADER = "x-porchlight-session";
/** A fixed key guards a page other machines can reach; BoxPilot generates 32 characters. */
export const MIN_KEY_LENGTH = 32;
const KEY_PATTERN = /^[\x21-\x7e]+$/;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);
/** A host name or bracketed IPv6 address, with an optional port. */
const HOST_HEADER_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*|\[[0-9a-f:.]+\])(?::\d{1,5})?$/i;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_DEPTH = 6;
/** Repositories named in a preview of what a scan would cover. The count is always the full one. */
const PREVIEW_NAMES = 60;
/** Findings one analysis run may judge, and how many it judges unless told otherwise. */
const MAX_ANALYSE = 500;
const DEFAULT_ANALYSE = 25;
/** Repositories one fetch may name. */
const MAX_FETCH = 300;
/** Fetched repositories sit two folders down: owner, then repository. */
const GITHUB_DEPTH = 2;
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
/** What the local model can be asked for, one route each. */
const ASSIST_ROUTES = ["finding", "roadmap", "domain", "ask"];

class HttpError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/**
 * Serves the UI and its API on the loopback interface only.
 *
 * A local web server is reachable by every page open in the user's browser,
 * so three checks stand between a hostile page and this API:
 * the Host header must be this server's own address (defeats DNS rebinding),
 * a cross-site Origin is refused, and every API call must carry the session
 * key, which only a page opened from the printed link has.
 *
 * Listening beyond loopback (in a container, behind BoxPilot), people reach the page by whatever
 * name they use, so any well-formed Host is accepted and the fixed key is what guards the API.
 */
export async function startUiServer(options: UiOptions): Promise<UiServer> {
	const listenHost = options.host ?? "127.0.0.1";
	const loopbackOnly = LOOPBACK_HOSTS.has(listenHost);
	if (options.sessionKey !== undefined) checkKey(options.sessionKey);
	if (!loopbackOnly && options.sessionKey === undefined) {
		throw new Error(`Listening on ${listenHost} needs PORCHLIGHT_UI_KEY: a key of at least ${MIN_KEY_LENGTH} characters`);
	}
	const sessionKey = options.sessionKey ?? randomBytes(24).toString("base64url");
	const scan = options.scan ?? scanRepos;
	const github: GithubConfig = options.github ?? { dir: join(dirname(options.reportPath), "github") };
	let status: ScanStatus = { state: "idle" };
	let fetching: FetchStatus = { state: "idle" };
	const analysisPath = join(dirname(options.reportPath), "repo-analysis.json");
	/** The interface's own preferences (the chosen look), kept beside the report. */
	const settingsPath = join(dirname(options.reportPath), "ui-settings.json");
	// Every finished scan is kept, so the page can say what is new and what was fixed since the last one.
	const history = new History(dirname(options.reportPath));
	const notesPath = join(dirname(options.reportPath), "finding-notes.json");
	// Where the owner was, so the app opens there again however it was closed.
	const viewPath = join(dirname(options.reportPath), "ui-view.json");
	// A report from before history was kept starts it, so the next scan has something to compare with.
	await readReport(options.reportPath)
		.then((report) => (report ? history.add(report) : null))
		.catch(() => {});
	let analysing: AnalysisStatus = { state: "idle" };
	let stopAnalysis: AbortController | null = null;
	let port = options.port;
	/** Ollama on a small server answers one request at a time, so this asks it one at a time. */
	let modelBusy = false;
	/** Sends to a model still waiting for an answer, hosted ones included, so quitting can warn about them. */
	let sending = 0;
	const modelPath = join(dirname(options.reportPath), "model-settings.json");
	// The mural for an export, written in the background: a model on a processor takes minutes.
	const muralPath = join(dirname(options.reportPath), "repo-mural.json");
	let muralJob: MuralJob = (await readMural(muralPath)) ?? { state: "idle" };
	// The check of this computer: what it found is kept beside the report, readable only by its owner.
	const hostPath = join(dirname(options.reportPath), "host-check.json");
	const runHostCheck = options.hostCheck ?? ((hostOptions) => checkHost({ run: runCommand, ...hostOptions }));
	let hostStatus: HostStatus = { state: "idle" };
	const startup: ModelInUse = { config: options.assistant ?? null, error: options.assistantError, unset: options.assistantUnset ?? false, source: "startup" };
	/** A key given at start-up for a hosted provider, used for that provider when Settings has none. */
	const startupKeys: Partial<Record<HostedProvider, string>> =
		startup.config && isHosted(startup.config) && startup.config.apiKey ? { [startup.config.provider as HostedProvider]: startup.config.apiKey } : {};
	let savedModel = await readSavedModel(modelPath);
	let model: ModelInUse = savedModel ? inUse(savedModel) : startup;

	function inUse(saved: SavedModel): ModelInUse {
		try {
			const config = configFor(saved, { fallbackKeys: startupKeys });
			return { config, unset: config === null, source: "settings" };
		} catch (err) {
			return { config: null, error: err instanceof Error ? err.message : String(err), unset: false, source: "settings" };
		}
	}

	/** What would be lost by quitting now, in words, so the app can ask first. Empty when nothing is. */
	function busyWork(): string[] {
		const busy: string[] = [];
		if (status.state === "running") busy.push("A scan is running");
		if (fetching.state === "running") busy.push("Repositories are being fetched from GitHub");
		if (analysing.state === "running") busy.push("Deeper analysis is running");
		if (muralJob.state === "running") busy.push("A mural is being written");
		if (hostStatus.state === "running") busy.push("This computer is being checked");
		if (investigation) busy.push(`An investigation of ${investigation.run.domain} is running`);
		if (sending > 0) busy.push("A model is answering what you sent it");
		else if (modelBusy && muralJob.state !== "running" && analysing.state !== "running") busy.push("The model is answering");
		return busy;
	}

	/**
	 * The check of this computer. It only reads (invariant 19). As a service it does not run: in a
	 * container it would describe the container, not the computer the owner cares about.
	 */
	async function hostRoute(res: ServerResponse, route: string, body: unknown): Promise<void> {
		if (route === "GET /api/host") return sendJson(res, 200, { status: hostStatus, report: loopbackOnly ? await readHostReport(hostPath) : null, service: !loopbackOnly });
		if (route !== "POST /api/host/check") throw new HttpError(404, "Not found");
		if (!loopbackOnly) throw new HttpError(409, "Porchlight runs in a container here, so it cannot see the computer it runs on.");
		if (hostStatus.state === "running") throw new HttpError(409, "This computer is already being checked");
		const fields = bodyObject(body);
		for (const name of ["askApple", "lookUpPackages"]) {
			if (fields[name] !== undefined && typeof fields[name] !== "boolean") throw new HttpError(400, `${name} must be true or false`);
		}
		hostStatus = { state: "running", startedAt: new Date().toISOString(), done: 0, total: 0, current: "" };
		// Not awaited: the page polls for progress, as it does for a scan.
		void runHostCheck({
			askApple: fields.askApple !== false,
			lookUpPackages: fields.lookUpPackages !== false,
			onProgress: ({ done, total, current }) => {
				if (hostStatus.state === "running") hostStatus = { ...hostStatus, done, total, current };
			},
		})
			.then(async (report) => {
				await saveHostReport(hostPath, report);
				hostStatus = { state: "done", finishedAt: new Date().toISOString() };
			})
			.catch((err) => {
				hostStatus = { state: "failed", finishedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) };
			});
		return sendJson(res, 202, { status: hostStatus });
	}

	/**
	 * The owner's status and note for one finding of the latest scan. Kept by the finding's identity,
	 * so they carry over to later scans; they never change the finding itself.
	 */
	async function noteRoute(res: ServerResponse, body: unknown): Promise<void> {
		const fields = bodyObject(body);
		const target = {
			repo: textField(fields, "repo", 1000),
			ruleId: textField(fields, "ruleId", 500),
			location: textField(fields, "location", 2000),
			detail: textField(fields, "detail", 2000),
		};
		if (!isStatus(fields.status)) throw new HttpError(400, "Choose a status");
		const note = fields.note ?? "";
		if (typeof note !== "string" || note.length > MAX_NOTE) throw new HttpError(400, `Keep the note to ${MAX_NOTE} characters`);
		const report = await storedReport();
		if (!locateFinding(report, target)) throw new HttpError(404, "That finding is not in the latest scan. Reload the page to see the current one.");
		const key = findingKey(target.repo, target);
		return sendJson(res, 200, { key, note: await setNote(notesPath, key, fields.status, note) });
	}

	function targets() {
		return sendTargets(savedModel, startup.config, startupKeys);
	}

	/**
	 * "Send to a model": the roadmap or the findings, all or what the filters show, to the model the
	 * owner picks, for a deeper analysis or a repair plan. The request names the model by Porchlight's
	 * own id and what to send; the data comes from this server's copy of the report (invariant 13).
	 * The answer is text for the page to show, labelled as generated; nothing acts on it.
	 */
	async function sendRoute(res: ServerResponse, body: unknown): Promise<void> {
		const fields = bodyObject(body);
		const target = targets().find((candidate) => candidate.id === fields.target);
		if (!target) throw new HttpError(400, "Choose one of the models offered. Set one up under Settings → Model");
		if (!(SEND_CONTENTS as readonly unknown[]).includes(fields.content)) throw new HttpError(400, `Choose what to send: ${SEND_CONTENTS.join(" or ")}`);
		if (!(SEND_PURPOSES as readonly unknown[]).includes(fields.purpose)) throw new HttpError(400, `Choose what to ask for: ${SEND_PURPOSES.join(" or ")}`);
		const text = (name: string) => (typeof fields[name] === "string" ? (fields[name] as string) : null);
		const filter = parseFilter({ severity: text("severity"), kind: text("kind"), match: text("q"), repo: text("repo") });
		const report = await storedReport();
		const prompt = sendPrompt(report, {
			content: fields.content as SendContent,
			purpose: fields.purpose as SendPurpose,
			filter,
			cap: target.hosted ? HOSTED_DATA_CAP : DATA_CAP,
		});

		// A hosted provider answers many requests at once; the owner's own model one at a time.
		const local = !target.hosted;
		if (local && modelBusy) throw new HttpError(409, "The local model is still answering another request. Try again when it has finished, or send to a hosted model.");
		if (local) modelBusy = true;
		sending += 1;
		const cancel = new AbortController();
		const onClose = () => {
			if (!res.writableFinished) cancel.abort();
		};
		res.once("close", onClose);
		try {
			const answer = await chat(target.config, prompt.messages, { fetchFn: options.fetchFn, signal: cancel.signal, timeoutMs: SEND_TIMEOUT_MS, maxTokens: SEND_TOKENS });
			const partial = describeFilter(filter);
			sendJson(res, 200, {
				text: answer,
				model: target.config.model,
				label: target.label,
				hosted: target.hosted,
				...(prompt.cut ? { cut: prompt.cut } : {}),
				...(partial ? { partial } : {}),
			});
		} catch (err) {
			if (err instanceof AssistantError) throw new HttpError(err.status, err.message);
			throw err;
		} finally {
			res.off("close", onClose);
			sending -= 1;
			if (local) modelBusy = false;
		}
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

	function assistantSummary() {
		const config = model.config;
		return config
			? { configured: true, model: config.model, host: config.url.host, hosted: isHosted(config) }
			: {
					configured: false,
					error: model.error ?? "No model is connected",
					// No model asked for: the features are off, the usual state rather than a value to correct.
					unset: model.unset,
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

	async function modelRoute(res: ServerResponse, route: string, body: unknown): Promise<void> {
		try {
			if (route === "GET /api/model") return sendJson(res, 200, modelState());
			if (route === "POST /api/model") {
				const next = nextSaved(savedModel, modelRequest(body));
				// Checked before it is saved, so a mistake never replaces a working choice.
				configFor(next, { fallbackKeys: startupKeys });
				await saveModel(modelPath, next);
				savedModel = next;
				model = inUse(next);
				return sendJson(res, 200, modelState());
			}
			if (route === "POST /api/model/startup") {
				await forgetModel(modelPath);
				savedModel = null;
				model = startup;
				return sendJson(res, 200, modelState());
			}
			if (route === "POST /api/model/models") {
				const config = requestedConfig(body, false);
				if (!config) return sendJson(res, 200, { models: [] });
				return sendJson(res, 200, { models: await listModels(config, { fetchFn: options.fetchFn }) });
			}
			if (route === "POST /api/model/test") {
				const config = requestedConfig(body, true);
				if (!config) throw new ModelSettingError("Choose a model first");
				const started = Date.now();
				const text = await chat(config, [{ role: "user", content: "Reply with the single word: ready" }], { fetchFn: options.fetchFn, timeoutMs: 120_000 });
				return sendJson(res, 200, { text: text.slice(0, 200), model: config.model, seconds: Math.round((Date.now() - started) / 100) / 10 });
			}
			throw new HttpError(404, "Not found");
		} catch (err) {
			if (err instanceof ModelSettingError) throw new HttpError(400, err.message);
			if (err instanceof AssistantError) throw new HttpError(err.status, err.message);
			throw err;
		}
	}

	// Access from other devices: a second listener on this machine's Tailscale address only.
	const accessPath = join(dirname(options.reportPath), "access.json");
	const accessPort = options.accessPort ?? DEFAULT_ACCESS_PORT;
	const findTailnet = options.tailnetAddress ?? tailnetAddress;
	let access: AccessFile = (await readAccess(accessPath)) ?? { enabled: false, key: "" };
	let tailnetServer: Server | null = null;
	let accessStatus: AccessStatus = { enabled: access.enabled, listening: false };
	let accessRetry: ReturnType<typeof setInterval> | undefined;
	const tailnetGate: Gate = {
		loopbackOnly: false,
		key: () => access.key,
		port: () => {
			const bound = tailnetServer?.address();
			return bound && typeof bound === "object" ? bound.port : accessPort;
		},
		tailnet: true,
	};

	async function stopAccess(): Promise<void> {
		const closing = tailnetServer;
		tailnetServer = null;
		if (!closing) return;
		await new Promise<void>((done) => {
			closing.close(() => done());
			closing.closeAllConnections();
		});
	}

	/** Listens on the tailnet when access is on, and stops when it is off. Safe to call again to retry. */
	async function applyAccess(): Promise<void> {
		await stopAccess();
		clearInterval(accessRetry);
		accessRetry = undefined;
		if (!access.enabled) {
			accessStatus = { enabled: false, listening: false };
			return;
		}
		const address = findTailnet();
		if (!address) {
			accessStatus = { enabled: true, listening: false, error: "Tailscale is not connected on this Mac. Start Tailscale; Porchlight will keep checking." };
			// Tailscale may come up after Porchlight does.
			accessRetry = setInterval(() => void (findTailnet() ? applyAccess() : undefined), ACCESS_RETRY_MS);
			accessRetry.unref();
			return;
		}
		const listener = createServer(respond(tailnetGate));
		try {
			await new Promise<void>((resolveListen, reject) => {
				listener.once("error", reject);
				listener.listen(accessPort, address, resolveListen);
			});
		} catch (err) {
			const code = (err as { code?: unknown }).code;
			accessStatus = {
				enabled: true,
				listening: false,
				error: code === "EADDRINUSE" ? `Port ${accessPort} on the Tailscale address is taken, perhaps by another copy of Porchlight` : `Could not listen on the Tailscale address (${String(code ?? err)})`,
			};
			return;
		}
		tailnetServer = listener;
		const bound = listener.address();
		const boundPort = bound && typeof bound === "object" ? bound.port : accessPort;
		const name = hostname().toLowerCase().endsWith(".ts.net") ? hostname().toLowerCase() : address;
		accessStatus = { enabled: true, listening: true, url: `http://${name}:${boundPort}` };
	}

	/** On this computer: the status, the address and the key to give another device. Elsewhere: the status alone. */
	function accessState(gate: Gate) {
		const here = !gate.tailnet && gate.loopbackOnly;
		return {
			...accessStatus,
			// Only this computer can change who gets in, and only it is shown the key.
			canChange: here,
			...(here && accessStatus.listening && accessStatus.url ? { link: `${accessStatus.url}/#k=${access.key}` } : {}),
		};
	}

	/** The mural for this scan and these filters: its state, or a request to write it. */
	async function muralRoute(res: ServerResponse, route: string, report: ScanReport, filter: ReturnType<typeof parseFilter>, key: string): Promise<void> {
		const describe = () =>
			muralJob.state === "done"
				? { state: "done", current: muralJob.key === key, model: muralJob.mural.model, generatedAt: muralJob.mural.generatedAt, headline: muralJob.mural.headline }
				: muralJob.state === "failed"
					? { state: "failed", current: muralJob.key === key, error: muralJob.error }
					: { state: muralJob.state, current: muralJob.state === "running" && muralJob.key === key };
		if (route === "GET /api/repos/mural") return sendJson(res, 200, describe());
		if (route !== "POST /api/repos/mural") throw new HttpError(404, "Not found");
		const config = model.config;
		if (!config) throw new HttpError(503, "Choose a model in Settings → Model to write a mural");
		if (muralJob.state === "running") throw new HttpError(409, "A mural is already being written");
		if (analysing.state === "running") throw new HttpError(409, "Deeper analysis is running. Write the mural when it has finished, so it can include it");
		if (modelBusy) throw new HttpError(409, "The model is still answering another request. Try again when it has finished.");

		const roadmap = buildRepoRoadmap(report, filter);
		const analysis = await readAnalysis(analysisPath, report);
		// What was fixed since the previous scan, where this scan could check again: the "done" column's best evidence.
		const change = await history.latestChange(report).catch(() => null);
		const facts = muralFacts(report, roadmap, listRepoFindings(report, filter), analysis, change);
		const prompt = muralPrompt(facts, roadmap, judgedHighlights(report, analysis).slice(0, MURAL_HIGHLIGHTS));
		muralJob = { state: "running", key, startedAt: new Date().toISOString() };
		modelBusy = true;
		void (async () => {
			try {
				// A small model now and then answers with something other than the JSON asked for: it gets one more try.
				let written: ReturnType<typeof parseMural> | undefined;
				for (let attempt = 1; !written; attempt++) {
					const text = await chat(config, prompt.messages, { fetchFn: options.fetchFn, timeoutMs: MURAL_TIMEOUT_MS, maxTokens: MURAL_TOKENS });
					try {
						written = parseMural(text);
					} catch (err) {
						if (attempt >= MURAL_ATTEMPTS || !(err instanceof MuralError)) throw err;
					}
				}
				const mural: Mural = { ...written, model: config.model, generatedAt: new Date().toISOString(), facts, cut: prompt.cut };
				// Kept beside the report, so a later export can use it without writing it again.
				await saveMural(muralPath, { key, mural }).catch(() => {});
				muralJob = { state: "done", key, mural };
			} catch (err) {
				const known = err instanceof AssistantError || err instanceof MuralError;
				muralJob = { state: "failed", key, error: known ? err.message : "The mural could not be written" };
			} finally {
				modelBusy = false;
			}
		})();
		return sendJson(res, 202, describe());
	}

	async function accessRoute(res: ServerResponse, route: string, body: unknown, gate: Gate): Promise<void> {
		if (route === "GET /api/access") return sendJson(res, 200, accessState(gate));
		if (gate.tailnet || !gate.loopbackOnly) throw new HttpError(403, "Access can only be changed on the Mac that runs Porchlight");
		if (route === "POST /api/access") {
			const enabled = bodyObject(body).enabled;
			if (typeof enabled !== "boolean") throw new HttpError(400, "Say whether access is on");
			access = { enabled, key: access.key || newAccessKey() };
			await saveAccess(accessPath, access);
			await applyAccess();
			return sendJson(res, 200, accessState(gate));
		}
		if (route === "POST /api/access/key") {
			// A new key turns away every device that had the old one, including open pages.
			access = { ...access, key: newAccessKey() };
			await saveAccess(accessPath, access);
			await applyAccess();
			return sendJson(res, 200, accessState(gate));
		}
		throw new HttpError(404, "Not found");
	}


	// "Investigate with a model": one run at a time, on a domain whose ownership record holds its token.
	const investigateDir = join(dirname(options.reportPath), "investigations");
	const investigateDomainsPath = join(dirname(options.reportPath), "investigate-domains.json");
	const runStore = new RunStore(investigateDir);
	const investigateNet: Net = options.investigateNet ?? (options.fetchFn ? { ...liveNet, fetch: options.fetchFn } : liveNet);
	let investigation: InvestigationJob | null = null;
	/** Saves run by run, in order, so a slow write never lands after a newer one. */
	let runSaves: Promise<void> = Promise.resolve();

	/** What a run sends to the model, in words, for the page to show before anything is sent. */
	function investigationDisclosure(config: AssistantConfig): string {
		const where = isHosted(config) ? `${HOSTED[config.provider as HostedProvider].name} (${config.url.host}), outside your machines` : `the model at ${config.url.host}`;
		return `Each turn sends ${where}: the domain, your goal, the tool list, the findings so far and the latest results of the tools, which are your site's DNS records and HTTP responses (headers and up to 1 500 characters of each body, with Set-Cookie values left out). It never sends the ownership token, your scans, keys or anything from this computer.`;
	}

	async function investigateDomains() {
		const file = await readDomains(investigateDomainsPath);
		return Object.entries(file.domains)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, entry]) => ({
				name,
				source: entry.source,
				...(entry.verifiedAt ? { verifiedAt: entry.verifiedAt } : {}),
				challenge: { type: "TXT", name: challengeName(name), value: challengeValue(entry.token) },
			}));
	}

	/** A domain from the request that the owner has added, with its token. */
	async function addedDomain(fields: Record<string, unknown>): Promise<{ name: string; token: string }> {
		const name = parseDomain(fields.domain);
		if (!name) throw new HttpError(400, "Type a domain such as example.com");
		const entry = (await readDomains(investigateDomainsPath)).domains[name];
		if (!entry) throw new HttpError(404, `Add ${name} first, and publish its TXT record`);
		return { name, token: entry.token };
	}

	/** True or false from DNS; a lookup that failed is an error, never "verified". */
	async function proveOwnership(name: string, token: string): Promise<boolean> {
		try {
			return await checkOwnership(name, token, options.fetchFn ?? fetch);
		} catch (err) {
			throw new HttpError(502, `Could not ask DNS for the TXT record: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async function currentRun(id: string): Promise<Run | null> {
		if (investigation?.run.id === id) return investigation.run;
		const stored = await runStore.read(id);
		return stored ? settled(stored) : null;
	}

	async function investigateRoute(res: ServerResponse, route: string, url: URL, body: unknown, gate: Gate): Promise<void> {
		// Stopping is always allowed; anything that adds a target or sends a request is for this computer's page only.
		const here = gate.loopbackOnly && !gate.tailnet;
		if (route === "POST /api/investigate/stop") {
			investigation?.stop.abort();
			return sendJson(res, 200, { stopped: investigation !== null });
		}
		if (route === "GET /api/investigate") {
			const config = model.config;
			return sendJson(res, 200, {
				canChange: here,
				domains: await investigateDomains(),
				runs: await runStore.list(),
				active: investigation ? investigation.run : null,
				assistant: assistantSummary(),
				...(config ? { disclosure: investigationDisclosure(config) } : {}),
				monitor: options.monitor !== null,
				tools: INVESTIGATION_TOOLS,
				defaults: { goal: DEFAULT_GOAL, maxTurns: DEFAULT_MAX_TURNS, maxTurnsLimit: MAX_TURNS_LIMIT, minGapMs: options.investigateMinGapMs ?? DEFAULT_MIN_GAP_MS, maxGoal: MAX_GOAL },
			});
		}
		if (route === "GET /api/investigate/run") {
			const id = url.searchParams.get("id");
			const run = isRunId(id) ? await currentRun(id) : null;
			if (!run) throw new HttpError(404, "There is no such investigation");
			return sendJson(res, 200, { run });
		}
		if (route === "GET /api/investigate/export") {
			const id = url.searchParams.get("id");
			const run = isRunId(id) ? await currentRun(id) : null;
			if (!run) throw new HttpError(404, "There is no such investigation");
			const format = url.searchParams.get("format") ?? "md";
			if (!(INVESTIGATION_FORMATS as readonly string[]).includes(format)) throw new HttpError(400, `Choose a format: ${INVESTIGATION_FORMATS.join(" or ")}`);
			return sendDownload(res, exportInvestigation(run, format as InvestigationFormat));
		}
		if (!here) throw new HttpError(403, "Investigations are run from the page on the Mac that runs Porchlight");
		const fields = bodyObject(body);

		if (route === "POST /api/investigate/domains") {
			const name = parseDomain(fields.domain);
			if (!name) throw new HttpError(400, "Type a domain such as example.com");
			const file = await readDomains(investigateDomainsPath);
			if (!file.domains[name]) {
				// When the monitor already watches this domain, its record serves here too.
				let token: string | null = null;
				if (options.monitor) {
					const answer = await callMonitor(options.monitor, "GET", `/domains/${encodeURIComponent(name)}`, undefined, options.fetchFn).catch(() => null);
					if (answer?.status === 200) token = tokenFromChallenge(answer.body?.domain?.challenge?.value);
				}
				file.domains[name] = { token: token ?? newToken(), addedAt: new Date().toISOString(), source: token ? "monitor" : "local" };
				await saveDomains(investigateDomainsPath, file);
			}
			return sendJson(res, 200, { domains: await investigateDomains() });
		}
		if (route === "POST /api/investigate/domains/remove") {
			const name = parseDomain(fields.domain);
			if (!name) throw new HttpError(400, "Type a domain such as example.com");
			if (investigation?.run.domain === name) throw new HttpError(409, "Stop the investigation of this domain first");
			const file = await readDomains(investigateDomainsPath);
			delete file.domains[name];
			await saveDomains(investigateDomainsPath, file);
			return sendJson(res, 200, { domains: await investigateDomains() });
		}
		if (route === "POST /api/investigate/verify") {
			const { name, token } = await addedDomain(fields);
			const verified = await proveOwnership(name, token);
			if (verified) {
				const file = await readDomains(investigateDomainsPath);
				const entry = file.domains[name];
				if (entry) {
					entry.verifiedAt = new Date().toISOString();
					await saveDomains(investigateDomainsPath, file);
				}
			}
			return sendJson(res, 200, { verified, domains: await investigateDomains() });
		}
		if (route === "POST /api/investigate/approve") {
			const active = investigation;
			if (!active || active.run.id !== fields.run || !active.approval || active.approval.stepId !== fields.step) {
				throw new HttpError(409, "That action is no longer waiting for approval");
			}
			if (typeof fields.approve !== "boolean") throw new HttpError(400, "Say whether to approve");
			const { resolve: answer } = active.approval;
			active.approval = null;
			answer(fields.approve);
			return sendJson(res, 200, { approved: fields.approve });
		}
		if (route === "POST /api/investigate/finding") {
			if (!isRunId(fields.run)) throw new HttpError(400, "Name the investigation");
			const status = fields.status;
			if (status !== "open" && status !== "accepted" && status !== "dismissed") throw new HttpError(400, "Choose accepted, dismissed or open");
			const run = await currentRun(fields.run);
			const finding = run?.findings.find((item) => item.id === fields.finding);
			if (!run || !finding) throw new HttpError(404, "That finding is not in this investigation");
			finding.status = status;
			if (investigation?.run !== run) await runStore.save(run);
			else await saveActive(run);
			return sendJson(res, 200, { finding });
		}
		if (route !== "POST /api/investigate/start") throw new HttpError(404, "Not found");

		const config = model.config;
		if (!config) throw new HttpError(503, model.error ?? "No model is connected. Choose one in Settings → Model");
		if (investigation) throw new HttpError(409, `An investigation of ${investigation.run.domain} is already running. Stop it first`);
		const { name, token } = await addedDomain(fields);
		const goal = fields.goal === undefined || fields.goal === "" ? DEFAULT_GOAL : fields.goal;
		if (typeof goal !== "string" || goal.trim() === "" || goal.length > MAX_GOAL) throw new HttpError(400, `Write a goal of 1 to ${MAX_GOAL} characters`);
		const maxTurns = fields.maxTurns ?? DEFAULT_MAX_TURNS;
		if (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > MAX_TURNS_LIMIT) throw new HttpError(400, `Choose 1 to ${MAX_TURNS_LIMIT} turns`);
		const hosted = isHosted(config);
		// The page shows what will be sent; a hosted model is used only once the owner has said yes to it.
		if (hosted && fields.sendsToHosted !== true) throw new HttpError(409, investigationDisclosure(config));
		if (!(await proveOwnership(name, token))) {
			throw new HttpError(409, `The TXT record ${challengeName(name)} does not hold ${challengeValue(token)} yet. Publish it, wait a few minutes, and check again`);
		}

		const run = newRun({ domain: name, goal: goal.trim(), model: config.model, modelHost: config.url.host, hosted, maxTurns, minGapMs: options.investigateMinGapMs ?? DEFAULT_MIN_GAP_MS });
		const stop = new AbortController();
		const active: InvestigationJob = { run, stop, approval: null };
		investigation = active;
		await saveActive(run);
		// Not awaited: the run outlives this request and the page polls for progress.
		void investigate(run, {
			ask: async (system, user, signal) => {
				const local = !hosted;
				// The owner's own model answers one request at a time; Explain and Ask wait their turn.
				while (local && modelBusy && !signal.aborted) await abortableSleep(500, signal);
				if (local) modelBusy = true;
				try {
					return await chat(config, [{ role: "system", content: system }, { role: "user", content: user }], { fetchFn: options.fetchFn, signal, timeoutMs: INVESTIGATE_TIMEOUT_MS, maxTokens: INVESTIGATE_TOKENS });
				} finally {
					if (local) modelBusy = false;
				}
			},
			net: investigateNet,
			verify: async (signal) => {
				// Read again each time: a domain removed from the list is no longer proven.
				const entry = (await readDomains(investigateDomainsPath)).domains[name];
				return entry !== undefined && entry.token === token && (await checkOwnership(name, token, options.fetchFn ?? fetch, signal));
			},
			approve: (request, signal) =>
				new Promise<boolean>((resolveApproval) => {
					const done = (approved: boolean) => {
						signal.removeEventListener("abort", abort);
						if (active.approval?.stepId === request.stepId) active.approval = null;
						resolveApproval(approved);
					};
					const abort = () => done(false);
					if (signal.aborted) return done(false);
					signal.addEventListener("abort", abort, { once: true });
					active.approval = { stepId: request.stepId, resolve: done };
				}),
			limiter: new RateLimiter(run.minGapMs),
			onChange: (changed) => saveActive(changed),
		}, stop.signal)
			.catch(() => {})
			.finally(async () => {
				await runSaves;
				if (investigation === active) investigation = null;
				await runStore.prune().catch(() => {});
			});
		return sendJson(res, 202, { run });
	}

	function saveActive(run: Run): Promise<void> {
		runSaves = runSaves.then(() => runStore.save(run)).catch((err) => console.error(`porchlight ui: could not save the investigation: ${err instanceof Error ? err.message : String(err)}`));
		return runSaves;
	}

	const localGate: Gate = { loopbackOnly, key: () => sessionKey, port: () => port, tailnet: false };
	const respond = (gate: Gate) => (req: IncomingMessage, res: ServerResponse) => {
		handle(req, res, gate).catch((err) => {
			// An export that cannot be made is the caller's mistake, and the message says what to change.
			const known = err instanceof HttpError || err instanceof ExportError;
			if (!known) console.error(`porchlight ui: ${err instanceof Error ? err.message : String(err)}`);
			sendJson(res, err instanceof HttpError ? err.status : known ? 400 : 500, { error: known ? err.message : "Internal error" });
		});
	};
	const server = createServer(respond(localGate));

	async function handle(req: IncomingMessage, res: ServerResponse, gate: Gate): Promise<void> {
		const host = req.headers.host ?? "";
		if (!hostAllowed(host, gate.port(), gate.loopbackOnly)) throw new HttpError(403, "Forbidden host");
		const url = new URL(req.url ?? "/", `http://${host}`);

		// For container health checks: says only that the server is up.
		if (url.pathname === "/healthz") {
			if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
			res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" });
			res.end("ok\n");
			return;
		}

		if (!url.pathname.startsWith("/api/")) {
			if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
			const entry = STATIC_FILES[url.pathname];
			if (!entry) throw new HttpError(404, "Not found");
			res.writeHead(200, { ...SECURITY_HEADERS, "content-type": entry.type });
			res.end(await readFile(join(UI_DIR, entry.file)));
			return;
		}

		if (!originAllowed(req.headers.origin, host, gate.loopbackOnly)) throw new HttpError(403, "Cross-site request refused");
		// Says where the reader's key is kept: a service's settings, or the Mac's Settings for another device.
		if (!sessionMatches(req.headers[SESSION_HEADER], gate.key())) {
			return sendJson(res, 401, { error: "Session key required", service: !gate.loopbackOnly && !gate.tailnet, tailnet: gate.tailnet });
		}

		const body = req.method === "POST" ? await readJsonBody(req) : undefined;
		const route = `${req.method} ${url.pathname}`;

		if (route === "GET /api/state") {
			return sendJson(res, 200, {
				defaultRoot: options.defaultRoot,
				reportPath: options.reportPath,
				scan: status,
				appearance: await readAppearance(settingsPath),
				// A service (a container, under BoxPilot) is configured where it is managed, not from a shell,
				// so the page explains connecting the monitor in those terms.
				service: !loopbackOnly,
				// Opened from another device over the tailnet, rather than on this computer.
				remote: gate.tailnet,
				// The computer Porchlight runs on, so the page can call it "This Mac".
				platform: process.platform,
				monitor: options.monitor
					? { configured: true, host: options.monitor.url.host }
					: {
							configured: false,
							error: options.monitorError ?? "The monitor is not configured",
							// Neither setting given: the usual state of a fresh install, as opposed to a value to correct.
							unset: options.monitorUnset ?? false,
						},
				// Whether a token is set, never the token.
				github: { token: github.token !== undefined, ...(options.githubError ? { error: options.githubError } : {}) },
				assistant: assistantSummary(),
				lastView: await readView(viewPath),
				// What "Send to a model" offers. Never a key: only where each one runs and which model.
				sendTargets: targets().map((target) => ({ id: target.id, label: target.label, model: target.config.model, host: target.config.url.host, hosted: target.hosted, current: target.current })),
			});
		}
		if (route === "POST /api/repos/send") return sendRoute(res, body);
		if (url.pathname === "/api/host" || url.pathname === "/api/host/check") return hostRoute(res, route, body);
		if (url.pathname === "/api/investigate" || url.pathname.startsWith("/api/investigate/")) return investigateRoute(res, route, url, body, gate);
		if (route === "GET /api/repos/history") {
			const report = await readReport(options.reportPath);
			const scans = (await history.list()).reverse();
			return sendJson(res, 200, { scans, change: report ? await history.latestChange(report) : null });
		}
		if (route === "POST /api/findings/note") return noteRoute(res, body);
		if (route === "GET /api/busy") return sendJson(res, 200, { busy: busyWork() });
		if (route === "POST /api/view") {
			const view = bodyObject(body).view;
			// A place in the page, with its filters; never the session key, which lives only in the fragment it came in.
			if (typeof view !== "string" || !/^#\/[^\s]{0,1000}$/.test(view) || /(?:^|[#&?])k=/.test(view)) throw new HttpError(400, "Not a place in the page");
			await saveView(viewPath, view);
			return sendJson(res, 200, { view });
		}
		if (route === "POST /api/settings") {
			const appearance = (body as { appearance?: unknown } | undefined)?.appearance;
			if (!isLook(appearance)) throw new HttpError(400, "Unknown appearance");
			await saveAppearance(settingsPath, appearance as string);
			return sendJson(res, 200, { appearance });
		}
		if (url.pathname === "/api/model" || url.pathname.startsWith("/api/model/")) return modelRoute(res, route, body);
		if (url.pathname === "/api/access" || url.pathname.startsWith("/api/access/")) return accessRoute(res, route, body, gate);
		if (url.pathname.startsWith("/api/assist/")) return assist(req, res, url.pathname.slice("/api/assist/".length), body);
		if (route === "GET /api/repos/report") return sendJson(res, 200, { ...(await loadReport(options.reportPath, analysisPath)), findingNotes: await readNotes(notesPath) });
		if (url.pathname === "/api/analysis" || url.pathname === "/api/analysis/stop") return analysisRoute(res, route, body);
		if (route === "GET /api/repos/roadmap" || route === "GET /api/repos/export" || url.pathname === "/api/repos/mural") {
			const report = await readReport(options.reportPath);
			if (!report) throw new HttpError(404, "There is no scan yet. Scan a folder first.");
			const query = url.searchParams;
			const filter = parseFilter({ severity: query.get("severity"), kind: query.get("kind"), match: query.get("q"), repo: query.get("repo") });
			if (route === "GET /api/repos/roadmap") return sendJson(res, 200, { roadmap: buildRepoRoadmap(report, filter) });
			const key = muralKey(report, filter);
			if (url.pathname === "/api/repos/mural") return muralRoute(res, route, report, filter, key);
			let mural: Mural | undefined;
			if (query.get("mural") === "1") {
				if (muralJob.state !== "done" || muralJob.key !== key) throw new HttpError(409, "Write the mural first: it is made for this scan and these filters");
				mural = muralJob.mural;
			}
			return sendDownload(res, exportRepos(report, exportChoice(query), filter, mural));
		}
		if (route === "GET /api/repos/scan") return sendJson(res, 200, { scan: status });
		if (route === "GET /api/repos/preview") {
			return sendJson(res, 200, { preview: await previewScan(url.searchParams.get("root") ?? options.defaultRoot, url.searchParams.get("depth"), github.dir) });
		}
		if (url.pathname === "/api/github" || url.pathname.startsWith("/api/github/")) return githubRoute(res, route, url, body);
		if (route === "POST /api/repos/scan") {
			if (status.state === "running") throw new HttpError(409, "A scan is already running");
			// A repository half fetched is not one to scan.
			if (fetching.state === "running") throw new HttpError(409, "Repositories are still being fetched from GitHub. Scan when that has finished.");
			if (analysing.state === "running") throw new HttpError(409, "The model is still analysing the last scan. Stop that first, or wait for it to finish.");
			const { root, depth } = await scanRequest(body);
			const also = (await fetchedRepos(github.dir)).length > 0 ? [{ root: github.dir, depth: GITHUB_DEPTH }] : undefined;
			status = { state: "running", root, startedAt: new Date().toISOString(), done: 0, total: 0, current: null };
			// Not awaited: the scan outlives this request and the UI polls for progress.
			void scan({
				root,
				depth,
				...(also ? { also } : {}),
				onProgress: ({ done, total, path }) => {
					if (status.state === "running") status = { ...status, done, total, current: nameUnder(root, also?.map((other) => other.root), path) };
				},
			})
				.then(async (report) => {
					if (report.repos.length === 0) {
						const error = `No git repositories found under ${root}`;
						status = { state: "failed", root, finishedAt: new Date().toISOString(), error, noRepositories: true, depth };
						return;
					}
					// A scan that checked nothing must not replace one that did.
					if (report.tools.every((tool) => tool.status === "missing")) {
						const error = `No scanner is installed. Install one: ${report.tools.map((tool) => tool.installHint).join("; ")}`;
						status = { state: "failed", root, finishedAt: new Date().toISOString(), error };
						return;
					}
					await saveReport(options.reportPath, report);
					await history.add(report).catch((err) => console.error(`porchlight ui: could not keep the scan in history: ${err instanceof Error ? err.message : String(err)}`));
					status = { state: "done", root, finishedAt: new Date().toISOString() };
				})
				.catch((err) => {
					const error = err instanceof Error ? err.message : String(err);
					status = { state: "failed", root, finishedAt: new Date().toISOString(), error };
				});
			return sendJson(res, 202, { scan: status });
		}

		const domainExport = /^\/api\/domains\/([^/]+)\/export$/.exec(url.pathname);
		if (domainExport) {
			if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
			const [code, answer] = await proxyToMonitor("GET", `/api/domains/${domainExport[1]}`, undefined);
			const report = (answer as { report?: MonitorReport | null }).report;
			if (code !== 200) throw new HttpError(code, (answer as { error?: string }).error ?? "The monitor refused the request");
			if (!report) throw new HttpError(404, "This domain has not been scanned yet, so there is nothing to export.");
			return sendDownload(res, exportDomain(report, exportChoice(url.searchParams)));
		}
		if (url.pathname === "/api/domains" || url.pathname.startsWith("/api/domains/")) {
			const [code, answer] = await proxyToMonitor(req.method ?? "GET", url.pathname, body);
			return sendJson(res, code, withSuggestions(answer));
		}
		throw new HttpError(404, "Not found");
	}

	/**
	 * The model as a step of the analysis: judges findings from the stored report, worst first, one
	 * at a time, saving each judgement as it arrives so a stop or a restart loses nothing. What it
	 * reads is built here from this server's own copy of the report and the repository's files.
	 */
	async function analysisRoute(res: ServerResponse, route: string, body: unknown): Promise<void> {
		if (route === "POST /api/analysis/stop") {
			stopAnalysis?.abort();
			return sendJson(res, 200, { status: analysing });
		}
		if (route === "GET /api/analysis") {
			const report = await readReport(options.reportPath);
			if (!report) return sendJson(res, 200, { status: analysing, summary: null });
			const stored = await readAnalysis(analysisPath, report);
			const units = unitsOf(report);
			const waiting = Object.fromEntries(SEVERITIES.map((severity) => [severity, 0])) as Record<Severity, number>;
			const verdicts = Object.fromEntries(VERDICTS.map((verdict) => [verdict, 0]));
			for (const unit of units) {
				const judged = stored.items[unit.key];
				if (judged) verdicts[judged.verdict] = (verdicts[judged.verdict] ?? 0) + 1;
				else waiting[unit.severity]++;
			}
			return sendJson(res, 200, { status: analysing, summary: { items: units.length, judged: units.length - Object.values(waiting).reduce((sum, count) => sum + count, 0), waiting, verdicts } });
		}
		if (route !== "POST /api/analysis") throw new HttpError(404, "Not found");

		const assistant = model.config;
		if (!assistant) throw new HttpError(503, model.error ?? "No model is connected. Choose one in Settings → Model");
		if (analysing.state === "running") throw new HttpError(409, "The analysis is already running");
		if (status.state === "running") throw new HttpError(409, "A scan is running. Analyse when it has finished.");
		const fields = bodyObject(body);
		const limit = fields.limit ?? DEFAULT_ANALYSE;
		if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_ANALYSE) throw new HttpError(400, `Choose how many to analyse, from 1 to ${MAX_ANALYSE}`);
		const severities = fields.severities ?? ["critical", "high"];
		if (!Array.isArray(severities) || severities.length === 0 || !severities.every((severity) => SEVERITIES.includes(severity as Severity))) {
			throw new HttpError(400, "Severities must be some of: critical, high, medium, low");
		}
		const report = await storedReport();
		const stored = await readAnalysis(analysisPath, report);
		const queue = unitsOf(report)
			.filter((unit) => !stored.items[unit.key] && severities.includes(unit.severity))
			.slice(0, limit);
		if (queue.length === 0) throw new HttpError(409, "Nothing is waiting to be analysed at those severities");

		const stop = new AbortController();
		stopAnalysis = stop;
		analysing = { state: "running", done: 0, total: queue.length, current: null, failed: 0 };
		// Not awaited: the analysis outlives this request and the page polls for progress.
		void (async () => {
			let done = 0;
			let failed = 0;
			let lastError: string | undefined;
			for (const unit of queue) {
				if (stop.signal.aborted) break;
				analysing = { state: "running", done, total: queue.length, current: `${unit.repoName}: ${unit.kind === "vulnerability" ? unit.findings[0]?.detail : unit.findings[0]?.location}`, failed };
				// Explain and Ask share the one model; whichever asked first finishes first.
				while (modelBusy && !stop.signal.aborted) await new Promise((resolveWait) => setTimeout(resolveWait, 500));
				if (stop.signal.aborted) break;
				modelBusy = true;
				try {
					stored.items[unit.key] = await judge(report, unit, assistant, { fetchFn: options.fetchFn, signal: stop.signal });
					await saveAnalysis(analysisPath, stored);
				} catch (err) {
					if (stop.signal.aborted) break;
					failed++;
					lastError = err instanceof Error ? err.message : String(err);
					// A model that cannot be reached, or a key it refuses, will fail every item the same way.
					if (failed >= 3 && done === 0) break;
				} finally {
					modelBusy = false;
				}
				done++;
			}
			analysing = { state: stop.signal.aborted ? "stopped" : "done", finishedAt: new Date().toISOString(), done: done - failed, total: queue.length, failed, ...(lastError ? { lastError } : {}) };
		})();
		return sendJson(res, 202, { status: analysing });
	}

	/**
	 * Repositories on GitHub: which can be fetched, fetching them, and removing a fetched one. The
	 * token is used here and never reaches the browser; the page only learns whether one is set.
	 */
	async function githubRoute(res: ServerResponse, route: string, url: URL, body: unknown): Promise<void> {
		try {
			if (route === "GET /api/github") {
				return sendJson(res, 200, { token: github.token !== undefined, fetched: await fetchedRepos(github.dir), job: fetching });
			}
			if (route === "GET /api/github/repos") {
				const owner = url.searchParams.get("owner")?.trim() || undefined;
				if (owner !== undefined && !validOwner(owner)) throw new HttpError(400, "That is not a GitHub account name. Type the name alone, such as octocat.");
				return sendJson(res, 200, { repos: await listRepos(github, owner, options.fetchFn) });
			}
			if (route === "POST /api/github/fetch") {
				if (fetching.state === "running") throw new HttpError(409, "Repositories are already being fetched");
				if (status.state === "running") throw new HttpError(409, "A scan is running. Fetch when it has finished.");
				const fields = bodyObject(body);
				const names = fields.all === true ? await fetchedRepos(github.dir) : fields.repos;
				if (!Array.isArray(names) || names.length === 0 || names.length > MAX_FETCH || !names.every((name) => typeof name === "string" && parseRepoName(name))) {
					throw new HttpError(400, `Choose 1 to ${MAX_FETCH} repositories, each named owner/repository`);
				}
				const wanted = [...new Set(names as string[])];
				fetching = { state: "running", done: 0, total: wanted.length, current: null, errors: [] };
				// Not awaited: fetching outlives this request and the page polls for progress.
				void (async () => {
					const errors: { repo: string; message: string }[] = [];
					for (const [index, repo] of wanted.entries()) {
						fetching = { state: "running", done: index, total: wanted.length, current: repo, errors };
						try {
							await fetchRepo(github, repo, options.run);
						} catch (err) {
							errors.push({ repo, message: err instanceof Error ? err.message : String(err) });
						}
					}
					fetching = { state: "done", finishedAt: new Date().toISOString(), total: wanted.length, errors };
				})();
				return sendJson(res, 202, { job: fetching });
			}
			if (route === "DELETE /api/github/fetched") {
				if (fetching.state === "running" || status.state === "running") throw new HttpError(409, "Wait for the fetch or scan that is running to finish");
				const name = url.searchParams.get("repo") ?? "";
				if (!parseRepoName(name)) throw new HttpError(400, "Name the repository as owner/repository");
				await removeFetched(github.dir, name);
				return sendJson(res, 200, { fetched: await fetchedRepos(github.dir) });
			}
		} catch (err) {
			if (err instanceof GithubError) throw new HttpError(err.status, err.message);
			throw err;
		}
		throw new HttpError(404, "Not found");
	}

	/**
	 * Asks the local model about what the page shows: a finding, the roadmap, a domain's latest scan,
	 * or a question about the stored report. The data comes from this server's own copy, never from
	 * the request, so the page names what to explain and cannot supply what the model reads.
	 */
	async function assist(req: IncomingMessage, res: ServerResponse, kind: string, body: unknown): Promise<void> {
		if (!ASSIST_ROUTES.includes(kind)) throw new HttpError(404, "Not found");
		if (req.method !== "POST") throw new HttpError(405, "Method not allowed");
		const assistant = model.config;
		if (!assistant) throw new HttpError(503, model.error ?? "No model is connected. Choose one in Settings → Model");
		const fields = bodyObject(body);

		let prompt: Prompt;
		if (kind === "domain") {
			prompt = domainPrompt(await latestDomainReport(domainField(fields)));
		} else if (kind === "ask") {
			const question = fields.question;
			if (typeof question !== "string" || question.trim() === "" || question.length > MAX_QUESTION) {
				throw new HttpError(400, `Ask a question of 1 to ${MAX_QUESTION} characters`);
			}
			prompt = askPrompt(await storedReport(), question);
		} else if (kind === "finding") {
			const target = {
				repo: textField(fields, "repo", 1000),
				ruleId: textField(fields, "ruleId", 500),
				location: textField(fields, "location", 2000),
				detail: fields.detail === undefined ? undefined : textField(fields, "detail", 2000),
			};
			const report = await storedReport();
			const found = locateFinding(report, target);
			if (!found) throw new HttpError(404, "That finding is not in the latest scan. Reload the page to see the current one.");
			prompt = findingPrompt(report, found.repo, found.finding);
		} else {
			prompt = roadmapPrompt(await storedReport());
		}

		if (modelBusy) throw new HttpError(409, "The model is still answering another request. Try again when it has finished.");
		modelBusy = true;
		// A page that is closed stops waiting, so Ollama stops working on an answer nobody will read.
		const cancel = new AbortController();
		const onClose = () => {
			if (!res.writableFinished) cancel.abort();
		};
		res.once("close", onClose);
		try {
			const text = await chat(assistant, prompt.messages, { fetchFn: options.fetchFn, signal: cancel.signal });
			sendJson(res, 200, { text, model: assistant.model, ...(prompt.cut ? { cut: prompt.cut } : {}) });
		} catch (err) {
			if (err instanceof AssistantError) throw new HttpError(err.status, err.message);
			throw err;
		} finally {
			res.off("close", onClose);
			modelBusy = false;
		}
	}

	async function storedReport(): Promise<ScanReport> {
		const report = await readReport(options.reportPath);
		if (!report) throw new HttpError(404, "There is no scan yet. Scan a folder first.");
		return report;
	}

	/** The latest scan report of a domain, read from the monitor. The admin token is added here and never leaves this process. */
	async function latestDomainReport(domain: string): Promise<MonitorReport & Record<string, unknown>> {
		if (!options.monitor) throw new HttpError(503, options.monitorError ?? "The monitor is not configured");
		let answer: { status: number; body: Record<string, unknown> };
		try {
			answer = await callMonitor(options.monitor, "GET", `/domains/${encodeURIComponent(domain)}`, undefined, options.fetchFn);
		} catch (err) {
			throw new HttpError(502, `Could not reach the monitor: ${err instanceof Error ? err.message : String(err)}`);
		}
		const error = typeof answer.body.error === "string" ? answer.body.error : `The monitor answered HTTP ${answer.status}`;
		// Only "not there" passes through; anything else is the monitor's problem, not the page's.
		if (answer.status === 404) throw new HttpError(404, error);
		if (answer.status >= 400) throw new HttpError(502, `The monitor refused the request: ${error}`);
		const report = answer.body.report;
		if (!report || typeof report !== "object") throw new HttpError(404, `${domain} has not been scanned yet, so there is nothing to explain.`);
		return report as MonitorReport & Record<string, unknown>;
	}

	/** Forwards a domains call to the monitor. The admin token is added here and never reaches the browser. */
	async function proxyToMonitor(method: string, pathname: string, body: unknown): Promise<[number, unknown]> {
		if (!options.monitor) throw new HttpError(503, options.monitorError ?? "The monitor is not configured");
		const [name, action, ...extra] = pathname.split("/").slice(3);
		let target: string;
		if (name === undefined) {
			if (method !== "GET" && method !== "POST") throw new HttpError(405, "Method not allowed");
			target = "/domains";
		} else {
			const domain = safeDecode(name).toLowerCase();
			if (!DOMAIN_PATTERN.test(domain) || extra.length > 0) throw new HttpError(400, "Invalid domain name");
			if (action === undefined) {
				if (method !== "GET" && method !== "DELETE") throw new HttpError(405, "Method not allowed");
			} else if (method !== "POST" || (action !== "verify" && action !== "scan")) {
				throw new HttpError(404, "Not found");
			}
			target = `/domains/${encodeURIComponent(domain)}${action ? `/${action}` : ""}`;
		}
		try {
			const sendBody = method === "POST" && name === undefined ? body : undefined;
			const response = await callMonitor(options.monitor, method, target, sendBody, options.fetchFn);
			return [response.status, response.body];
		} catch (err) {
			throw new HttpError(502, `Could not reach the monitor: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	await new Promise<void>((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(options.port, listenHost, resolveListen);
	});
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("Could not determine the server port");
	port = address.port;
	// Only beside a page on this computer: a service is reached however it is deployed.
	if (loopbackOnly) await applyAccess();
	else access = { enabled: false, key: "" };

	return {
		port,
		sessionKey,
		model: () => model,
		access: () => accessStatus,
		url: `http://127.0.0.1:${port}/#k=${sessionKey}`,
		close: async () => {
			investigation?.stop.abort();
			clearInterval(accessRetry);
			await stopAccess();
			await new Promise<void>((resolveClose) => {
				server.close(() => resolveClose());
				server.closeAllConnections();
			});
		},
	};
}

/** Refuses a fixed key that is too short to guard a page, or that cannot travel in a header. */
export function checkKey(key: string): void {
	if (key.length < MIN_KEY_LENGTH || !KEY_PATTERN.test(key)) {
		throw new Error(`PORCHLIGHT_UI_KEY must be at least ${MIN_KEY_LENGTH} characters, with no spaces or control characters`);
	}
}

/** A mural reads at most this many findings the model judged real, most severe first. */
const MURAL_HIGHLIGHTS = 40;
/** Tries at a mural whose answer is not the JSON asked for, before saying so. */
const MURAL_ATTEMPTS = 2;
/** Room for about 20 short points as JSON. */
const MURAL_TOKENS = 1_500;
/** A repair plan is longer than an explanation; this is what a local model may write for one. */
const SEND_TOKENS = 3_000;
/** A model on a processor writing 3 000 tokens at a few a second takes many minutes. */
const SEND_TIMEOUT_MS = 1_200_000;
/** A 9B model on a processor reads the prompt and writes the mural in a few minutes. */
const MURAL_TIMEOUT_MS = 900_000;
/** One investigation turn: a short JSON answer, though a model on a processor still takes a while. */
const INVESTIGATE_TIMEOUT_MS = 300_000;
const INVESTIGATE_TOKENS = 1_500;

type MuralJob =
	| { state: "idle" }
	| { state: "running"; key: string; startedAt: string }
	| { state: "done"; key: string; mural: Mural }
	| { state: "failed"; key: string; error: string };

/** A mural is for one scan and one filter; a new scan or other filters need a new one. */
function muralKey(report: ScanReport, filter: ReturnType<typeof parseFilter>): string {
	return `${report.scannedAt}\n${JSON.stringify(filter)}`;
}

async function readMural(path: string): Promise<MuralJob | null> {
	try {
		const saved = JSON.parse(await readFile(path, "utf8")) as { key?: unknown; mural?: Mural };
		return typeof saved.key === "string" && saved.mural ? { state: "done", key: saved.key, mural: saved.mural } : null;
	} catch {
		return null;
	}
}

/** It names repositories and findings, like the report, so only its owner can read it. */
async function saveMural(path: string, job: { key: string; mural: Mural }): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify({ key: job.key, mural: job.mural }, null, "\t")}\n`, { mode: 0o600 });
	await rename(temporary, path);
}

const DEFAULT_ACCESS_PORT = 4747;
const ACCESS_RETRY_MS = 30_000;

interface AccessFile {
	enabled: boolean;
	key: string;
}

/** Long enough to guard a page reachable from other machines, like PORCHLIGHT_UI_KEY. */
function newAccessKey(): string {
	return randomBytes(32).toString("base64url");
}

async function readAccess(path: string): Promise<AccessFile | null> {
	try {
		const saved = JSON.parse(await readFile(path, "utf8")) as Partial<AccessFile>;
		if (typeof saved.enabled !== "boolean" || typeof saved.key !== "string") return null;
		// A key too short to guard the page is replaced, never used.
		return { enabled: saved.enabled, key: saved.key.length >= MIN_KEY_LENGTH && KEY_PATTERN.test(saved.key) ? saved.key : newAccessKey() };
	} catch {
		return null;
	}
}

/** Holds the access key, so only its owner can read it. */
async function saveAccess(path: string, access: AccessFile): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(access, null, "\t")}\n`, { mode: 0o600 });
	await chmod(temporary, 0o600);
	await rename(temporary, path);
}

/** This machine's Tailscale IPv4 address (100.64.0.0/10), or null when Tailscale is not up. */
export function tailnetAddress(): string | null {
	for (const addresses of Object.values(networkInterfaces())) {
		for (const entry of addresses ?? []) {
			if (entry.family !== "IPv4" || entry.internal) continue;
			const [a, b] = entry.address.split(".").map(Number);
			if (a === 100 && b !== undefined && b >= 64 && b <= 127) return entry.address;
		}
	}
	return null;
}

/**
 * On loopback, only the server's own loopback names, which defeats DNS rebinding. Beyond it, any
 * well-formed name: people reach the page by a Tailscale name or a LAN address.
 */
export function hostAllowed(host: string, port: number, loopbackOnly: boolean): boolean {
	if (loopbackOnly) return host === `127.0.0.1:${port}` || host === `localhost:${port}`;
	return HOST_HEADER_PATTERN.test(host);
}

/**
 * A cross-site Origin is refused. Beyond loopback, an HTTPS proxy such as Tailscale Serve sits in
 * front, so the browser's scheme differs from this server's and only the host part is compared.
 */
export function originAllowed(origin: string | undefined, host: string, loopbackOnly: boolean): boolean {
	if (origin === undefined) return true;
	if (loopbackOnly) return origin === `http://${host}`;
	try {
		return new URL(origin).host === host.toLowerCase();
	} catch {
		return false;
	}
}

/** A request body as named fields. No body counts as none given. */
function bodyObject(body: unknown): Record<string, unknown> {
	if (body === undefined) return {};
	if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "Body must be a JSON object");
	return body as Record<string, unknown>;
}

function textField(fields: Record<string, unknown>, name: string, max: number): string {
	const value = fields[name];
	if (typeof value !== "string" || value === "" || value.length > max) throw new HttpError(400, `${name} must be text of 1 to ${max} characters`);
	return value;
}

function domainField(fields: Record<string, unknown>): string {
	const domain = typeof fields.domain === "string" ? fields.domain.trim().toLowerCase() : "";
	if (!DOMAIN_PATTERN.test(domain)) throw new HttpError(400, "Invalid domain name");
	return domain;
}

function safeDecode(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return "";
	}
}

function sessionMatches(presented: string | string[] | undefined, expected: string): boolean {
	// No key set means nobody gets in, never that anybody does.
	if (typeof presented !== "string" || expected === "") return false;
	const a = Buffer.from(presented);
	const b = Buffer.from(expected);
	return a.length === b.length && timingSafeEqual(a, b);
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
	if (res.headersSent) return;
	res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}

/** Sends a file to save. Its name is built from a fixed stem and a date, never from request input. */
interface InvestigationJob {
	run: Run;
	stop: AbortController;
	/** The action waiting for the owner, and how to answer it. */
	approval: { stepId: string; resolve: (approved: boolean) => void } | null;
}

function sendDownload(res: ServerResponse, file: Pick<ExportFile, "contentType" | "filename" | "body">): void {
	res.writeHead(200, {
		...SECURITY_HEADERS,
		"content-type": file.contentType,
		"content-disposition": `attachment; filename="${file.filename}"`,
	});
	res.end(file.body);
}

function exportChoice(query: URLSearchParams): { content?: string; format?: string } {
	return { content: query.get("content") ?? undefined, format: query.get("format") ?? undefined };
}

/** Adds the repair for each open finding to a monitor answer that carries a scan report. */
function withSuggestions(answer: unknown): unknown {
	const report = (answer as { report?: MonitorReport | null } | null)?.report;
	if (!report || !Array.isArray(report.findings)) return answer;
	return { ...(answer as object), suggestions: domainSuggestions(report) };
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large");
		chunks.push(chunk as Buffer);
	}
	if (size === 0) return undefined;
	// Requiring JSON also keeps plain HTML forms on other sites from posting here.
	if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
		throw new HttpError(415, "Body must be application/json");
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new HttpError(400, "Body is not valid JSON");
	}
}

/** What a scan of a folder would cover, found the way a scan finds it: nothing is run and nothing is read but folder names. */
export interface ScanPreview {
	root: string;
	/** Whether `root` is a folder this process can see. */
	exists: boolean;
	/** How many repositories a scan would cover. */
	total: number;
	/** The first of them, named as the report names them. */
	repos: string[];
	/** How many of them were fetched from GitHub rather than found in `root`. */
	fetched: number;
	depth: number;
}

async function previewScan(root: string, depthText: string | null, githubDir: string): Promise<ScanPreview> {
	const depth = depthText === null ? 3 : Number(depthText);
	if (!Number.isInteger(depth) || depth < 0 || depth > MAX_DEPTH) throw new HttpError(400, `Depth must be a whole number from 0 to ${MAX_DEPTH}`);
	if (root.trim() === "") throw new HttpError(400, "Choose a folder to scan");
	const absolute = resolve(root.trim().replace(/^~(?=$|\/)/, homedir()));
	const info = await stat(absolute).catch(() => null);
	if (!info?.isDirectory()) return { root: absolute, exists: false, total: 0, repos: [], fetched: 0, depth };
	const inFolder = await discoverRepos(absolute, depth);
	const fromGithub = (await discoverRepos(githubDir, GITHUB_DEPTH)).filter((path) => !inFolder.includes(path));
	const names = [...inFolder, ...fromGithub].slice(0, PREVIEW_NAMES).map((path) => nameUnder(absolute, [githubDir], path));
	return { root: absolute, exists: true, total: inFolder.length + fromGithub.length, repos: names, fetched: fromGithub.length, depth };
}

async function scanRequest(body: unknown): Promise<{ root: string; depth: number }> {
	const { root, depth = 3 } = (body ?? {}) as { root?: unknown; depth?: unknown };
	if (typeof root !== "string" || root.trim() === "") throw new HttpError(400, "Choose a folder to scan");
	if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 0 || depth > MAX_DEPTH) {
		throw new HttpError(400, `Depth must be a whole number from 0 to ${MAX_DEPTH}`);
	}
	const expanded = root.trim().replace(/^~(?=$|\/)/, homedir());
	const absolute = resolve(expanded);
	const info = await stat(absolute).catch(() => null);
	if (!info?.isDirectory()) throw new HttpError(400, `Not a folder: ${absolute}`);
	return { root: absolute, depth };
}

/**
 * The stored report, ordered worst first, each finding with its suggested fix,
 * what the scan did not cover, and what repositories told the scanners to leave out.
 */
async function loadReport(path: string, analysisPath: string): Promise<{ report: unknown; notes: string[]; settingNotes: string[] }> {
	const report = await readReport(path);
	if (!report) return { report: null, notes: [], settingNotes: [] };
	const suggestions = suggestionsFor(report);
	const analysis: AnalysisFile = await readAnalysis(analysisPath, report);
	return {
		notes: coverageNotes(report),
		settingNotes: settingNotes(report),
		report: {
			...report,
			repos: rankRepos(report.repos).map((repo) => {
				const name = repoName(report, repo);
				return {
					...repo,
					name,
					// The model's judgement rides beside the finding; it changes nothing about it.
					findings: rank(repo.findings).map((finding) => ({ ...finding, suggestion: suggestions.get(finding), analysis: analysis.items[unitKey(name, finding)] })),
				};
			}),
		},
	};
}

/** The stored report as it was written, or null when there is none yet. */
async function readReport(path: string): Promise<ScanReport | null> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
	let report: ScanReport;
	try {
		report = JSON.parse(text) as ScanReport;
	} catch {
		throw new HttpError(500, `The report file is not valid JSON: ${path}`);
	}
	if (!Array.isArray(report?.repos) || !Array.isArray(report?.tools) || typeof report.root !== "string") {
		throw new HttpError(500, `The report file is not a Porchlight scan report: ${path}`);
	}
	return report;
}

/** The chosen look, or the default when none was saved or the file holds something else. */
async function readAppearance(path: string): Promise<string> {
	try {
		const saved = (JSON.parse(await readFile(path, "utf8")) as { appearance?: unknown }).appearance;
		return isLook(saved) ? (saved as string) : DEFAULT_LOOK;
	} catch {
		return DEFAULT_LOOK;
	}
}

async function saveAppearance(path: string, appearance: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify({ appearance }, null, "\t")}\n`, { mode: 0o600 });
	await rename(temporary, path);
}

/** The place in the page the owner was last at, or null. */
async function readView(path: string): Promise<string | null> {
	try {
		const view = (JSON.parse(await readFile(path, "utf8")) as { view?: unknown }).view;
		return typeof view === "string" && view.startsWith("#/") ? view : null;
	} catch {
		return null;
	}
}

async function saveView(path: string, view: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify({ view }, null, "\t")}\n`, { mode: 0o600 });
	await rename(temporary, path);
}

/** Reports say where secrets were found, so a new one is readable only by its owner. */
async function readHostReport(path: string): Promise<HostReport | null> {
	try {
		const report = JSON.parse(await readFile(path, "utf8")) as HostReport;
		return Array.isArray(report?.checks) ? report : null;
	} catch {
		return null;
	}
}

/** What this computer's check found says where it is weak, so only its owner can read it. */
async function saveHostReport(path: string, report: HostReport): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(report, null, "\t")}\n`, { mode: 0o600 });
	await chmod(temporary, 0o600);
	await rename(temporary, path);
}

async function saveReport(path: string, report: ScanReport): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(report, null, "\t")}\n`, { mode: 0o600 });
	await chmod(temporary, 0o600);
	await rename(temporary, path);
}
