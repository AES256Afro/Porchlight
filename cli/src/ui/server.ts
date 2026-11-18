import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { judge, readAnalysis, saveAnalysis, unitKey, unitsOf, VERDICTS, type AnalysisFile } from "../analysis/analyse.ts";
import { AssistantError, chat, isHosted, type AssistantConfig } from "../assist/ollama.ts";
import { askPrompt, domainPrompt, findingPrompt, locateFinding, roadmapPrompt, type Prompt } from "../assist/prompts.ts";
import { MAX_QUESTION } from "../../ui/generated.js";
import { fetchedRepos, fetchRepo, GithubError, listRepos, parseRepoName, removeFetched, validOwner, type GithubConfig } from "../github/github.ts";
import { callMonitor, type MonitorConfig } from "../monitor/client.ts";
import { discoverRepos } from "../repos/discover.ts";
import type { Runner } from "../repos/exec.ts";
import { coverageNotes, nameUnder, rank, rankRepos, repoName, settingNotes } from "../repos/report.ts";
import { scanRepos } from "../repos/scan.ts";
import { SEVERITIES, type ScanReport, type Severity } from "../repos/types.ts";
import { domainSuggestions, type MonitorReport } from "../roadmap/domains.ts";
import { exportDomain, exportRepos, ExportError, parseFilter, type ExportFile } from "../roadmap/export.ts";
import { buildRepoRoadmap, suggestionsFor } from "../roadmap/repos.ts";

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
	/** The local model (Ollama) behind Explain, Summarise and Ask. Null or absent turns them off. */
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
	/** A fixed key (SECURITYX_UI_KEY). Without one, each start makes its own. */
	sessionKey?: string;
	scan?: typeof scanRepos;
	/** Used for the monitor and the local model alike. Tests pass a fake. */
	fetchFn?: typeof fetch;
}

export interface UiServer {
	port: number;
	sessionKey: string;
	/** Address to open, carrying the session key in the fragment so it is never sent to a server or logged. */
	url: string;
	close(): Promise<void>;
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
const SCRIPTS = ["app", "api", "dom", "filter", "list", "hints", "generated", "store", "export", "assist", "analysis", "github", "overview", "findings", "roadmap", "repos", "domains"];
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

const SESSION_HEADER = "x-securityx-session";
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
		throw new Error(`Listening on ${listenHost} needs SECURITYX_UI_KEY: a key of at least ${MIN_KEY_LENGTH} characters`);
	}
	const sessionKey = options.sessionKey ?? randomBytes(24).toString("base64url");
	const scan = options.scan ?? scanRepos;
	const github: GithubConfig = options.github ?? { dir: join(dirname(options.reportPath), "github") };
	let status: ScanStatus = { state: "idle" };
	let fetching: FetchStatus = { state: "idle" };
	const analysisPath = join(dirname(options.reportPath), "repo-analysis.json");
	let analysing: AnalysisStatus = { state: "idle" };
	let stopAnalysis: AbortController | null = null;
	let port = options.port;
	/** Ollama on a small server answers one request at a time, so this asks it one at a time. */
	let modelBusy = false;

	const server = createServer((req, res) => {
		handle(req, res).catch((err) => {
			// An export that cannot be made is the caller's mistake, and the message says what to change.
			const known = err instanceof HttpError || err instanceof ExportError;
			if (!known) console.error(`securityx ui: ${err instanceof Error ? err.message : String(err)}`);
			sendJson(res, err instanceof HttpError ? err.status : known ? 400 : 500, { error: known ? err.message : "Internal error" });
		});
	});

	async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const host = req.headers.host ?? "";
		if (!hostAllowed(host, port, loopbackOnly)) throw new HttpError(403, "Forbidden host");
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

		if (!originAllowed(req.headers.origin, host, loopbackOnly)) throw new HttpError(403, "Cross-site request refused");
		// Says whether this is a service, so the page can tell the reader where their key is kept.
		if (!sessionMatches(req.headers[SESSION_HEADER], sessionKey)) return sendJson(res, 401, { error: "Session key required", service: !loopbackOnly });

		const body = req.method === "POST" ? await readJsonBody(req) : undefined;
		const route = `${req.method} ${url.pathname}`;

		if (route === "GET /api/state") {
			return sendJson(res, 200, {
				defaultRoot: options.defaultRoot,
				reportPath: options.reportPath,
				scan: status,
				// A service (a container, under BoxPilot) is configured where it is managed, not from a shell,
				// so the page explains connecting the monitor in those terms.
				service: !loopbackOnly,
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
				assistant: options.assistant
					? { configured: true, model: options.assistant.model, host: options.assistant.url.host, hosted: isHosted(options.assistant) }
					: {
							configured: false,
							error: options.assistantError ?? "The local model is not configured",
							// No model address: the features are off, the usual state rather than a value to correct.
							unset: options.assistantUnset ?? false,
						},
			});
		}
		if (url.pathname.startsWith("/api/assist/")) return assist(req, res, url.pathname.slice("/api/assist/".length), body);
		if (route === "GET /api/repos/report") return sendJson(res, 200, await loadReport(options.reportPath, analysisPath));
		if (url.pathname === "/api/analysis" || url.pathname === "/api/analysis/stop") return analysisRoute(res, route, body);
		if (route === "GET /api/repos/roadmap" || route === "GET /api/repos/export") {
			const report = await readReport(options.reportPath);
			if (!report) throw new HttpError(404, "There is no scan yet. Scan a folder first.");
			const query = url.searchParams;
			const filter = parseFilter({ severity: query.get("severity"), kind: query.get("kind"), match: query.get("q"), repo: query.get("repo") });
			if (route === "GET /api/repos/roadmap") return sendJson(res, 200, { roadmap: buildRepoRoadmap(report, filter) });
			return sendDownload(res, exportRepos(report, exportChoice(query), filter));
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

		const assistant = options.assistant;
		if (!assistant) throw new HttpError(503, options.assistantError ?? "No model is connected");
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
		const assistant = options.assistant;
		if (!assistant) throw new HttpError(503, options.assistantError ?? "The local model is not configured");
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

	return {
		port,
		sessionKey,
		url: `http://127.0.0.1:${port}/#k=${sessionKey}`,
		close: () =>
			new Promise((resolveClose) => {
				server.close(() => resolveClose());
				server.closeAllConnections();
			}),
	};
}

/** Refuses a fixed key that is too short to guard a page, or that cannot travel in a header. */
export function checkKey(key: string): void {
	if (key.length < MIN_KEY_LENGTH || !KEY_PATTERN.test(key)) {
		throw new Error(`SECURITYX_UI_KEY must be at least ${MIN_KEY_LENGTH} characters, with no spaces or control characters`);
	}
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
	if (typeof presented !== "string") return false;
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
function sendDownload(res: ServerResponse, file: ExportFile): void {
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
		throw new HttpError(500, `The report file is not a SecurityX scan report: ${path}`);
	}
	return report;
}

/** Reports say where secrets were found, so a new one is readable only by its owner. */
async function saveReport(path: string, report: ScanReport): Promise<void> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	await writeFile(temporary, `${JSON.stringify(report, null, "\t")}\n`, { mode: 0o600 });
	await chmod(temporary, 0o600);
	await rename(temporary, path);
}
