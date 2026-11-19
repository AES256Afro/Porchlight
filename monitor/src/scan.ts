import { sendAlert } from "./alert.ts";
import { diffSnapshots } from "./diff.ts";
import { errorMessage, settingsFrom, type AppEnv, type Deps, type Settings } from "./env.ts";
import { deriveFindings, diffFindings } from "./findings.ts";
import { checkOwnership } from "./ownership.ts";
import { formatReport, hasNews, type ScanReport } from "./report.ts";
import { collectSnapshot, type Snapshot } from "./snapshot.ts";
import { latestScan, markScan, nextDueDomain, saveScan, type DomainRow } from "./store.ts";

export type ScanOutcome =
	| { status: "ok"; report: ScanReport }
	| { status: "unverified" }
	| { status: "error"; error: string };

/**
 * Scans one domain: re-check ownership, observe, compare with the last scan,
 * store, and alert if anything is new. Never throws; failures are recorded on
 * the domain so the schedule moves on to the next one.
 */
export async function runScan(env: AppEnv, domain: DomainRow, deps: Deps): Promise<ScanOutcome> {
	const settings = settingsFrom(env);
	const startedAt = deps.now().toISOString();
	try {
		// The gate. Nothing below runs for a domain whose challenge record is
		// missing, including one that passed in the past.
		if (!(await checkOwnership(domain.name, domain.challenge_token, deps.fetch))) {
			await markScan(env.DB, domain.id, "unverified", startedAt);
			if (domain.last_scan_status !== "unverified") {
				await sendAlert(
					env,
					deps,
					`Porchlight: ownership check failed for ${domain.name}. ` +
						"Its verification TXT record is missing, so scanning is paused until the record is back.",
					{ domain: domain.name, status: "unverified" },
				);
			}
			return { status: "unverified" };
		}

		const previous = await latestScan(env.DB, domain.id);
		const snapshot = await collectSnapshot(domain.name, previous?.snapshot ?? null, settings, deps);
		const report = buildReport(
			snapshot,
			previous?.snapshot ?? null,
			previous?.report ?? null,
			settings,
			deps.now(),
		);
		await saveScan(env.DB, domain.id, { snapshot, report }, settings.snapshotsToKeep);
		if (hasNews(report)) await sendAlert(env, deps, formatReport(report), report);
		return { status: "ok", report };
	} catch (err) {
		const error = errorMessage(err);
		console.error(`Scan of ${domain.name} failed: ${error}`);
		await markScan(env.DB, domain.id, "error", startedAt).catch(() => {});
		return { status: "error", error };
	}
}

export function buildReport(
	snapshot: Snapshot,
	prevSnapshot: Snapshot | null,
	prevReport: ScanReport | null,
	settings: Settings,
	now: Date,
): ScanReport {
	const previousFindings = prevReport?.findings ?? [];
	const findings = deriveFindings(snapshot, previousFindings, settings, now);
	const { added, resolved } = diffFindings(previousFindings, findings);

	const hosts = Object.values(snapshot.hosts);
	const notes: string[] = [];
	if (!snapshot.ctOk) {
		notes.push(
			"The certificate log could not be read, so newly issued hostnames may be missing from this scan.",
		);
	}
	const unprobed = hosts.filter((host) => !host.probed).length;
	if (unprobed > 0) {
		notes.push(
			`${unprobed} known hosts were not probed because MAX_HOSTS is ${settings.maxHosts}.`,
		);
	}
	const failedLookups = hosts.filter((host) => host.probed && host.dns === null).length;
	if (failedLookups > 0)
		notes.push(`DNS lookups failed for ${failedLookups} hosts; their findings were carried over.`);

	return {
		domain: snapshot.domain,
		takenAt: snapshot.takenAt,
		baseline: prevSnapshot === null,
		changes: diffSnapshots(prevSnapshot, snapshot),
		newFindings: added,
		resolvedFindings: resolved,
		findings,
		hostCount: hosts.length,
		notes,
	};
}

/** Scans the most overdue verified domain, if one is due. Called on every cron tick. */
export async function runDueScan(env: AppEnv, deps: Deps): Promise<ScanOutcome | null> {
	const intervalMs = settingsFrom(env).scanIntervalHours * 3_600_000;
	const cutoff = new Date(deps.now().getTime() - intervalMs).toISOString();
	const domain = await nextDueDomain(env.DB, cutoff);
	return domain ? runScan(env, domain, deps) : null;
}
