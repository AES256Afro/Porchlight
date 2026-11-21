// What every page reads to draw itself and keep up: the server's state, what needs the owner, what
// is busy, the connections, Activity, the owner's place and preferences, and the domains the monitor
// watches (answered through it, the admin token added there and never sent to the page: invariant 7).
import { join } from "node:path";
import { isHosted, listModels } from "../../assist/ollama.ts";
import type { GithubConfig } from "../../github/github.ts";
import { monitorProblem } from "../../monitor/settings.ts";
import type { Run } from "../../investigate/engine.ts";
import { domainSuggestions, type MonitorReport } from "../../roadmap/domains.ts";
import { isAnswerPlace, isLook } from "../../../ui/looks.js";
import type { ServerContext } from "../context.ts";
import type { Call, Gate } from "../gate.ts";
import { bodyObject, HttpError, sendJson } from "../http.ts";
import { readUiSettings, readView, saveUiSettings, saveView } from "../kept-files.ts";
import { under, type Route } from "../router.ts";
import type { ActivityLine, ScheduleState } from "../types.ts";

/** What the state needs from the areas that keep their own: each read as it is at the time of the request. */
export interface StateSources {
	porchlightVersion(): Promise<string>;
	activity(after: number): { lines: ActivityLine[]; last: number };
	defaultDepth: number;
	scheduleState(): Promise<ScheduleState | null>;
	github: GithubConfig;
	projectsState(gate: Gate): Promise<unknown>;
	monitorState(): unknown;
	proxyToMonitor(method: string, pathname: string, body: unknown): Promise<[number, unknown]>;
	cloudflareTokenState(): Promise<{ configured: boolean; verified?: { status: string; checkedAt: string; expiresOn?: string } }>;
	investigation(): { run: Run } | null;
	/** What would be lost by quitting now, in words. */
	busyWork(): string[];
}

/** Adds the repair for each open finding to a monitor answer that carries a scan report. */
function withSuggestions(answer: unknown): unknown {
	const report = (answer as { report?: MonitorReport | null } | null)?.report;
	if (!report || !Array.isArray(report.findings)) return answer;
	return { ...(answer as object), suggestions: domainSuggestions(report) };
}

export function stateRoutes(ctx: ServerContext, sources: StateSources) {
	const { options, loopbackOnly, dataDir } = ctx;
	/** The interface's own preferences (the chosen look), kept in the data folder. */
	const settingsPath = join(dataDir, "ui-settings.json");
	// Where the owner was, so the app opens there again however it was closed.
	const viewPath = join(dataDir, "ui-view.json");

	/** What the page needs to draw itself: where things are, what is set up, never a secret. */
	async function stateRoute({ res, gate }: Call): Promise<void> {
		return sendJson(res, 200, {
			defaultRoot: options.defaultRoot,
			reportPath: options.reportPath,
			// What the scan form starts from, and how often a service scans by itself (0: only when asked).
			scanDepth: sources.defaultDepth,
			scanEveryHours: options.scanEveryHours ?? 0,
			scan: ctx.scanStatus(),
			...(await readUiSettings(settingsPath)),
			// A service (a container, under BoxPilot) is configured where it is managed, not from a shell,
			// so the page explains connecting the monitor in those terms.
			service: !loopbackOnly,
			// Opened from another device over the tailnet, rather than on this computer.
			remote: gate.tailnet,
			// The computer Porchlight runs on, so the page can call it "This Mac".
			platform: process.platform,
			monitor: sources.monitorState(),
			// Whether a token is set, never the token.
			github: { token: sources.github.token !== undefined, ...(options.githubError ? { error: options.githubError } : {}) },
			assistant: ctx.assistantSummary(),
			lastView: await readView(viewPath),
			// The projects, and the one exports, discussions and the log go to.
			projects: await sources.projectsState(gate),
			// Whether Cloudflare is connected and how, never the token.
			cloudflare: await sources.cloudflareTokenState(),
			// What "Send to a model" offers. Never a key: only where each one runs and which model.
			sendTargets: ctx.targets().map((target) => ({ id: target.id, label: target.label, model: target.config.model, host: target.config.url.host, hosted: target.hosted, current: target.current })),
			// Which Porchlight this is (R6Q-4), and what the schedule did and will do (QL-5).
			version: await sources.porchlightVersion(),
			schedule: await sources.scheduleState(),
		});
	}

	/**
	 * What needs the owner from any page (E-Q1): an investigation step waiting for approval. The page
	 * asks this every few seconds and marks the Investigate section and the tab's title.
	 */
	function attentionRoute({ res }: Call): void {
		const investigation = sources.investigation();
		const waiting = investigation?.run.steps.filter((step) => step.outcome === "waiting").length ?? 0;
		return sendJson(res, 200, { approval: investigation && waiting > 0 ? { domain: investigation.run.domain, waiting } : null });
	}

	/**
	 * "Check connections" (US-8): asks the monitor and the model whether they answer now, as doctor does,
	 * so "connected" means working rather than configured. The monitor's token goes only to its own address.
	 */
	async function connectionsRoute({ res }: Call): Promise<void> {
		const at = new Date().toISOString();
		const monitor = ctx.monitor();
		const monitorCheck = monitor
			? await monitorProblem(monitor, options.fetchFn ?? fetch).then(
					(problem) => (problem ? { ok: false, detail: problem } : { ok: true, detail: `${monitor.url.host} answers` }),
					(err) => ({ ok: false, detail: `${monitor.url.host} could not be reached: ${err instanceof Error ? err.message : String(err)}` }),
				)
			: null;
		const config = ctx.model().config;
		let modelCheck: { ok: boolean; detail: string } | null = null;
		// A hosted provider is not asked: asking sends the key and costs a request. Its settings are checked when saved.
		if (config && !isHosted(config)) {
			modelCheck = await listModels(config, { fetchFn: options.fetchFn })
				.then((names) => (names.some((name) => name === config.model || name === `${config.model}:latest`) ? { ok: true, detail: `${config.model} is ready at ${config.url.host}` } : { ok: false, detail: `${config.url.host} answers, but has no model named ${config.model}` }))
				.catch((err) => ({ ok: false, detail: `${config.url.host} could not be reached: ${err instanceof Error ? err.message : String(err)}` }));
		} else if (config) modelCheck = { ok: true, detail: `${config.model} at ${config.url.host} is hosted, so it is not asked until you use it` };
		const cloudflare = await sources.cloudflareTokenState();
		return sendJson(res, 200, {
			at,
			monitor: monitorCheck,
			model: modelCheck,
			cloudflare: cloudflare.configured ? { ok: cloudflare.verified?.status === "active", detail: cloudflare.verified ? `The token was ${cloudflare.verified.status} at the last audit, ${cloudflare.verified.checkedAt.slice(0, 10)}${cloudflare.verified.expiresOn ? `; it ends ${cloudflare.verified.expiresOn.slice(0, 10)}` : ""}` : "Saved, not checked yet: run an audit" } : null,
		});
	}

	function activityRoute({ res, url }: Call): void {
		const after = Number(url.searchParams.get("after") ?? 0);
		return sendJson(res, 200, sources.activity(Number.isInteger(after) && after >= 0 ? after : 0));
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

	return {
		stateRoutes: [["GET /api/state", stateRoute]] as Route[],
		pageRoutes: [
			["GET /api/activity", activityRoute],
		] as Route[],
		watchRoutes: [
			["GET /api/busy", ({ res }) => sendJson(res, 200, { busy: sources.busyWork() })],
			["GET /api/attention", attentionRoute],
			["GET /api/connections", connectionsRoute],
			["POST /api/view", viewRoute],
			["POST /api/settings", settingsRoute],
		] as Route[],
		domainRoutes: [
			[
				under("/api/domains"),
				async ({ req, res, url, body }) => {
					const [code, answer] = await sources.proxyToMonitor(req.method ?? "GET", url.pathname, body);
					return sendJson(res, code, withSuggestions(answer));
				},
			],
		] as Route[],
	};
}
