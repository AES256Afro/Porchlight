// The GitHub settings audit (invariant 24): /api/github/audit and beneath it. It reads with the token
// given at start-up (PORCHLIGHT_GITHUB_TOKEN), which never reaches the page; the audit is kept 0600 as
// github-audit.json in the data folder. It only reads: there is no change, no apply and no approval.
import { join } from "node:path";
import { auditGithub, READ_PERMISSIONS } from "../../github/audit.ts";
import { exportGithubAudit, GH_FORMATS, type GhFormat } from "../../github/audit-export.ts";
import { AUDIT_FILE, readGithubAudit, saveGithubAudit } from "../../github/audit-store.ts";
import type { GithubAuditStatus } from "../../github/audit-types.ts";
import type { GithubConfig } from "../../github/github.ts";
import type { ServerContext } from "../context.ts";
import type { Call } from "../gate.ts";
import { bodyObject, HttpError, sendDownload, sendJson } from "../http.ts";
import type { Route } from "../router.ts";

/** `github`: the GitHub area's settings, whose token this audit reads with. */
export function createGithubAudit(ctx: ServerContext, github: GithubConfig) {
	const { options, dataDir, loopbackOnly, projects, log } = ctx;
	const auditPath = join(dataDir, AUDIT_FILE);
	let status: GithubAuditStatus = { state: "idle" };

	/** What the page may know: whether there is a token (never the token), the audit, and what it needs. */
	async function overview({ res }: Call): Promise<void> {
		const kept = await readGithubAudit(auditPath);
		return sendJson(res, 200, {
			token: github.token !== undefined,
			status,
			report: kept.state === "read" ? kept.report : null,
			// A kept audit that cannot be read is said, never shown as none (invariant 5).
			...(kept.state === "unreadable" ? { unreadable: `The kept GitHub audit could not be read (${kept.reason}). Audit again to replace it.` } : {}),
			permissions: READ_PERMISSIONS.map(({ name, classic, purpose }) => ({ name, classic, purpose })),
			service: !loopbackOnly,
		});
	}

	async function start({ res, body }: Call): Promise<void> {
		bodyObject(body);
		if (status.state === "running") throw new HttpError(409, "A GitHub audit is already running");
		const token = github.token;
		if (!token) throw new HttpError(409, "Set PORCHLIGHT_GITHUB_TOKEN to a GitHub token first: the audit reads with it");
		status = { state: "running", startedAt: new Date().toISOString(), done: 0, total: 0, current: "" };
		const project = await projects.current();
		log("GitHub settings audit started", project);
		// Not awaited: the page polls for progress, as it does for the Cloudflare audit.
		void auditGithub({
			token,
			fetchFn: options.fetchFn,
			onProgress: ({ done, total, current }) => {
				if (status.state === "running") status = { ...status, done, total, current };
			},
		})
			.then(async (report) => {
				await saveGithubAudit(auditPath, report);
				status = { state: "done", finishedAt: new Date().toISOString() };
				const problems = report.repos.flatMap((repo) => repo.checks).filter((item) => item.status === "failed").length;
				log(`GitHub settings audit finished: ${report.repos.length} ${report.repos.length === 1 ? "repository" : "repositories"}, ${problems} ${problems === 1 ? "finding" : "findings"}`, project);
			})
			.catch((err) => {
				// The message is the audit's own or GitHub's, already scrubbed of the token; scrubbed again here.
				const message = (err instanceof Error ? err.message : String(err)).split(token).join("[token]");
				status = { state: "failed", finishedAt: new Date().toISOString(), error: message };
				log("GitHub settings audit failed", project);
			});
		return sendJson(res, 202, { status });
	}

	async function exportRoute({ res, url }: Call): Promise<void> {
		const kept = await readGithubAudit(auditPath);
		if (kept.state === "unreadable") throw new HttpError(409, `The kept GitHub audit could not be read (${kept.reason}). Audit again to replace it.`);
		if (kept.state === "missing") throw new HttpError(404, "There is no GitHub audit yet. Run one first.");
		const format = url.searchParams.get("format") ?? "md";
		if (!(GH_FORMATS as readonly string[]).includes(format)) throw new HttpError(400, `Choose a format: ${GH_FORMATS.join(", ")}`);
		const file = exportGithubAudit(kept.report, format as GhFormat);
		log(`Exported the GitHub settings audit (${format}) as a download`);
		return sendDownload(res, file);
	}

	// Before the GitHub area's own routes, whose "not found" claims everything under /api/github.
	const routes: Route[] = [
		["GET /api/github/audit", overview],
		["POST /api/github/audit", start],
		["GET /api/github/audit/export", exportRoute],
	];

	return { routes, status: () => status };
}
