// @ts-check
// What every page shares: the server's settings, the latest scan report, and
// the state of a running scan. Pages read from here and are told when it
// changes, so a scan started on one page updates all of them.
import { api, ApiError } from "./api.js";
import { findingKey } from "./tracking.js";

/** @typedef {import("../src/repos/types.ts").Finding} Finding */
/** @typedef {{ title: string, how: string[], phase: "now" | "next" | "schedule" | "later" }} Suggestion */
/** @typedef {import("../src/analysis/analyse.ts").Judgement} Judgement */
/** @typedef {Finding & { suggestion?: Suggestion, analysis?: Judgement }} SuggestedFinding */
/** @typedef {Omit<import("../src/repos/types.ts").RepoResult, "findings"> & { name: string, findings: SuggestedFinding[] }} Repo */
/** @typedef {Omit<import("../src/repos/types.ts").ScanReport, "repos"> & { repos: Repo[] }} ScanReport */
/** @typedef {import("../src/ui/server.ts").ScanStatus} ScanStatus */
/** @typedef {SuggestedFinding & { repo: string }} FindingRow */
/** @typedef {import("../src/host/types.ts").HostReport} HostReport */
/** @typedef {import("../src/ui/server.ts").HostStatus} HostStatus */
/** @typedef {import("../src/cloudflare/types.ts").CfReport} CfReport */
/** @typedef {import("../src/ui/server.ts").CloudflareStatus} CloudflareStatus */
/** @typedef {{ configured: boolean, source: "settings" | "startup" | null, savedAt?: string, error?: string, verified?: { status: string, kind: "user" | "account", expiresOn?: string, checkedAt: string } }} CloudflareToken */
/** @typedef {{ name: string, scope: string, purpose: string }} CloudflarePermission */
/** @typedef {{ read: CloudflarePermission[], write: CloudflarePermission[], templateUrl: string }} CloudflareGuide */
/** @typedef {{ at: string, zone: string, zoneId: string, change: string, title: string, request: { method: string, url: string, body: unknown }, ok: boolean, result: string }} AppliedChange */
/** @typedef {"report" | "scan" | "settings" | "notes" | "host" | "cloudflare" | "projects"} Change */
/** @typedef {import("../src/projects/projects.ts").Project} Project */
/**
 * The projects and the one in use. `canChange`: this page may add and remove them (not another device
 * over the tailnet). `within`: a service keeps its project folders inside this folder.
 *
 * @typedef {{ current: string | null, projects: Project[], canChange: boolean, within?: string }} Projects
 */

const POLL_MS = 800;

export const store = {
	/**
	 * `service`: Porchlight runs as a service (a container, under BoxPilot), configured where it is
	 * managed rather than from a terminal. `monitor.unset`: neither monitor setting was given.
	 * `assistant`: the local model behind Explain, Summarise and Ask.
	 *
	 * `platform`: the operating system Porchlight runs on, such as "darwin".
	 *
	 * `cloudflare`: whether a Cloudflare token is saved or given at start-up; never the token.
	 *
	 * @type {{ defaultRoot: string, reportPath: string, service: boolean, monitor: { configured: boolean, host?: string, error?: string, unset?: boolean, source?: "settings", savedAt?: string }, github: { token: boolean, error?: string }, assistant: import("./generated.js").AssistantSettings, appearance: string, answers: string, remote: boolean, platform: string, sendTargets: import("./send-text.js").SendTarget[], lastView: string | null, cloudflare: CloudflareToken } | null}
	 */
	settings: null,
	/** @type {ScanReport | null} */
	report: null,
	/** What the scan could not check. */
	/** @type {string[]} */
	notes: [],
	/** What repositories told the scanners to leave out. */
	/** @type {string[]} */
	settingNotes: [],
	/** @type {ScanStatus} */
	scan: { state: "idle" },
	/** The owner's status and note for findings, by `findingKey`. They carry over to later scans. */
	/** @type {Record<string, import("./tracking.js").FindingNote>} */
	findingNotes: {},
	/** The latest scan against the one before it; null until there are two. */
	/** @type {{ previousScannedAt: string, newCount: number, fixedCount: number, uncheckedCount?: number, newKeys: string[], fixed: { repo: string, severity: import("./filter.js").Severity, kind: string, ruleId: string, title: string, location: string, detail: string }[] } | null} */
	change: null,
	/** Every kept scan, newest first. */
	/** @type {{ file: string, scannedAt: string, root: string, repositories: number, findings: number, counts: Record<string, number>, newCount?: number, fixedCount?: number }[]} */
	scans: [],
	/**
	 * The check of the computer Porchlight runs on. `service`: it does not run here (a container).
	 *
	 * @type {{ status: HostStatus, report: HostReport | null, service: boolean }}
	 */
	host: { status: { state: "idle" }, report: null, service: false },
	/** @type {Projects} */
	projects: { current: null, projects: [], canChange: false },
	/**
	 * The audit of the owner's Cloudflare account. `canChange`: this page may save the token and approve
	 * changes (only the page on the computer Porchlight runs on).
	 *
	 * @type {{ loaded: boolean, token: CloudflareToken, status: CloudflareStatus, report: CfReport | null, changes: AppliedChange[], batch: import("../src/ui/server.ts").BatchStatus, lacking: string[], canChange: boolean, service: boolean, guide: CloudflareGuide | null }}
	 */
	cloudflare: { loaded: false, token: { configured: false, source: null }, status: { state: "idle" }, report: null, changes: [], batch: { state: "idle" }, lacking: [], canChange: false, service: false, guide: null },
};

/** @type {Set<string>} */
let newKeys = new Set();

/** @type {Set<(change: Change) => void>} */
const listeners = new Set();
/** @type {Promise<void> | null} */
let loading = null;
/** @type {FindingRow[] | null} */
let rows = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let pollTimer;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let hostTimer;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let cloudflareTimer;

/**
 * @param {(change: Change) => void} listener
 * @returns {() => void} stops listening
 */
export function subscribe(listener) {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** @param {Change} change */
function emit(change) {
	for (const listener of [...listeners]) listener(change);
}

/** Loads the settings and the report once. Later calls wait for, or reuse, the first. */
export function load() {
	loading ??= (async () => {
		const state = await api("GET", "/state");
		store.settings = {
			defaultRoot: state.defaultRoot,
			reportPath: state.reportPath,
			service: state.service === true,
			monitor: state.monitor,
			github: state.github ?? { token: false },
			assistant: state.assistant ?? { configured: false },
			appearance: state.appearance ?? "today",
			// Where a model's answers appear: "right", "below" or "bottom" (Settings → Appearance).
			answers: typeof state.answers === "string" ? state.answers : "right",
			remote: state.remote === true,
			platform: typeof state.platform === "string" ? state.platform : "",
			sendTargets: Array.isArray(state.sendTargets) ? state.sendTargets : [],
			lastView: typeof state.lastView === "string" ? state.lastView : null,
			cloudflare: state.cloudflare ?? { configured: false, source: null },
		};
		emit("settings");
		if (state.projects) setProjects(state.projects);
		store.scan = state.scan;
		await loadReport();
		if (store.scan.state === "running") poll();
	})().catch((err) => {
		loading = null; // A failed load is retried by the next page that asks.
		throw err;
	});
	return loading;
}

/**
 * The model changed in Settings: every page's Explain, Summarise and Ask follow it.
 *
 * @param {import("./generated.js").AssistantSettings} assistant
 */
export function setAssistant(assistant) {
	if (!store.settings) return;
	store.settings.assistant = assistant;
	emit("settings");
	// The models "Send to a model" offers follow Settings too: one set up there is offered at once.
	void api("GET", "/state")
		.then((state) => {
			if (!store.settings || !Array.isArray(state.sendTargets)) return;
			store.settings.sendTargets = state.sendTargets;
			emit("settings");
		})
		.catch(() => {});
}

/**
 * The projects as the server last said, after a change on any page.
 *
 * @param {Projects} projects
 */
export function setProjects(projects) {
	store.projects = {
		current: typeof projects.current === "string" ? projects.current : null,
		projects: Array.isArray(projects.projects) ? projects.projects : [],
		canChange: projects.canChange === true,
		...(typeof projects.within === "string" ? { within: projects.within } : {}),
	};
	emit("projects");
}

/** The project exports, discussions and the log go to, or null. */
export function currentProject() {
	return store.projects.projects.find((project) => project.id === store.projects.current) ?? null;
}

/** Forgets everything, so the next `load` starts again. Used after the session key changes. */
export function reset() {
	clearTimeout(pollTimer);
	clearTimeout(hostTimer);
	clearTimeout(cloudflareTimer);
	loading = null;
	rows = null;
	store.settings = null;
	store.report = null;
	store.notes = [];
	store.settingNotes = [];
}

export async function loadReport() {
	const data = await api("GET", "/repos/report");
	store.report = /** @type {ScanReport | null} */ (data.report);
	store.notes = data.notes;
	store.settingNotes = data.settingNotes ?? [];
	store.findingNotes = data.findingNotes ?? {};
	rows = null;
	// History is extra: a page still shows the scan if it cannot be read.
	try {
		const history = await api("GET", "/repos/history");
		store.change = history.change ?? null;
		store.scans = Array.isArray(history.scans) ? history.scans : [];
	} catch {
		store.change = null;
		store.scans = [];
	}
	newKeys = new Set(store.change?.newKeys ?? []);
	emit("report");
}

/**
 * Whether a finding is new since the previous scan.
 *
 * @param {string} repo
 * @param {{ ruleId: string, location: string, detail: string }} finding
 */
export function isNew(repo, finding) {
	return newKeys.has(findingKey(repo, finding));
}

/**
 * The owner's status and note for a finding, or null when it has none.
 *
 * @param {string} repo
 * @param {{ ruleId: string, location: string, detail: string }} finding
 */
export function noteFor(repo, finding) {
	return store.findingNotes[findingKey(repo, finding)] ?? null;
}

/**
 * Saves the owner's status and note for a finding of the latest scan.
 *
 * @param {string} repo
 * @param {{ ruleId: string, location: string, detail: string }} finding
 * @param {string} status
 * @param {string} note
 */
export async function saveFindingNote(repo, finding, status, note) {
	const answer = await api("POST", "/findings/note", { repo, ruleId: finding.ruleId, location: finding.location, detail: finding.detail, status, note });
	if (answer.note) store.findingNotes[answer.key] = answer.note;
	else delete store.findingNotes[answer.key];
	emit("notes");
}

/**
 * @param {string} root
 * @param {number} depth
 */
export async function startScan(root, depth) {
	try {
		const { scan } = await api("POST", "/repos/scan", { root, depth });
		setScan(scan);
	} catch (err) {
		// Someone else, or another tab, started one: follow that scan instead.
		if (!(err instanceof ApiError && err.status === 409)) throw err;
	}
	poll();
}

/** @param {ScanStatus} scan */
function setScan(scan) {
	store.scan = scan;
	emit("scan");
}

function poll() {
	clearTimeout(pollTimer);
	pollTimer = setTimeout(async () => {
		try {
			const { scan } = await api("GET", "/repos/scan");
			setScan(scan);
			if (scan.state === "running") return poll();
			if (scan.state === "done") await loadReport();
		} catch (err) {
			setScan({ state: "failed", root: "", finishedAt: "", error: err instanceof Error ? err.message : String(err) });
		}
	}, POLL_MS);
}

/** Every finding of the report as one list, each carrying its repository's name. Built once per report. */
export function findingRows() {
	rows ??= (store.report?.repos ?? []).flatMap((repo) => repo.findings.map((finding) => ({ ...finding, repo: repo.name })));
	return rows;
}

/** Reads what the last check of this computer found, and follows a check that is running. */
export async function loadHost() {
	const data = await api("GET", "/host");
	store.host = { status: data.status, report: data.report ?? null, service: data.service === true };
	emit("host");
	if (store.host.status.state === "running") pollHost();
}

/**
 * Starts a check of this computer. It only reads; the options say whether it may ask Apple for
 * updates and look packages up on OSV.dev.
 *
 * @param {{ askApple: boolean, lookUpPackages: boolean }} options
 */
export async function startHostCheck(options) {
	try {
		const { status } = await api("POST", "/host/check", options);
		store.host.status = status;
		emit("host");
	} catch (err) {
		// Already running, started from another tab: follow it instead.
		if (!(err instanceof ApiError && err.status === 409 && !store.host.service)) throw err;
	}
	pollHost();
}

function pollHost() {
	clearTimeout(hostTimer);
	hostTimer = setTimeout(async () => {
		try {
			const data = await api("GET", "/host");
			store.host = { status: data.status, report: data.report ?? null, service: data.service === true };
			emit("host");
			if (data.status.state === "running") pollHost();
		} catch (err) {
			store.host.status = { state: "failed", finishedAt: "", error: err instanceof Error ? err.message : String(err) };
			emit("host");
		}
	}, POLL_MS);
}

/** @param {Record<string, any>} data */
function setCloudflare(data) {
	store.cloudflare = {
		loaded: true,
		token: data.token ?? { configured: false, source: null },
		status: data.status ?? { state: "idle" },
		report: data.report ?? null,
		changes: Array.isArray(data.changes) ? data.changes : [],
		batch: data.batch ?? { state: "idle" },
		lacking: Array.isArray(data.lacking) ? data.lacking : [],
		canChange: data.canChange === true,
		service: data.service === true,
		guide: data.guide ?? null,
	};
	if (store.settings) store.settings.cloudflare = store.cloudflare.token;
	emit("cloudflare");
}

/** Reads the latest Cloudflare audit and the token's state, and follows an audit that is running. */
export async function loadCloudflare() {
	setCloudflare(await api("GET", "/cloudflare"));
	if (store.cloudflare.status.state === "running" || store.cloudflare.batch.state === "running") pollCloudflare();
}

/**
 * Starts an audit of the Cloudflare account. It only reads; `lookups` says whether it may look up
 * where CNAME records point, for zones whose ownership record proves them.
 *
 * @param {{ lookups: boolean }} options
 */
export async function startCloudflareAudit(options) {
	try {
		const { status } = await api("POST", "/cloudflare/audit", options);
		store.cloudflare.status = status;
		emit("cloudflare");
	} catch (err) {
		// Already running, started from another tab: follow it instead.
		if (!(err instanceof ApiError && err.status === 409 && store.cloudflare.status.state === "running")) throw err;
	}
	pollCloudflare();
}

/**
 * The monitor was connected or removed in Settings: every page follows. Only its host, never its token.
 *
 * @param {NonNullable<typeof store.settings>["monitor"]} monitor
 */
export function updateMonitor(monitor) {
	if (store.settings) store.settings.monitor = monitor;
	emit("settings");
}

/**
 * The token changed in Settings, or a change was applied: every page follows.
 *
 * @param {Partial<{ token: CloudflareToken, changes: AppliedChange[], lacking: string[] }>} update
 */
export function updateCloudflare(update) {
	if (update.lacking) store.cloudflare.lacking = update.lacking;
	if (update.token) {
		store.cloudflare.token = update.token;
		if (store.settings) store.settings.cloudflare = update.token;
	}
	if (update.changes) store.cloudflare.changes = update.changes;
	emit("cloudflare");
}

function pollCloudflare() {
	clearTimeout(cloudflareTimer);
	cloudflareTimer = setTimeout(async () => {
		try {
			setCloudflare(await api("GET", "/cloudflare"));
			if (store.cloudflare.status.state === "running" || store.cloudflare.batch.state === "running") pollCloudflare();
		} catch (err) {
			store.cloudflare.status = { state: "failed", finishedAt: "", error: err instanceof Error ? err.message : String(err) };
			emit("cloudflare");
		}
	}, POLL_MS);
}
