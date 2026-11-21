// The check of the computer that runs Porchlight (invariant 19): /api/host and /api/host/check.
import { join } from "node:path";
import { checkHost } from "../../host/check.ts";
import type { HostReport } from "../../host/types.ts";
import { compareChecks, KeptRuns } from "../../kept-checks.ts";
import { run as runCommand } from "../../repos/exec.ts";
import type { ServerContext } from "../context.ts";
import type { Call } from "../gate.ts";
import { bodyObject, HttpError, sendJson } from "../http.ts";
import { readHostReport, saveHostReport } from "../kept-files.ts";
import { paths, type Route } from "../router.ts";
import type { HostStatus } from "../types.ts";

export function createHostCheck(ctx: ServerContext) {
	const { options, loopbackOnly, dataDir, note } = ctx;
	// The check of this computer: what it found is kept beside the report, readable only by its owner.
	const hostPath = join(dataDir, "host-check.json");
	// Earlier checks, so a check after a fix says what it fixed (G-Q1).
	const hostRuns = new KeptRuns<HostReport>(join(dataDir, "host-checks"));
	const runHostCheck = options.hostCheck ?? ((hostOptions) => checkHost({ run: runCommand, ...hostOptions }));
	let hostStatus: HostStatus = { state: "idle" };
	const notFound = () => {
		throw new HttpError(404, "Not found");
	};

	/**
	 * The check of this computer. It only reads (invariant 19). As a service it does not run: in a
	 * container it would describe the container, not the computer the owner cares about.
	 */
	async function hostReport({ res }: Call): Promise<void> {
		const report = loopbackOnly ? await readHostReport(hostPath) : null;
		const previous = report ? await hostRuns.before(report.checkedAt) : null;
		const place = (checks: HostReport["checks"]) => checks.map((check) => ({ ...check, place: "" }));
		const change = report && previous ? compareChecks({ at: previous.checkedAt, checks: place(previous.checks) }, { checks: place(report.checks) }) : null;
		return sendJson(res, 200, { status: hostStatus, report, service: !loopbackOnly, change, kept: loopbackOnly ? await hostRuns.count() : 0 });
	}

	async function startCheck({ res, body }: Call): Promise<void> {
		if (!loopbackOnly) throw new HttpError(409, "Porchlight runs in a container here, so it cannot see the computer it runs on.");
		if (hostStatus.state === "running") throw new HttpError(409, "This computer is already being checked");
		const fields = bodyObject(body);
		for (const name of ["askApple", "lookUpPackages"]) {
			if (fields[name] !== undefined && typeof fields[name] !== "boolean") throw new HttpError(400, `${name} must be true or false`);
		}
		hostStatus = { state: "running", startedAt: new Date().toISOString(), done: 0, total: 0, current: "" };
		// Not awaited: the page polls for progress, as it does for a scan.
		void runHostCheck({
			askApple: fields.askApple !== false,
			lookUpPackages: fields.lookUpPackages !== false,
			onProgress: ({ done, total, current }) => {
				if (hostStatus.state === "running") hostStatus = { ...hostStatus, done, total, current };
			},
		})
			.then(async (report) => {
				await saveHostReport(hostPath, report);
				await hostRuns.add(report, report.checkedAt).catch((err) => note(`Could not keep this check for comparison: ${err instanceof Error ? err.message : String(err)}`, "warning"));
				hostStatus = { state: "done", finishedAt: new Date().toISOString() };
			})
			.catch((err) => {
				hostStatus = { state: "failed", finishedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) };
			});
		return sendJson(res, 202, { status: hostStatus });
	}

	const routes: Route[] = [["GET /api/host", hostReport], ["POST /api/host/check", startCheck], [paths("/api/host", "/api/host/check"), notFound]];
	return { routes, hostStatus: () => hostStatus };
}
