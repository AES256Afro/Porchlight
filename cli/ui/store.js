// @ts-check
// What every page shares: the server's settings, the latest scan report, and
// the state of a running scan. Pages read from here and are told when it
// changes, so a scan started on one page updates all of them.
import { api, ApiError } from "./api.js";

/** @typedef {import("../src/repos/types.ts").Finding} Finding */
/** @typedef {{ title: string, how: string[], phase: "now" | "next" | "schedule" | "later" }} Suggestion */
/** @typedef {Finding & { suggestion?: Suggestion }} SuggestedFinding */
/** @typedef {Omit<import("../src/repos/types.ts").RepoResult, "findings"> & { name: string, findings: SuggestedFinding[] }} Repo */
/** @typedef {Omit<import("../src/repos/types.ts").ScanReport, "repos"> & { repos: Repo[] }} ScanReport */
/** @typedef {import("../src/ui/server.ts").ScanStatus} ScanStatus */
/** @typedef {SuggestedFinding & { repo: string }} FindingRow */
/** @typedef {"report" | "scan"} Change */

const POLL_MS = 800;

export const store = {
	/**
	 * `service`: SecurityX runs as a service (a container, under BoxPilot), configured where it is
	 * managed rather than from a terminal. `monitor.unset`: neither monitor setting was given.
	 *
	 * @type {{ defaultRoot: string, reportPath: string, service: boolean, monitor: { configured: boolean, host?: string, error?: string, unset?: boolean } } | null}
	 */
	settings: null,
	/** @type {ScanReport | null} */
	report: null,
	/** What the scan could not check. */
	/** @type {string[]} */
	notes: [],
	/** @type {ScanStatus} */
	scan: { state: "idle" },
};

/** @type {Set<(change: Change) => void>} */
const listeners = new Set();
/** @type {Promise<void> | null} */
let loading = null;
/** @type {FindingRow[] | null} */
let rows = null;
/** @type {ReturnType<typeof setTimeout> | undefined} */
let pollTimer;

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
		store.settings = { defaultRoot: state.defaultRoot, reportPath: state.reportPath, service: state.service === true, monitor: state.monitor };
		store.scan = state.scan;
		await loadReport();
		if (store.scan.state === "running") poll();
	})().catch((err) => {
		loading = null; // A failed load is retried by the next page that asks.
		throw err;
	});
	return loading;
}

/** Forgets everything, so the next `load` starts again. Used after the session key changes. */
export function reset() {
	clearTimeout(pollTimer);
	loading = null;
	rows = null;
	store.settings = null;
	store.report = null;
	store.notes = [];
}

export async function loadReport() {
	const data = await api("GET", "/repos/report");
	store.report = /** @type {ScanReport | null} */ (data.report);
	store.notes = data.notes;
	rows = null;
	emit("report");
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
