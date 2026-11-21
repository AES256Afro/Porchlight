import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import type { AssistantConfig } from "../assist/ollama.ts";
import { EgressLog, loggedFetch } from "../egress.ts";
import type { GithubConfig } from "../github/github.ts";
import type { HostCheckOptions } from "../host/check.ts";
import type { HostReport } from "../host/types.ts";
import type { Net } from "../investigate/tools.ts";
import type { MonitorConfig } from "../monitor/client.ts";
import type { NotifyFormat } from "../notify/format.ts";
import { ProjectError } from "../projects/projects.ts";
import type { Runner } from "../repos/exec.ts";
import { History } from "../repos/history.ts";
import { rescanRepo, scanRepos } from "../repos/scan.ts";
import { ExportError } from "../roadmap/export.ts";
import { PORCHLIGHT_VERSION } from "../version.ts";
import { plainError } from "../../ui/plain-error.js";
import { createActivity } from "./activity.ts";
import type { ServerContext } from "./context.ts";
import { checkKey, hostAllowed, LOOPBACK_HOSTS, MIN_KEY_LENGTH, originAllowed, SESSION_HEADER, sessionMatches, type Call, type Gate } from "./gate.ts";
import { etagMatches, HttpError, readJsonBody, SECURITY_HEADERS, sendBytes, sendJson, staticFile } from "./http.ts";
import { moveIntoDataFolder } from "./kept-files.ts";
import { readReport } from "./report-cache.ts";
import { dispatch, type Route } from "./router.ts";
import { createAccess } from "./routes/access.ts";
import { createAnalysis } from "./routes/analysis.ts";
import { assistRoutes } from "./routes/assist.ts";
import { createCloudflare } from "./routes/cloudflare.ts";
import { createDigest } from "./routes/digest.ts";
import { createDiscussions } from "./routes/discussions.ts";
import { createDownload } from "./routes/download.ts";
import { egressRoutes } from "./routes/egress.ts";
import { createGithub } from "./routes/github.ts";
import { createHostCheck } from "./routes/host.ts";
import { claimsHosts, hostsRoute } from "./routes/hosts.ts";
import { createInvestigate } from "./routes/investigate.ts";
import { menuStatusRoutes } from "./routes/menu-status.ts";
import { createModels } from "./routes/models.ts";
import { createMonitor } from "./routes/monitor.ts";
import { noteRoutes } from "./routes/notes.ts";
import { orphanExportRoutes } from "./routes/orphan-notes.ts";
import { osvDatabaseRoutes } from "./routes/osv-database.ts";
import { createProjects } from "./routes/projects.ts";
import { createReport } from "./routes/report.ts";
import { createScanning } from "./routes/scanning.ts";
import { seenRoutes } from "./routes/seen.ts";
import { stateRoutes } from "./routes/state.ts";
import type { AccessStatus, ModelInUse } from "./types.ts";

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
export const SCRIPTS = ["app", "api", "dom", "filter", "list", "hints", "generated", "store", "export", "assist", "analysis", "github", "overview", "findings", "finding-parts", "roadmap", "repos", "domains", "looks", "appearance", "settings", "models", "model-settings", "access-settings", "send", "send-text", "tracking", "finding-notes", "host", "host-areas", "paths", "investigate", "discussions", "discussion", "discussion-links", "panel", "projects", "cloudflare", "cloudflare-settings", "monitor-settings", "activity", "model-download", "scan-choices", "scan-options", "poller", "glance", "charts", "chart-layout", "domain-hosts", "due", "seen", "model-tasks", "egress", "plain-error"];
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
			models: () => [models.model().config?.url.host, ...models.targets().map((target) => target.config.url.host)].filter((host): host is string => typeof host === "string"),
			notify: () => options.notify?.url.host,
		}),
	};
	// Settings and secrets in the data folder; the report's own companions beside it (S34).
	const reportDir = dirname(options.reportPath);
	const dataDir = options.dataDir ?? reportDir;
	if (dataDir !== reportDir) await moveIntoDataFolder(reportDir, dataDir, (line) => console.log(`porchlight ui: ${line}`));
	// Every finished scan is kept, so the page can say what is new and what was fixed since the last one.
	const history = new History(reportDir);
	// A report from before history was kept starts it, so the next scan has something to compare with.
	await readReport(options.reportPath)
		.then((report) => (report ? history.add(report) : null))
		.catch(() => {});
	let port = options.port;

	// What every area shares: the Activity view and the project's log, the model in use, the latest report.
	const activity = createActivity(loopbackOnly);
	const models = await createModels(options, dataDir);
	const projectsArea = await createProjects(options, dataDir, loopbackOnly, activity.note);
	const ctx: ServerContext = {
		options,
		loopbackOnly,
		dataDir,
		reportDir,
		history,
		notesPath: join(reportDir, "finding-notes.json"),
		analysisPath: join(reportDir, "repo-analysis.json"),
		projects: projectsArea.projects,
		log: projectsArea.log,
		note: activity.note,
		saveExport: projectsArea.saveExport,
		assistantSummary: models.assistantSummary,
		confirmModel: models.confirmModel,
		modelWords: models.modelWords,
		model: models.model,
		modelFor: models.modelFor,
		targets: models.targets,
		modelBusy: models.modelBusy,
		setModelBusy: models.setModelBusy,
		sending: models.sending,
		monitor: () => monitorArea.monitor(),
		storedReport: async () => {
			const report = await readReport(options.reportPath);
			if (!report) throw new HttpError(404, "There is no scan yet. Scan a folder first.");
			return report;
		},
		/**
		 * The keys of the findings new in `report` since the kept scan before it, from the server's own
		 * history (B-Q1): "New since the last scan" exports exactly what the page shows. None when there is
		 * no earlier scan or it cannot be read, so the filter then matches nothing rather than everything.
		 */
		newKeysOf: async (report) => {
			const latest = await history.compare(report).catch(() => null);
			return new Set(latest?.state === "compared" ? latest.change.newKeys : []);
		},
		scanStatus: () => scanning.status(),
		fetchStatus: () => githubArea.fetchStatus(),
		analysisStatus: () => analysis.status(),
	};

	// The areas, each in routes/<area>.ts, given what they share with the rest.
	const hostArea = createHostCheck(ctx);
	const downloadArea = createDownload(ctx);
	const accessArea = await createAccess(ctx, (gate) => respond(gate));
	const monitorArea = await createMonitor(ctx);
	const investigateArea = createInvestigate(ctx);
	const cloudflareArea = createCloudflare(ctx, investigateArea.domainsPath);
	const digestArea = createDigest(ctx);
	const githubArea = createGithub(ctx);
	const analysis = createAnalysis(ctx);
	const reportArea = await createReport(ctx, monitorArea);
	const scanning = createScanning(ctx, githubArea.github, { analyseAfterScan: analysis.analyseAfterScan, afterScheduledScan: digestArea.afterScheduledScan });
	const sources = { latestDomainReport: monitorArea.latestDomainReport, auditPath: cloudflareArea.auditPath };
	const discussions = createDiscussions(ctx, sources);
	const state = stateRoutes(ctx, {
		porchlightVersion,
		activity: activity.since,
		defaultDepth: scanning.defaultDepth,
		scheduleState: scanning.scheduleState,
		github: githubArea.github,
		projectsState: projectsArea.projectsState,
		monitorState: monitorArea.monitorState,
		proxyToMonitor: monitorArea.proxyToMonitor,
		cloudflareTokenState: cloudflareArea.cloudflareTokenState,
		investigation: investigateArea.investigation,
		busyWork,
	});

	/** What would be lost by quitting now, in words, so the app can ask first. Empty when nothing is. */
	function busyWork(): string[] {
		const busy: string[] = [];
		const muralRunning = reportArea.muralRunning();
		const analysisRunning = analysis.status().state === "running";
		if (scanning.status().state === "running") busy.push("A scan is running");
		if (githubArea.fetchStatus().state === "running") busy.push("Repositories are being fetched from GitHub");
		if (analysisRunning) busy.push("Deeper analysis is running");
		if (muralRunning) busy.push("A mural is being written");
		if (hostArea.hostStatus().state === "running") busy.push("This computer is being checked");
		if (investigateArea.investigation()) busy.push(`An investigation of ${investigateArea.investigation()!.run.domain} is running`);
		if (cloudflareArea.cloudflareStatus().state === "running") busy.push("Your Cloudflare account is being audited");
		if (models.sendingNow() > 0) busy.push("A model is answering what you sent it");
		else if (models.modelBusy() && !muralRunning && !analysisRunning) busy.push("The model is answering");
		return busy;
	}

	/**
	 * What answers what, in order: the first entry that claims a request answers it, so a narrower
	 * path comes before the wider one that contains it (/api/model/local before /api/model, a
	 * domain's export and hosts before /api/domains). Each entry answers one route, or one family of
	 * paths whose handler says which methods it takes, and none dispatches again (RD-2).
	 */
	const routeTable: Route[] = [
		...state.stateRoutes,
		...projectsArea.routes,
		...discussions.routes,
		...hostArea.routes,
		...investigateArea.routes,
		...cloudflareArea.routes,
		...monitorArea.routes,
		...state.pageRoutes,
		...reportArea.historyRoutes,
		...noteRoutes(ctx),
		...state.watchRoutes,
		...downloadArea.routes,
		...models.routes(ctx),
		...accessArea.routes,
		...assistRoutes(ctx, sources, discussions),
		...reportArea.reportRoutes,
		...analysis.routes,
		...reportArea.muralStopRoutes,
		...reportArea.roadmapRoutes,
		...scanning.readRoutes,
		...reportArea.sbomRoutes,
		...githubArea.routes,
		...scanning.startRoutes,
		...reportArea.domainExportRoutes,
		[claimsHosts, (call) => hostsRoute(ctx, call)],
		...osvDatabaseRoutes(ctx),
		...orphanExportRoutes(ctx),
		...seenRoutes(ctx),
		...egressRoutes(egress),
		...menuStatusRoutes(ctx, () => scanning.status().state === "running"),
		...state.domainRoutes,
	];

	const localGate: Gate = { loopbackOnly, key: () => sessionKey, port: () => port, tailnet: false };
	const respond = (gate: Gate) => (req: IncomingMessage, res: ServerResponse) => {
		handle(req, res, gate).catch((err) => {
			// An export that cannot be made is the caller's mistake, and the message says what to change.
			const known = err instanceof HttpError || err instanceof ExportError || err instanceof ProjectError;
			if (!known) console.error(`porchlight ui: ${err instanceof Error ? err.message : String(err)}`);
			// A project folder that cannot be written is a state to put right, said in the owner's terms.
			// "fetch failed" and "DNS status 2" are put into plain words here, once, for every route (R6U-10).
			sendJson(res, err instanceof HttpError ? err.status : err instanceof ProjectError ? 409 : known ? 400 : 500, { error: known ? plainError(err.message) : "Internal error" });
		});
	};
	const server = createServer(respond(localGate));

	/**
	 * Every request comes through here: first the gate, which decides whether it is answered at all,
	 * then the one dispatch through the route table.
	 */
	async function handle(req: IncomingMessage, res: ServerResponse, gate: Gate): Promise<void> {
		const call = await admit(req, res, gate);
		if (!call) return;
		return dispatch(routeTable, call);
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
		model: models.model,
		access: () => accessArea.accessStatus(),
		url: `http://127.0.0.1:${port}/#k=${sessionKey}`,
		close: async () => {
			investigateArea.investigation()?.stop.abort();
			scanning.close();
			accessArea.clearRetry();
			await accessArea.stopAccess();
			await new Promise<void>((resolveClose) => {
				server.close(() => resolveClose());
				server.closeAllConnections();
			});
		},
	};
}
