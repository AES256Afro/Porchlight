// The audit of the owner's Cloudflare account (invariant 21): /api/cloudflare and beneath it. The token
// is kept in the data folder and never sent to the page; a change is sent only once the owner approves it.
import { randomBytes } from "node:crypto";
import type { ServerResponse } from "node:http";
import { join } from "node:path";
import { APPROVAL_WINDOW_MS, describeChange, isChangeId, planBatch, planChange, sendChange, type PlannedChange } from "../../cloudflare/apply.ts";
import { auditCloudflare, READ_PERMISSIONS, TOKEN_TEMPLATE_URL, WRITE_PERMISSIONS } from "../../cloudflare/audit.ts";
import { CfClient, tokenShapeProblem } from "../../cloudflare/client.ts";
import { CF_FORMATS, exportCloudflare, type CfFormat } from "../../cloudflare/export.ts";
import { forgetToken, readAudit, readChanges, readSavedToken, recordChange, saveAudit, saveToken } from "../../cloudflare/store.ts";
import type { CfReport } from "../../cloudflare/types.ts";
import { changeDomains, newToken, readDomains } from "../../investigate/ownership.ts";
import { auditChecks, changedSinceAudit, compareChecks, KeptRuns } from "../../kept-checks.ts";
import { FILE_TITLES, type Project } from "../../projects/projects.ts";
import type { ServerContext } from "../context.ts";
import { onComputerPage, type Gate } from "../gate.ts";
import { bodyObject, HttpError, sendDownload, sendJson } from "../http.ts";
import type { BatchStatus, CloudflareStatus } from "../types.ts";

/** Changes shown to the owner at once, waiting for their answer. */
const MAX_PENDING_CHANGES = 20;

/** `investigateDomainsPath`: this computer's ownership tokens, shared with "Investigate with a model". */
export function createCloudflare(ctx: ServerContext, investigateDomainsPath: string) {
	const { options, loopbackOnly, dataDir, projects, log, note, saveExport, assistantSummary } = ctx;
	// The Cloudflare account audit: the owner's token, kept beside the report and never sent to the page.
	const cloudflareTokenPath = join(dataDir, "cloudflare-settings.json");
	const cloudflareAuditPath = join(dataDir, "cloudflare-audit.json");
	const cloudflareChangesPath = join(dataDir, "cloudflare-changes.json");
	// Earlier audits, so the page can say what was fixed and is new since the last one (F-Q3).
	const auditRuns = new KeptRuns<CfReport>(join(dataDir, "cloudflare-audits"));
	let cloudflareStatus: CloudflareStatus = { state: "idle" };
	/** What Cloudflare last said about the token in use. Never the token. */
	let cloudflareVerified: { status: string; kind: "user" | "account"; expiresOn?: string; checkedAt: string } | null = null;
	/** Changes shown to the owner and waiting for their answer, by their random id. */
	const pendingChanges = new Map<string, PlannedChange>();
	/** The set of changes shown to the owner and waiting for one answer; a new preview replaces it. */
	let pendingBatch: { id: string; createdAt: number; changes: PlannedChange[] } | null = null;
	let batchStatus: BatchStatus = { state: "idle" };
	/** Write permissions Cloudflare refused this token, so the page can say what to add before the next try. */
	const lacking = new Set<string>();
	let batchStop: AbortController | null = null;

	/** The token in use: the one saved under Settings → Cloudflare, else the one given at start-up. */
	async function cloudflareToken(): Promise<{ token: string; source: "settings" | "startup" } | null> {
		const saved = await readSavedToken(cloudflareTokenPath);
		if (saved) return { token: saved.token, source: "settings" };
		return options.cloudflareToken ? { token: options.cloudflareToken, source: "startup" } : null;
	}

	/** What the page may know about the token: whether there is one, where it came from, what Cloudflare said. */
	async function cloudflareTokenState() {
		const saved = await readSavedToken(cloudflareTokenPath);
		const source = saved ? "settings" : options.cloudflareToken ? "startup" : null;
		return {
			configured: source !== null,
			source,
			...(saved?.savedAt ? { savedAt: saved.savedAt } : {}),
			...(options.cloudflareTokenError && !saved ? { error: options.cloudflareTokenError } : {}),
			...(cloudflareVerified ? { verified: cloudflareVerified } : {}),
		};
	}

	function cloudflareGuide() {
		return { read: READ_PERMISSIONS, write: WRITE_PERMISSIONS, templateUrl: TOKEN_TEMPLATE_URL };
	}

	async function cloudflareRoute(res: ServerResponse, route: string, url: URL, body: unknown, gate: Gate): Promise<void> {
		// Saving a token and changing the account are for this computer's page only; reading is for any page with the key.
		const here = onComputerPage(gate);
		if (route === "GET /api/cloudflare") {
			const changes = await readChanges(cloudflareChangesPath);
			const report = await readAudit(cloudflareAuditPath);
			const previous = report ? await auditRuns.before(report.checkedAt) : null;
			return sendJson(res, 200, {
				token: await cloudflareTokenState(),
				status: cloudflareStatus,
				report,
				// Against the audit before it (F-Q3), and the checks changed since it (F-Q2).
				change: report && previous ? compareChecks({ at: previous.checkedAt, checks: auditChecks(previous) }, { checks: auditChecks(report) }) : null,
				changedSince: report ? [...changedSinceAudit(report.checkedAt, changes)] : [],
				changes: changes.slice(-50).reverse(),
				batch: batchStatus,
				lacking: [...lacking],
				canChange: here,
				service: !loopbackOnly,
				guide: cloudflareGuide(),
				assistant: assistantSummary(),
			});
		}
		if (route === "GET /api/cloudflare/token") return sendJson(res, 200, { token: await cloudflareTokenState(), canChange: here, guide: cloudflareGuide() });
		if (route === "GET /api/cloudflare/export" || route === "POST /api/cloudflare/export") {
			const report = await readAudit(cloudflareAuditPath);
			if (!report) throw new HttpError(404, "There is no Cloudflare audit yet. Run one first.");
			const format = url.searchParams.get("format") ?? "md";
			if (!(CF_FORMATS as readonly string[]).includes(format)) throw new HttpError(400, `Choose a format: ${CF_FORMATS.join(", ")}`);
			const zone = url.searchParams.get("zone");
			if (zone !== null && !report.zones.some((candidate) => candidate.id === zone)) throw new HttpError(404, "That zone is not in the latest audit");
			const file = exportCloudflare(report, format as CfFormat, zone);
			// POST writes it into the project in use; GET hands it to the browser to save.
			if (route === "POST /api/cloudflare/export") return saveExport(res, file, "cloudflare");
			log(`Exported ${FILE_TITLES.cloudflare} (${format}) as a download`);
			return sendDownload(res, file);
		}
		if (route === "POST /api/cloudflare/audit") {
			if (cloudflareStatus.state === "running") throw new HttpError(409, "A Cloudflare audit is already running");
			const lookups = bodyObject(body).lookups;
			if (lookups !== undefined && typeof lookups !== "boolean") throw new HttpError(400, "lookups must be true or false");
			// Running before the first await, so a second request is refused (B24); as it was if the audit cannot start.
			const earlierAudit = cloudflareStatus;
			cloudflareStatus = { state: "running", startedAt: new Date().toISOString(), done: 0, total: 0, current: "" };
			let token: Awaited<ReturnType<typeof cloudflareToken>>;
			let ownership: Awaited<ReturnType<typeof readDomains>>;
			try {
				token = await cloudflareToken();
				if (!token) throw new HttpError(409, "Connect Cloudflare first: paste an API token in Settings → Cloudflare");
				ownership = await readDomains(investigateDomainsPath);
			} catch (err) {
				cloudflareStatus = earlierAudit;
				throw err;
			}
			const project = await projects.current();
			log("Cloudflare audit started", project);
			// Not awaited: the page polls for progress, as it does for a scan.
			void auditCloudflare({
				token: token.token,
				fetchFn: options.fetchFn,
				lookups: lookups !== false,
				ownershipTokens: Object.fromEntries(Object.entries(ownership.domains).map(([name, entry]) => [name, entry.token])),
				onProgress: ({ done, total, current }) => {
					if (cloudflareStatus.state === "running") cloudflareStatus = { ...cloudflareStatus, done, total, current };
				},
			})
				.then(async (report) => {
					await saveAudit(cloudflareAuditPath, report);
					await auditRuns.add(report, report.checkedAt).catch((err) => note(`Could not keep this audit for comparison: ${err instanceof Error ? err.message : String(err)}`, "warning"));
					// A request shown before this audit was planned from what it replaced: it is asked for again (S28).
					pendingChanges.clear();
					pendingBatch = null;
					cloudflareVerified = { status: report.token.status, kind: report.token.kind, ...(report.token.expiresOn ? { expiresOn: report.token.expiresOn } : {}), checkedAt: report.checkedAt };
					cloudflareStatus = { state: "done", finishedAt: new Date().toISOString() };
					const problems = [...report.zones.flatMap((zone) => zone.checks), ...report.accounts.flatMap((account) => account.checks), ...report.userChecks].filter((item) => item.status === "failed").length;
					log(`Cloudflare audit finished: ${report.zones.length} ${report.zones.length === 1 ? "zone" : "zones"}, ${problems} ${problems === 1 ? "finding" : "findings"}`, project);
				})
				.catch((err) => {
					cloudflareStatus = { state: "failed", finishedAt: new Date().toISOString(), error: err instanceof Error ? err.message : String(err) };
					log("Cloudflare audit failed", project);
				});
			return sendJson(res, 202, { status: cloudflareStatus });
		}
		if (!here) throw new HttpError(403, "The Cloudflare token and changes to your account are managed from the page on the computer that runs Porchlight");
		const fields = bodyObject(body);

		if (route === "POST /api/cloudflare/token") {
			const token = typeof fields.token === "string" ? fields.token.trim() : "";
			const problem = tokenShapeProblem(token);
			if (problem) throw new HttpError(400, problem);
			// Checked with Cloudflare before it is saved, so a mistake never replaces a working token.
			const verified = await new CfClient(token, options.fetchFn ?? fetch).verify();
			if (!verified.ok) throw new HttpError(400, verified.message ?? `Cloudflare says this token is ${verified.status ?? "not active"}`);
			await saveToken(cloudflareTokenPath, token);
			lacking.clear();
			cloudflareVerified = { status: verified.status ?? "active", kind: verified.kind, ...(verified.expiresOn ? { expiresOn: verified.expiresOn } : {}), checkedAt: new Date().toISOString() };
			return sendJson(res, 200, { token: await cloudflareTokenState() });
		}
		if (route === "POST /api/cloudflare/token/remove") {
			await forgetToken(cloudflareTokenPath);
			cloudflareVerified = null;
			pendingChanges.clear();
			pendingBatch = null;
			batchStop?.abort();
			lacking.clear();
			return sendJson(res, 200, { token: await cloudflareTokenState() });
		}
		if (route === "POST /api/cloudflare/changes/preview") {
			const report = await readAudit(cloudflareAuditPath);
			const zone = report?.zones.find((candidate) => candidate.id === fields.zone);
			if (!report || !zone) throw new HttpError(404, "That zone is not in the latest audit. Run the audit again.");
			const change = fields.change;
			if (!isChangeId(change)) throw new HttpError(400, "Choose one of the changes the audit offers");
			// Only a change the audit offered for a problem it found in this zone.
			if (!zone.checks.some((item) => item.change === change && item.status === "failed")) throw new HttpError(409, "The latest audit does not suggest that change for this zone");
			let ownershipToken: string | undefined;
			if (change === "ownership-record") ownershipToken = (await readDomains(investigateDomainsPath)).domains[zone.name]?.token ?? newToken();
			const planned = planChange(zone, change, ownershipToken, report.checkedAt);
			for (const [id, waiting] of pendingChanges) if (Date.now() - waiting.createdAt > APPROVAL_WINDOW_MS) pendingChanges.delete(id);
			if (pendingChanges.size >= MAX_PENDING_CHANGES) throw new HttpError(409, "Answer the changes already waiting first");
			pendingChanges.set(planned.id, planned);
			return sendJson(res, 200, { pending: describeChange(planned) });
		}
		if (route === "POST /api/cloudflare/changes/approve") {
			const planned = typeof fields.id === "string" ? pendingChanges.get(fields.id) : undefined;
			if (!planned || Date.now() - planned.createdAt > APPROVAL_WINDOW_MS) {
				if (planned) pendingChanges.delete(planned.id);
				throw new HttpError(409, "That change is no longer waiting. Ask for it again to see the request.");
			}
			if (typeof fields.approve !== "boolean") throw new HttpError(400, "Say whether to apply it");
			// One at a time: the same template could otherwise go out twice, once from each (CF-S2).
			if (fields.approve && batchStatus.state === "running") throw new HttpError(409, "Changes are being sent now. Wait for them to finish, or stop them");
			pendingChanges.delete(planned.id);
			if (!fields.approve) return sendJson(res, 200, { applied: false });
			const token = await cloudflareToken();
			if (!token) throw new HttpError(409, "Connect Cloudflare first: paste an API token in Settings → Cloudflare");
			if (!(await fromLatestAudit(planned))) throw new HttpError(409, "A newer audit replaced the one this request was planned from. Ask for it again.");
			if (await ownershipTokenChanged(planned)) throw new HttpError(409, "The token for this domain changed since the request was shown. Ask for it again.");
			const { outcome, changes } = await applyPlanned(planned, token.token);
			return sendJson(res, 200, { applied: true, ok: outcome.ok, ...(outcome.notSent ? { notSent: true } : {}), result: outcome.result, changes: changes.slice(-50).reverse(), lacking: [...lacking] });
		}

		// "Fix these": every change the latest audit offers, for one zone or all, shown as the exact
		// requests and sent after one approval. The same fixed templates, each sent once and recorded.
		if (route === "POST /api/cloudflare/changes/batch/stop") {
			// What was already sent stays sent; the rest are not.
			batchStop?.abort();
			return sendJson(res, 200, { stopped: batchStop !== null });
		}
		if (route === "POST /api/cloudflare/changes/batch/preview") {
			if (batchStatus.state === "running") throw new HttpError(409, "Changes are being sent now. Wait for them to finish, or stop them");
			const report = await readAudit(cloudflareAuditPath);
			if (!report) throw new HttpError(404, "There is no Cloudflare audit yet. Run one first.");
			let zones = report.zones;
			if (fields.zone !== undefined) {
				zones = report.zones.filter((candidate) => candidate.id === fields.zone);
				if (zones.length === 0) throw new HttpError(404, "That zone is not in the latest audit. Run the audit again.");
			}
			const domains = (await readDomains(investigateDomainsPath)).domains;
			// A check changed since the audit is left out until the next audit says how it stands (F-Q2).
			const changed = changedSinceAudit(report.checkedAt, await readChanges(cloudflareChangesPath));
			zones = zones.map((zone) => ({ ...zone, checks: zone.checks.filter((check) => !check.change || !changed.has(`${zone.id}\n${check.change}`)) }));
			const { changes: planned, offered } = planBatch(zones, (name) => domains[name]?.token ?? newToken(), report.checkedAt);
			if (planned.length === 0) throw new HttpError(409, "The latest audit found nothing here that Porchlight can change");
			pendingBatch = { id: randomBytes(12).toString("hex"), createdAt: Date.now(), changes: planned };
			// `offered`: every change the audit offers here, so the page can say when one approval covers only some (F-F5).
			return sendJson(res, 200, { batch: { id: pendingBatch.id, expiresAt: new Date(pendingBatch.createdAt + APPROVAL_WINDOW_MS).toISOString(), changes: planned.map(describeChange), offered } });
		}
		if (route === "POST /api/cloudflare/changes/batch/approve") {
			const batch = pendingBatch;
			if (!batch || batch.id !== fields.id || Date.now() - batch.createdAt > APPROVAL_WINDOW_MS) {
				if (batch && batch.id === fields.id) pendingBatch = null;
				throw new HttpError(409, "Those changes are no longer waiting. Ask for them again to see the requests.");
			}
			if (typeof fields.approve !== "boolean") throw new HttpError(400, "Say whether to send them");
			// Some may be left out; none can be added. Each name must be one of the requests that was shown.
			// A change that carries a warning is sent only when it is named: a bare yes never covers it.
			let chosen = batch.changes.filter((change) => !change.care);
			if (fields.include !== undefined) {
				const include = fields.include;
				if (!Array.isArray(include) || !include.every((id) => typeof id === "string" && batch.changes.some((change) => change.id === id))) {
					throw new HttpError(400, "Choose among the changes that were shown");
				}
				chosen = batch.changes.filter((change) => include.includes(change.id));
			}
			if (fields.approve && chosen.length === 0) throw new HttpError(400, "Choose at least one change to send");
			if (batchStatus.state === "running") throw new HttpError(409, "Changes are being sent now");
			pendingBatch = null;
			if (!fields.approve) return sendJson(res, 200, { started: false });
			const token = await cloudflareToken();
			if (!token) throw new HttpError(409, "Connect Cloudflare first: paste an API token in Settings → Cloudflare");
			if (!(await fromLatestAudit(batch.changes[0]))) throw new HttpError(409, "A newer audit replaced the one these requests were planned from. Ask for them again.");
			const startedAt = new Date().toISOString();
			const stop = new AbortController();
			batchStop = stop;
			batchStatus = { state: "running", startedAt, total: chosen.length, done: 0, applied: 0, failed: 0, skipped: 0, current: "" };
			const logTo = await projects.current();
			log(`Cloudflare changes approved together: ${chosen.length}, on ${new Set(chosen.map((change) => change.zone)).size} ${new Set(chosen.map((change) => change.zone)).size === 1 ? "domain" : "domains"}`, logTo);
			// Not awaited: the page follows it in the Activity view.
			void (async () => {
				let applied = 0;
				let failed = 0;
				let skipped = 0;
				// A permission the token turned out to lack: the rest that need it are not sent, only said.
				const lacking = new Set<string>();
				for (const planned of chosen) {
					if (stop.signal.aborted) break;
					if (batchStatus.state === "running") batchStatus = { ...batchStatus, current: planned.title };
					if (lacking.has(planned.permission)) {
						skipped += 1;
						note(`Not sent: ${planned.title}. The token lacks "${planned.permission}"`, "warning");
					} else if (await ownershipTokenChanged(planned)) {
						skipped += 1;
						note(`Not sent: ${planned.title}. The token for this domain changed since the request was shown`, "warning");
					} else {
						note(`Sending: ${planned.title}`);
						try {
							const { outcome } = await applyPlanned(planned, token.token, logTo);
							if (outcome.ok) applied += 1;
							else if (outcome.notSent) skipped += 1;
							else failed += 1;
							if (outcome.denied) lacking.add(planned.permission);
						} catch (err) {
							failed += 1;
							note(`Could not send: ${planned.title}. ${err instanceof Error ? err.message : String(err)}`.split(token.token).join("[token]"), "warning");
						}
					}
					if (batchStatus.state === "running") batchStatus = { ...batchStatus, done: applied + failed + skipped, applied, failed, skipped };
				}
				const stopped = stop.signal.aborted;
				batchStatus = { state: "finished", startedAt, finishedAt: new Date().toISOString(), total: chosen.length, applied, failed, skipped, stopped };
				if (batchStop === stop) batchStop = null;
				log(`Cloudflare changes ${stopped ? "stopped" : "finished"}: ${applied} applied, ${failed} refused, ${skipped + (stopped ? chosen.length - applied - failed - skipped : 0)} not sent`, logTo);
			})();
			return sendJson(res, 202, { started: true, batch: batchStatus });
		}
		throw new HttpError(404, "Not found");
	}

	/** Whether a change was planned from the audit that is still the latest: a newer one may have found the problem gone (S28). */
	async function fromLatestAudit(planned: PlannedChange | undefined): Promise<boolean> {
		const latest = await readAudit(cloudflareAuditPath);
		return planned !== undefined && latest !== null && planned.auditAt === latest.checkedAt;
	}

	/** For the ownership record: whether this computer's token for the domain changed after the request was shown. */
	async function ownershipTokenChanged(planned: PlannedChange): Promise<boolean> {
		if (planned.change !== "ownership-record") return false;
		const entry = (await readDomains(investigateDomainsPath)).domains[planned.zone];
		return entry !== undefined && entry.token !== planned.ownershipToken;
	}

	/** Sends one approved change, exactly as planned, and records it whether Cloudflare accepted it or not. */
	async function applyPlanned(planned: PlannedChange, token: string, project?: Project | null) {
		const outcome = await sendChange(new CfClient(token, options.fetchFn ?? fetch), planned);
		// Kept for the investigation and the audit: the record now holds this token.
		if (outcome.ok && planned.change === "ownership-record" && planned.ownershipToken) {
			const token = planned.ownershipToken;
			await changeDomains(investigateDomainsPath, (file) => {
				if (file.domains[planned.zone]) return false;
				file.domains[planned.zone] = { token, addedAt: new Date().toISOString(), source: "local" };
				return true;
			});
		}
		// The change's title is Porchlight's, from its own list; the request and the token stay out of the log.
		log(`Cloudflare change ${outcome.ok ? "applied" : outcome.notSent ? "not sent" : "failed"}: ${planned.title}, on ${planned.zone}`, project);
		if (outcome.notSent) note(`${outcome.result.replace(/^Not sent: /, `Not sent: ${planned.title}. `)}`, "warning");
		else if (!outcome.ok) note(`Cloudflare refused: ${planned.title}. ${outcome.result}`, "warning");
		if (outcome.denied) lacking.add(planned.permission);
		else if (outcome.ok) lacking.delete(planned.permission);
		const changes = await recordChange(cloudflareChangesPath, {
			at: new Date().toISOString(),
			zone: planned.zone,
			zoneId: planned.zoneId,
			change: planned.change,
			title: planned.title,
			request: { method: planned.method, url: planned.url, body: planned.body },
			ok: outcome.ok,
			result: outcome.result,
			...(outcome.notSent ? { notSent: true } : {}),
		});
		return { outcome, changes };
	}

	return { cloudflareRoute, cloudflareTokenState, cloudflareStatus: () => cloudflareStatus, auditPath: cloudflareAuditPath };
}
