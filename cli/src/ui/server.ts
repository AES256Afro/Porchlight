import { randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { judge, readAnalysis, saveAnalysis, unitKey, unitsOf, VERDICTS } from "../analysis/analyse.ts";
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
	type ModelTask,
	type SavedModel,
} from "../assist/settings.ts";
import { EgressLog, loggedFetch } from "../egress.ts";
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
import { isAnswerPlace, isLook } from "../../ui/looks.js";
import { fetchedRepos, fetchRepo, GithubError, listRepos, parseRepoName, removeFetched, validOwner, type GithubConfig } from "../github/github.ts";
import type { MonitorConfig } from "../monitor/client.ts";
import { monitorProblem } from "../monitor/settings.ts";
import type { Runner } from "../repos/exec.ts";
import { nameUnder, repoName, reportStamp } from "../repos/report.ts";
import { carryNotes, History, mergeRescan, notesForPage, orphanNotes, readNotes, removeNotes, setNote, setNotes, type HistoryEntry, type RescanChange } from "../repos/history.ts";
import type { HostCheckOptions } from "../host/check.ts";
import type { HostReport } from "../host/types.ts";
import { CancelledError, run as runCommand } from "../repos/exec.ts";
import { rescanRepo, scanRepos } from "../repos/scan.ts";
import { buildSbom } from "../repos/sbom.ts";
import { jsonText } from "../roadmap/escape.ts";
import { noticeRequest, type Notice, type NotifyFormat } from "../notify/format.ts";
import { failedScanNotice, scanNotice } from "../notify/scan.ts";
import { describeChoices, standardChoices } from "../../ui/scan-choices.js";
import { findingKey, isDay, isStatus, MAX_NOTE, rescanWords, type NoteSource } from "../../ui/tracking.js";
import { SEVERITIES, type RepoResult, type ScanChoices, type ScanReport, type Severity } from "../repos/types.ts";
import { domainSuggestions, type MonitorReport } from "../roadmap/domains.ts";
import { exportDomain, exportRepos, ExportError, parseFilter } from "../roadmap/export.ts";
import { buildRepoRoadmap, listRepoFindings } from "../roadmap/repos.ts";
import type { Net } from "../investigate/tools.ts";
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
import { readAudit } from "../cloudflare/store.ts";
import { oneAtATime, readPrivateJson, UnreadableFileError } from "../private-files.ts";
import { PORCHLIGHT_VERSION } from "../version.ts";
import { hostedName, type ServerContext } from "./context.ts";
import { checkKey, hostAllowed, MIN_KEY_LENGTH, LOOPBACK_HOSTS, mayChange, onOwnPage, originAllowed, SESSION_HEADER, sessionMatches, type Call, type Gate, type Route } from "./gate.ts";
import { bodyObject, domainField, etagMatches, fileStamp, HttpError, readJsonBody, SECURITY_HEADERS, sendBytes, sendDownload, sendJson, staticFile, textField, type Sendable } from "./http.ts";
import { moveIntoDataFolder, readMural, readUiSettings, readView, saveMural, saveReport, saveUiSettings, saveView, type MuralJob } from "./kept-files.ts";
import { readReport, reportResponseBody } from "./report-cache.ts";
import { createAccess } from "./routes/access.ts";
import { createCloudflare } from "./routes/cloudflare.ts";
import { createDownload } from "./routes/download.ts";
import { createHostCheck } from "./routes/host.ts";
import { claimsHosts, hostsRoute } from "./routes/hosts.ts";
import { claimsOsvDatabase, osvDatabaseRoute } from "./routes/osv-database.ts";
import { claimsOrphanExport, orphanExportRoute } from "./routes/orphan-notes.ts";
import { createInvestigate } from "./routes/investigate.ts";
import { createMonitor } from "./routes/monitor.ts";
import { createDigest } from "./routes/digest.ts";
import { claimsEgress, egressRoute } from "./routes/egress.ts";
import { claimsMenuStatus, menuStatusRoute } from "./routes/menu-status.ts";
import { claimsModelTasks, createModelTasks } from "./routes/model-tasks.ts";
import { claimsSeen, seenRoute } from "./routes/seen.ts";
import { previewScan, scanCounts, scanRequest } from "./scans.ts";
import type { AccessStatus, ActivityLine, AnalysisStatus, FetchStatus, ModelInUse, ScanStatus, ScheduleState } from "./types.ts";

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
	/** Also send a weekly digest after a scheduled scan, once a week (PORCHLIGHT_NOTIFY_DIGEST=weekly; FT-13). Needs `notify`. */
	digest?: boolean;
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

export type { AccessStatus, ActivityLine, AnalysisStatus, BatchStatus, CloudflareStatus, DownloadStatus, FetchStatus, HostStatus, ModelInUse, ScanStatus, ScheduleState } from "./types.ts";

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

export { checkKey, hostAllowed, mayChange, MIN_KEY_LENGTH, originAllowed, tailnetAddress } from "./gate.ts";
export { acceptsGzip, etagMatches } from "./http.ts";
export { moveIntoDataFolder } from "./kept-files.ts";
export { scanCounts, type ScanPreview } from "./scans.ts";

/** This copy's version, from its package.json (R6Q-4). */
export function porchlightVersion(): Promise<string> {
	return Promise.resolve(PORCHLIGHT_VERSION);
}

/** The page's own modules. Nothing else in the folder is served. */
/** Every script the page loads. A test checks it names each file in ui/, so none is left unserved. */
export const SCRIPTS = ["app", "api", "dom", "filter", "list", "hints", "generated", "store", "export", "assist", "analysis", "github", "overview", "findings", "finding-parts", "roadmap", "repos", "domains", "looks", "appearance", "settings", "models", "model-settings", "access-settings", "send", "send-text", "tracking", "finding-notes", "host", "host-areas", "paths", "investigate", "discussions", "discussion", "discussion-links", "panel", "projects", "cloudflare", "cloudflare-settings", "monitor-settings", "activity", "model-download", "scan-choices", "scan-options", "poller", "glance", "charts", "chart-layout", "domain-hosts", "due", "seen", "model-tasks", "egress"];
/**
 * The page's stylesheets, by layer, in the order index.html loads them (RD-6): the tokens (colours, type,
 * corners), the base frame, components, page rules, then the looks, which only override. A test checks
 * it names each .css file in ui/, as SCRIPTS does for scripts.
 */
export const STYLES = ["tokens", "base", "components", "pages", "looks"];
const STATIC_FILES: Record<string, { file: string; type: string }> = {
	"/": { file: "index.html", type: "text/html; charset=utf-8" },
	...Object.fromEntries(STYLES.map((name) => [`/${name}.css`, { file: `${name}.css`, type: "text/css; charset=utf-8" }])),
	"/favicon.svg": { file: "favicon.svg", type: "image/svg+xml" },
	...Object.fromEntries(SCRIPTS.map((name) => [`/${name}.js`, { file: `${name}.js`, type: "text/javascript; charset=utf-8" }])),
};

const DEFAULT_DEPTH = 3;
/** Findings one analysis run may judge, and how many it judges unless told otherwise. */
const MAX_ANALYSE = 500;
const DEFAULT_ANALYSE = 25;
/** Repositories one fetch may name. */
const MAX_FETCH = 300;
/** What the local model can be asked for, one route each. */
const ASSIST_ROUTES = ["finding", "roadmap", "domain", "ask", "cloudflare"];

const DOMAIN_EXPORT = /^\/api\/domains\/([^/]+)\/export$/;

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
	// Every request the server sends out is recorded, by host and purpose only (R6F-3). Hosts the server
	// knows are named by what they are: looked up when a request is made, never before.
	const egress = new EgressLog();
	options = {
		...options,
		fetchFn: loggedFetch(options.fetchFn ?? fetch, egress, {
			monitor: () => monitorArea.monitor()?.url.host,
			models: () => [model.config?.url.host, ...targets().map((target) => target.config.url.host)].filter((host): host is string => typeof host === "string"),
			notify: () => options.notify?.url.host,
		}),
	};
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
	/** The report's response as last built, and what identified its three files then (OP-5). */
	let reportResponse: (Sendable & { stamp: string }) | null = null;
	// Where the owner was, so the app opens there again however it was closed.
	const viewPath = join(dataDir, "ui-view.json");
	// A report from before history was kept starts it, so the next scan has something to compare with.
	await readReport(options.reportPath)
		.then((report) => (report ? history.add(report) : null))
		.catch(() => {});
	let analysing: AnalysisStatus = { state: "idle" };
	/** Why a Deep scan's analysis did not start, the last time one did not (R6U-11). */
	let analysisNotStarted: { at: string; why: string } | null = null;
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
	const startup: ModelInUse = { config: options.assistant ?? null, error: options.assistantError, unset: options.assistantUnset ?? false, source: "startup" };
	/** A key given at start-up for a hosted provider, used for that provider when Settings has none. */
	const startupKeys: Partial<Record<HostedProvider, string>> =
		startup.config && startup.config.provider !== undefined && startup.config.provider in HOSTED && startup.config.apiKey ? { [startup.config.provider as HostedProvider]: startup.config.apiKey } : {};
	let savedModel = await readSavedModel(modelPath);
	let model: ModelInUse = savedModel ? inUse(savedModel) : startup;
	// A model per task (R6F-10): chosen in Settings from the models set up, never from a request.
	const modelTasks = await createModelTasks(dataDir, () => targets());
	/** The model a task uses: its own when one is chosen, else the one in use. */
	function modelFor(task: ModelTask): ModelInUse {
		return modelTasks.modelFor(task) ?? model;
	}

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
		if (hostArea.hostStatus().state === "running") busy.push("This computer is being checked");
		if (investigateArea.investigation()) busy.push(`An investigation of ${investigateArea.investigation()!.run.domain} is running`);
		if (cloudflareArea.cloudflareStatus().state === "running") busy.push("Your Cloudflare account is being audited");
		if (sending > 0) busy.push("A model is answering what you sent it");
		else if (modelBusy && muralJob.state !== "running" && analysing.state !== "running") busy.push("The model is answering");
		return busy;
	}

	/**
	 * The owner's status and note for one finding of the latest scan. Kept by the finding's identity,
	 * so they carry over to later scans; they never change the finding itself.
	 */
	/** Where a status is set from, recorded beside it (R6U-7). */
	function noteSource(gate: Gate): NoteSource {
		return gate.tailnet ? "device" : gate.loopbackOnly ? "here" : "service";
	}

	/**
	 * One status and note for many findings of the latest scan at once (B-Q2): each is found in the
	 * report as for one, and all are saved in one change, or none when any is not there.
	 */
	async function bulkNoteRoute(res: ServerResponse, body: unknown, gate: Gate): Promise<void> {
		const fields = bodyObject(body);
		if (!isStatus(fields.status)) throw new HttpError(400, "Choose a status");
		const note = fields.note ?? "";
		if (typeof note !== "string" || note.length > MAX_NOTE) throw new HttpError(400, `Keep the note to ${MAX_NOTE} characters`);
		const items = fields.findings;
		if (!Array.isArray(items) || items.length === 0 || items.length > MAX_BULK_NOTES) throw new HttpError(400, `Choose from 1 to ${MAX_BULK_NOTES} findings`);
		const until = fields.until === undefined || fields.until === "" ? undefined : fields.until;
		if (until !== undefined) {
			if (fields.status !== "accepted") throw new HttpError(400, "Only an accepted risk has an end date");
			if (!isDay(until)) throw new HttpError(400, "Give the end date as a day, such as 2027-06-30");
			if (until < new Date(Date.now() - 86_400_000).toISOString().slice(0, 10)) throw new HttpError(400, "Choose an end date that has not passed");
		}
		const report = await storedReport();
		const keys: string[] = [];
		for (const item of items) {
			const one = bodyObject(item);
			const target = { repo: textField(one, "repo", 1000), ruleId: textField(one, "ruleId", 500), location: textField(one, "location", 2000), detail: textField(one, "detail", 2000) };
			const found = locateFinding(report, target);
			if (!found) throw new HttpError(404, "A chosen finding is not in the latest scan. Reload the page to see the current one.");
			if (fields.status === "rotated" && found.finding.kind !== "secret") throw new HttpError(400, "Only a secret can be marked rotated. Leave out the findings that are not secrets.");
			keys.push(findingKey(target.repo, target));
		}
		const saved = await setNotes(notesPath, keys, fields.status, note, new Date(), until, noteSource(gate));
		return sendJson(res, 200, { notes: keys.map((key, index) => ({ key, note: saved[index] ?? null })) });
	}

	/**
	 * Notes that name no finding of any kept scan (R6Q-12): counted, listed by place and status, and
	 * removed only when the owner asks, and only those.
	 */
	async function orphansRoute(res: ServerResponse, route: string): Promise<void> {
		const notes = await readNotes(notesPath);
		const orphans = await orphanNotes(notes, history, await readReport(options.reportPath));
		if (route === "POST /api/findings/orphans/remove") {
			const removed = await removeNotes(notesPath, orphans);
			log(`Removed ${removed === 1 ? "1 note" : `${removed} notes`} that matched no kept finding`);
			return sendJson(res, 200, { removed });
		}
		if (route !== "GET /api/findings/orphans") throw new HttpError(405, "Method not allowed");
		return sendJson(res, 200, {
			count: orphans.length,
			notes: orphans.slice(0, 200).map((key) => {
				const [repo = "", ruleId = "", location = ""] = key.split("\n");
				const entry = notes[key]!;
				return { repo, ruleId, location, status: entry.status, updatedAt: entry.updatedAt, ...(entry.until ? { until: entry.until } : {}) };
			}),
		});
	}

	async function noteRoute(res: ServerResponse, body: unknown, gate: Gate): Promise<void> {
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
		return sendJson(res, 200, { key, note: await setNote(notesPath, key, fields.status, note, new Date(), until, noteSource(gate)) });
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
		const line = { n: activityCount, at: new Date().toISOString(), kind, text: oneLine(text).slice(0, 400) };
		activity.push(line);
		// A service's operator reads `docker logs`: each line goes there too, with its time, and nothing more (R6Q-1).
		if (!loopbackOnly) process.stdout.write(`${line.at} ${line.text}\n`);
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
			canChange: onOwnPage(gate),
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
		if (!onOwnPage(gate)) throw new HttpError(403, "Projects are added and removed from the page on the computer that runs Porchlight");
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
			const audit = await readAudit(cloudflareArea.auditPath).catch(() => null);
			if (!audit || audit.checkedAt !== discussion.about.checkedAt) return { ok: false, reason: NEWER_AUDIT };
		} else if (discussion.kind === "domain") {
			// A domain's discussion is offered a follow-up only while the monitor's latest scan of it is the
			// one it read (AI-B10); a monitor that cannot be asked is said, and offers none.
			const domain = discussion.about.domain ?? "";
			const latest = await monitorArea.latestDomainReport(domain).then(
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
			const report = await monitorArea.latestDomainReport(about.domain ?? "");
			if (String(report.takenAt) !== about.takenAt) {
				throw new HttpError(409, `A newer scan of ${about.domain} has replaced the one this discussion is about. Ask again from the Domains page to start a new discussion about it.`);
			}
			return domainPrompt(report);
		}
		if (discussion.kind === "cloudflare") {
			const audit = await readAudit(cloudflareArea.auditPath);
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
		const filter = parseFilter({ severity: about.filter?.severity, kind: about.filter?.kind, match: about.filter?.q, repo: about.filter?.repo, new: about.filter?.new }, await newKeysOf(report));
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
			// `stale`: a newer scan or audit replaced what it was about, so the page offers to ask again about the latest (H-Q3).
			const stale = !state.ok && (state.reason === NEWER_SCAN || state.reason === NEWER_AUDIT || state.reason.startsWith("A newer scan of "));
			return sendJson(res, 200, { discussion: viewOf(discussion), followUp: state.ok ? { ok: true } : { ok: false, reason: state.reason, ...(stale ? { stale: true } : {}) } });
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
		const report = await storedReport();
		const filter = parseFilter({ severity: text("severity"), kind: text("kind"), match: text("q"), repo: text("repo"), new: text("new") }, await newKeysOf(report));
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
				(["severity", "kind", "q", "repo", "new"] as const).flatMap((name) => (text(name) === null ? [] : [[name, text(name) as string]])),
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

	function assistantSummary(task?: ModelTask) {
		const using = task ? modelFor(task) : model;
		const config = using.config;
		return config
			? { configured: true, model: config.model, host: config.url.host, hosted: isHosted(config) }
			: {
					configured: false,
					error: using.error ?? "No model is connected",
					// No model asked for: the features are off, the usual state rather than a value to correct.
					unset: using.unset,
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

	// The areas with state of their own, each in routes/<area>.ts, given what they share with the rest.
	const ctx: ServerContext = {
		options,
		loopbackOnly,
		dataDir,
		projects,
		log,
		note,
		saveExport,
		assistantSummary,
		confirmModel,
		modelWords,
		model: () => model,
		modelFor,
		modelBusy: () => modelBusy,
		setModelBusy: (busy) => {
			modelBusy = busy;
		},
		monitor: () => monitorArea.monitor(),
	};
	const hostArea = createHostCheck(ctx);
	const { downloadRoute } = createDownload(ctx);
	const accessArea = await createAccess(ctx, (gate) => respond(gate));
	const monitorArea = await createMonitor(ctx);
	const investigateArea = createInvestigate(ctx);
	const cloudflareArea = createCloudflare(ctx, investigateArea.domainsPath);
	const digestArea = createDigest(ctx);

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
		const config = modelFor("mural").config;
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
			// The page's own files hold no data, so the browser may keep them, asking each time whether they changed (OP-7).
			const file = await staticFile(entry.file);
			const headers = { ...SECURITY_HEADERS, "cache-control": "no-cache", etag: file.etag, vary: "accept-encoding", "content-type": entry.type };
			if (etagMatches(req.headers["if-none-match"], file.etag)) {
				res.writeHead(304, headers);
				res.end();
				return null;
			}
			await sendBytes(req, res, 200, headers, file);
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
			[paths("/api/host", "/api/host/check"), ({ res, route, body }) => hostArea.hostRoute(res, route, body)],
			[under("/api/investigate"), ({ res, route, url, body, gate }) => investigateArea.investigateRoute(res, route, url, body, gate)],
			[under("/api/cloudflare"), ({ res, route, url, body, gate }) => cloudflareArea.cloudflareRoute(res, route, url, body, gate)],
			[under("/api/monitor"), ({ res, route, body, gate }) => monitorArea.monitorRoute(res, route, body, gate), "here"],
			[exact("GET /api/activity"), activityRoute],
			[exact("GET /api/repos/history"), historyRoute],
			[exact("POST /api/findings/note"), ({ res, body, gate }) => noteRoute(res, body, gate)],
			[exact("POST /api/findings/notes"), ({ res, body, gate }) => bulkNoteRoute(res, body, gate)],
			[paths("/api/findings/orphans", "/api/findings/orphans/remove"), ({ res, route }) => orphansRoute(res, route), "owner"],
			[exact("GET /api/busy"), ({ res }) => sendJson(res, 200, { busy: busyWork() })],
			[exact("GET /api/attention"), attentionRoute],
			[exact("GET /api/connections"), connectionsRoute],
			[exact("POST /api/view"), viewRoute],
			[exact("POST /api/settings"), settingsRoute],
			[under("/api/model/local"), ({ res, route, url, body, gate }) => downloadRoute(res, route, url, body, gate), "here"],
			// Where the owner's data is sent, under which key, and a probe of any address: never from another device (S20).
			[under("/api/model"), ({ res, route, body }) => modelRoute(res, route, body), "owner"],
			[under("/api/access"), ({ res, route, body, gate }) => accessArea.accessRoute(res, route, body, gate), "here"],
			[(call) => call.url.pathname.startsWith("/api/assist/"), ({ req, res, url, body }) => assist(req, res, url.pathname.slice("/api/assist/".length), body)],
			[
				exact("GET /api/repos/report"),
				async ({ req, res }) => {
					// Built once for each version of the report, the judgements and the notes, and sent gzipped where the
					// browser takes it (OP-5). Each file is looked at before it is read, so a change after the look only
					// makes the next request build it again, never keeps an older answer under a newer file.
					const stamp = (await Promise.all([options.reportPath, analysisPath, notesPath].map(fileStamp))).join("|");
					if (reportResponse?.stamp !== stamp) {
						// Notes that cannot be read are said beside the report, never a reason the report cannot be shown.
						reportResponse = { stamp, body: await reportResponseBody(options.reportPath, analysisPath, await notesForPage(notesPath)) };
					}
					return sendBytes(req, res, 200, { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", vary: "accept-encoding" }, reportResponse);
				},
			],
			[exact("GET /api/analysis/judgements"), ({ res, url }) => judgementsRoute(res, url.searchParams.get("since"))],
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
				async ({ res, url }) =>
					sendJson(res, 200, { preview: { ...(await previewScan(url.searchParams.get("root") ?? options.defaultRoot, url.searchParams.get("depth"), github.dir, url.searchParams.get("home") === "1")), tools: await toolReadiness() } }),
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
			[
				exact("POST /api/repos/rescan"),
				async ({ res, body }) => {
					// One repository by name, or several at once (US-9, "Scan these again"); names only, never a path.
					const fields = bodyObject(body);
					if (fields.repos === undefined) return sendJson(res, 202, { scan: await beginRescan([textField(fields, "repo", 1000)]) });
					if (!Array.isArray(fields.repos) || fields.repos.length === 0 || fields.repos.length > MAX_RESCAN) throw new HttpError(400, `Name from 1 to ${MAX_RESCAN} repositories`);
					const names = [...new Set(fields.repos.map((name) => textField({ name }, "name", 1000)))];
					return sendJson(res, 202, { scan: await beginRescan(names) });
				},
			],
			[(call) => DOMAIN_EXPORT.test(call.url.pathname), domainExportRoute],
			[claimsHosts, (call) => hostsRoute(ctx, call)],
			[claimsOsvDatabase, (call) => osvDatabaseRoute(ctx, call)],
			[claimsOrphanExport, (call) => orphanExportRoute(ctx, call)],
			[claimsSeen, (call) => seenRoute(ctx, call), "owner"],
			[claimsEgress, (call) => egressRoute(egress, call)],
			[claimsModelTasks, (call) => modelTasks.route(ctx, call), "owner"],
			[claimsMenuStatus, (call) => menuStatusRoute(ctx, call, () => status.state === "running")],
			[
				under("/api/domains"),
				async ({ req, res, url, body }) => {
					const [code, answer] = await monitorArea.proxyToMonitor(req.method ?? "GET", url.pathname, body);
					return sendJson(res, code, withSuggestions(answer));
				},
			],
		];
	}

	/** Whether git and the scanners run, asked at most once a minute (US-2): a first scan should not find out by failing. */
	let tools: { at: number; value: Promise<{ tool: string; ready: boolean; fix: string }[]> } | null = null;
	function toolReadiness(): Promise<{ tool: string; ready: boolean; fix: string }[]> {
		if (tools && Date.now() - tools.at < 60_000) return tools.value;
		const runner = options.run ?? runCommand;
		const ask = (tool: string, args: string[], fix: string) =>
			runner(tool, args, { timeoutMs: 10_000 }).then(
				() => ({ tool, ready: true, fix }),
				() => ({ tool, ready: false, fix }),
			);
		const value = Promise.all([
			ask("git", ["--version"], process.platform === "darwin" ? "xcode-select --install" : "Install git with your system's package manager"),
			ask("gitleaks", ["version"], "brew install gitleaks"),
			ask("osv-scanner", ["--version"], "brew install osv-scanner"),
		]);
		tools = { at: Date.now(), value };
		return value;
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
			monitor: monitorArea.monitorState(),
			// Whether a token is set, never the token.
			github: { token: github.token !== undefined, ...(options.githubError ? { error: options.githubError } : {}) },
			assistant: assistantSummary(),
			lastView: await readView(viewPath),
			// The projects, and the one exports, discussions and the log go to.
			projects: await projectsState(gate),
			// Whether Cloudflare is connected and how, never the token.
			cloudflare: await cloudflareArea.cloudflareTokenState(),
			// What "Send to a model" offers. Never a key: only where each one runs and which model.
			sendTargets: targets().map((target) => ({ id: target.id, label: target.label, model: target.config.model, host: target.config.url.host, hosted: target.hosted, current: target.current })),
			// Which Porchlight this is (R6Q-4), and what the schedule did and will do (QL-5).
			version: await porchlightVersion(),
			schedule: await scheduleState(),
		});
	}

	/**
	 * What needs the owner from any page (E-Q1): an investigation step waiting for approval. The page
	 * asks this every few seconds and marks the Investigate section and the tab's title.
	 */
	function attentionRoute({ res }: Call): void {
		const investigation = investigateArea.investigation();
		const waiting = investigation?.run.steps.filter((step) => step.outcome === "waiting").length ?? 0;
		return sendJson(res, 200, { approval: investigation && waiting > 0 ? { domain: investigation.run.domain, waiting } : null });
	}

	/**
	 * "Check connections" (US-8): asks the monitor and the model whether they answer now, as doctor does,
	 * so "connected" means working rather than configured. The monitor's token goes only to its own address.
	 */
	async function connectionsRoute({ res }: Call): Promise<void> {
		const at = new Date().toISOString();
		const monitorCheck = monitorArea.monitor()
			? await monitorProblem(monitorArea.monitor()!, options.fetchFn ?? fetch).then(
					(problem) => (problem ? { ok: false, detail: problem } : { ok: true, detail: `${monitorArea.monitor()!.url.host} answers` }),
					(err) => ({ ok: false, detail: `${monitorArea.monitor()!.url.host} could not be reached: ${err instanceof Error ? err.message : String(err)}` }),
				)
			: null;
		const config = model.config;
		let modelCheck: { ok: boolean; detail: string } | null = null;
		// A hosted provider is not asked: asking sends the key and costs a request. Its settings are checked when saved.
		if (config && !isHosted(config)) {
			modelCheck = await listModels(config, { fetchFn: options.fetchFn })
				.then((names) => (names.some((name) => name === config.model || name === `${config.model}:latest`) ? { ok: true, detail: `${config.model} is ready at ${config.url.host}` } : { ok: false, detail: `${config.url.host} answers, but has no model named ${config.model}` }))
				.catch((err) => ({ ok: false, detail: `${config.url.host} could not be reached: ${err instanceof Error ? err.message : String(err)}` }));
		} else if (config) modelCheck = { ok: true, detail: `${config.model} at ${config.url.host} is hosted, so it is not asked until you use it` };
		const cloudflare = await cloudflareArea.cloudflareTokenState();
		return sendJson(res, 200, {
			at,
			monitor: monitorCheck,
			model: modelCheck,
			cloudflare: cloudflare.configured ? { ok: cloudflare.verified?.status === "active", detail: cloudflare.verified ? `The token was ${cloudflare.verified.status} at the last audit, ${cloudflare.verified.checkedAt.slice(0, 10)}${cloudflare.verified.expiresOn ? `; it ends ${cloudflare.verified.expiresOn.slice(0, 10)}` : ""}` : "Saved, not checked yet: run an audit" } : null,
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

	/**
	 * The keys of the findings new in `report` since the kept scan before it, from the server's own
	 * history (B-Q1): "New since the last scan" exports exactly what the page shows. None when there is
	 * no earlier scan or it cannot be read, so the filter then matches nothing rather than everything.
	 */
	async function newKeysOf(report: ScanReport): Promise<Set<string>> {
		const latest = await history.compare(report).catch(() => null);
		return new Set(latest?.state === "compared" ? latest.change.newKeys : []);
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
		const filter = parseFilter({ severity: query.get("severity"), kind: query.get("kind"), match: query.get("q"), repo: query.get("repo"), new: query.get("new") }, await newKeysOf(report));
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
		const [code, answer] = await monitorArea.proxyToMonitor("GET", `/api/domains/${domainExport[1]}`, undefined);
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
	/**
	 * The judgements made at or after `since`, each under the key of every finding it judges, so the
	 * page can put them beside their findings without fetching the report and history again (OP-6).
	 * `scannedAt` names the report they belong to; a page holding another one fetches the report instead.
	 */
	async function judgementsRoute(res: ServerResponse, since: string | null): Promise<void> {
		const report = await readReport(options.reportPath);
		if (!report) return sendJson(res, 200, { scannedAt: null, judgements: [] });
		const stored = await readAnalysis(analysisPath, report);
		const judgements: { key: string; analysis: unknown }[] = [];
		for (const repo of report.repos) {
			const name = repoName(report, repo);
			for (const finding of repo.findings) {
				const judged = stored.items[unitKey(name, finding)];
				if (judged && (!since || judged.at >= since)) judgements.push({ key: findingKey(name, finding), analysis: judged });
			}
		}
		return sendJson(res, 200, { scannedAt: report.scannedAt, judgements });
	}

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
			return sendJson(res, 200, { status: analysing, notStarted: analysisNotStarted, summary: { items: units.length, judged: units.length - Object.values(waiting).reduce((sum, count) => sum + count, 0), waiting, verdicts } });
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
		const assistant = modelFor("analysis").config;
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
		// Said on the Overview's analysis card too, not only in Activity and the log (R6U-11).
		const notStarted = (why: string) => {
			analysisNotStarted = { at: new Date().toISOString(), why };
			log(`Deeper analysis did not start: ${why}`, project);
		};
		const assistant = modelFor("analysis").config;
		if (!assistant) return notStarted("no model is set up (Settings → Model)");
		// The model may have been switched while the scan ran: the analysis uses only the one the page showed (S22).
		if (shown && (shown.model !== assistant.model || shown.host !== assistant.url.host)) return notStarted(`the model is now ${modelWords(assistant)}, not the one the page showed when the scan started`);
		if (isHosted(assistant) && !sendsToHosted) return notStarted(`${modelWords(assistant)} is hosted, and the scan did not say yes to sending to it`);
		void startAnalysis(DEFAULT_ANALYSE, ["critical", "high"]).catch((err) => notStarted(err instanceof Error ? err.message : String(err)));
	}

	/** Starts the model's judgement of the findings waiting at these severities, up to `limit`, and returns at once. */
	async function startAnalysis(limit: number, severities: Severity[]): Promise<typeof analysing> {
		const assistant = modelFor("analysis").config;
		if (!assistant) throw new HttpError(503, modelFor("analysis").error ?? "No model is connected. Choose one in Settings → Model");
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
			const report = await monitorArea.latestDomainReport(domain);
			prompt = domainPrompt(report);
			about = { domain, takenAt: String(report.takenAt) };
		} else if (kind === "cloudflare") {
			const report = await readAudit(cloudflareArea.auditPath);
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
			// An unchanged repository's history is not read again (OP-1); "Scan this repository again" always reads it.
			historyReuse: { dir: join(dataDir, "history-scans") },
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
				const latest = await history.compare(report).catch((err) => ({ state: "unreadable" as const, reason: err instanceof Error ? err.message : String(err) }));
				const compared = latest.state === "compared" ? { newCount: latest.change.newCount, fixedCount: latest.change.fixedCount, uncheckedCount: latest.change.uncheckedCount } : undefined;
				status = { state: "done", root, finishedAt: new Date().toISOString(), ...(compared ? { change: compared } : {}) };
				log(`Scan finished: ${scanCounts(report)}`, project);
				if (scheduled) {
					scheduleRecord.lastRun = { at: new Date().toISOString(), ok: true, summary: scanCounts(report) };
					await tell(scanNotice(report, latest.state === "compared" ? latest.change : null, latest.state === "unreadable" ? latest.reason : undefined), project);
					await digestArea.afterScheduledScan(project);
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
				if (scheduled) {
					scheduleRecord.lastRun = { at: new Date().toISOString(), ok: false, summary: error.slice(0, 300) };
					void tell(failedScanNotice(root, error), project);
				}
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
		const at = new Date().toISOString();
		try {
			const response = await (options.fetchFn ?? fetch)(options.notify.url, { method: "POST", headers, body, redirect: "error", signal: AbortSignal.timeout(15_000) });
			await response.body?.cancel();
			scheduleRecord.notice = { at, delivered: response.ok, detail: response.ok ? `delivered to ${options.notify.url.host}` : `${options.notify.url.host} refused it (HTTP ${response.status})` };
			log(response.ok ? `Sent the scan's outcome to ${options.notify.url.host}` : `${options.notify.url.host} refused the scan's outcome (HTTP ${response.status})`, project);
		} catch (err) {
			scheduleRecord.notice = { at, delivered: false, detail: `${options.notify.url.host} could not be reached` };
			log(`Could not send the scan's outcome to ${options.notify.url.host}: ${err instanceof Error ? err.message : String(err)}`, project);
		}
	}

	/**
	 * What the schedule did last and will do next (QL-5), in memory: after a restart the last scan's time
	 * stands in for the last run. The notice's address is never part of it, only its host.
	 */
	const scheduleRecord: { lastRun?: { at: string; ok: boolean; summary: string }; notice?: { at: string; delivered: boolean; detail: string } } = {};

	async function scheduleState(): Promise<ScheduleState | null> {
		const hours = options.scanEveryHours;
		if (!hours) return null;
		const last = (await readReport(options.reportPath).catch(() => null))?.scannedAt;
		const failedAt = status.state === "failed" ? status.finishedAt : undefined;
		const latest = [last, failedAt, scheduleRecord.lastRun?.at].filter((at): at is string => typeof at === "string").sort().at(-1);
		return {
			everyHours: hours,
			root: options.defaultRoot,
			...(scheduleRecord.lastRun ? { lastRun: scheduleRecord.lastRun } : {}),
			nextRun: latest ? new Date(Date.parse(latest) + hours * 3_600_000).toISOString() : new Date().toISOString(),
			notify: options.notify ? { host: options.notify.url.host, ...(scheduleRecord.notice ? { last: scheduleRecord.notice } : {}) } : null,
		};
	}

	/**
	 * Scans one repository of the stored report again and puts the result in its place. The
	 * repository is found by its name in the report, never by a path from the request. Where a
	 * scanner is missing or fails this time, what it found before is kept: not looking again never
	 * clears a finding (invariant 5). The report keeps its scan time, so its history and a model's
	 * judgements still belong to it; the repository records when it was scanned again.
	 */
	async function beginRescan(names: string[]): Promise<ScanStatus> {
		scanMayStart();
		// Running before the first await (B24); as it was again if a repository cannot be scanned.
		const earlier = status;
		const cancel = new AbortController();
		scanCancel = cancel;
		const label = names.length === 1 ? names[0]! : `${names.length} repositories`;
		status = { state: "running", root: "", startedAt: new Date().toISOString(), done: 0, total: names.length, current: names[0] ?? null };
		let report: ScanReport;
		let befores: RepoResult[];
		try {
			report = await storedReport();
			befores = names.map((name) => {
				const before = report.repos.find((repo) => repoName(report, repo) === name);
				if (!before) throw new HttpError(404, "That repository is not in the latest scan. Reload the page to see the current one.");
				return before;
			});
		} catch (err) {
			status = earlier;
			scanCancel = null;
			throw err;
		}
		status = { ...status, root: report.root };
		const project = await projects.current();
		log(`Scanning ${label} again`, project);
		// Scanned as the whole report was, so what it covers stays what the report says it covers.
		const choices = { ...(report.choices ?? standardChoices()), analyse: false };
		void (async () => {
			const total: RescanChange = { repo: label, fixedCount: 0, newCount: 0, uncheckedCount: 0 };
			for (const [index, before] of befores.entries()) {
				const name = names[index]!;
				if (status.state === "running") status = { ...status, done: index, current: name };
				const now = await rescan(before.path, { signal: cancel.signal, choices, scanned: report.repos.map((other) => other.path), ...(osvDatabase ? { osvDatabase } : {}) });
				if (cancel.signal.aborted) throw new CancelledError();
				// Scanners that did not look this time keep what they found before (invariant 5); fixed and new are counted by findingKey.
				const { merged, change } = mergeRescan(name, before, now, choices);
				// Read again: the report may have been replaced while this ran.
				const current = await storedReport();
				if (current.scannedAt !== report.scannedAt) throw new Error("A new scan replaced the report while this repository was being scanned again");
				await saveReport(options.reportPath, { ...current, repos: current.repos.map((entry) => (entry.path === before.path ? merged : entry)) });
				total.fixedCount += change.fixedCount;
				total.newCount += change.newCount;
				total.uncheckedCount += change.uncheckedCount;
				log(`Scanned ${name} again: ${merged.findings.length === 1 ? "1 finding" : `${merged.findings.length} findings`}. ${rescanWords(change)}`, project);
			}
			status = { state: "done", root: report.root, finishedAt: new Date().toISOString(), rescan: total };
		})()
			.catch((err) => {
				if (err instanceof CancelledError || cancel.signal.aborted) {
					status = { state: "idle" };
					log(`Stopped scanning ${label} again. What was scanned before stopping is kept`, project);
					return;
				}
				const error = err instanceof Error ? err.message : String(err);
				status = { state: "failed", root: report.root, finishedAt: new Date().toISOString(), error };
				log(`Scanning ${label} again failed: ${error}`, project);
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

	await new Promise<void>((resolveListen, reject) => {
		server.once("error", reject);
		server.listen(options.port, listenHost, resolveListen);
	});
	const address = server.address();
	if (address === null || typeof address === "string") throw new Error("Could not determine the server port");
	port = address.port;
	// Only beside a page on this computer: a service is reached however it is deployed.
	if (loopbackOnly) await accessArea.applyAccess();
	else accessArea.turnOffForService();

	return {
		port,
		sessionKey,
		model: () => model,
		access: () => accessArea.accessStatus(),
		url: `http://127.0.0.1:${port}/#k=${sessionKey}`,
		close: async () => {
			investigateArea.investigation()?.stop.abort();
			scanCancel?.abort();
			clearInterval(schedule);
			accessArea.clearRetry();
			await accessArea.stopAccess();
			await new Promise<void>((resolveClose) => {
				server.close(() => resolveClose());
				server.closeAllConnections();
			});
		},
	};
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

const MAX_ACTIVITY = 400;
/** The most repositories one "Scan these again" scans (US-9). */
const MAX_RESCAN = 200;
/** The most findings one "Set status for N" changes at once (B-Q2). */
const MAX_BULK_NOTES = 500;

function exportChoice(query: URLSearchParams): { content?: string; format?: string } {
	return { content: query.get("content") ?? undefined, format: query.get("format") ?? undefined };
}

/** Adds the repair for each open finding to a monitor answer that carries a scan report. */
function withSuggestions(answer: unknown): unknown {
	const report = (answer as { report?: MonitorReport | null } | null)?.report;
	if (!report || !Array.isArray(report.findings)) return answer;
	return { ...(answer as object), suggestions: domainSuggestions(report) };
}
