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
/** @typedef {"report" | "scan" | "settings" | "notes" | "host" | "projects"} Change */
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
	 * @type {{ defaultRoot: string, reportPath: string, service: boolean, monitor: { configured: boolean, host?: string, error?: string, unset?: boolean }, github: { token: boolean, error?: string }, assistant: import("./generated.js").AssistantSettings, appearance: string, answers: string, remote: boolean, platform: string, sendTargets: import("./send-text.js").SendTarget[], lastView: string | null } | null}
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
