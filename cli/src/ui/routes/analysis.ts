// The model's deeper analysis of the latest scan (invariant 16): judges findings from the stored
// report, worst first, one at a time, saving each judgement as it arrives so a stop or a restart loses
// nothing. What it reads is built from this server's own copy of the report and the repository's files.
// /api/analysis, /api/analysis/stop and /api/analysis/judgements.
import { judge, readAnalysis, saveAnalysis, unitKey, unitsOf, VERDICTS } from "../../analysis/analyse.ts";
import { sizedFor } from "../../assist/context.ts";
import { isHosted } from "../../assist/ollama.ts";
import type { Project } from "../../projects/projects.ts";
import { repoName } from "../../repos/report.ts";
import { SEVERITIES, type ScanReport, type Severity } from "../../repos/types.ts";
import { plainError } from "../../../ui/plain-error.js";
import { findingKey } from "../../../ui/tracking.js";
import type { ServerContext } from "../context.ts";
import type { Call } from "../gate.ts";
import { bodyObject, HttpError, sendJson } from "../http.ts";
import { readReport } from "../report-cache.ts";
import { paths, type Route } from "../router.ts";
import type { AnalysisStatus } from "../types.ts";

/** Findings one analysis run may judge, and how many it judges unless told otherwise. */
const MAX_ANALYSE = 500;
const DEFAULT_ANALYSE = 25;

export function createAnalysis(ctx: ServerContext) {
	const { options, analysisPath, projects, log, modelFor, modelWords, confirmModel } = ctx;
	let analysing: AnalysisStatus = { state: "idle" };
	/** Why a Deep scan's analysis did not start, the last time one did not (R6U-11). */
	let analysisNotStarted: { at: string; why: string } | null = null;
	let stopAnalysis: AbortController | null = null;

	/**
	 * The judgements made at or after `since`, each under the key of every finding it judges, so the
	 * page can put them beside their findings without fetching the report and history again (OP-6).
	 * `scannedAt` names the report they belong to; a page holding another one fetches the report instead.
	 */
	async function judgements({ res, url }: Call): Promise<void> {
		const since = url.searchParams.get("since");
		const report = await readReport(options.reportPath);
		if (!report) return sendJson(res, 200, { scannedAt: null, judgements: [] });
		const stored = await readAnalysis(analysisPath, report);
		const found: { key: string; analysis: unknown }[] = [];
		for (const repo of report.repos) {
			const name = repoName(report, repo);
			for (const finding of repo.findings) {
				const judged = stored.items[unitKey(name, finding)];
				if (judged && (!since || judged.at >= since)) found.push({ key: findingKey(name, finding), analysis: judged });
			}
		}
		return sendJson(res, 200, { scannedAt: report.scannedAt, judgements: found });
	}

	async function summary({ res }: Call): Promise<void> {
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

	async function start({ res, body }: Call): Promise<void> {
		if (ctx.scanStatus().state === "running") throw new HttpError(409, "A scan is running. Analyse when it has finished.");
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

	function stop({ res }: Call): void {
		stopAnalysis?.abort();
		return sendJson(res, 200, { status: analysing });
	}

	/**
	 * A Deep scan's last step: the model's deeper analysis of the critical and high findings, as the
	 * analysis card would start it. A hosted model is used only when the scan request said yes to
	 * sending to it, which the page asks for beside the Deep choice. Whatever stops it is said in
	 * the log; the scan itself has finished either way.
	 */
	function analyseAfterScan(sendsToHosted: boolean, project: Project | null, shown?: { model: string; host: string }): void {
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
	async function startAnalysis(limit: number, severities: Severity[]): Promise<AnalysisStatus> {
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
			report = await ctx.storedReport();
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
				while (ctx.modelBusy() && !stop.signal.aborted) await new Promise((resolveWait) => setTimeout(resolveWait, 500));
				if (stop.signal.aborted) break;
				ctx.setModelBusy(true);
				try {
					// A local model that reads less than the usual is asked for a shorter answer (R6F-8).
					const sized = sizedFor(assistant, { cap: 0 });
					stored.items[unit.key] = await judge(report, unit, assistant, { fetchFn: options.fetchFn, signal: stop.signal, ...(sized.contextLength !== null ? { contextLength: sized.contextLength, maxTokens: sized.maxTokens } : {}) });
					await saveAnalysis(analysisPath, stored);
					inARow = 0;
				} catch (err) {
					if (stop.signal.aborted) break;
					failed++;
					inARow++;
					lastError = plainError(err instanceof Error ? err.message : String(err));
					// A model that cannot be reached, or a key it refuses, fails every item the same way:
					// three failures in a row end the run rather than spend the rest of it (B36).
					if (inARow >= 3) {
						done++;
						gaveUp = true;
						break;
					}
				} finally {
					ctx.setModelBusy(false);
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

	const routes: Route[] = [
		["GET /api/analysis/judgements", judgements],
		["POST /api/analysis/stop", stop],
		["GET /api/analysis", summary],
		["POST /api/analysis", start],
		[
			paths("/api/analysis", "/api/analysis/stop"),
			() => {
				throw new HttpError(404, "Not found");
			},
		],
	];

	return { status: () => analysing, analyseAfterScan, routes };
}
