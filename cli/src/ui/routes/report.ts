// The latest scan as the page reads it and as it leaves Porchlight: the report itself (OP-5), the kept
// scans (invariant 17), the roadmap, exports of it or of the findings (invariant 11), the mural an
// export can carry (invariant 16), the SBOM, and a domain's roadmap or findings from the monitor.
import { readAnalysis } from "../../analysis/analyse.ts";
import { AssistantError, chat } from "../../assist/ollama.ts";
import { judgedHighlights, muralFacts, MuralError, parseMural, type Mural } from "../../assist/mural.ts";
import { DATA_CAP, muralPrompt } from "../../assist/prompts.ts";
import { sizedFor } from "../../assist/context.ts";
import { FILE_TITLES, type FileTitle } from "../../projects/projects.ts";
import type { HistoryEntry } from "../../repos/history.ts";
import { notesForPage } from "../../repos/history.ts";
import { repoName, reportStamp } from "../../repos/report.ts";
import { buildSbom } from "../../repos/sbom.ts";
import type { ScanReport } from "../../repos/types.ts";
import type { MonitorReport } from "../../roadmap/domains.ts";
import { jsonText } from "../../roadmap/escape.ts";
import { exportDomain, exportRepos, parseFilter } from "../../roadmap/export.ts";
import { buildRepoRoadmap, listRepoFindings } from "../../roadmap/repos.ts";
import { isFiltering } from "../../../ui/filter.js";
import type { ServerContext } from "../context.ts";
import type { Call } from "../gate.ts";
import { bodyObject, fileStamp, HttpError, SECURITY_HEADERS, sendBytes, sendDownload, sendJson, type Sendable } from "../http.ts";
import { readMural, saveMural, type MuralJob } from "../kept-files.ts";
import { readReport, reportResponseBody } from "../report-cache.ts";
import { paths, type Route } from "../router.ts";
import { join } from "node:path";

/** A mural reads at most this many findings the model judged real, most severe first. */
const MURAL_HIGHLIGHTS = 40;
/** Tries at a mural whose answer is not the JSON asked for, before saying so. */
const MURAL_ATTEMPTS = 2;
/** Room for about 20 short points as JSON. */
const MURAL_TOKENS = 1_500;
/** A 9B model on a processor reads the prompt and writes the mural in a few minutes. */
const MURAL_TIMEOUT_MS = 900_000;
const DOMAIN_EXPORT = /^\/api\/domains\/([^/]+)\/export$/;

/** A mural belongs to one report's content and one filter: scanning one repository again makes it out of date (B38). */
function muralKey(report: ScanReport, filter: ReturnType<typeof parseFilter>): string {
	return `${reportStamp(report)}\n${JSON.stringify(filter)}`;
}

function exportChoice(query: URLSearchParams): { content?: string; format?: string } {
	return { content: query.get("content") ?? undefined, format: query.get("format") ?? undefined };
}

/** What the report area needs from the monitor's: one call to it, with the admin token added there. */
export interface MonitorCalls {
	proxyToMonitor(method: string, pathname: string, body: unknown): Promise<[number, unknown]>;
}

export async function createReport(ctx: ServerContext, monitor: MonitorCalls) {
	const { options, reportDir, history, notesPath, analysisPath, log, saveExport, modelFor, confirmModel } = ctx;
	/** The report's response as last built, and what identified its three files then (OP-5). */
	let reportResponse: (Sendable & { stamp: string }) | null = null;
	// The mural for an export, written in the background: a model on a processor takes minutes.
	const muralPath = join(reportDir, "repo-mural.json");
	let muralJob: MuralJob = (await readMural(muralPath)) ?? { state: "idle" };
	/** Stops the mural being written, when one is (AI-B8). */
	let stopMural: AbortController | null = null;

	/**
	 * Built once for each version of the report, the judgements and the notes, and sent gzipped where the
	 * browser takes it (OP-5). Each file is looked at before it is read, so a change after the look only
	 * makes the next request build it again, never keeps an older answer under a newer file.
	 */
	async function reportRoute({ req, res }: Call): Promise<void> {
		const stamp = (await Promise.all([options.reportPath, analysisPath, notesPath].map(fileStamp))).join("|");
		if (reportResponse?.stamp !== stamp) {
			// Notes that cannot be read are said beside the report, never a reason the report cannot be shown.
			reportResponse = { stamp, body: await reportResponseBody(options.reportPath, analysisPath, await notesForPage(notesPath)) };
		}
		return sendBytes(req, res, 200, { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", vary: "accept-encoding" }, reportResponse);
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

	/** The latest scan and the page's filters, read from the request's query: what every view of the roadmap starts from. */
	async function filtered(url: URL) {
		const report = await readReport(options.reportPath);
		if (!report) throw new HttpError(404, "There is no scan yet. Scan a folder first.");
		const query = url.searchParams;
		const filter = parseFilter({ severity: query.get("severity"), kind: query.get("kind"), match: query.get("q"), repo: query.get("repo"), new: query.get("new") }, await ctx.newKeysOf(report));
		return { report, filter, key: muralKey(report, filter) };
	}

	async function roadmapRoute({ res, url }: Call): Promise<void> {
		const { report, filter } = await filtered(url);
		return sendJson(res, 200, { roadmap: buildRepoRoadmap(report, filter) });
	}

	/** An export of the roadmap or the findings. POST writes it into the project in use; GET hands it to the browser to save. */
	async function exportRoute({ req, res, url }: Call): Promise<void> {
		const { report, filter, key } = await filtered(url);
		const query = url.searchParams;
		let mural: Mural | undefined;
		if (query.get("mural") === "1") {
			if (muralJob.state !== "done" || muralJob.key !== key) throw new HttpError(409, "Write the mural first: it is made for this scan and these filters");
			mural = muralJob.mural;
		}
		const file = exportRepos(report, exportChoice(query), filter, mural);
		const title: FileTitle = `${exportChoice(query).content === "findings" ? "findings" : "roadmap"}${isFiltering(filter) ? "-partial" : ""}`;
		if (req.method === "POST") return saveExport(res, file, title);
		log(`Exported ${FILE_TITLES[title]} (${file.extension}) as a download`);
		return sendDownload(res, file);
	}

	function describeMural(key: string) {
		return muralJob.state === "done"
			? { state: "done", current: muralJob.key === key, model: muralJob.mural.model, generatedAt: muralJob.mural.generatedAt, headline: muralJob.mural.headline }
			: muralJob.state === "failed"
				? { state: "failed", current: muralJob.key === key, error: muralJob.error }
				: { state: muralJob.state, current: muralJob.state === "running" && muralJob.key === key };
	}

	/** The mural for this scan and these filters: its state. */
	async function muralState({ res, url }: Call): Promise<void> {
		const { key } = await filtered(url);
		return sendJson(res, 200, describeMural(key));
	}

	/** A request to write the mural for this scan and these filters. */
	async function writeMural({ res, url, body }: Call): Promise<void> {
		const { report, filter, key } = await filtered(url);
		const config = modelFor("mural").config;
		if (!config) throw new HttpError(503, "Choose a model in Settings → Model to write a mural");
		confirmModel(bodyObject(body ?? {}), config);
		if (muralJob.state === "running") throw new HttpError(409, "A mural is already being written");
		if (ctx.analysisStatus().state === "running") throw new HttpError(409, "Deeper analysis is running. Write the mural when it has finished, so it can include it");
		if (ctx.modelBusy()) throw new HttpError(409, "The model is still answering another request. Try again when it has finished.");

		// Running, and the model taken, before the first await, so a second request is refused (B24).
		const earlierMural = muralJob;
		muralJob = { state: "running", key, startedAt: new Date().toISOString() };
		ctx.setModelBusy(true);
		let prompt: ReturnType<typeof muralPrompt>;
		let facts: ReturnType<typeof muralFacts>;
		// A local model that reads less than the usual gets a smaller data block and answer (R6F-8).
		const sized = sizedFor(config, { cap: DATA_CAP, maxTokens: MURAL_TOKENS });
		try {
			const roadmap = buildRepoRoadmap(report, filter);
			const analysis = await readAnalysis(analysisPath, report);
			// What was fixed since the previous scan, where this scan could check again: the "done" column's best evidence.
			const change = await history.latestChange(report).catch(() => null);
			facts = muralFacts(report, roadmap, listRepoFindings(report, filter), analysis, change);
			prompt = muralPrompt(facts, roadmap, judgedHighlights(report, analysis).slice(0, MURAL_HIGHLIGHTS), sized.cap);
		} catch (err) {
			muralJob = earlierMural;
			ctx.setModelBusy(false);
			throw err;
		}
		const stop = new AbortController();
		stopMural = stop;
		void (async () => {
			try {
				// A small model now and then answers with something other than the JSON asked for: it gets one more try.
				let written: ReturnType<typeof parseMural> | undefined;
				for (let attempt = 1; !written; attempt++) {
					const text = await chat(config, prompt.messages, { fetchFn: options.fetchFn, timeoutMs: MURAL_TIMEOUT_MS, maxTokens: sized.maxTokens ?? MURAL_TOKENS, ...(sized.contextLength !== null ? { contextLength: sized.contextLength } : {}), signal: stop.signal, json: true });
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
				ctx.setModelBusy(false);
				if (stopMural === stop) stopMural = null;
			}
		})();
		return sendJson(res, 202, describeMural(key));
	}

	/**
	 * A CycloneDX bill of materials of the latest scan's repositories, read offline. The repositories
	 * are the report's own, never a path from the request, and the file's name is a fixed stem and a date.
	 */
	async function sbomRoute({ res }: Call): Promise<void> {
		const report = await ctx.storedReport();
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

	/** A domain's repair roadmap or findings, from the monitor's latest report of it. */
	async function domainExportRoute({ req, res, url }: Call): Promise<void> {
		const domainExport = DOMAIN_EXPORT.exec(url.pathname)!;
		if (req.method !== "GET" && req.method !== "POST") throw new HttpError(405, "Method not allowed");
		const [code, answer] = await monitor.proxyToMonitor("GET", `/api/domains/${domainExport[1]}`, undefined);
		const report = (answer as { report?: MonitorReport | null }).report;
		if (code !== 200) throw new HttpError(code, (answer as { error?: string }).error ?? "The monitor refused the request");
		if (!report) throw new HttpError(404, "This domain has not been scanned yet, so there is nothing to export.");
		const file = exportDomain(report, exportChoice(url.searchParams));
		const title: FileTitle = exportChoice(url.searchParams).content === "findings" ? "domain-findings" : "domain-roadmap";
		if (req.method === "POST") return saveExport(res, file, title);
		log(`Exported ${FILE_TITLES[title]} (${file.extension}) as a download`);
		return sendDownload(res, file);
	}

	return {
		muralRunning: () => muralJob.state === "running",
		/** Where the report's own entries go in the table, in the order they had. */
		historyRoutes: [["GET /api/repos/history", historyRoute]] as Route[],
		reportRoutes: [["GET /api/repos/report", reportRoute]] as Route[],
		muralStopRoutes: [
			[
				"POST /api/repos/mural/stop",
				({ res }) => {
					stopMural?.abort();
					return sendJson(res, 200, { stopped: stopMural !== null });
				},
			],
		] as Route[],
		roadmapRoutes: [
			["GET /api/repos/roadmap", roadmapRoute],
			["GET /api/repos/export", exportRoute],
			["POST /api/repos/export", exportRoute],
			["GET /api/repos/mural", muralState],
			["POST /api/repos/mural", writeMural],
			[
				paths("/api/repos/export"),
				() => {
					throw new HttpError(405, "Method not allowed");
				},
			],
			[
				paths("/api/repos/mural"),
				async ({ url }) => {
					await filtered(url);
					throw new HttpError(404, "Not found");
				},
			],
		] as Route[],
		sbomRoutes: [["GET /api/repos/sbom", sbomRoute]] as Route[],
		domainExportRoutes: [[(call: Call) => DOMAIN_EXPORT.test(call.url.pathname), domainExportRoute]] as Route[],
	};
}
