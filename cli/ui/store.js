// @ts-check
// What every page shares: the server's settings, the latest scan report, and
// the state of a running scan. Pages read from here and are told when it
// changes, so a scan started on one page updates all of them.
import { taskAssistant } from "./model-tasks.js";
import { api, ApiError } from "./api.js";
import { pageVisibility } from "./dom.js";
import { poller } from "./poller.js";
import { findingKey } from "./tracking.js";

/** @typedef {import("../src/repos/types.ts").Finding} Finding */
/** @typedef {{ title: string, how: string[], phase: "now" | "next" | "schedule" | "later" }} Suggestion */
/** @typedef {import("../src/analysis/analyse.ts").Judgement} Judgement */
/** @typedef {Finding & { suggestion?: Suggestion, fix?: number, analysis?: Judgement }} SuggestedFinding */
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
/** @typedef {{ at: string, zone: string, zoneId: string, change: string, title: string, request: { method: string, url: string, body: unknown }, ok: boolean, result: string, notSent?: boolean }} AppliedChange */
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
	 * @type {{ defaultRoot: string, reportPath: string, scanDepth: number, scanEveryHours: number, service: boolean, monitor: { configured: boolean, host?: string, error?: string, unset?: boolean, source?: "settings", savedAt?: string }, github: { token: boolean, error?: string }, assistant: import("./generated.js").AssistantSettings, appearance: string, answers: string, remote: boolean, platform: string, sendTargets: import("./send-text.js").SendTarget[], lastView: string | null, cloudflare: CloudflareToken, version: string, schedule: import("../src/ui/server.ts").ScheduleState | null } | null}
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
	/** Why the owner's notes could not be read, when they could not: the page says so rather than show none. */
	notesProblem: "",
	/** Why the scan before the latest could not be compared with it, when it could not. */
	changeProblem: "",
	/** The latest scan against the one before it; null until there are two. */
	/** @type {{ previousScannedAt: string, newCount: number, fixedCount: number, uncheckedCount?: number, newKeys: string[], fixed: { repo: string, severity: import("./filter.js").Severity, kind: string, ruleId: string, title: string, location: string, detail: string }[] } | null} */
	change: null,
	/** Every kept scan, newest first. */
	/** @type {{ file: string, scannedAt: string, root: string, repositories: number, findings: number, counts: Record<string, number>, newCount?: number, fixedCount?: number }[]} */
	scans: [],
	/**
	 * The check of the computer Porchlight runs on. `service`: it does not run here (a container).
	 *
	 * `change`: against the check before it (G-Q1); null when there is none.
	 *
	 * @type {{ status: HostStatus, report: HostReport | null, service: boolean, change: import("../src/kept-checks.ts").CheckComparison | null, loaded: boolean }}
	 */
	host: { status: { state: "idle" }, report: null, service: false, change: null, loaded: false },
	/** @type {Projects} */
	projects: { current: null, projects: [], canChange: false },
	/**
	 * The audit of the owner's Cloudflare account. `canChange`: this page may save the token and approve
	 * changes (only the page on the computer Porchlight runs on).
	 *
	 * `change`: against the audit before it (F-Q3). `changedSince`: "<zone id>\n<change>" for each check
	 * changed after the audit (F-Q2).
	 *
	 * @type {{ loaded: boolean, token: CloudflareToken, status: CloudflareStatus, report: CfReport | null, changes: AppliedChange[], batch: import("../src/ui/server.ts").BatchStatus, lacking: string[], canChange: boolean, service: boolean, guide: CloudflareGuide | null, change: import("../src/kept-checks.ts").CheckComparison | null, changedSince: Set<string> }}
	 */
	cloudflare: { loaded: false, token: { configured: false, source: null }, status: { state: "idle" }, report: null, changes: [], batch: { state: "idle" }, lacking: [], canChange: false, service: false, guide: null, change: null, changedSince: new Set() },
};

/**
 * The keys of the findings new since the last scan. One set, changed in place when a report loads, so
 * a page's filter can hold it once and always see the latest (B-Q1).
 *
 * @type {Set<string>}
 */
export const newFindingKeys = new Set();
const newKeys = newFindingKeys;

/** @type {Set<(change: Change) => void>} */
const listeners = new Set();
/** @type {Promise<void> | null} */
let loading = null;
/** @type {FindingRow[] | null} */
let rows = null;
/**
 * The three things the page follows while they run on the server: a scan, the host check and the
 * Cloudflare audit (or a set of its changes being sent). Each asks once at a time, forgives a few
 * failures in a row with a growing wait, and waits while the tab is hidden (OP-8, UI-B10).
 */
/** @type {ReturnType<typeof poller> | null} */
let scanPoll = null;
/** @type {ReturnType<typeof poller> | null} */
let hostPoll = null;
/** @type {ReturnType<typeof poller> | null} */
let cloudflarePoll = null;

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
			// Folder levels a scan looks through unless changed, and how often a service scans by itself (0: only when asked).
			scanDepth: typeof state.scanDepth === "number" ? state.scanDepth : 3,
			scanEveryHours: typeof state.scanEveryHours === "number" ? state.scanEveryHours : 0,
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
			version: typeof state.version === "string" ? state.version : "",
			schedule: state.schedule ?? null,
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
	scanPoll?.stop();
	hostPoll?.stop();
	cloudflarePoll?.stop();
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
	// Each repair is sent once; a finding names its own by its place in the list (OP-5).
	/** @type {Suggestion[]} */
	const repairs = Array.isArray(data.suggestions) ? data.suggestions : [];
	for (const repo of store.report?.repos ?? []) {
		for (const finding of repo.findings) if (typeof finding.fix === "number" && repairs[finding.fix]) finding.suggestion = repairs[finding.fix];
	}
	store.notes = data.notes;
	store.settingNotes = data.settingNotes ?? [];
	store.findingNotes = data.findingNotes ?? {};
	store.notesProblem = typeof data.notesProblem === "string" ? data.notesProblem : "";
	rows = null;
	// History is extra: a page still shows the scan if it cannot be read.
	try {
		const history = await api("GET", "/repos/history");
		store.change = history.change ?? null;
		store.scans = Array.isArray(history.scans) ? history.scans : [];
		store.changeProblem = typeof history.changeProblem === "string" ? history.changeProblem : typeof history.problem === "string" ? history.problem : "";
	} catch (err) {
		store.change = null;
		store.scans = [];
		store.changeProblem = err instanceof Error ? err.message : String(err);
	}
	newKeys.clear();
	for (const key of store.change?.newKeys ?? []) newKeys.add(key);
	emit("report");
}

/**
 * Puts the deeper analysis's newer judgements beside their findings, without fetching the report and
 * history again (OP-6). A report other than the one shown is fetched whole instead.
 */
export async function loadJudgements() {
	const report = store.report;
	if (!report) return loadReport();
	let since = "";
	for (const repo of report.repos) for (const finding of repo.findings) if (finding.analysis && finding.analysis.at > since) since = finding.analysis.at;
	const data = await api("GET", `/analysis/judgements${since ? `?since=${encodeURIComponent(since)}` : ""}`);
	if (data.scannedAt !== report.scannedAt || store.report !== report) return loadReport();
	/** @type {Map<string, Judgement>} */
	const judged = new Map((Array.isArray(data.judgements) ? data.judgements : []).map((/** @type {{ key: string, analysis: Judgement }} */ item) => [item.key, item.analysis]));
	if (judged.size === 0) return;
	for (const repo of report.repos) {
		for (const finding of repo.findings) {
			const analysis = judged.get(findingKey(repo.name, finding));
			if (analysis) finding.analysis = analysis;
		}
	}
	rows = null;
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
 * @param {string} [until] for an accepted risk: the last day it is accepted for (YYYY-MM-DD), or "" for no end
 */
export async function saveFindingNote(repo, finding, status, note, until = "") {
	const answer = await api("POST", "/findings/note", { repo, ruleId: finding.ruleId, location: finding.location, detail: finding.detail, status, note, ...(status === "accepted" && until ? { until } : {}) });
	if (answer.note) store.findingNotes[answer.key] = answer.note;
	else delete store.findingNotes[answer.key];
	emit("notes");
}

/** @type {Promise<import("../src/discussions/discussions.ts").DiscussionSummary[]> | null} */
let discussionList = null;

/**
 * The kept discussions, asked once a page load and again after a new answer (H-Q1). One that cannot be
 * read is none: the page then simply offers no earlier answer.
 */
export function discussionsOnce() {
	discussionList ??= api("GET", "/discussions").then(
		(answer) => (Array.isArray(answer.discussions) ? answer.discussions : []),
		() => [],
	);
	return discussionList;
}

/** A new answer was kept: the next ask reads the list again. */
export function discussionsChanged() {
	discussionList = null;
}

/**
 * One status and note for several findings at once (B-Q2).
 *
 * @param {{ repo: string, ruleId: string, location: string, detail: string }[]} findings
 * @param {string} status
 * @param {string} note
 * @param {string} [until]
 * @returns {Promise<number>} how many were saved
 */
export async function saveFindingNotes(findings, status, note, until = "") {
	const answer = await api("POST", "/findings/notes", {
		findings: findings.map((finding) => ({ repo: finding.repo, ruleId: finding.ruleId, location: finding.location, detail: finding.detail })),
		status,
		note,
		...(status === "accepted" && until ? { until } : {}),
	});
	for (const item of Array.isArray(answer.notes) ? answer.notes : []) {
		if (item.note) store.findingNotes[item.key] = item.note;
		else delete store.findingNotes[item.key];
	}
	emit("notes");
	return Array.isArray(answer.notes) ? answer.notes.length : 0;
}

/**
 * @param {string} root
 * @param {number} depth
 * @param {import("../src/repos/types.ts").ScanChoices} choices
 * @param {boolean} [sendsToHosted] the page said a hosted model would be sent findings afterwards, and the owner went ahead
 */
export async function startScan(root, depth, choices, sendsToHosted = false) {
	try {
		// The model the page showed goes too: a Deep scan's analysis afterwards uses no other (S22).
		const assistant = taskAssistant("analysis");
		const shown = assistant?.model && assistant.host !== undefined ? { shown: { model: assistant.model, host: assistant.host } } : {};
		const { scan } = await api("POST", "/repos/scan", { root, depth, choices, sendsToHosted, ...shown });
		setScan(scan);
	} catch (err) {
		// Another tab started a scan: follow that one. The server also answers 409 while a model analyses
		// or GitHub fetches, and then nothing is running to follow: its reason is said instead (B40).
		if (!(err instanceof ApiError && err.status === 409)) throw err;
		const { scan } = await api("GET", "/repos/scan");
		setScan(scan);
		if (scan.state !== "running") throw err;
	}
	poll();
}

/**
 * Scans one repository of the report again, by its name, and follows it like any scan.
 *
 * @param {string} repo
 */
export async function rescanRepo(repo) {
	const { scan } = await api("POST", "/repos/rescan", { repo });
	setScan(scan);
	poll();
}

/**
 * Scans several repositories of the report again, one after another, as one job (US-9).
 *
 * @param {string[]} repos
 */
export async function rescanRepos(repos) {
	const { scan } = await api("POST", "/repos/rescan", { repos: repos.slice(0, 200) });
	setScan(scan);
	poll();
}

/** Stops the scan that is running. Nothing is saved; the last scan stays as it was. */
export async function cancelScan() {
	try {
		await api("POST", "/repos/scan/cancel");
	} catch (err) {
		// It finished in the meantime: there is nothing left to stop.
		if (!(err instanceof ApiError && err.status === 409)) throw err;
	}
	poll();
}

/** @param {ScanStatus} scan */
function setScan(scan) {
	store.scan = scan;
	emit("scan");
}

/** Follows the scan until it ends. One failed poll says nothing about the scan, which runs on the server either way. */
function poll() {
	scanPoll ??= poller({
		every: POLL_MS,
		visibility: pageVisibility(),
		run: async () => {
			const { scan } = await api("GET", "/repos/scan");
			setScan(scan);
			if (scan.state === "running") return true;
			if (scan.state === "done") await loadReport();
			return false;
		},
		onGiveUp: (err) => setScan({ state: "failed", root: "", finishedAt: "", error: `Lost touch with the scan: ${err instanceof Error ? err.message : String(err)}` }),
	});
	scanPoll.start();
}

/** Every finding of the report as one list, each carrying its repository's name. Built once per report. */
export function findingRows() {
	rows ??= (store.report?.repos ?? []).flatMap((repo) => repo.findings.map((finding) => ({ ...finding, repo: repo.name })));
	return rows;
}

/** Reads what the last check of this computer found, and follows a check that is running. */
export async function loadHost() {
	const data = await api("GET", "/host");
	store.host = { status: data.status, report: data.report ?? null, service: data.service === true, change: data.change ?? null, loaded: true };
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

/** Follows the host check until it ends; a dropped request is asked again, not taken for the end (UI-B10). */
function pollHost() {
	hostPoll ??= poller({
		every: POLL_MS,
		visibility: pageVisibility(),
		run: async () => {
			const data = await api("GET", "/host");
			store.host = { status: data.status, report: data.report ?? null, service: data.service === true, change: data.change ?? null, loaded: true };
			emit("host");
			return data.status.state === "running";
		},
		onGiveUp: (err) => {
			store.host.status = { state: "failed", finishedAt: "", error: `Lost touch with the check: ${err instanceof Error ? err.message : String(err)}` };
			emit("host");
		},
	});
	hostPoll.start();
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
		change: data.change ?? null,
		changedSince: new Set(Array.isArray(data.changedSince) ? data.changedSince : []),
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
		// Already running, started from another tab: follow it instead. This page may not know yet that it
		// runs, so it asks before saying anything (UI-B12).
		if (!(err instanceof ApiError && err.status === 409)) throw err;
		setCloudflare(await api("GET", "/cloudflare"));
		if (store.cloudflare.status.state !== "running") throw err;
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
	if (update.changes) {
		store.cloudflare.changes = update.changes;
		// A change Cloudflare accepted after the audit marks its check, as the server does (F-Q2).
		const checkedAt = store.cloudflare.report?.checkedAt ?? "";
		for (const change of update.changes) if (change.ok && change.at > checkedAt) store.cloudflare.changedSince.add(`${change.zoneId}\n${change.change}`);
	}
	emit("cloudflare");
}

/** Follows the audit, or a set of changes being sent, until it ends. One failed poll says nothing about the audit (F-F1). */
function pollCloudflare() {
	cloudflarePoll ??= poller({
		every: POLL_MS,
		visibility: pageVisibility(),
		run: async () => {
			setCloudflare(await api("GET", "/cloudflare"));
			return store.cloudflare.status.state === "running" || store.cloudflare.batch.state === "running";
		},
		onGiveUp: (err) => {
			store.cloudflare.status = { state: "failed", finishedAt: "", error: `Lost touch with the audit: ${err instanceof Error ? err.message : String(err)}` };
			emit("cloudflare");
		},
	});
	cloudflarePoll.start();
}
