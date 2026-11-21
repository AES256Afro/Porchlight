import { randomBytes, timingSafeEqual } from "node:crypto";
import { lstat, mkdir, readFile, rename, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { cpus, homedir, hostname, networkInterfaces, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { judge, readAnalysis, saveAnalysis, unitKey, unitsOf, VERDICTS, type AnalysisFile } from "../analysis/analyse.ts";
import { DEFAULT_OLLAMA, describeMachine, DownloadError, HUB_FORMATS, HUB_HOST, HUB_SIZES, HUB_SORTS, HUB_TASKS, installedModels, modelNameProblem, pullModel, searchHub } from "../assist/download.ts";
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
	cloudflarePrompt,
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
import { describeFilter, isFiltering } from "../../ui/filter.js";
import { MAX_QUESTION } from "../../ui/generated.js";
import { DEFAULT_ANSWER_PLACE, DEFAULT_LOOK, isAnswerPlace, isLook } from "../../ui/looks.js";
import { fetchedRepos, fetchRepo, GithubError, listRepos, parseRepoName, removeFetched, validOwner, type GithubConfig } from "../github/github.ts";
import { callMonitor, type MonitorConfig } from "../monitor/client.ts";
import { forgetMonitor, monitorProblem, MonitorSettingsError, parseMonitorSettings, readSavedMonitor, saveMonitor } from "../monitor/settings.ts";
import { discoverRepos } from "../repos/discover.ts";
import type { Runner } from "../repos/exec.ts";
import { coverageNotes, nameUnder, rank, rankRepos, repoName, reportStamp, settingNotes } from "../repos/report.ts";
import { carryNotes, History, notesForPage, setNote, type HistoryEntry } from "../repos/history.ts";
import { checkHost, type HostCheckOptions } from "../host/check.ts";
import type { HostReport } from "../host/types.ts";
import { CancelledError, run as runCommand } from "../repos/exec.ts";
import { rescanRepo, scanRepos } from "../repos/scan.ts";
import { buildSbom } from "../repos/sbom.ts";
import { jsonText } from "../roadmap/escape.ts";
import { noticeRequest, type Notice, type NotifyFormat } from "../notify/format.ts";
import { failedScanNotice, scanNotice } from "../notify/scan.ts";
import { ChoiceError, describeChoices, parseChoices, standardChoices } from "../../ui/scan-choices.js";
import { findingKey, isDay, isStatus, MAX_NOTE } from "../../ui/tracking.js";
import { SEVERITIES, type RepoResult, type ScanChoices, type ScanReport, type Severity, type ToolName } from "../repos/types.ts";
import { domainSuggestions, type MonitorReport } from "../roadmap/domains.ts";
import { exportDomain, exportRepos, ExportError, parseFilter, type ExportFile } from "../roadmap/export.ts";
import { buildRepoRoadmap, listRepoFindings, suggestionsFor } from "../roadmap/repos.ts";
import { DEFAULT_GOAL, DEFAULT_MAX_TURNS, DEFAULT_MIN_GAP_MS, investigate, MAX_GOAL, MAX_TURNS_LIMIT, newRun, type ApprovalAnswer, type Run } from "../investigate/engine.ts";
import { exportInvestigation, INVESTIGATION_FORMATS, type InvestigationFormat } from "../investigate/export.ts";
import { challengeName, challengeValue, changeDomains, checkOwnership, newToken, readDomains, tokenFromChallenge } from "../investigate/ownership.ts";
import { abortableSleep, asciiDomain, parseDomain, RateLimiter } from "../investigate/scope.ts";
import { isRunId, RunStore, settled } from "../investigate/store.ts";
import { liveNet, TOOLS as INVESTIGATION_TOOLS, type Net } from "../investigate/tools.ts";
import {
	DISCUSSION_FORMATS,
	DiscussionStore,
	exportDiscussion,
	fingerprintOf,
	followUpPrompt,
	HOSTED_HISTORY_CAP,
	KIND_WORDS,
	LOCAL_HISTORY_CAP,
	MAX_TURNS,
	newDiscussion,
	viewOf,
	type Discussion,
	type DiscussionAbout,
	type DiscussionFormat,
	type DiscussionKind,
	type DiscussionTurn,
} from "../discussions/discussions.ts";
import type { SendTarget } from "../assist/settings.ts";
import {
	appendLog,
	checkFolder,
	cleanName,
	FILE_TITLES,
	isProjectId,
	oneLine,
	OWN_FOLDER,
	prepareProject,
	ProjectError,
	ProjectStore,
	rewriteFile,
	saveFile,
	type FileTitle,
	type Project,
	type Saved,
} from "../projects/projects.ts";
import { APPROVAL_WINDOW_MS, describeChange, isChangeId, planBatch, planChange, sendChange, type PlannedChange } from "../cloudflare/apply.ts";
import { auditCloudflare, READ_PERMISSIONS, TOKEN_TEMPLATE_URL, WRITE_PERMISSIONS } from "../cloudflare/audit.ts";
import { CfClient, tokenShapeProblem } from "../cloudflare/client.ts";
import { CF_FORMATS, exportCloudflare, type CfFormat } from "../cloudflare/export.ts";
import { forgetToken, readAudit, readChanges, readSavedToken, recordChange, saveAudit, saveToken } from "../cloudflare/store.ts";
import { oneAtATime, readPrivateJson, UnreadableFileError, writePrivateJson } from "../private-files.ts";

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
	/**
	 * Where settings, keys, tokens, fetched repositories and audits are kept (default: beside the report).
	 * Only the report's own history, notes, judgements and mural stay beside the report, so a report kept
	 * in a project folder (`--report reports/x.json`) never draws keys into it (S34).
	 */
	dataDir?: string;
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
	/** Scans one repository again. Tests pass a fake. */
	rescan?: typeof rescanRepo;
	/** Folder levels a scan looks through unless the page asks otherwise (PORCHLIGHT_SCAN_DEPTH; default 3). */
	scanDepth?: number;
	/**
	 * As a service: scan the folder again once the last scan is this many hours old
	 * (PORCHLIGHT_SCAN_EVERY_HOURS). Absent: only when the owner asks.
	 */
	scanEveryHours?: number;
	/** How often the schedule looks at the clock (default a minute). Tests pass a short one. */
	scheduleTickMs?: number;
	/**
	 * Where the owner is told the outcome of a scan the schedule ran (PORCHLIGHT_NOTIFY_URL), and in
	 * which format. Counts, titles, repositories and files only. Absent: nobody is told.
	 */
	notify?: { url: URL; format: NotifyFormat };
	/** Compare packages against OSV's databases kept beside the report (`osv-db/`), not by asking api.osv.dev (PORCHLIGHT_OSV_OFFLINE). */
	osvOffline?: boolean;
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
	/** A Cloudflare API token given at start-up (PORCHLIGHT_CLOUDFLARE_TOKEN). One saved in Settings → Cloudflare replaces it. */
	cloudflareToken?: string;
	/** Why the start-up token is not used, shown in Settings. */
	cloudflareTokenError?: string;
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

/** A request that is past the gate: who sent it is settled, and its body is read. */
interface Call {
	req: IncomingMessage;
	res: ServerResponse;
	url: URL;
	/** The method and the path, as in "GET /api/state". */
	route: string;
	/** The JSON body of a POST; undefined for anything else. */
	body: unknown;
	gate: Gate;
}

/**
 * Who may change something through a route (any method but GET): "here", the page on the computer that
 * runs Porchlight only; "owner", that page or a service's own page, never another device on the tailnet;
 * "any", every page that holds its listener's key. A handler can be stricter still for one action.
 */
type Changes = "here" | "owner" | "any";

/** Which requests an entry of the route table answers, what answers them, and who may change things through it (default "any"). */
type Route = [claims: (call: Call) => boolean, answer: (call: Call) => void | Promise<void>, changes?: Changes];

/** Whether this gate may change things through a route that allows `changes`. */
export function mayChange(changes: Changes, gate: { loopbackOnly: boolean; tailnet: boolean }): boolean {
	return changes === "any" || (changes === "owner" ? !gate.tailnet : gate.loopbackOnly && !gate.tailnet);
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

/** The audit of the owner's Cloudflare account, run in the background like a scan. */
export type CloudflareStatus =
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
	| { state: "done" | "stopped"; finishedAt: string; done: number; total: number; failed: number; lastError?: string; gaveUp?: boolean };

const UI_DIR = join(import.meta.dirname, "../../ui");
/** The page's own modules. Nothing else in the folder is served. */
/** Every script the page loads. A test checks it names each file in ui/, so none is left unserved. */
export const SCRIPTS = ["app", "api", "dom", "filter", "list", "hints", "generated", "store", "export", "assist", "analysis", "github", "overview", "findings", "finding-parts", "roadmap", "repos", "domains", "looks", "appearance", "settings", "models", "model-settings", "access-settings", "send", "send-text", "tracking", "finding-notes", "host", "host-areas", "paths", "investigate", "discussions", "discussion", "discussion-links", "panel", "projects", "cloudflare", "cloudflare-settings", "monitor-settings", "activity", "model-download", "scan-choices", "scan-options"];
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
const DEFAULT_DEPTH = 3;
/** Repositories named in a preview of what a scan would cover. The count is always the full one. */
const PREVIEW_NAMES = 60;
/** Findings one analysis run may judge, and how many it judges unless told otherwise. */
const MAX_ANALYSE = 500;
const DEFAULT_ANALYSE = 25;
/** Repositories one fetch may name. */
const MAX_FETCH = 300;
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;
/** What the local model can be asked for, one route each. */
const ASSIST_ROUTES = ["finding", "roadmap", "domain", "ask", "cloudflare"];

const DOMAIN_EXPORT = /^\/api\/domains\/([^/]+)\/export$/;

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
	const rescan = options.rescan ?? rescanRepo;
	const defaultDepth = options.scanDepth ?? DEFAULT_DEPTH;
	// Settings and secrets in the data folder; the report's own companions beside it (S34).
	const reportDir = dirname(options.reportPath);
	const dataDir = options.dataDir ?? reportDir;
	if (dataDir !== reportDir) await moveIntoDataFolder(reportDir, dataDir, (line) => console.log(`porchlight ui: ${line}`));
	const osvDatabase = options.osvOffline ? join(dataDir, "osv-db") : undefined;
	/** Stops the scan that is running, when there is one. */
	let scanCancel: AbortController | null = null;
	const github: GithubConfig = options.github ?? { dir: join(dataDir, "github") };
	let status: ScanStatus = { state: "idle" };
	let fetching: FetchStatus = { state: "idle" };
	const analysisPath = join(reportDir, "repo-analysis.json");
	/** The interface's own preferences (the chosen look), kept in the data folder. */
	const settingsPath = join(dataDir, "ui-settings.json");
	// Every finished scan is kept, so the page can say what is new and what was fixed since the last one.
	const history = new History(reportDir);
	const notesPath = join(reportDir, "finding-notes.json");
	// Where the owner was, so the app opens there again however it was closed.
	const viewPath = join(dataDir, "ui-view.json");
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
	const modelPath = join(dataDir, "model-settings.json");
	// The mural for an export, written in the background: a model on a processor takes minutes.
	const muralPath = join(reportDir, "repo-mural.json");
	let muralJob: MuralJob = (await readMural(muralPath)) ?? { state: "idle" };
	/** Stops the mural being written, when one is (AI-B8). */
	let stopMural: AbortController | null = null;
	// The check of this computer: what it found is kept beside the report, readable only by its owner.
	const hostPath = join(dataDir, "host-check.json");
	const runHostCheck = options.hostCheck ?? ((hostOptions) => checkHost({ run: runCommand, ...hostOptions }));
	let hostStatus: HostStatus = { state: "idle" };
	const startup: ModelInUse = { config: options.assistant ?? null, error: options.assistantError, unset: options.assistantUnset ?? false, source: "startup" };
	/** A key given at start-up for a hosted provider, used for that provider when Settings has none. */
	const startupKeys: Partial<Record<HostedProvider, string>> =
		startup.config && startup.config.provider !== undefined && startup.config.provider in HOSTED && startup.config.apiKey ? { [startup.config.provider as HostedProvider]: startup.config.apiKey } : {};
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
		if (cloudflareStatus.state === "running") busy.push("Your Cloudflare account is being audited");
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
		const found = locateFinding(report, target);
		if (!found) throw new HttpError(404, "That finding is not in the latest scan. Reload the page to see the current one.");
		// A credential can be rotated; a vulnerable package is upgraded, which the next scan sees for itself.
		if (fields.status === "rotated" && found.finding.kind !== "secret") throw new HttpError(400, "Only a secret can be marked rotated");
		// An accepted risk may carry the last day it is accepted for: a day from today on, so it cannot be saved already ended.
		const until = fields.until === undefined || fields.until === "" ? undefined : fields.until;
		if (until !== undefined) {
			if (fields.status !== "accepted") throw new HttpError(400, "Only an accepted risk has an end date");
			if (!isDay(until)) throw new HttpError(400, "Give the end date as a day, such as 2027-06-30");
			if (until < new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)) throw new HttpError(400, "Choose an end date that has not passed");
		}
		const key = findingKey(target.repo, target);
		return sendJson(res, 200, { key, note: await setNote(notesPath, key, fields.status, note, new Date(), until) });
	}

	function targets() {
		return sendTargets(savedModel, startup.config, startupKeys);
	}

	// Discussions: every answer a model gives on a page, kept so it can be read again and followed up.
	const discussionStore = new DiscussionStore(join(dataDir, "discussions"));
	/** Discussions waiting for a follow-up answer: one question at a time each. */
	const answering = new Set<string>();

	// Projects: a folder the owner chose, where exports, discussions and a daily log are written.
	const projects = new ProjectStore(join(dataDir, "projects.json"));
	// A service (a container) keeps project folders in its data volume, in a folder of their own.
	const projectsWithin = loopbackOnly ? undefined : join(dataDir, "projects");
	if (projectsWithin) await mkdir(projectsWithin, { recursive: true, mode: 0o700 }).catch(() => {});
	let logging: Promise<void> = Promise.resolve();

	/**
	 * Adds a line to a project's log: the one given, or the one in use. Lines are written in order, and
	 * a log that cannot be written never stops the work it records. Only Porchlight's own words and
	 * figures go in: never a key, a token, a secret value or a model's text.
	 */
	function log(text: string, project?: Project | null): void {
		const at = new Date();
		note(text);
		logging = logging
			.then(async () => {
				const target = project === undefined ? await projects.current() : project;
				if (target) await appendLog(target, text, at);
			})
			.catch((err) => console.error(`porchlight ui: could not write the project's log: ${err instanceof Error ? err.message : String(err)}`));
	}

	/**
	 * What Porchlight is doing, as it happens, for the page's Activity view: the last MAX_ACTIVITY lines,
	 * kept in memory only. Like the project log it holds Porchlight's own words and figures, one line
	 * each: never a key, a token, a secret value, a request's body or a model's text.
	 */
	const activity: ActivityLine[] = [];
	let activityCount = 0;
	function note(text: string, kind: ActivityLine["kind"] = "info"): void {
		activityCount += 1;
		activity.push({ n: activityCount, at: new Date().toISOString(), kind, text: oneLine(text).slice(0, 400) });
		if (activity.length > MAX_ACTIVITY) activity.splice(0, activity.length - MAX_ACTIVITY);
	}

	/** The model and where it runs, for the log: a hosted one is said to be outside the owner's machines. */
	function modelWords(config: AssistantConfig): string {
		return isHosted(config) ? `${config.model} (${hostedName(config)}, outside your machines)` : `${config.model} at ${config.url.host}`;
	}

	/**
	 * A request to a model names the model the page showed, since another tab or device may have
	 * switched it since (S22): one that names another is refused. A hosted model also needs the page's
	 * word that it showed what is sent there; with none named, nothing is sent to a hosted model.
	 */
	function confirmModel(fields: Record<string, unknown>, config: AssistantConfig): void {
		const shown = fields.shown;
		const named = typeof shown === "object" && shown !== null && typeof (shown as { model?: unknown }).model === "string" && typeof (shown as { host?: unknown }).host === "string";
		if (shown !== undefined && (!named || (shown as { model: string }).model !== config.model || (shown as { host: string }).host !== config.url.host)) {
			throw new HttpError(409, `The model is now ${modelWords(config)}, not the one this page showed. Reload the page to see what it sends there.`);
		}
		if (isHosted(config) && (!named || fields.sendsToHosted !== true)) {
			throw new HttpError(409, `${modelWords(config)} is outside your machines. Reload the page: it says what is sent there before you ask.`);
		}
	}

	/** Writes a discussion's transcript into a project as a new file, and records where. */
	async function newTranscript(discussion: Discussion, project: Project): Promise<Saved> {
		const saved = await saveFile(project, "Discussions", `discussion-${discussion.kind}`, "md", exportDiscussion(discussion, "md").body);
		discussion.saved = { project: project.id, name: saved.name };
		await discussionStore.save(discussion);
		return saved;
	}

	/** Writes a kept transcript again after a new answer, in the project it is kept in, if that is still listed. */
	async function updateTranscript(discussion: Discussion): Promise<Saved | null> {
		if (!discussion.saved) return null;
		const project = await projects.get(discussion.saved.project);
		if (!project) return null;
		return rewriteFile(project, "Discussions", discussion.saved.name, exportDiscussion(discussion, "md").body);
	}

	/** The transcript is a copy: one that cannot be written is said in the server's output, never at the cost of the answer. */
	function transcriptFailed(err: unknown): null {
		console.error(`porchlight ui: could not save the discussion to the project: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}

	/** An export written into the project in use instead of downloaded, and said in its log. */
	async function saveExport(res: ServerResponse, file: { body: string; filename: string }, title: FileTitle): Promise<void> {
		const project = await projects.current();
		if (!project) throw new HttpError(409, "Choose a project first, under Settings → Projects, or download the file instead.");
		const extension = /\.([a-z]+)$/.exec(file.filename)?.[1] ?? "txt";
		const saved = await saveFile(project, "Exports", title, extension, file.body);
		log(`Exported ${FILE_TITLES[title]} (${extension}) to ${OWN_FOLDER}/Exports/${saved.name}`, project);
		return sendJson(res, 200, { saved: { ...saved, projectName: project.name } });
	}

	async function projectsState(gate: Gate) {
		const file = await projects.read();
		return {
			current: file.current,
			projects: file.projects,
			// The page on this computer, or a service's own page; never another device over the tailnet.
			canChange: !gate.tailnet,
			// A service keeps its project folders inside its data folder.
			...(projectsWithin ? { within: projectsWithin } : {}),
		};
	}

	async function projectsRoute(res: ServerResponse, route: string, url: URL, body: unknown, gate: Gate): Promise<void> {
		if (route === "GET /api/projects") return sendJson(res, 200, await projectsState(gate));
		const fields = route.startsWith("POST ") ? bodyObject(body) : {};
		// Moving between projects already chosen is open to any page with the key: it chooses no folder.
		if (route === "POST /api/projects/use") {
			const id = fields.id ?? null;
			if (id !== null && !isProjectId(id)) throw new HttpError(400, "Choose a project");
			const project = await projects.use(id);
			if (project) log(`Using this project, ${project.name}`, project);
			return sendJson(res, 200, await projectsState(gate));
		}
		if (gate.tailnet) throw new HttpError(403, "Projects are added and removed from the page on the computer that runs Porchlight");
		const checkOptions = async () => {
			const report = await readReport(options.reportPath).catch(() => null);
			return { home: homedir(), scanRoots: [options.defaultRoot, ...(report ? [report.root] : [])], ...(projectsWithin ? { within: projectsWithin } : {}) };
		};
		if (route === "GET /api/projects/preview") return sendJson(res, 200, { check: await checkFolder(url.searchParams.get("folder"), await checkOptions()) });
		if (route === "POST /api/projects") {
			const name = cleanName(fields.name);
			if (!name) throw new HttpError(400, "Name the project in 1 to 60 characters, such as acme-audit");
			const check = await checkFolder(fields.folder, await checkOptions());
			if (check.error) throw new HttpError(400, check.error);
			const project = await projects.add(name, check.folder);
			try {
				await prepareProject(project);
			} catch (err) {
				await projects.remove(project.id).catch(() => {});
				throw err;
			}
			log(`Project started: ${project.name}, in ${project.folder}`, project);
			return sendJson(res, 200, { ...(await projectsState(gate)), added: project.id });
		}
		if (route === "POST /api/projects/remove") {
			if (!isProjectId(fields.id)) throw new HttpError(400, "Choose a project");
			const project = await projects.remove(fields.id);
			log("Project taken off Porchlight's list. Its folder and files are left as they are.", project);
			return sendJson(res, 200, await projectsState(gate));
		}
		throw new HttpError(404, "Not found");
	}

	/**
	 * Keeps a model's first answer as a discussion. Not keeping it never costs the owner the answer:
	 * the page still shows it, only without a follow-up box.
	 */
	async function recordDiscussion(
		kind: DiscussionKind,
		about: DiscussionAbout,
		config: AssistantConfig,
		targetId: string | null,
		cut: string | null,
		first: DiscussionTurn,
	): Promise<{ id: string; title: string } | undefined> {
		try {
			const target = targetId ?? targets().find((candidate) => fingerprintOf(candidate.config) === fingerprintOf(config))?.id ?? "";
			const discussion = newDiscussion({ kind, about, config, hosted: isHosted(config), target, cut, first });
			await discussionStore.save(discussion);
			await discussionStore.prune().catch(() => {});
			// Begun while a project is in use: its transcript is kept there too, and written again after each answer.
			const project = await projects.current();
			if (project) await newTranscript(discussion, project).catch(transcriptFailed);
			log(`Asked ${modelWords(config)}: ${KIND_WORDS[kind]}, answered in ${first.seconds} s`, project);
			return { id: discussion.id, title: discussion.title };
		} catch (err) {
			console.error(`porchlight ui: could not keep the discussion: ${err instanceof Error ? err.message : String(err)}`);
			return undefined;
		}
	}

	const NEWER_SCAN = "A newer scan has replaced the one this discussion is about. Ask again from the page to start a new discussion about it.";
	const NEWER_AUDIT = "A newer Cloudflare audit has replaced the one this discussion is about. Ask again from the Cloudflare page to start a new discussion about it.";

	/**
	 * Whether a discussion can take a follow-up now, and the model it goes to: the same one it began
	 * with, never one swapped in since, and the same scan, never a newer one the model has not read.
	 */
	async function followUpState(discussion: Discussion): Promise<{ ok: true; target: SendTarget } | { ok: false; reason: string }> {
		if (discussion.turns.length >= MAX_TURNS) {
			return { ok: false, reason: `This discussion has ${MAX_TURNS} answers, the most one can hold. Ask again from the page to start a new one.` };
		}
		const target = targets().find((candidate) => candidate.id === discussion.target);
		if (!target || fingerprintOf(target.config) !== discussion.fingerprint) {
			return {
				ok: false,
				reason: `${discussion.model} at ${discussion.host}, the model this discussion used, is no longer set up. Set it up again under Settings → Model, or ask again from the page to start a new discussion.`,
			};
		}
		if (discussion.kind === "cloudflare") {
			const audit = await readAudit(cloudflareAuditPath).catch(() => null);
			if (!audit || audit.checkedAt !== discussion.about.checkedAt) return { ok: false, reason: NEWER_AUDIT };
		} else if (discussion.kind === "domain") {
			// A domain's discussion is offered a follow-up only while the monitor's latest scan of it is the
			// one it read (AI-B10); a monitor that cannot be asked is said, and offers none.
			const domain = discussion.about.domain ?? "";
			const latest = await latestDomainReport(domain).then(
				(report) => String(report.takenAt),
				(err: unknown) => (err instanceof Error ? err : new Error(String(err))),
			);
			if (latest instanceof Error) return { ok: false, reason: `The monitor could not be asked whether ${domain} has been scanned since: ${latest.message}` };
			if (latest !== discussion.about.takenAt) return { ok: false, reason: `A newer scan of ${domain} has replaced the one this discussion is about. Ask again from the Domains page to start a new discussion about it.` };
		} else {
			const report = await readReport(options.reportPath).catch(() => null);
			if (!report || !sameScan(report, discussion.about)) return { ok: false, reason: NEWER_SCAN };
		}
		return { ok: true, target };
	}

	/** The first prompt of a discussion, built again from this server's own data, exactly as it was sent (invariant 13). */
	async function rebuildPrompt(discussion: Discussion, target: SendTarget): Promise<Prompt> {
		const about = discussion.about;
		if (discussion.kind === "domain") {
			const report = await latestDomainReport(about.domain ?? "");
			if (String(report.takenAt) !== about.takenAt) {
				throw new HttpError(409, `A newer scan of ${about.domain} has replaced the one this discussion is about. Ask again from the Domains page to start a new discussion about it.`);
			}
			return domainPrompt(report);
		}
		if (discussion.kind === "cloudflare") {
			const audit = await readAudit(cloudflareAuditPath);
			if (!audit || audit.checkedAt !== about.checkedAt) throw new HttpError(409, NEWER_AUDIT);
			return cloudflarePrompt(audit);
		}
		const report = await storedReport();
		if (!sameScan(report, about)) throw new HttpError(409, NEWER_SCAN);
		if (discussion.kind === "finding") {
			const found = locateFinding(report, { repo: about.repo ?? "", ruleId: about.ruleId ?? "", location: about.location ?? "", detail: about.detail });
			if (!found) throw new HttpError(409, NEWER_SCAN);
			return findingPrompt(report, found.repo, found.finding);
		}
		if (discussion.kind === "roadmap") return roadmapPrompt(report);
		if (discussion.kind === "ask") return askPrompt(report, discussion.turns[0]?.question ?? "");
		const filter = parseFilter({ severity: about.filter?.severity, kind: about.filter?.kind, match: about.filter?.q, repo: about.filter?.repo });
		return sendPrompt(report, {
			content: about.content === "findings" ? "findings" : "roadmap",
			purpose: about.purpose === "repair" ? "repair" : "analyse",
			filter,
			cap: target.hosted ? HOSTED_DATA_CAP : DATA_CAP,
		});
	}

	/**
	 * Kept discussions: the list, one in full, a file of one, deleting one, and a follow-up question.
	 * A follow-up sends the first prompt as built from this server's data, the conversation so far and
	 * the owner's question, to the model the discussion began with. The answer is text for the page.
	 */
	async function discussionRoute(res: ServerResponse, route: string, url: URL, body: unknown): Promise<void> {
		if (route === "GET /api/discussions") return sendJson(res, 200, { discussions: await discussionStore.list(), maxTurns: MAX_TURNS });
		if (route === "GET /api/discussions/one" || route === "GET /api/discussions/export") {
			const discussion = await discussionStore.read(url.searchParams.get("id"));
			if (!discussion) throw new HttpError(404, "There is no such discussion");
			if (route === "GET /api/discussions/export") {
				const format = url.searchParams.get("format") ?? "md";
				if (!(DISCUSSION_FORMATS as readonly string[]).includes(format)) throw new HttpError(400, `Choose a format: ${DISCUSSION_FORMATS.join(" or ")}`);
				return sendDownload(res, exportDiscussion(discussion, format as DiscussionFormat));
			}
			const state = await followUpState(discussion);
			return sendJson(res, 200, { discussion: viewOf(discussion), followUp: state.ok ? { ok: true } : { ok: false, reason: state.reason } });
		}
		const fields = bodyObject(body);
		// A copy of the transcript in the project in use: written again there after each answer from now on.
		if (route === "POST /api/discussions/save") {
			const discussion = await discussionStore.read(fields.id);
			if (!discussion) throw new HttpError(404, "There is no such discussion");
			const project = await projects.current();
			if (!project) throw new HttpError(409, "Choose a project first, under Settings → Projects.");
			const saved = discussion.saved?.project === project.id ? await updateTranscript(discussion) : await newTranscript(discussion, project);
			if (saved) log(`Saved a discussion (${KIND_WORDS[discussion.kind]}) to ${OWN_FOLDER}/Discussions/${saved.name}`, project);
			return sendJson(res, 200, { discussion: viewOf(discussion), saved: saved ? { ...saved, projectName: project.name } : null });
		}
		if (route === "POST /api/discussions/delete") {
			if (typeof fields.id === "string" && answering.has(fields.id)) throw new HttpError(409, "This discussion is waiting for an answer. Delete it when the answer has come");
			if (!(await discussionStore.remove(fields.id))) throw new HttpError(404, "There is no such discussion");
			return sendJson(res, 200, { deleted: fields.id });
		}
		if (route !== "POST /api/discussions/ask") throw new HttpError(404, "Not found");

		const question = fields.question;
		if (typeof question !== "string" || question.trim() === "" || question.length > MAX_QUESTION) throw new HttpError(400, `Ask a question of 1 to ${MAX_QUESTION} characters`);
		const discussion = await discussionStore.read(fields.id);
		if (!discussion) throw new HttpError(404, "There is no such discussion");
		if (answering.has(discussion.id)) throw new HttpError(409, "This discussion is still waiting for an answer to the last question");
		const state = await followUpState(discussion);
		if (!state.ok) throw new HttpError(409, state.reason);
		const target = state.target;
		const prompt = await rebuildPrompt(discussion, target);
		const { messages, note } = followUpPrompt(prompt, discussion.turns, question.trim(), target.hosted ? HOSTED_HISTORY_CAP : LOCAL_HISTORY_CAP);

		// As for "Send to a model": the owner's own model answers one request at a time, a hosted one many.
		const local = !target.hosted;
		if (local && modelBusy) throw new HttpError(409, "The model is still answering another request. Try again when it has finished.");
		if (local) modelBusy = true;
		answering.add(discussion.id);
		sending += 1;
		const cancel = new AbortController();
		const onClose = () => {
			if (!res.writableFinished) cancel.abort();
		};
		res.once("close", onClose);
		const started = Date.now();
		try {
			const long = discussion.kind === "send";
			const answer = await chat(target.config, messages, {
				fetchFn: options.fetchFn,
				signal: cancel.signal,
				...(long ? { timeoutMs: SEND_TIMEOUT_MS, maxTokens: SEND_TOKENS } : {}),
			});
			const turn: DiscussionTurn = {
				question: question.trim(),
				answer,
				model: target.config.model,
				at: new Date().toISOString(),
				seconds: Math.round((Date.now() - started) / 100) / 10,
				...(note ? { note } : {}),
			};
			discussion.turns.push(turn);
			discussion.updatedAt = turn.at;
			await discussionStore.save(discussion);
			const kept = await updateTranscript(discussion).catch(transcriptFailed);
			log(`Follow-up question to ${modelWords(target.config)}: ${KIND_WORDS[discussion.kind]}, answered in ${turn.seconds} s`, kept ? await projects.get(kept.project) : undefined);
			sendJson(res, 200, { discussion: viewOf(discussion), turn });
		} catch (err) {
			if (err instanceof AssistantError) throw new HttpError(err.status, err.message);
			throw err;
		} finally {
			res.off("close", onClose);
			answering.delete(discussion.id);
			sending -= 1;
			if (local) modelBusy = false;
		}
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
		const started = Date.now();
		try {
			const answer = await chat(target.config, prompt.messages, { fetchFn: options.fetchFn, signal: cancel.signal, timeoutMs: SEND_TIMEOUT_MS, maxTokens: SEND_TOKENS });
			const partial = describeFilter(filter);
			// What the page's filter was, in the request's own words, so a follow-up rebuilds the same data.
			const filterWords = Object.fromEntries(
				(["severity", "kind", "q", "repo"] as const).flatMap((name) => (text(name) === null ? [] : [[name, text(name) as string]])),
			);
			const about: DiscussionAbout = {
				scannedAt: report.scannedAt,
				stamp: reportStamp(report),
				content: fields.content as string,
				purpose: fields.purpose as string,
				...(Object.keys(filterWords).length > 0 ? { filter: filterWords } : {}),
				...(partial ? { partial } : {}),
			};
			const discussion = await recordDiscussion("send", about, target.config, target.id, prompt.cut, {
				question: null,
				answer,
				model: target.config.model,
				at: new Date().toISOString(),
				seconds: Math.round((Date.now() - started) / 100) / 10,
			});
			sendJson(res, 200, {
				text: answer,
				model: target.config.model,
				label: target.label,
				hosted: target.hosted,
				...(prompt.cut ? { cut: prompt.cut } : {}),
				...(partial ? { partial } : {}),
				...(discussion ? { discussion: discussion.id, title: discussion.title } : {}),
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
				// One save at a time, each from the file as it is now, so two saves for different providers
				// keep both keys (B21); a file that cannot be read is never written over, which would lose every key (B25).
				await oneAtATime(modelPath, async () => {
					const read = await readPrivateJson(modelPath);
					if (read.state === "unreadable") throw new HttpError(409, new UnreadableFileError("Your model settings", read.reason).message);
					const next = nextSaved(read.state === "read" ? await readSavedModel(modelPath) : null, modelRequest(body));
					// Checked before it is saved, so a mistake never replaces a working choice.
					configFor(next, { fallbackKeys: startupKeys });
					await saveModel(modelPath, next);
					savedModel = next;
					model = inUse(next);
				});
				return sendJson(res, 200, modelState());
			}
			if (route === "POST /api/model/startup") {
				await oneAtATime(modelPath, async () => {
					await forgetModel(modelPath);
					savedModel = null;
					model = startup;
				});
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

	// Downloading a local model: Ollama does it, at the address chosen under Settings → Model or on
	// this computer. One at a time, and only from this computer's page: it fills a disk.
	let download: DownloadStatus = { state: "idle" };
	// What this computer can run, from its memory: read once, from the system, never from a request.
	const machine = describeMachine(totalmem(), cpus()[0]?.model ?? "", process.platform, process.arch);
	let downloadStop: AbortController | null = null;
	function ollamaBase(): URL {
		const config = model.config;
		return config && (config.provider ?? "ollama") === "ollama" ? config.url : new URL(DEFAULT_OLLAMA);
	}

	async function downloadRoute(res: ServerResponse, route: string, url: URL, body: unknown, gate: Gate): Promise<void> {
		const here = gate.loopbackOnly && !gate.tailnet;
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

	// Access from other devices: a second listener on this machine's Tailscale address only.
	const accessPath = join(dataDir, "access.json");
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
	/** Starts or stops the tailnet listener to match `access`, one change at a time, the retry included (S25). */
	function applyAccess(): Promise<void> {
		return oneAtATime(`${accessPath}#listener`, applyAccessNow);
	}

	async function applyAccessNow(): Promise<void> {
		await stopAccess();
		clearInterval(accessRetry);
		accessRetry = undefined;
		if (!access.enabled) {
			accessStatus = { enabled: false, listening: false };
			return;
		}
		const address = findTailnet();
		if (!address) {
			accessStatus = { enabled: true, listening: false, error: "Tailscale is not connected on this computer. Start Tailscale; Porchlight will keep checking." };
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
	async function muralRoute(res: ServerResponse, route: string, report: ScanReport, filter: ReturnType<typeof parseFilter>, key: string, body: unknown): Promise<void> {
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
		confirmModel(bodyObject(body ?? {}), config);
		if (muralJob.state === "running") throw new HttpError(409, "A mural is already being written");
		if (analysing.state === "running") throw new HttpError(409, "Deeper analysis is running. Write the mural when it has finished, so it can include it");
		if (modelBusy) throw new HttpError(409, "The model is still answering another request. Try again when it has finished.");

		// Running, and the model taken, before the first await, so a second request is refused (B24).
		const earlierMural = muralJob;
		muralJob = { state: "running", key, startedAt: new Date().toISOString() };
		modelBusy = true;
		let prompt: ReturnType<typeof muralPrompt>;
		let facts: ReturnType<typeof muralFacts>;
		try {
			const roadmap = buildRepoRoadmap(report, filter);
			const analysis = await readAnalysis(analysisPath, report);
			// What was fixed since the previous scan, where this scan could check again: the "done" column's best evidence.
			const change = await history.latestChange(report).catch(() => null);
			facts = muralFacts(report, roadmap, listRepoFindings(report, filter), analysis, change);
			prompt = muralPrompt(facts, roadmap, judgedHighlights(report, analysis).slice(0, MURAL_HIGHLIGHTS));
		} catch (err) {
			muralJob = earlierMural;
			modelBusy = false;
			throw err;
		}
		const stop = new AbortController();
		stopMural = stop;
		void (async () => {
			try {
				// A small model now and then answers with something other than the JSON asked for: it gets one more try.
				let written: ReturnType<typeof parseMural> | undefined;
				for (let attempt = 1; !written; attempt++) {
					const text = await chat(config, prompt.messages, { fetchFn: options.fetchFn, timeoutMs: MURAL_TIMEOUT_MS, maxTokens: MURAL_TOKENS, signal: stop.signal, json: true });
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
				muralJob = { state: "failed", key, error: stop.signal.aborted ? "Stopped: no mural was written" : known ? err.message : "The mural could not be written" };
			} finally {
				modelBusy = false;
				if (stopMural === stop) stopMural = null;
			}
		})();
		return sendJson(res, 202, describe());
	}

	async function accessRoute(res: ServerResponse, route: string, body: unknown, gate: Gate): Promise<void> {
		if (route === "GET /api/access") return sendJson(res, 200, accessState(gate));
		if (gate.tailnet || !gate.loopbackOnly) throw new HttpError(403, "Access can only be changed on the computer that runs Porchlight");
		if (route === "POST /api/access") {
			const enabled = bodyObject(body).enabled;
			if (typeof enabled !== "boolean") throw new HttpError(400, "Say whether access is on");
			// One change at a time, saved before it takes effect: the file always says what a restart
			// should open, and a change that could not be saved changes nothing (S25).
			await oneAtATime(accessPath, async () => {
				const next = { enabled, key: access.key || newAccessKey() };
				await saveAccess(accessPath, next);
				access = next;
				await applyAccess();
			});
			return sendJson(res, 200, accessState(gate));
		}
		if (route === "POST /api/access/key") {
			// A new key turns away every device that had the old one, including open pages.
			await oneAtATime(accessPath, async () => {
				const next = { ...access, key: newAccessKey() };
				await saveAccess(accessPath, next);
				access = next;
				await applyAccess();
			});
			return sendJson(res, 200, accessState(gate));
		}
		throw new HttpError(404, "Not found");
	}


	// The monitor that watches the owner's websites. A connection saved under Settings → Monitor comes
	// before the one given at start-up, as a saved model or Cloudflare token does. The admin token is
	// added to each call here and never sent to the page.
	const monitorSettingsPath = join(dataDir, "monitor-settings.json");
	let savedMonitor = await readSavedMonitor(monitorSettingsPath);
	let monitor: MonitorConfig | null = savedMonitor?.config ?? options.monitor;

	function monitorState() {
		if (!monitor) {
			return {
				configured: false,
				error: options.monitorError ?? "The monitor is not configured",
				// Neither setting given: the usual state of a fresh install, as opposed to a value to correct.
				unset: options.monitorUnset ?? false,
			};
		}
		return { configured: true, host: monitor.url.host, ...(savedMonitor ? { source: "settings", savedAt: savedMonitor.savedAt } : {}) };
	}

	async function monitorRoute(res: ServerResponse, route: string, body: unknown, gate: Gate): Promise<void> {
		// A service is given its monitor where it is managed; another device only looks.
		if (!(gate.loopbackOnly && !gate.tailnet)) throw new HttpError(403, "The monitor is connected from the page on the computer that runs Porchlight");
		if (route === "POST /api/monitor") {
			const fields = bodyObject(body);
			let config: MonitorConfig;
			try {
				config = parseMonitorSettings(fields.address, fields.token);
			} catch (err) {
				if (err instanceof MonitorSettingsError) throw new HttpError(400, err.message);
				throw err;
			}
			// Asked before it is saved, so a mistake never replaces a working connection.
			const problem = await monitorProblem(config, options.fetchFn ?? fetch);
			if (problem) throw new HttpError(400, problem);
			savedMonitor = await saveMonitor(monitorSettingsPath, config);
			monitor = config;
			log(`Monitor connected: ${config.url.host}`);
			return sendJson(res, 200, { monitor: monitorState() });
		}
		if (route === "POST /api/monitor/remove") {
			await forgetMonitor(monitorSettingsPath);
			savedMonitor = null;
			monitor = options.monitor;
			log("Monitor connection removed from Settings");
			return sendJson(res, 200, { monitor: monitorState() });
		}
		throw new HttpError(404, "Not found");
	}

	// "Investigate with a model": one run at a time, on a domain whose ownership record holds its token.
	const investigateDir = join(dataDir, "investigations");
	const investigateDomainsPath = join(dataDir, "investigate-domains.json");
	const runStore = new RunStore(investigateDir);
	const investigateNet: Net = options.investigateNet ?? (options.fetchFn ? { ...liveNet, fetch: options.fetchFn } : liveNet);
	let investigation: InvestigationJob | null = null;
	/** An investigation is being started: ownership is being checked. See S24. */
	let investigationStarting = false;
	/** Saves run by run, in order, so a slow write never lands after a newer one. */
	let runSaves: Promise<void> = Promise.resolve();

	/** What a run sends to the model, in words, for the page to show before anything is sent. */
	function investigationDisclosure(config: AssistantConfig): string {
		const where = isHosted(config) ? `${hostedName(config)} (${config.url.host}), outside your machines` : `the model at ${config.url.host}`;
		return `Each turn sends ${where}: the domain, your goal, the tool list, the findings so far and the latest results of the tools, which are your site's DNS records and HTTP responses (headers and up to 1 500 characters of each body, with Set-Cookie values left out). It never sends the ownership token, your scans, keys or anything from this computer.`;
	}

	async function investigateDomains() {
		const file = await readDomains(investigateDomainsPath);
		return Object.entries(file.domains)
			.sort(([a], [b]) => a.localeCompare(b, "en"))
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
				monitor: monitor !== null,
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
		if (route === "GET /api/investigate/export" || route === "POST /api/investigate/export") {
			const id = url.searchParams.get("id");
			const run = isRunId(id) ? await currentRun(id) : null;
			if (!run) throw new HttpError(404, "There is no such investigation");
			const format = url.searchParams.get("format") ?? "md";
			if (!(INVESTIGATION_FORMATS as readonly string[]).includes(format)) throw new HttpError(400, `Choose a format: ${INVESTIGATION_FORMATS.join(" or ")}`);
			const file = exportInvestigation(run, format as InvestigationFormat);
			if (route === "POST /api/investigate/export") return saveExport(res, file, "investigation");
			log(`Exported ${FILE_TITLES.investigation} (${format}) as a download`);
			return sendDownload(res, file);
		}
		if (!here) throw new HttpError(403, "Investigations are run from the page on the computer that runs Porchlight");
		const fields = bodyObject(body);

		if (route === "POST /api/investigate/domains") {
			const name = parseDomain(fields.domain);
			if (!name) throw new HttpError(400, "Type a domain such as example.com");
			if (!(await readDomains(investigateDomainsPath)).domains[name]) {
				// When the monitor already watches this domain, its record serves here too.
				let token: string | null = null;
				if (monitor) {
					const answer = await callMonitor(monitor, "GET", `/domains/${encodeURIComponent(name)}`, undefined, options.fetchFn).catch(() => null);
					if (answer?.status === 200) token = tokenFromChallenge(answer.body?.domain?.challenge?.value);
				}
				// One change at a time, so two domains added together are both kept (B21).
				await changeDomains(investigateDomainsPath, (file) => {
					if (file.domains[name]) return false;
					file.domains[name] = { token: token ?? newToken(), addedAt: new Date().toISOString(), source: token ? "monitor" : "local" };
					return true;
				});
			}
			return sendJson(res, 200, { domains: await investigateDomains() });
		}
		if (route === "POST /api/investigate/domains/remove") {
			const name = parseDomain(fields.domain);
			if (!name) throw new HttpError(400, "Type a domain such as example.com");
			if (investigation?.run.domain === name) throw new HttpError(409, "Stop the investigation of this domain first");
			await changeDomains(investigateDomainsPath, (file) => delete file.domains[name]);
			return sendJson(res, 200, { domains: await investigateDomains() });
		}
		if (route === "POST /api/investigate/verify") {
			const { name, token } = await addedDomain(fields);
			const verified = await proveOwnership(name, token);
			if (verified) {
				await changeDomains(investigateDomainsPath, (file) => {
					const entry = file.domains[name];
					if (entry) entry.verifiedAt = new Date().toISOString();
					return entry !== undefined;
				});
			}
			return sendJson(res, 200, { verified, domains: await investigateDomains() });
		}
		if (route === "POST /api/investigate/approve") {
			const active = investigation;
			if (!active || active.run.id !== fields.run || !active.approval || active.approval.stepId !== fields.step) {
				throw new HttpError(409, "That action is no longer waiting for approval");
			}
			if (typeof fields.approve !== "boolean") throw new HttpError(400, "Say whether to approve");
			// "rest": this action and every later one of this run. It can only go with a yes.
			if (fields.rest !== undefined && typeof fields.rest !== "boolean") throw new HttpError(400, "Say whether to approve the rest of the run");
			const rest = fields.rest === true;
			if (rest && !fields.approve) throw new HttpError(400, "The rest of a run can be approved, not denied. Use Stop to end it");
			const { resolve: answer } = active.approval;
			active.approval = null;
			answer(rest ? "rest" : fields.approve);
			if (rest) log(`Investigation of ${active.run.domain}: you approved the rest of its requests at turn ${active.run.turns}`);
			return sendJson(res, 200, { approved: fields.approve, rest });
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
		// A run is recorded only once ownership is proven, which takes a DNS lookup. Until then this flag
		// refuses a second start, so no run is ever started that Stop cannot reach (S24).
		if (investigationStarting) throw new HttpError(409, "An investigation is already starting");
		investigationStarting = true;
		const { name, token, goal, maxTurns, approveAll, hosted } = await (async () => {
			const { name, token } = await addedDomain(fields);
			const goal = fields.goal === undefined || fields.goal === "" ? DEFAULT_GOAL : fields.goal;
			if (typeof goal !== "string" || goal.trim() === "" || goal.length > MAX_GOAL) throw new HttpError(400, `Write a goal of 1 to ${MAX_GOAL} characters`);
			const maxTurns = fields.maxTurns ?? DEFAULT_MAX_TURNS;
			if (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > MAX_TURNS_LIMIT) throw new HttpError(400, `Choose 1 to ${MAX_TURNS_LIMIT} turns`);
			// Approving every request of the run at its start is the owner's choice, said plainly or not at all.
			if (fields.approveAll !== undefined && typeof fields.approveAll !== "boolean") throw new HttpError(400, "Say whether to approve the run's requests now");
			const approveAll = fields.approveAll === true;
			const hosted = isHosted(config);
			// The page shows what will be sent; a hosted model is used only once the owner has said yes to it.
			if (hosted && fields.sendsToHosted !== true) throw new HttpError(409, investigationDisclosure(config));
			confirmModel(fields, config);
			if (!(await proveOwnership(name, token))) {
				throw new HttpError(409, `The TXT record ${challengeName(name)} does not hold ${challengeValue(token)} yet. Publish it, wait a few minutes, and check again`);
			}
			return { name, token, goal, maxTurns, approveAll, hosted };
		})().finally(() => {
			investigationStarting = false;
		});

		const run = newRun({ domain: name, goal: goal.trim(), model: config.model, modelHost: config.url.host, hosted, maxTurns, minGapMs: options.investigateMinGapMs ?? DEFAULT_MIN_GAP_MS, approveAll });
		const stop = new AbortController();
		const stepsNoted = new Set<string>();
		const waitingNoted = new Set<string>();
		const active: InvestigationJob = { run, stop, approval: null };
		investigation = active;
		await saveActive(run);
		// The log goes to the project in use now, also for the line written when the run ends.
		const logTo = await projects.current();
		log(`Investigation of ${name} started: ${modelWords(config)}, at most ${maxTurns} turns, ${approveAll ? "every request approved at the start" : "each request waits for your approval"}`, logTo);
		// Not awaited: the run outlives this request and the page polls for progress.
		void investigate(run, {
			ask: async (system, user, signal) => {
				const local = !hosted;
				note(`Investigation of ${name}, turn ${run.turns}: asking ${modelWords(config)} for the next step`);
				// The owner's own model answers one request at a time; Explain and Ask wait their turn.
				while (local && modelBusy && !signal.aborted) await abortableSleep(500, signal);
				if (local) modelBusy = true;
				try {
					return await chat(config, [{ role: "system", content: system }, { role: "user", content: user }], { fetchFn: options.fetchFn, signal, timeoutMs: INVESTIGATE_TIMEOUT_MS, maxTokens: INVESTIGATE_TOKENS, json: true });
				} finally {
					if (local) modelBusy = false;
				}
			},
			net: investigateNet,
			verify: async (signal) => {
				// Read again each time: a domain removed from the list is no longer proven.
				const entry = (await readDomains(investigateDomainsPath)).domains[name];
				if (entry === undefined || entry.token !== token) return false;
				if (await checkOwnership(name, token, options.fetchFn ?? fetch, signal)) return true;
				// A resolver can miss a record that is there, just after it was published. Asked once more
				// before the run is stopped; the answer still has to be yes for anything to be sent.
				await abortableSleep(options.investigateMinGapMs === 0 ? 0 : OWNERSHIP_RECHECK_MS, signal);
				return !signal.aborted && (await checkOwnership(name, token, options.fetchFn ?? fetch, signal));
			},
			approve: (request, signal) =>
				new Promise<ApprovalAnswer>((resolveApproval) => {
					const done = (answer: ApprovalAnswer) => {
						signal.removeEventListener("abort", abort);
						if (active.approval?.stepId === request.stepId) active.approval = null;
						resolveApproval(answer);
					};
					const abort = () => done(false);
					if (signal.aborted) return done(false);
					signal.addEventListener("abort", abort, { once: true });
					active.approval = { stepId: request.stepId, resolve: done };
				}),
			limiter: new RateLimiter(run.minGapMs),
			hidden: [token],
			onChange: (changed) => {
				for (const step of changed.steps) {
					if (step.outcome === "waiting" && !waitingNoted.has(step.id)) {
						waitingNoted.add(step.id);
						note(`Investigation of ${name}, turn ${step.turn}: ${step.description ?? "an action"} is waiting for your approval`, "warning");
					}
					if (step.outcome === "waiting" || stepsNoted.has(step.id)) continue;
					// A step that ran under the run's approval is saved once more when it finishes; noted then.
					if (step.outcome === "refused" && step.reason === undefined) continue;
					stepsNoted.add(step.id);
					// The model's words never reach the Activity view: a tool it named that is not one is said in fixed words (S37).
					const what = step.description ?? (step.tool ? (INVESTIGATION_TOOLS.some((tool) => tool.name === step.tool) ? `${step.tool} (refused)` : "an action that is not one of the tools") : "no action");
					note(`Investigation of ${name}, turn ${step.turn}: ${what}: ${step.outcome}`, step.outcome === "ran" ? "good" : step.outcome === "no action" ? "info" : "warning");
				}
				return saveActive(changed);
			},
		}, stop.signal)
			.catch(() => {})
			.finally(async () => {
				await runSaves;
				if (investigation === active) investigation = null;
				const actions = run.evidence.length;
				const found = run.findings.length;
				log(`Investigation of ${name} ${RUN_ENDINGS[run.status] ?? "ended"}: ${actions} ${actions === 1 ? "action" : "actions"} run, ${found} ${found === 1 ? "finding" : "findings"} from the model`, logTo);
				await runStore.prune().catch(() => {});
			});
		return sendJson(res, 202, { run });
	}

	function saveActive(run: Run): Promise<void> {
		runSaves = runSaves.then(() => runStore.save(run)).catch((err) => console.error(`porchlight ui: could not save the investigation: ${err instanceof Error ? err.message : String(err)}`));
		return runSaves;
	}

	// The Cloudflare account audit: the owner's token, kept beside the report and never sent to the page.
	const cloudflareTokenPath = join(dataDir, "cloudflare-settings.json");
	const cloudflareAuditPath = join(dataDir, "cloudflare-audit.json");
	const cloudflareChangesPath = join(dataDir, "cloudflare-changes.json");
	let cloudflareStatus: CloudflareStatus = { state: "idle" };
	/** What Cloudflare last said about the token in use. Never the token. */
	let cloudflareVerified: { status: string; kind: "user" | "account"; expiresOn?: string; checkedAt: string } | null = null;
	/** Changes shown to the owner and waiting for their answer, by their random id. */
	const pendingChanges = new Map<string, PlannedChange>();
	/** The set of changes shown to the owner and waiting for one answer; a new preview replaces it. */
	let pendingBatch: { id: string; createdAt: number; changes: PlannedChange[] } | null = null;
	let batchStatus: BatchStatus = { state: "idle" };
	/** Write permissions Cloudflare refused this token, so the page can say what to add before the next try. */
	const lacking = new Set<string>();
	let batchStop: AbortController | null = null;

	/** The token in use: the one saved under Settings → Cloudflare, else the one given at start-up. */
	async function cloudflareToken(): Promise<{ token: string; source: "settings" | "startup" } | null> {
		const saved = await readSavedToken(cloudflareTokenPath);
		if (saved) return { token: saved.token, source: "settings" };
		return options.cloudflareToken ? { token: options.cloudflareToken, source: "startup" } : null;
	}

	/** What the page may know about the token: whether there is one, where it came from, what Cloudflare said. */
	async function cloudflareTokenState() {
		const saved = await readSavedToken(cloudflareTokenPath);
		const source = saved ? "settings" : options.cloudflareToken ? "startup" : null;
		return {
			configured: source !== null,
			source,
			...(saved?.savedAt ? { savedAt: saved.savedAt } : {}),
			...(options.cloudflareTokenError && !saved ? { error: options.cloudflareTokenError } : {}),
			...(cloudflareVerified ? { verified: cloudflareVerified } : {}),
		};
	}

	function cloudflareGuide() {
		return { read: READ_PERMISSIONS, write: WRITE_PERMISSIONS, templateUrl: TOKEN_TEMPLATE_URL };
	}

	async function cloudflareRoute(res: ServerResponse, route: string, url: URL, body: unknown, gate: Gate): Promise<void> {
		// Saving a token and changing the account are for this computer's page only; reading is for any page with the key.
		const here = gate.loopbackOnly && !gate.tailnet;
		if (route === "GET /api/cloudflare") {
			const changes = await readChanges(cloudflareChangesPath);
			return sendJson(res, 200, {
				token: await cloudflareTokenState(),
				status: cloudflareStatus,
				report: await readAudit(cloudflareAuditPath),
				changes: changes.slice(-50).reverse(),
				batch: batchStatus,
				lacking: [...lacking],
				canChange: here,
				service: !loopbackOnly,
				guide: cloudflareGuide(),
				assistant: assistantSummary(),
			});
		}
		if (route === "GET /api/cloudflare/token") return sendJson(res, 200, { token: await cloudflareTokenState(), canChange: here, guide: cloudflareGuide() });
		if (route === "GET /api/cloudflare/export" || route === "POST /api/cloudflare/export") {
			const report = await readAudit(cloudflareAuditPath);
			if (!report) throw new HttpError(404, "There is no Cloudflare audit yet. Run one first.");
			const format = url.searchParams.get("format") ?? "md";
			if (!(CF_FORMATS as readonly string[]).includes(format)) throw new HttpError(400, `Choose a format: ${CF_FORMATS.join(", ")}`);
			const zone = url.searchParams.get("zone");
			if (zone !== null && !report.zones.some((candidate) => candidate.id === zone)) throw new HttpError(404, "That zone is not in the latest audit");
			const file = exportCloudflare(report, format as CfFormat, zone);
			// POST writes it into the project in use; GET hands it to the browser to save.
			if (route === "POST /api/cloudflare/export") return saveExport(res, file, "cloudflare");
			log(`Exported ${FILE_TITLES.cloudflare} (${format}) as a download`);
			return sendDownload(res, file);
		}
		if (route === "POST /api/cloudflare/audit") {
			if (cloudflareStatus.state === "running") throw new HttpError(409, "A Cloudflare audit is already running");
			const lookups = bodyObject(body).lookups;
			if (lookups !== undefined && typeof lookups !== "boolean") throw new HttpError(400, "lookups must be true or false");
			// Running before the first await, so a second request is refused (B24); as it was if the audit cannot start.
			const earlierAudit = cloudflareStatus;
			cloudflareStatus = { state: "running", startedAt: new Date().toISOString(), done: 0, total: 0, current: "" };
			let token: Awaited<ReturnType<typeof cloudflareToken>>;
			let ownership: Awaited<ReturnType<typeof readDomains>>;
			try {
				token = await cloudflareToken();
				if (!token) throw new HttpError(409, "Connect Cloudflare first: paste an API token in Settings → Cloudflare");
				ownership = await readDomains(investigateDomainsPath);
			} catch (err) {
				cloudflareStatus = earlierAudit;
				throw err;
			}
			const project = await projects.current();
			log("Cloudflare audit started", project);
			// Not awaited: the page polls for progress, as it does for a scan.
			void auditCloudflare({
				token: token.token,
				fetchFn: options.fetchFn,
				lookups: lookups !== false,
				ownershipTokens: Object.fromEntries(Object.entries(ownership.domains).map(([name, entry]) => [name, entry.token])),
				onProgress: ({ done, total, current }) => {
					if (cloudflareStatus.state === "running") cloudflareStatus = { ...cloudflareStatus, done, total, current };
				},
			})
				.then(async (report) => {
					await saveAudit(cloudflareAuditPath, report);
					// A request shown before this audit was planned from what it replaced: it is asked for again (S28).
					pendingChanges.clear();
					pendingBatch = null;
					cloudflareVerified = { status: report.token.status, kind: report.token.kind, ...(report.token.expiresOn ? { expiresOn: report.token.expiresOn } : {}), checkedAt: report.checkedAt };
					cloudflareStatus = { state: "done", finishedAt: new Date().toISOString() };
					const problems = [...report.zones.flatMap((zone) => zone.checks), ...report.accounts.flatMap((account) => account.checks), ...report.userChecks].filter((item) => item.status === "failed").length;
					log(`Cloudflare audit finished: ${report.zones.length} ${report.zones.length === 1 ? "zone" : "zones"}, ${problems} ${problems === 1 ? "problem" : "problems"}`, project);
				})
				.catch((err) => {
					cloudflareStatus = { state: "failed", finishedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) };
					log("Cloudflare audit failed", project);
				});
			return sendJson(res, 202, { status: cloudflareStatus });
		}
		if (!here) throw new HttpError(403, "The Cloudflare token and changes to your account are managed from the page on the computer that runs Porchlight");
		const fields = bodyObject(body);

		if (route === "POST /api/cloudflare/token") {
			const token = typeof fields.token === "string" ? fields.token.trim() : "";
			const problem = tokenShapeProblem(token);
			if (problem) throw new HttpError(400, problem);
			// Checked with Cloudflare before it is saved, so a mistake never replaces a working token.
			const verified = await new CfClient(token, options.fetchFn ?? fetch).verify();
			if (!verified.ok) throw new HttpError(400, verified.message ?? `Cloudflare says this token is ${verified.status ?? "not active"}`);
			await saveToken(cloudflareTokenPath, token);
			lacking.clear();
			cloudflareVerified = { status: verified.status ?? "active", kind: verified.kind, ...(verified.expiresOn ? { expiresOn: verified.expiresOn } : {}), checkedAt: new Date().toISOString() };
			return sendJson(res, 200, { token: await cloudflareTokenState() });
		}
		if (route === "POST /api/cloudflare/token/remove") {
			await forgetToken(cloudflareTokenPath);
			cloudflareVerified = null;
			pendingChanges.clear();
			pendingBatch = null;
			batchStop?.abort();
			lacking.clear();
			return sendJson(res, 200, { token: await cloudflareTokenState() });
		}
		if (route === "POST /api/cloudflare/changes/preview") {
			const report = await readAudit(cloudflareAuditPath);
			const zone = report?.zones.find((candidate) => candidate.id === fields.zone);
			if (!report || !zone) throw new HttpError(404, "That zone is not in the latest audit. Run the audit again.");
			const change = fields.change;
			if (!isChangeId(change)) throw new HttpError(400, "Choose one of the changes the audit offers");
			// Only a change the audit offered for a problem it found in this zone.
			if (!zone.checks.some((item) => item.change === change && item.status === "failed")) throw new HttpError(409, "The latest audit does not suggest that change for this zone");
			let ownershipToken: string | undefined;
			if (change === "ownership-record") ownershipToken = (await readDomains(investigateDomainsPath)).domains[zone.name]?.token ?? newToken();
			const planned = planChange(zone, change, ownershipToken, report.checkedAt);
			for (const [id, waiting] of pendingChanges) if (Date.now() - waiting.createdAt > APPROVAL_WINDOW_MS) pendingChanges.delete(id);
			if (pendingChanges.size >= MAX_PENDING_CHANGES) throw new HttpError(409, "Answer the changes already waiting first");
			pendingChanges.set(planned.id, planned);
			return sendJson(res, 200, { pending: describeChange(planned) });
		}
		if (route === "POST /api/cloudflare/changes/approve") {
			const planned = typeof fields.id === "string" ? pendingChanges.get(fields.id) : undefined;
			if (!planned || Date.now() - planned.createdAt > APPROVAL_WINDOW_MS) {
				if (planned) pendingChanges.delete(planned.id);
				throw new HttpError(409, "That change is no longer waiting. Ask for it again to see the request.");
			}
			if (typeof fields.approve !== "boolean") throw new HttpError(400, "Say whether to apply it");
			// One at a time: the same template could otherwise go out twice, once from each (CF-S2).
			if (fields.approve && batchStatus.state === "running") throw new HttpError(409, "Changes are being sent now. Wait for them to finish, or stop them");
			pendingChanges.delete(planned.id);
			if (!fields.approve) return sendJson(res, 200, { applied: false });
			const token = await cloudflareToken();
			if (!token) throw new HttpError(409, "Connect Cloudflare first: paste an API token in Settings → Cloudflare");
			if (!(await fromLatestAudit(planned))) throw new HttpError(409, "A newer audit replaced the one this request was planned from. Ask for it again.");
			if (await ownershipTokenChanged(planned)) throw new HttpError(409, "The token for this domain changed since the request was shown. Ask for it again.");
			const { outcome, changes } = await applyPlanned(planned, token.token);
			return sendJson(res, 200, { applied: true, ok: outcome.ok, ...(outcome.notSent ? { notSent: true } : {}), result: outcome.result, changes: changes.slice(-50).reverse(), lacking: [...lacking] });
		}

		// "Fix these": every change the latest audit offers, for one zone or all, shown as the exact
		// requests and sent after one approval. The same fixed templates, each sent once and recorded.
		if (route === "POST /api/cloudflare/changes/batch/stop") {
			// What was already sent stays sent; the rest are not.
			batchStop?.abort();
			return sendJson(res, 200, { stopped: batchStop !== null });
		}
		if (route === "POST /api/cloudflare/changes/batch/preview") {
			if (batchStatus.state === "running") throw new HttpError(409, "Changes are being sent now. Wait for them to finish, or stop them");
			const report = await readAudit(cloudflareAuditPath);
			if (!report) throw new HttpError(404, "There is no Cloudflare audit yet. Run one first.");
			let zones = report.zones;
			if (fields.zone !== undefined) {
				zones = report.zones.filter((candidate) => candidate.id === fields.zone);
				if (zones.length === 0) throw new HttpError(404, "That zone is not in the latest audit. Run the audit again.");
			}
			const domains = (await readDomains(investigateDomainsPath)).domains;
			const { changes: planned, offered } = planBatch(zones, (name) => domains[name]?.token ?? newToken(), report.checkedAt);
			if (planned.length === 0) throw new HttpError(409, "The latest audit found nothing here that Porchlight can change");
			pendingBatch = { id: randomBytes(12).toString("hex"), createdAt: Date.now(), changes: planned };
			// `offered`: every change the audit offers here, so the page can say when one approval covers only some (F-F5).
			return sendJson(res, 200, { batch: { id: pendingBatch.id, expiresAt: new Date(pendingBatch.createdAt + APPROVAL_WINDOW_MS).toISOString(), changes: planned.map(describeChange), offered } });
		}
		if (route === "POST /api/cloudflare/changes/batch/approve") {
			const batch = pendingBatch;
			if (!batch || batch.id !== fields.id || Date.now() - batch.createdAt > APPROVAL_WINDOW_MS) {
				if (batch && batch.id === fields.id) pendingBatch = null;
				throw new HttpError(409, "Those changes are no longer waiting. Ask for them again to see the requests.");
			}
			if (typeof fields.approve !== "boolean") throw new HttpError(400, "Say whether to send them");
			// Some may be left out; none can be added. Each name must be one of the requests that was shown.
			// A change that carries a warning is sent only when it is named: a bare yes never covers it.
			let chosen = batch.changes.filter((change) => !change.care);
			if (fields.include !== undefined) {
				const include = fields.include;
				if (!Array.isArray(include) || !include.every((id) => typeof id === "string" && batch.changes.some((change) => change.id === id))) {
					throw new HttpError(400, "Choose among the changes that were shown");
				}
				chosen = batch.changes.filter((change) => include.includes(change.id));
			}
			if (fields.approve && chosen.length === 0) throw new HttpError(400, "Choose at least one change to send");
			if (batchStatus.state === "running") throw new HttpError(409, "Changes are being sent now");
			pendingBatch = null;
			if (!fields.approve) return sendJson(res, 200, { started: false });
			const token = await cloudflareToken();
			if (!token) throw new HttpError(409, "Connect Cloudflare first: paste an API token in Settings → Cloudflare");
			if (!(await fromLatestAudit(batch.changes[0]))) throw new HttpError(409, "A newer audit replaced the one these requests were planned from. Ask for them again.");
			const startedAt = new Date().toISOString();
			const stop = new AbortController();
			batchStop = stop;
			batchStatus = { state: "running", startedAt, total: chosen.length, done: 0, applied: 0, failed: 0, skipped: 0, current: "" };
			const logTo = await projects.current();
			log(`Cloudflare changes approved together: ${chosen.length}, on ${new Set(chosen.map((change) => change.zone)).size} ${new Set(chosen.map((change) => change.zone)).size === 1 ? "domain" : "domains"}`, logTo);
			// Not awaited: the page follows it in the Activity view.
			void (async () => {
				let applied = 0;
				let failed = 0;
				let skipped = 0;
				// A permission the token turned out to lack: the rest that need it are not sent, only said.
				const lacking = new Set<string>();
				for (const planned of chosen) {
					if (stop.signal.aborted) break;
					if (batchStatus.state === "running") batchStatus = { ...batchStatus, current: planned.title };
					if (lacking.has(planned.permission)) {
						skipped += 1;
						note(`Not sent: ${planned.title}. The token lacks "${planned.permission}"`, "warning");
					} else if (await ownershipTokenChanged(planned)) {
						skipped += 1;
						note(`Not sent: ${planned.title}. The token for this domain changed since the request was shown`, "warning");
					} else {
						note(`Sending: ${planned.title}`);
						try {
							const { outcome } = await applyPlanned(planned, token.token, logTo);
							if (outcome.ok) applied += 1;
							else if (outcome.notSent) skipped += 1;
							else failed += 1;
							if (outcome.denied) lacking.add(planned.permission);
						} catch (err) {
							failed += 1;
							note(`Could not send: ${planned.title}. ${err instanceof Error ? err.message : String(err)}`.split(token.token).join("[token]"), "warning");
						}
					}
					if (batchStatus.state === "running") batchStatus = { ...batchStatus, done: applied + failed + skipped, applied, failed, skipped };
				}
				const stopped = stop.signal.aborted;
				batchStatus = { state: "finished", startedAt, finishedAt: new Date().toISOString(), total: chosen.length, applied, failed, skipped, stopped };
				if (batchStop === stop) batchStop = null;
				log(`Cloudflare changes ${stopped ? "stopped" : "finished"}: ${applied} applied, ${failed} refused, ${skipped + (stopped ? chosen.length - applied - failed - skipped : 0)} not sent`, logTo);
			})();
			return sendJson(res, 202, { started: true, batch: batchStatus });
		}
		throw new HttpError(404, "Not found");
	}

	/** Whether a change was planned from the audit that is still the latest: a newer one may have found the problem gone (S28). */
	async function fromLatestAudit(planned: PlannedChange | undefined): Promise<boolean> {
		const latest = await readAudit(cloudflareAuditPath);
		return planned !== undefined && latest !== null && planned.auditAt === latest.checkedAt;
	}

	/** For the ownership record: whether this computer's token for the domain changed after the request was shown. */
	async function ownershipTokenChanged(planned: PlannedChange): Promise<boolean> {
		if (planned.change !== "ownership-record") return false;
		const entry = (await readDomains(investigateDomainsPath)).domains[planned.zone];
		return entry !== undefined && entry.token !== planned.ownershipToken;
	}

	/** Sends one approved change, exactly as planned, and records it whether Cloudflare accepted it or not. */
	async function applyPlanned(planned: PlannedChange, token: string, project?: Project | null) {
		const outcome = await sendChange(new CfClient(token, options.fetchFn ?? fetch), planned);
		// Kept for the investigation and the audit: the record now holds this token.
		if (outcome.ok && planned.change === "ownership-record" && planned.ownershipToken) {
			const token = planned.ownershipToken;
			await changeDomains(investigateDomainsPath, (file) => {
				if (file.domains[planned.zone]) return false;
				file.domains[planned.zone] = { token, addedAt: new Date().toISOString(), source: "local" };
				return true;
			});
		}
		// The change's title is Porchlight's, from its own list; the request and the token stay out of the log.
		log(`Cloudflare change ${outcome.ok ? "applied" : outcome.notSent ? "not sent" : "failed"}: ${planned.title}, on ${planned.zone}`, project);
		if (outcome.notSent) note(`${outcome.result.replace(/^Not sent: /, `Not sent: ${planned.title}. `)}`, "warning");
		else if (!outcome.ok) note(`Cloudflare refused: ${planned.title}. ${outcome.result}`, "warning");
		if (outcome.denied) lacking.add(planned.permission);
		else if (outcome.ok) lacking.delete(planned.permission);
		const changes = await recordChange(cloudflareChangesPath, {
			at: new Date().toISOString(),
			zone: planned.zone,
			zoneId: planned.zoneId,
			change: planned.change,
			title: planned.title,
			request: { method: planned.method, url: planned.url, body: planned.body },
			ok: outcome.ok,
			result: outcome.result,
			...(outcome.notSent ? { notSent: true } : {}),
		});
		return { outcome, changes };
	}

	const localGate: Gate = { loopbackOnly, key: () => sessionKey, port: () => port, tailnet: false };
	const respond = (gate: Gate) => (req: IncomingMessage, res: ServerResponse) => {
		handle(req, res, gate).catch((err) => {
			// An export that cannot be made is the caller's mistake, and the message says what to change.
			const known = err instanceof HttpError || err instanceof ExportError || err instanceof ProjectError;
			if (!known) console.error(`porchlight ui: ${err instanceof Error ? err.message : String(err)}`);
			// A project folder that cannot be written is a state to put right, said in the owner's terms.
			sendJson(res, err instanceof HttpError ? err.status : err instanceof ProjectError ? 409 : known ? 400 : 500, { error: known ? err.message : "Internal error" });
		});
	};
	const server = createServer(respond(localGate));

	/**
	 * Every request comes through here: first the gate, which decides whether it is answered at all,
	 * then the first route in the table that claims it.
	 */
	async function handle(req: IncomingMessage, res: ServerResponse, gate: Gate): Promise<void> {
		const call = await admit(req, res, gate);
		if (!call) return;
		for (const [claims, answer, changes = "any"] of (routeTable ??= routes())) {
			if (!claims(call)) continue;
			// Settings that decide where data goes or what is kept are changed from the owner's own page (S20).
			if (call.req.method !== "GET" && !mayChange(changes, call.gate)) throw new HttpError(403, "This is changed from the page on the computer that runs Porchlight");
			return answer(call);
		}
		throw new HttpError(404, "Not found");
	}

	/**
	 * The gate. A request reaches the API only with this server's own Host (which defeats DNS
	 * rebinding), no cross-site Origin, and the key of the listener it came in on. The health check
	 * and the page's own files are answered here, without the key, and nothing else is. Returns null
	 * when the request has been answered.
	 */
	async function admit(req: IncomingMessage, res: ServerResponse, gate: Gate): Promise<Call | null> {
		const host = req.headers.host ?? "";
		if (!hostAllowed(host, gate.port(), gate.loopbackOnly)) throw new HttpError(403, "Forbidden host");
		const url = new URL(req.url ?? "/", `http://${host}`);

		// For container health checks: says only that the server is up.
		if (url.pathname === "/healthz") {
			if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
			res.writeHead(200, { ...SECURITY_HEADERS, "content-type": "text/plain; charset=utf-8" });
			res.end("ok\n");
			return null;
		}

		if (!url.pathname.startsWith("/api/")) {
			if (req.method !== "GET") throw new HttpError(405, "Method not allowed");
			const entry = STATIC_FILES[url.pathname];
			if (!entry) throw new HttpError(404, "Not found");
			res.writeHead(200, { ...SECURITY_HEADERS, "content-type": entry.type });
			res.end(await readFile(join(UI_DIR, entry.file)));
			return null;
		}

		if (!originAllowed(req.headers.origin, host, gate.loopbackOnly)) throw new HttpError(403, "Cross-site request refused");
		// Says where the reader's key is kept: a service's settings, or Settings on the computer that runs Porchlight, for another device.
		if (!sessionMatches(req.headers[SESSION_HEADER], gate.key())) {
			sendJson(res, 401, { error: "Session key required", service: !gate.loopbackOnly && !gate.tailnet, tailnet: gate.tailnet });
			return null;
		}

		const body = req.method === "POST" ? await readJsonBody(req) : undefined;
		return { req, res, url, route: `${req.method} ${url.pathname}`, body, gate };
	}

	let routeTable: Route[] | undefined;

	/**
	 * What answers what, in order: the first entry that claims a request answers it, so a narrower
	 * path comes before the wider one that contains it (/api/model/local before /api/model, a
	 * domain's export before /api/domains). Built on the first request, once everything it names exists.
	 */
	function routes(): Route[] {
		const exact = (route: string) => (call: Call) => call.route === route;
		/** A path and everything beneath it, whatever the method: the handler says which methods it takes. */
		const under = (path: string) => (call: Call) => call.url.pathname === path || call.url.pathname.startsWith(`${path}/`);
		const paths = (...names: string[]) => (call: Call) => names.includes(call.url.pathname);
		return [
			[exact("GET /api/state"), stateRoute],
			[exact("POST /api/repos/send"), ({ res, body }) => sendRoute(res, body)],
			[under("/api/projects"), ({ res, route, url, body, gate }) => projectsRoute(res, route, url, body, gate)],
			[under("/api/discussions"), ({ res, route, url, body }) => discussionRoute(res, route, url, body)],
			[paths("/api/host", "/api/host/check"), ({ res, route, body }) => hostRoute(res, route, body)],
			[under("/api/investigate"), ({ res, route, url, body, gate }) => investigateRoute(res, route, url, body, gate)],
			[under("/api/cloudflare"), ({ res, route, url, body, gate }) => cloudflareRoute(res, route, url, body, gate)],
			[under("/api/monitor"), ({ res, route, body, gate }) => monitorRoute(res, route, body, gate), "here"],
			[exact("GET /api/activity"), activityRoute],
			[exact("GET /api/repos/history"), historyRoute],
			[exact("POST /api/findings/note"), ({ res, body }) => noteRoute(res, body)],
			[exact("GET /api/busy"), ({ res }) => sendJson(res, 200, { busy: busyWork() })],
			[exact("POST /api/view"), viewRoute],
			[exact("POST /api/settings"), settingsRoute],
			[under("/api/model/local"), ({ res, route, url, body, gate }) => downloadRoute(res, route, url, body, gate), "here"],
			// Where the owner's data is sent, under which key, and a probe of any address: never from another device (S20).
			[under("/api/model"), ({ res, route, body }) => modelRoute(res, route, body), "owner"],
			[under("/api/access"), ({ res, route, body, gate }) => accessRoute(res, route, body, gate), "here"],
			[(call) => call.url.pathname.startsWith("/api/assist/"), ({ req, res, url, body }) => assist(req, res, url.pathname.slice("/api/assist/".length), body)],
			[
				exact("GET /api/repos/report"),
				async ({ res }) => {
					// Notes that cannot be read are said beside the report, never a reason the report cannot be shown.
					const notes = await notesForPage(notesPath);
					return sendJson(res, 200, { ...(await loadReport(options.reportPath, analysisPath)), findingNotes: notes.notes, ...(notes.problem ? { notesProblem: notes.problem } : {}) });
				},
			],
			[paths("/api/analysis", "/api/analysis/stop"), ({ res, route, body }) => analysisRoute(res, route, body)],
			[
				exact("POST /api/repos/mural/stop"),
				({ res }) => {
					stopMural?.abort();
					return sendJson(res, 200, { stopped: stopMural !== null });
				},
			],
			[(call) => call.route === "GET /api/repos/roadmap" || call.url.pathname === "/api/repos/export" || call.url.pathname === "/api/repos/mural", roadmapRoute],
			[exact("GET /api/repos/scan"), ({ res }) => sendJson(res, 200, { scan: status })],
			[exact("GET /api/repos/sbom"), sbomRoute],
			[
				exact("GET /api/repos/preview"),
				async ({ res, url }) => sendJson(res, 200, { preview: await previewScan(url.searchParams.get("root") ?? options.defaultRoot, url.searchParams.get("depth"), github.dir) }),
			],
			[under("/api/github"), ({ res, route, url, body }) => githubRoute(res, route, url, body)],
			[
				exact("POST /api/repos/scan"),
				async ({ res, body }) => {
					const { root, depth, choices, sendsToHosted, shown } = await scanRequest(body, defaultDepth);
					return sendJson(res, 202, { scan: await beginScan(root, depth, { choices, sendsToHosted, ...(shown ? { shown } : {}) }) });
				},
			],
			[exact("POST /api/repos/scan/cancel"), cancelScanRoute],
			[exact("POST /api/repos/rescan"), async ({ res, body }) => sendJson(res, 202, { scan: await beginRescan(textField(bodyObject(body), "repo", 1000)) })],
			[(call) => DOMAIN_EXPORT.test(call.url.pathname), domainExportRoute],
			[
				under("/api/domains"),
				async ({ req, res, url, body }) => {
					const [code, answer] = await proxyToMonitor(req.method ?? "GET", url.pathname, body);
					return sendJson(res, code, withSuggestions(answer));
				},
			],
		];
	}

	/** What the page needs to draw itself: where things are, what is set up, never a secret. */
	async function stateRoute({ res, gate }: Call): Promise<void> {
		return sendJson(res, 200, {
			defaultRoot: options.defaultRoot,
			reportPath: options.reportPath,
			// What the scan form starts from, and how often a service scans by itself (0: only when asked).
			scanDepth: defaultDepth,
			scanEveryHours: options.scanEveryHours ?? 0,
			scan: status,
			...(await readUiSettings(settingsPath)),
			// A service (a container, under BoxPilot) is configured where it is managed, not from a shell,
			// so the page explains connecting the monitor in those terms.
			service: !loopbackOnly,
			// Opened from another device over the tailnet, rather than on this computer.
			remote: gate.tailnet,
			// The computer Porchlight runs on, so the page can call it "This Mac".
			platform: process.platform,
			monitor: monitorState(),
			// Whether a token is set, never the token.
			github: { token: github.token !== undefined, ...(options.githubError ? { error: options.githubError } : {}) },
			assistant: assistantSummary(),
			lastView: await readView(viewPath),
			// The projects, and the one exports, discussions and the log go to.
			projects: await projectsState(gate),
			// Whether Cloudflare is connected and how, never the token.
			cloudflare: await cloudflareTokenState(),
			// What "Send to a model" offers. Never a key: only where each one runs and which model.
			sendTargets: targets().map((target) => ({ id: target.id, label: target.label, model: target.config.model, host: target.config.url.host, hosted: target.hosted, current: target.current })),
		});
	}

	function activityRoute({ res, url }: Call): void {
		const after = Number(url.searchParams.get("after") ?? 0);
		const from = Number.isInteger(after) && after >= 0 ? after : 0;
		return sendJson(res, 200, { lines: activity.filter((line) => line.n > from), last: activityCount });
	}

	async function historyRoute({ res }: Call): Promise<void> {
		const report = await readReport(options.reportPath);
		// Kept scans that cannot be read are said, never shown as none (B25, B68).
		let scans: HistoryEntry[] = [];
		let problem: string | undefined;
		try {
			scans = (await history.list()).reverse();
		} catch (err) {
			problem = err instanceof Error ? err.message : String(err);
		}
		const latest = report ? await history.compare(report) : ({ state: "first" } as const);
		return sendJson(res, 200, {
			scans,
			change: latest.state === "compared" ? latest.change : null,
			...(problem ? { problem } : {}),
			...(latest.state === "unreadable" ? { changeProblem: latest.reason } : {}),
		});
	}

	/** Where the owner is in the page, kept so the app opens there again. */
	async function viewRoute({ res, body }: Call): Promise<void> {
		const view = bodyObject(body).view;
		// A place in the page, with its filters; never the session key, which lives only in the fragment it came in.
		if (typeof view !== "string" || !/^#\/[^\s]{0,1000}$/.test(view) || /(?:^|[#&?])k=/.test(view)) throw new HttpError(400, "Not a place in the page");
		await saveView(viewPath, view);
		return sendJson(res, 200, { view });
	}

	/** The look, and where a model's answers appear. */
	async function settingsRoute({ res, body }: Call): Promise<void> {
		// Either preference, or both; whatever is left out stays as it was.
		const fields = bodyObject(body);
		if (fields.appearance === undefined && fields.answers === undefined) throw new HttpError(400, "Choose an appearance or where answers appear");
		if (fields.appearance !== undefined && !isLook(fields.appearance)) throw new HttpError(400, "Unknown appearance");
		if (fields.answers !== undefined && !isAnswerPlace(fields.answers)) throw new HttpError(400, "Unknown place for answers");
		const next = { ...(await readUiSettings(settingsPath)) };
		if (fields.appearance !== undefined) next.appearance = fields.appearance as string;
		if (fields.answers !== undefined) next.answers = fields.answers as string;
		await saveUiSettings(settingsPath, next);
		return sendJson(res, 200, next);
	}

	/** The roadmap for the page, an export of it or of the findings, and the mural an export can carry. */
	async function roadmapRoute({ req, res, url, route, body }: Call): Promise<void> {
		if (url.pathname === "/api/repos/export" && req.method !== "GET" && req.method !== "POST") throw new HttpError(405, "Method not allowed");
		const report = await readReport(options.reportPath);
		if (!report) throw new HttpError(404, "There is no scan yet. Scan a folder first.");
		const query = url.searchParams;
		const filter = parseFilter({ severity: query.get("severity"), kind: query.get("kind"), match: query.get("q"), repo: query.get("repo") });
		if (route === "GET /api/repos/roadmap") return sendJson(res, 200, { roadmap: buildRepoRoadmap(report, filter) });
		const key = muralKey(report, filter);
		if (url.pathname === "/api/repos/mural") return muralRoute(res, route, report, filter, key, body);
		let mural: Mural | undefined;
		if (query.get("mural") === "1") {
			if (muralJob.state !== "done" || muralJob.key !== key) throw new HttpError(409, "Write the mural first: it is made for this scan and these filters");
			mural = muralJob.mural;
		}
		const file = exportRepos(report, exportChoice(query), filter, mural);
		const title: FileTitle = `${exportChoice(query).content === "findings" ? "findings" : "roadmap"}${isFiltering(filter) ? "-partial" : ""}`;
		// POST writes it into the project in use; GET hands it to the browser to save.
		if (req.method === "POST") return saveExport(res, file, title);
		log(`Exported ${FILE_TITLES[title]} (${file.extension}) as a download`);
		return sendDownload(res, file);
	}

	/**
	 * A CycloneDX bill of materials of the latest scan's repositories, read offline. The repositories
	 * are the report's own, never a path from the request, and the file's name is a fixed stem and a date.
	 */
	async function sbomRoute({ res }: Call): Promise<void> {
		const report = await storedReport();
		let sbom;
		try {
			sbom = await buildSbom({ root: report.root, depth: 0, ...(options.run ? { run: options.run } : {}), repositories: report.repos.map((repo) => ({ path: repo.path, name: repoName(report, repo) })) });
		} catch (err) {
			throw new HttpError(503, err instanceof Error ? err.message : String(err));
		}
		const packages = sbom.components.reduce((sum, repo) => sum + repo.components.length, 0);
		log(`Exported a software bill of materials as a download: ${packages} packages in ${sbom.components.length} repositories${sbom.metadata.properties ? `, ${sbom.metadata.properties.length} not covered` : ""}`);
		return sendDownload(res, { contentType: "application/vnd.cyclonedx+json", filename: `porchlight-sbom-${new Date().toISOString().slice(0, 10)}.cdx.json`, body: jsonText(sbom) });
	}

	function cancelScanRoute({ res }: Call): void {
		if (status.state !== "running" || !scanCancel) throw new HttpError(409, "No scan is running");
		// The scanners are stopped; the scan's own ending (below, in beginScan) puts the status back.
		scanCancel.abort();
		return sendJson(res, 200, { scan: status });
	}

	/** A domain's repair roadmap or findings, from the monitor's latest report of it. */
	async function domainExportRoute({ req, res, url }: Call): Promise<void> {
		const domainExport = DOMAIN_EXPORT.exec(url.pathname)!;
		if (req.method !== "GET" && req.method !== "POST") throw new HttpError(405, "Method not allowed");
		const [code, answer] = await proxyToMonitor("GET", `/api/domains/${domainExport[1]}`, undefined);
		const report = (answer as { report?: MonitorReport | null }).report;
		if (code !== 200) throw new HttpError(code, (answer as { error?: string }).error ?? "The monitor refused the request");
		if (!report) throw new HttpError(404, "This domain has not been scanned yet, so there is nothing to export.");
		const file = exportDomain(report, exportChoice(url.searchParams));
		const title: FileTitle = exportChoice(url.searchParams).content === "findings" ? "domain-findings" : "domain-roadmap";
		if (req.method === "POST") return saveExport(res, file, title);
		log(`Exported ${FILE_TITLES[title]} (${file.extension}) as a download`);
		return sendDownload(res, file);
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

		if (status.state === "running") throw new HttpError(409, "A scan is running. Analyse when it has finished.");
		const fields = bodyObject(body);
		const limit = fields.limit ?? DEFAULT_ANALYSE;
		if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > MAX_ANALYSE) throw new HttpError(400, `Choose how many to analyse, from 1 to ${MAX_ANALYSE}`);
		const severities = fields.severities ?? ["critical", "high"];
		if (!Array.isArray(severities) || severities.length === 0 || !severities.every((severity) => SEVERITIES.includes(severity as Severity))) {
			throw new HttpError(400, "Severities must be some of: critical, high, medium, low");
		}
		const assistant = model.config;
		if (assistant) confirmModel(fields, assistant);
		return sendJson(res, 202, { status: await startAnalysis(limit, severities as Severity[]) });
	}

	/**
	 * A Deep scan's last step: the model's deeper analysis of the critical and high findings, as the
	 * analysis card would start it. A hosted model is used only when the scan request said yes to
	 * sending to it, which the page asks for beside the Deep choice. Whatever stops it is said in
	 * the log; the scan itself has finished either way.
	 */
	function analyseAfterScan(sendsToHosted: boolean, project: Awaited<ReturnType<typeof projects.current>>, shown?: { model: string; host: string }): void {
		const assistant = model.config;
		if (!assistant) return log("Deeper analysis did not start: no model is set up (Settings → Model)", project);
		// The model may have been switched while the scan ran: the analysis uses only the one the page showed (S22).
		if (shown && (shown.model !== assistant.model || shown.host !== assistant.url.host)) return log(`Deeper analysis did not start: the model is now ${modelWords(assistant)}, not the one the page showed when the scan started`, project);
		if (isHosted(assistant) && !sendsToHosted) return log(`Deeper analysis did not start: ${modelWords(assistant)} is hosted, and the scan did not say yes to sending to it`, project);
		void startAnalysis(DEFAULT_ANALYSE, ["critical", "high"]).catch((err) => log(`Deeper analysis did not start: ${err instanceof Error ? err.message : String(err)}`, project));
	}

	/** Starts the model's judgement of the findings waiting at these severities, up to `limit`, and returns at once. */
	async function startAnalysis(limit: number, severities: Severity[]): Promise<typeof analysing> {
		const assistant = model.config;
		if (!assistant) throw new HttpError(503, model.error ?? "No model is connected. Choose one in Settings → Model");
		if (analysing.state === "running") throw new HttpError(409, "The analysis is already running");
		// Running before the first await, so a second request in the meantime is refused (B24).
		const earlier = analysing;
		const stop = new AbortController();
		stopAnalysis = stop;
		analysing = { state: "running", done: 0, total: 0, current: null, failed: 0 };
		let report: ScanReport;
		let stored: Awaited<ReturnType<typeof readAnalysis>>;
		let queue: ReturnType<typeof unitsOf>;
		try {
			report = await storedReport();
			stored = await readAnalysis(analysisPath, report);
			queue = unitsOf(report)
				.filter((unit) => !stored.items[unit.key] && severities.includes(unit.severity))
				.slice(0, limit);
			if (queue.length === 0) throw new HttpError(409, "Nothing is waiting to be analysed at those severities");
		} catch (err) {
			analysing = earlier;
			stopAnalysis = null;
			throw err;
		}
		analysing = { state: "running", done: 0, total: queue.length, current: null, failed: 0 };
		const project = await projects.current();
		log(`Deeper analysis started: ${queue.length} ${queue.length === 1 ? "item" : "items"} for ${modelWords(assistant)}`, project);
		// Not awaited: the analysis outlives this request and the page polls for progress.
		void (async () => {
			let done = 0;
			let failed = 0;
			let inARow = 0;
			let gaveUp = false;
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
					inARow = 0;
				} catch (err) {
					if (stop.signal.aborted) break;
					failed++;
					inARow++;
					lastError = err instanceof Error ? err.message : String(err);
					// A model that cannot be reached, or a key it refuses, fails every item the same way:
					// three failures in a row end the run rather than spend the rest of it (B36).
					if (inARow >= 3) {
						done++;
						gaveUp = true;
						break;
					}
				} finally {
					modelBusy = false;
				}
				done++;
			}
			analysing = {
				state: stop.signal.aborted ? "stopped" : "done",
				finishedAt: new Date().toISOString(),
				done: done - failed,
				total: queue.length,
				failed,
				...(lastError ? { lastError } : {}),
				...(gaveUp ? { gaveUp } : {}),
			};
			log(`Deeper analysis ${stop.signal.aborted ? "stopped" : gaveUp ? "stopped after 3 failures in a row" : "finished"}: ${done - failed} judged, ${failed} failed`, project);
		})();
		return analysing;
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
				return sendJson(res, 200, await listRepos(github, owner, options.fetchFn));
			}
			if (route === "POST /api/github/fetch") {
				if (fetching.state === "running") throw new HttpError(409, "Repositories are already being fetched");
				if (status.state === "running") throw new HttpError(409, "A scan is running. Fetch when it has finished.");
				const fields = bodyObject(body);
				// Running before the first await, so a second request is refused (B24); as it was if nothing is fetched.
				const earlierFetch = fetching;
				fetching = { state: "running", done: 0, total: 0, current: null, errors: [] };
				let names: unknown;
				try {
					names = fields.all === true ? await fetchedRepos(github.dir) : fields.repos;
				} catch (err) {
					fetching = earlierFetch;
					throw err;
				}
				if (!Array.isArray(names) || names.length === 0 || names.length > MAX_FETCH || !names.every((name) => typeof name === "string" && parseRepoName(name))) {
					fetching = earlierFetch;
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
		confirmModel(fields, assistant);

		let prompt: Prompt;
		/** What the answer is about, kept with it as a discussion so it can be followed up. */
		let about: DiscussionAbout;
		let firstQuestion: string | null = null;
		if (kind === "domain") {
			const domain = domainField(fields);
			const report = await latestDomainReport(domain);
			prompt = domainPrompt(report);
			about = { domain, takenAt: String(report.takenAt) };
		} else if (kind === "cloudflare") {
			const report = await readAudit(cloudflareAuditPath);
			if (!report) throw new HttpError(404, "There is no Cloudflare audit yet. Run one first.");
			prompt = cloudflarePrompt(report);
			about = { checkedAt: report.checkedAt, zones: report.zones.length };
		} else if (kind === "ask") {
			const question = fields.question;
			if (typeof question !== "string" || question.trim() === "" || question.length > MAX_QUESTION) {
				throw new HttpError(400, `Ask a question of 1 to ${MAX_QUESTION} characters`);
			}
			const report = await storedReport();
			prompt = askPrompt(report, question);
			about = { scannedAt: report.scannedAt, stamp: reportStamp(report) };
			firstQuestion = question.trim();
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
			about = {
				scannedAt: report.scannedAt,
				stamp: reportStamp(report),
				repo: target.repo,
				ruleId: target.ruleId,
				location: target.location,
				detail: found.finding.detail,
				title: found.finding.title,
				severity: found.finding.severity,
			};
		} else {
			const report = await storedReport();
			prompt = roadmapPrompt(report);
			about = { scannedAt: report.scannedAt, stamp: reportStamp(report) };
		}

		if (modelBusy) throw new HttpError(409, "The model is still answering another request. Try again when it has finished.");
		modelBusy = true;
		// A page that is closed stops waiting, so Ollama stops working on an answer nobody will read.
		const cancel = new AbortController();
		const onClose = () => {
			if (!res.writableFinished) cancel.abort();
		};
		res.once("close", onClose);
		const started = Date.now();
		try {
			const text = await chat(assistant, prompt.messages, { fetchFn: options.fetchFn, signal: cancel.signal });
			const discussion = await recordDiscussion(kind as DiscussionKind, about, assistant, null, prompt.cut, {
				question: firstQuestion,
				answer: text,
				model: assistant.model,
				at: new Date().toISOString(),
				seconds: Math.round((Date.now() - started) / 100) / 10,
			});
			sendJson(res, 200, { text, model: assistant.model, ...(prompt.cut ? { cut: prompt.cut } : {}), ...(discussion ? { discussion: discussion.id, title: discussion.title } : {}) });
		} catch (err) {
			if (err instanceof AssistantError) throw new HttpError(err.status, err.message);
			throw err;
		} finally {
			res.off("close", onClose);
			modelBusy = false;
		}
	}

	/** Refuses a scan while something else is reading or writing the same repositories or report. */
	function scanMayStart(): void {
		if (status.state === "running") throw new HttpError(409, "A scan is already running");
		// A repository half fetched is not one to scan.
		if (fetching.state === "running") throw new HttpError(409, "Repositories are still being fetched from GitHub. Scan when that has finished.");
		if (analysing.state === "running") throw new HttpError(409, "The model is still analysing the last scan. Stop that first, or wait for it to finish.");
	}

	/**
	 * Starts a scan of `root` and returns at once: the scan outlives the request, and the page polls
	 * for progress. Used by the page's button and by the schedule.
	 */
	async function beginScan(root: string, depth: number, how: { scheduled?: boolean; choices?: ScanChoices; sendsToHosted?: boolean; shown?: { model: string; host: string } } = {}): Promise<ScanStatus> {
		scanMayStart();
		const scheduled = how.scheduled === true;
		// A scheduled scan is always a Standard one: nobody is there to have chosen less, or to say yes to a model.
		const choices = scheduled ? standardChoices() : (how.choices ?? standardChoices());
		const cancel = new AbortController();
		scanCancel = cancel;
		// Running before the first await, so a second request in the meantime is refused, not started too (B24).
		status = { state: "running", root, startedAt: new Date().toISOString(), done: 0, total: 0, current: null };
		// Exactly the repositories fetched, whatever they are named: a search would pass over .dotfiles or vendor (S50).
		const fetched = await fetchedRepos(github.dir);
		const also = fetched.length > 0 ? [{ root: github.dir, repos: fetched.map((name) => join(github.dir, ...name.split("/"))) }] : undefined;
		// The scan is logged in the project in use when it starts, even if the owner moves to another meanwhile.
		const project = await projects.current();
		log(`Scan started: ${root}, ${depth} ${depth === 1 ? "level" : "levels"} down. ${describeChoices(choices)}`, project);
		void scan({
			root,
			depth,
			choices,
			...(also ? { also } : {}),
			...(osvDatabase ? { osvDatabase } : {}),
			signal: cancel.signal,
			onProgress: ({ done, total, path }) => {
				if (status.state === "running") status = { ...status, done, total, current: nameUnder(root, also?.map((other) => other.root), path) };
			},
		})
			.then(async (report) => {
				// Cancelled as it finished: the owner asked for it not to count.
				if (cancel.signal.aborted) throw new CancelledError();
				if (report.repos.length === 0) {
					const error = `No git repositories found under ${root}`;
					status = { state: "failed", root, finishedAt: new Date().toISOString(), error, noRepositories: true, depth };
					log(`Scan found nothing to check: ${error}`, project);
					return;
				}
				// A scan that checked nothing must not replace one that did.
				if (report.tools.every((tool) => tool.status === "missing")) {
					const error = `No scanner is installed. Install one: ${report.tools.map((tool) => tool.installHint).join("; ")}`;
					status = { state: "failed", root, finishedAt: new Date().toISOString(), error };
					log("Scan failed: no scanner is installed", project);
					return;
				}
				await saveReport(options.reportPath, report);
				await history.add(report).catch((err) => console.error(`porchlight ui: could not keep the scan in history: ${err instanceof Error ? err.message : String(err)}`));
				// A secret's finding may name another of its commits than before (B20): its note follows it.
				const carried = await carryNotes(notesPath, report).catch(() => 0);
				if (carried > 0) log(`Moved ${carried === 1 ? "1 note" : `${carried} notes`} to the secret ${carried === 1 ? "it was" : "they were"} about`, project);
				status = { state: "done", root, finishedAt: new Date().toISOString() };
				log(`Scan finished: ${scanCounts(report)}`, project);
				if (scheduled) {
					const latest = await history.compare(report);
					await tell(scanNotice(report, latest.state === "compared" ? latest.change : null, latest.state === "unreadable" ? latest.reason : undefined), project);
				}
				if (choices.analyse) analyseAfterScan(how.sendsToHosted === true, project, how.shown);
			})
			.catch((err) => {
				// A cancelled scan saved nothing: the last report stands, and the page goes back to it.
				if (err instanceof CancelledError || cancel.signal.aborted) {
					status = { state: "idle" };
					log("Scan stopped before it finished. The last scan is unchanged", project);
					return;
				}
				const error = err instanceof Error ? err.message : String(err);
				status = { state: "failed", root, finishedAt: new Date().toISOString(), error };
				log(`Scan failed: ${error}`, project);
				if (scheduled) void tell(failedScanNotice(root, error), project);
			})
			.finally(() => {
				if (scanCancel === cancel) scanCancel = null;
			});
		return status;
	}

	/** Sends a notice where the owner asked, and says in the log whether it went. Never throws. */
	async function tell(notice: Notice, project: Awaited<ReturnType<typeof projects.current>>): Promise<void> {
		if (!options.notify) return;
		const { headers, body } = noticeRequest(options.notify.format, notice);
		try {
			const response = await (options.fetchFn ?? fetch)(options.notify.url, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(15_000) });
			await response.body?.cancel();
			log(response.ok ? `Sent the scan's outcome to ${options.notify.url.host}` : `${options.notify.url.host} refused the scan's outcome (HTTP ${response.status})`, project);
		} catch (err) {
			log(`Could not send the scan's outcome to ${options.notify.url.host}: ${err instanceof Error ? err.message : String(err)}`, project);
		}
	}

	/**
	 * Scans one repository of the stored report again and puts the result in its place. The
	 * repository is found by its name in the report, never by a path from the request. Where a
	 * scanner is missing or fails this time, what it found before is kept: not looking again never
	 * clears a finding (invariant 5). The report keeps its scan time, so its history and a model's
	 * judgements still belong to it; the repository records when it was scanned again.
	 */
	async function beginRescan(name: string): Promise<ScanStatus> {
		scanMayStart();
		// Running before the first await (B24); as it was again if the repository cannot be scanned.
		const earlier = status;
		const cancel = new AbortController();
		scanCancel = cancel;
		status = { state: "running", root: "", startedAt: new Date().toISOString(), done: 0, total: 1, current: name };
		let report: ScanReport;
		let before: RepoResult | undefined;
		try {
			report = await storedReport();
			before = report.repos.find((repo) => repoName(report, repo) === name);
			if (!before) throw new HttpError(404, "That repository is not in the latest scan. Reload the page to see the current one.");
		} catch (err) {
			status = earlier;
			scanCancel = null;
			throw err;
		}
		status = { ...status, root: report.root };
		const project = await projects.current();
		log(`Scanning ${name} again`, project);
		// Scanned as the whole report was, so what it covers stays what the report says it covers.
		const choices = { ...(report.choices ?? standardChoices()), analyse: false };
		void rescan(before.path, { signal: cancel.signal, choices, scanned: report.repos.map((other) => other.path), ...(osvDatabase ? { osvDatabase } : {}) })
			.then(async ({ repo, tools }) => {
				if (cancel.signal.aborted) throw new CancelledError();
				// Scanners that did not look this time: not chosen, not installed any more, or failed on the repository.
				const chosen = (tool: ToolName) => (tool === "gitleaks" ? choices.secrets || choices.privateData === true : choices.dependencies);
				const looked = (tool: ToolName) => chosen(tool) && tools.some((now) => now.tool === tool && now.status === "ok") && !repo.errors.some((error) => error.tool === tool);
				const kept = before.findings.filter((finding) => !looked(finding.tool));
				const merged: RepoResult = {
					...repo,
					findings: [...kept, ...repo.findings.filter((finding) => looked(finding.tool))],
					// A scanner that failed before and did not run now is still a gap.
					errors: [...repo.errors, ...before.errors.filter((error) => !tools.some((now) => now.tool === error.tool && now.status === "ok"))],
					rescannedAt: new Date().toISOString(),
				};
				// Read again: the report may have been replaced while this ran.
				const current = await storedReport();
				if (current.scannedAt !== report.scannedAt) throw new Error("A new scan replaced the report while this repository was being scanned again");
				const next: ScanReport = { ...current, repos: current.repos.map((entry) => (entry.path === before.path ? merged : entry)) };
				await saveReport(options.reportPath, next);
				status = { state: "done", root: report.root, finishedAt: new Date().toISOString() };
				log(`Scanned ${name} again: ${merged.findings.length === 1 ? "1 finding" : `${merged.findings.length} findings`}`, project);
			})
			.catch((err) => {
				if (err instanceof CancelledError || cancel.signal.aborted) {
					status = { state: "idle" };
					log(`Stopped scanning ${name} again. The last scan is unchanged`, project);
					return;
				}
				const error = err instanceof Error ? err.message : String(err);
				status = { state: "failed", root: report.root, finishedAt: new Date().toISOString(), error };
				log(`Scanning ${name} again failed: ${error}`, project);
			})
			.finally(() => {
				if (scanCancel === cancel) scanCancel = null;
			});
		return status;
	}

	/**
	 * As a service with a schedule: once the last scan is old enough and nothing else is at work,
	 * scan the folder again. A scan the schedule cannot start now (one is running, repositories are
	 * being fetched) is simply tried at the next look.
	 */
	async function scheduledScan(): Promise<void> {
		const hours = options.scanEveryHours;
		if (!hours || status.state === "running") return;
		const last = (await readReport(options.reportPath).catch(() => null))?.scannedAt;
		const failedAt = status.state === "failed" ? status.finishedAt : undefined;
		// A failed scan is not retried every minute: the schedule waits its full interval after it too.
		const latest = [last, failedAt].filter((at): at is string => typeof at === "string").sort().at(-1);
		if (latest && Date.now() - Date.parse(latest) < hours * 3_600_000) return;
		try {
			await beginScan(options.defaultRoot, defaultDepth, { scheduled: true });
		} catch (err) {
			if (!(err instanceof HttpError && err.status === 409)) console.error(`porchlight ui: the scheduled scan could not start: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	const schedule = options.scanEveryHours ? setInterval(() => void scheduledScan(), options.scheduleTickMs ?? 60_000) : undefined;
	schedule?.unref();

	async function storedReport(): Promise<ScanReport> {
		const report = await readReport(options.reportPath);
		if (!report) throw new HttpError(404, "There is no scan yet. Scan a folder first.");
		return report;
	}

	/** The latest scan report of a domain, read from the monitor. The admin token is added here and never leaves this process. */
	async function latestDomainReport(domain: string): Promise<MonitorReport & Record<string, unknown>> {
		if (!monitor) throw new HttpError(503, options.monitorError ?? "The monitor is not configured");
		let answer: { status: number; body: Record<string, unknown> };
		try {
			answer = await callMonitor(monitor, "GET", `/domains/${encodeURIComponent(domain)}`, undefined, options.fetchFn);
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
		if (!monitor) throw new HttpError(503, options.monitorError ?? "The monitor is not configured");
		const [name, action, ...extra] = pathname.split("/").slice(3);
		let target: string;
		if (name === undefined) {
			if (method !== "GET" && method !== "POST") throw new HttpError(405, "Method not allowed");
			target = "/domains";
		} else {
			// A name in its own script is sent in the ASCII form DNS uses (B58).
			const domain = asciiDomain(safeDecode(name).toLowerCase());
			if (!DOMAIN_PATTERN.test(domain) || extra.length > 0) throw new HttpError(400, "Invalid domain name");
			if (action === undefined) {
				if (method !== "GET" && method !== "DELETE") throw new HttpError(405, "Method not allowed");
			} else if (action === "history") {
				if (method !== "GET") throw new HttpError(405, "Method not allowed");
			} else if (method !== "POST" || (action !== "verify" && action !== "scan")) {
				throw new HttpError(404, "Not found");
			}
			target = `/domains/${encodeURIComponent(domain)}${action ? `/${action}` : ""}`;
		}
		try {
			const fields = method === "POST" && name === undefined ? bodyObject(body) : undefined;
			const sendBody = fields && typeof fields.domain === "string" ? { ...fields, domain: asciiDomain(fields.domain.trim().toLowerCase()) } : fields;
			const response = await callMonitor(monitor, method, target, sendBody, options.fetchFn);
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
			scanCancel?.abort();
			clearInterval(schedule);
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

/** Changes shown to the owner at once, waiting for their answer. */
const MAX_PENDING_CHANGES = 20;

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
/** A mural belongs to one report's content and one filter: scanning one repository again makes it out of date (B38). */
function muralKey(report: ScanReport, filter: ReturnType<typeof parseFilter>): string {
	return `${reportStamp(report)}\n${JSON.stringify(filter)}`;
}

/**
 * Whether a discussion is about this report as it is now: by its content stamp, which scanning one
 * repository again changes (B38). A discussion kept before there were stamps has its scan time alone,
 * which is compared as before, so it does not all turn stale at once.
 */
function sameScan(report: ScanReport, about: DiscussionAbout): boolean {
	return about.stamp !== undefined ? about.stamp === reportStamp(report) : about.scannedAt === report.scannedAt;
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
	await writePrivateJson(path, { key: job.key, mural: job.mural });
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

/**
 * What an earlier Porchlight kept beside the report and now keeps in the data folder (S34): settings,
 * keys and tokens, fetched repositories and the OSV databases, audits, investigations and discussions.
 */
const DATA_FILES = [
	"model-settings.json",
	"monitor-settings.json",
	"cloudflare-settings.json",
	"cloudflare-audit.json",
	"cloudflare-changes.json",
	"access.json",
	"investigate-domains.json",
	"host-check.json",
	"projects.json",
	"ui-settings.json",
	"ui-view.json",
	"investigations",
	"discussions",
	"github",
	"osv-db",
];

/**
 * Moves each of DATA_FILES found beside the report into the data folder, where none of that name is yet,
 * so a key saved by an earlier version keeps working and no longer sits in the report's folder (which may
 * be a project's own). Says what it moved and what it could not; a name already in the data folder wins.
 */
export async function moveIntoDataFolder(reportDir: string, dataDir: string, say: (line: string) => void): Promise<void> {
	await mkdir(dataDir, { recursive: true, mode: 0o700 });
	for (const name of DATA_FILES) {
		const from = join(reportDir, name);
		const to = join(dataDir, name);
		if (!(await lstat(from).catch(() => null)) || (await lstat(to).catch(() => null))) continue;
		try {
			await rename(from, to);
			say(`moved ${name} from beside the report into ${dataDir}`);
		} catch (err) {
			say(`could not move ${name} into ${dataDir} (${(err as NodeJS.ErrnoException).code ?? String(err)}); move it there yourself`);
		}
	}
}

/** Holds the access key, so only its owner can read it. */
async function saveAccess(path: string, access: AccessFile): Promise<void> {
	await writePrivateJson(path, access);
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
	const domain = typeof fields.domain === "string" ? asciiDomain(fields.domain.trim().toLowerCase()) : "";
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
/** A local model being downloaded through Ollama. `step` is Ollama's own word for what it is doing. */
export type DownloadStatus =
	| { state: "idle" }
	| { state: "running"; name: string; startedAt: string; step: string; total: number; completed: number }
	| { state: "done"; name: string; startedAt: string; finishedAt: string }
	| { state: "failed"; name: string; startedAt: string; finishedAt: string; error: string };

/** One line of the Activity view. `n` counts up, so the page asks only for what it has not seen. */
export interface ActivityLine {
	n: number;
	at: string;
	kind: "info" | "good" | "warning";
	text: string;
}
const MAX_ACTIVITY = 400;

/** A set of Cloudflare changes the owner approved at once, as it is sent. */
export type BatchStatus =
	| { state: "idle" }
	| { state: "running"; startedAt: string; total: number; done: number; applied: number; failed: number; skipped: number; current: string }
	| { state: "finished"; startedAt: string; finishedAt: string; total: number; applied: number; failed: number; skipped: number; stopped: boolean };

/** How long to wait before asking DNS a second time for an ownership record that was not found mid-run. */
const OWNERSHIP_RECHECK_MS = 2_000;

/** How a run ended, in the project log's words. */
const RUN_ENDINGS: Partial<Record<Run["status"], string>> = { done: "finished", stopped: "stopped", failed: "failed" };

interface InvestigationJob {
	run: Run;
	stop: AbortController;
	/** The action waiting for the owner, and how to answer it. */
	approval: { stepId: string; resolve: (answer: ApprovalAnswer) => void } | null;
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

/** A finished scan in figures, for a project's log: "3 repositories, 12 findings (1 critical, 4 high, 7 medium)". */
export function scanCounts(report: ScanReport): string {
	const counts = new Map<Severity, number>();
	let total = 0;
	for (const repo of report.repos) {
		for (const finding of repo.findings) {
			counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
			total++;
		}
	}
	const repositories = `${report.repos.length} ${report.repos.length === 1 ? "repository" : "repositories"}`;
	const bySeverity = SEVERITIES.filter((severity) => counts.has(severity)).map((severity) => `${counts.get(severity)} ${severity}`);
	return `${repositories}, ${total} ${total === 1 ? "finding" : "findings"}${bySeverity.length > 0 ? ` (${bySeverity.join(", ")})` : ""}`;
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
	const fromGithub = (await fetchedRepos(githubDir)).map((name) => join(githubDir, ...name.split("/"))).filter((path) => !inFolder.includes(path));
	const names = [...inFolder, ...fromGithub].slice(0, PREVIEW_NAMES).map((path) => nameUnder(absolute, [githubDir], path));
	return { root: absolute, exists: true, total: inFolder.length + fromGithub.length, repos: names, fetched: fromGithub.length, depth };
}

/** Who runs a hosted model: its provider's name, or the server's address for one of the owner's servers reached over the internet. */
function hostedName(config: AssistantConfig): string {
	return config.provider !== undefined && config.provider in HOSTED ? HOSTED[config.provider as HostedProvider].name : `the model server at ${config.url.host}`;
}

async function scanRequest(body: unknown, defaultDepth: number): Promise<{ root: string; depth: number; choices: ScanChoices; sendsToHosted: boolean; shown?: { model: string; host: string } }> {
	const { root, depth = defaultDepth, choices: asked, sendsToHosted, shown } = (body ?? {}) as { root?: unknown; depth?: unknown; choices?: unknown; sendsToHosted?: unknown; shown?: { model?: unknown; host?: unknown } };
	if (typeof root !== "string" || root.trim() === "") throw new HttpError(400, "Choose a folder to scan");
	if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 0 || depth > MAX_DEPTH) {
		throw new HttpError(400, `Depth must be a whole number from 0 to ${MAX_DEPTH}`);
	}
	const expanded = root.trim().replace(/^~(?=$|\/)/, homedir());
	const absolute = resolve(expanded);
	const info = await stat(absolute).catch(() => null);
	if (!info?.isDirectory()) throw new HttpError(400, `Not a folder: ${absolute}`);
	if (asked !== undefined && (typeof asked !== "object" || asked === null || Array.isArray(asked))) throw new HttpError(400, "Choices must be an object");
	let choices: ScanChoices;
	try {
		choices = parseChoices((asked ?? {}) as Record<string, unknown>);
	} catch (err) {
		if (err instanceof ChoiceError) throw new HttpError(400, err.message);
		throw err;
	}
	const named = typeof shown?.model === "string" && typeof shown.host === "string" ? { shown: { model: shown.model, host: shown.host } } : {};
	return { root: absolute, depth, choices, sendsToHosted: sendsToHosted === true, ...named };
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

/** The report last parsed from each path, with what identified the file then. */
const parsedReports = new Map<string, { stamp: string; report: ScanReport }>();

/**
 * The stored report as it was written, or null when there is none yet. Most requests read it, and a
 * large one takes a while to parse, so the parsed report is kept until the file changes: every save
 * writes a new file and renames it into place, which changes its identity, size or time. The kept
 * report is frozen, so no caller can change what the next one is given.
 */
async function readReport(path: string): Promise<ScanReport | null> {
	let stamp: string;
	try {
		const info = await stat(path, { bigint: true });
		stamp = `${info.ino}:${info.size}:${info.mtimeNs}`;
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			parsedReports.delete(path);
			return null;
		}
		throw err;
	}
	const kept = parsedReports.get(path);
	if (kept?.stamp === stamp) return kept.report;

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
	parsedReports.set(path, { stamp, report: deepFreeze(report) });
	return report;
}

function deepFreeze<T>(value: T): T {
	if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const inner of Object.values(value)) deepFreeze(inner);
	}
	return value;
}

/** The interface's own preferences: the look, and where a model's answers appear. */
interface UiSettings {
	appearance: string;
	answers: string;
}

/** The chosen look and answer place, each the default when none was saved or the file holds something else. */
async function readUiSettings(path: string): Promise<UiSettings> {
	let saved: { appearance?: unknown; answers?: unknown } = {};
	try {
		saved = JSON.parse(await readFile(path, "utf8")) ?? {};
	} catch {
		// No file yet, or not JSON: the defaults.
	}
	return {
		appearance: isLook(saved.appearance) ? (saved.appearance as string) : DEFAULT_LOOK,
		answers: isAnswerPlace(saved.answers) ? (saved.answers as string) : DEFAULT_ANSWER_PLACE,
	};
}

async function saveUiSettings(path: string, settings: UiSettings): Promise<void> {
	await writePrivateJson(path, settings);
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
	await writePrivateJson(path, { view });
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
	await writePrivateJson(path, report);
}

async function saveReport(path: string, report: ScanReport): Promise<void> {
	await writePrivateJson(path, report);
}
