// Scanning repositories from the page and on a schedule: what a scan would cover, starting one,
// stopping it, "Scan this repository again", and the schedule with its notice. /api/repos/scan,
// /api/repos/scan/cancel, /api/repos/rescan and /api/repos/preview.
import { join } from "node:path";
import { fetchedRepos, type GithubConfig } from "../../github/github.ts";
import { noticeRequest, type Notice } from "../../notify/format.ts";
import { failedScanNotice, scanNotice } from "../../notify/scan.ts";
import type { Project } from "../../projects/projects.ts";
import { CancelledError, run as runCommand } from "../../repos/exec.ts";
import { carryNotes, mergeRescan, type RescanChange } from "../../repos/history.ts";
import { nameUnder, repoName } from "../../repos/report.ts";
import { rescanRepo, scanRepos } from "../../repos/scan.ts";
import type { RepoResult, ScanChoices, ScanReport } from "../../repos/types.ts";
import { describeChoices, standardChoices } from "../../../ui/scan-choices.js";
import { plainError } from "../../../ui/plain-error.js";
import { rescanWords } from "../../../ui/tracking.js";
import type { ServerContext } from "../context.ts";
import type { Call } from "../gate.ts";
import { bodyObject, HttpError, sendJson, textField } from "../http.ts";
import { saveReport } from "../kept-files.ts";
import { readReport } from "../report-cache.ts";
import type { Route } from "../router.ts";
import { previewScan, scanCounts, scanRequest } from "../scans.ts";
import type { ScanStatus, ScheduleState } from "../types.ts";

/** Folder levels a scan looks through unless the page or PORCHLIGHT_SCAN_DEPTH says otherwise. */
export const DEFAULT_DEPTH = 3;
/** The most repositories one "Scan these again" scans (US-9). */
const MAX_RESCAN = 200;

/** What a scan sets off when it finishes: the model's analysis after a Deep scan, and the weekly digest after a scheduled one. */
export interface AfterScan {
	analyseAfterScan(sendsToHosted: boolean, project: Project | null, shown?: { model: string; host: string }): void;
	afterScheduledScan(project: Project | null): Promise<void>;
}

export function createScanning(ctx: ServerContext, github: GithubConfig, after: AfterScan) {
	const { options, dataDir, history, notesPath, projects, log } = ctx;
	const scan = options.scan ?? scanRepos;
	const rescan = options.rescan ?? rescanRepo;
	const defaultDepth = options.scanDepth ?? DEFAULT_DEPTH;
	const osvDatabase = options.osvOffline ? join(dataDir, "osv-db") : undefined;
	/** Readings of unchanged histories, reused by a scan and by "Scan this repository again" alike (OP-1). */
	const historyReuse = { dir: join(dataDir, "history-scans") };
	let status: ScanStatus = { state: "idle" };
	/** Stops the scan that is running, when there is one. */
	let scanCancel: AbortController | null = null;
	/**
	 * What the schedule did last and will do next (QL-5), in memory: after a restart the last scan's time
	 * stands in for the last run. The notice's address is never part of it, only its host.
	 */
	const scheduleRecord: { lastRun?: { at: string; ok: boolean; summary: string }; notice?: { at: string; delivered: boolean; detail: string } } = {};

	/** Refuses a scan while something else is reading or writing the same repositories or report. */
	function scanMayStart(): void {
		if (status.state === "running") throw new HttpError(409, "A scan is already running");
		// A repository half fetched is not one to scan.
		if (ctx.fetchStatus().state === "running") throw new HttpError(409, "Repositories are still being fetched from GitHub. Scan when that has finished.");
		if (ctx.analysisStatus().state === "running") throw new HttpError(409, "The model is still analysing the last scan. Stop that first, or wait for it to finish.");
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
			// An unchanged repository's history is not read again (OP-1).
			historyReuse,
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
					await after.afterScheduledScan(project);
				}
				if (choices.analyse) after.analyseAfterScan(how.sendsToHosted === true, project, how.shown);
			})
			.catch((err) => {
				// A cancelled scan saved nothing: the last report stands, and the page goes back to it.
				if (err instanceof CancelledError || cancel.signal.aborted) {
					status = { state: "idle" };
					log("Scan stopped before it finished. The last scan is unchanged", project);
					return;
				}
				const error = plainError(err instanceof Error ? err.message : String(err));
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
	async function tell(notice: Notice, project: Project | null): Promise<void> {
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
			report = await ctx.storedReport();
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
				const now = await rescan(before.path, { signal: cancel.signal, choices, scanned: report.repos.map((other) => other.path), historyReuse, ...(osvDatabase ? { osvDatabase } : {}) });
				if (cancel.signal.aborted) throw new CancelledError();
				// Scanners that did not look this time keep what they found before (invariant 5); fixed and new are counted by findingKey.
				const { merged, change } = mergeRescan(name, before, now, choices);
				// Read again: the report may have been replaced while this ran.
				const current = await ctx.storedReport();
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
				const error = plainError(err instanceof Error ? err.message : String(err));
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

	async function preview({ res, url }: Call): Promise<void> {
		return sendJson(res, 200, {
			preview: { ...(await previewScan(url.searchParams.get("root") ?? options.defaultRoot, url.searchParams.get("depth"), github.dir, url.searchParams.get("home") === "1")), tools: await toolReadiness() },
		});
	}

	async function start({ res, body }: Call): Promise<void> {
		const { root, depth, choices, sendsToHosted, shown } = await scanRequest(body, defaultDepth);
		return sendJson(res, 202, { scan: await beginScan(root, depth, { choices, sendsToHosted, ...(shown ? { shown } : {}) }) });
	}

	function cancelRoute({ res }: Call): void {
		if (status.state !== "running" || !scanCancel) throw new HttpError(409, "No scan is running");
		// The scanners are stopped; the scan's own ending (above, in beginScan) puts the status back.
		scanCancel.abort();
		return sendJson(res, 200, { scan: status });
	}

	/** One repository by name, or several at once (US-9, "Scan these again"); names only, never a path. */
	async function rescanRoute({ res, body }: Call): Promise<void> {
		const fields = bodyObject(body);
		if (fields.repos === undefined) return sendJson(res, 202, { scan: await beginRescan([textField(fields, "repo", 1000)]) });
		if (!Array.isArray(fields.repos) || fields.repos.length === 0 || fields.repos.length > MAX_RESCAN) throw new HttpError(400, `Name from 1 to ${MAX_RESCAN} repositories`);
		const names = [...new Set(fields.repos.map((name) => textField({ name }, "name", 1000)))];
		return sendJson(res, 202, { scan: await beginRescan(names) });
	}

	return {
		status: () => status,
		defaultDepth,
		scheduleState,
		/** Stops the scan that is running and the schedule, when the server closes. */
		close: () => {
			scanCancel?.abort();
			clearInterval(schedule);
		},
		/** The page's reads, at the place they had in the table. */
		readRoutes: [
			["GET /api/repos/scan", ({ res }) => sendJson(res, 200, { scan: status })],
			["GET /api/repos/preview", preview],
		] as Route[],
		startRoutes: [
			["POST /api/repos/scan", start],
			["POST /api/repos/scan/cancel", cancelRoute],
			["POST /api/repos/rescan", rescanRoute],
		] as Route[],
	};
}
