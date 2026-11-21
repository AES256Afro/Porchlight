// The monitor that watches the owner's domains: connecting it (/api/monitor), and every call made to it.
// The admin token is added here and never sent to the page (invariant 7).
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { asciiDomain } from "../../investigate/scope.ts";
import { callMonitor, type MonitorConfig } from "../../monitor/client.ts";
import { forgetMonitor, monitorProblem, MonitorSettingsError, parseMonitorSettings, readSavedMonitor, saveMonitor } from "../../monitor/settings.ts";
import type { MonitorReport } from "../../roadmap/domains.ts";
import type { ServerContext } from "../context.ts";
import { onComputerPage, type Gate } from "../gate.ts";
import { bodyObject, DOMAIN_PATTERN, HttpError, safeDecode, sendJson } from "../http.ts";

export async function createMonitor(ctx: ServerContext) {
	const { options, dataDir, log } = ctx;
	// The monitor that watches the owner's websites. A connection saved under Settings → Monitor comes
	// before the one given at start-up, as a saved model or Cloudflare token does. The admin token is
	// added to each call here and never sent to the page.
	const monitorSettingsPath = join(dataDir, "monitor-settings.json");
	let savedMonitor = await readSavedMonitor(monitorSettingsPath);
	let monitor: MonitorConfig | null = savedMonitor?.config ?? options.monitor;

	function monitorState() {
		if (!monitor) {
			return {
				configured: false,
				error: options.monitorError ?? "The monitor is not configured",
				// Neither setting given: the usual state of a fresh install, as opposed to a value to correct.
				unset: options.monitorUnset ?? false,
			};
		}
		return { configured: true, host: monitor.url.host, ...(savedMonitor ? { source: "settings", savedAt: savedMonitor.savedAt } : {}) };
	}

	async function monitorRoute(res: ServerResponse, route: string, body: unknown, gate: Gate): Promise<void> {
		// A service is given its monitor where it is managed; another device only looks.
		if (!onComputerPage(gate)) throw new HttpError(403, "The monitor is connected from the page on the computer that runs Porchlight");
		if (route === "POST /api/monitor") {
			const fields = bodyObject(body);
			let config: MonitorConfig;
			try {
				config = parseMonitorSettings(fields.address, fields.token);
			} catch (err) {
				if (err instanceof MonitorSettingsError) throw new HttpError(400, err.message);
				throw err;
			}
			// Asked before it is saved, so a mistake never replaces a working connection.
			const problem = await monitorProblem(config, options.fetchFn ?? fetch);
			if (problem) throw new HttpError(400, problem);
			savedMonitor = await saveMonitor(monitorSettingsPath, config);
			monitor = config;
			log(`Monitor connected: ${config.url.host}`);
			return sendJson(res, 200, { monitor: monitorState() });
		}
		if (route === "POST /api/monitor/remove") {
			await forgetMonitor(monitorSettingsPath);
			savedMonitor = null;
			monitor = options.monitor;
			log("Monitor connection removed from Settings");
			return sendJson(res, 200, { monitor: monitorState() });
		}
		throw new HttpError(404, "Not found");
	}

	/** The latest scan report of a domain, read from the monitor. The admin token is added here and never leaves this process. */
	async function latestDomainReport(domain: string): Promise<MonitorReport & Record<string, unknown>> {
		if (!monitor) throw new HttpError(503, options.monitorError ?? "The monitor is not configured");
		let answer: { status: number; body: Record<string, unknown> };
		try {
			answer = await callMonitor(monitor, "GET", `/domains/${encodeURIComponent(domain)}`, undefined, options.fetchFn);
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
		if (!monitor) throw new HttpError(503, options.monitorError ?? "The monitor is not configured");
		const [name, action, ...extra] = pathname.split("/").slice(3);
		let target: string;
		if (name === undefined) {
			if (method !== "GET" && method !== "POST") throw new HttpError(405, "Method not allowed");
			target = "/domains";
		} else {
			// A name in its own script is sent in the ASCII form DNS uses (B58).
			const domain = asciiDomain(safeDecode(name).toLowerCase());
			if (!DOMAIN_PATTERN.test(domain) || extra.length > 0) throw new HttpError(400, "Invalid domain name");
			if (action === undefined) {
				if (method !== "GET" && method !== "DELETE") throw new HttpError(405, "Method not allowed");
			} else if (action === "history") {
				if (method !== "GET") throw new HttpError(405, "Method not allowed");
			} else if (method !== "POST" || (action !== "verify" && action !== "scan")) {
				throw new HttpError(404, "Not found");
			}
			target = `/domains/${encodeURIComponent(domain)}${action ? `/${action}` : ""}`;
		}
		try {
			const fields = method === "POST" && name === undefined ? bodyObject(body) : undefined;
			const sendBody = fields && typeof fields.domain === "string" ? { ...fields, domain: asciiDomain(fields.domain.trim().toLowerCase()) } : fields;
			const response = await callMonitor(monitor, method, target, sendBody, options.fetchFn);
			return [response.status, response.body];
		} catch (err) {
			throw new HttpError(502, `Could not reach the monitor: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	return { monitorState, monitorRoute, latestDomainReport, proxyToMonitor, monitor: () => monitor };
}
