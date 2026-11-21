import { sendAlert } from "./alert.ts";
import { diffSnapshots } from "./diff.ts";
import { errorMessage, settingsFrom, type AppEnv, type Deps, type Settings } from "./env.ts";
import { deriveFindings, diffFindings } from "./findings.ts";
import { checkOwnership } from "./ownership.ts";
import { formatReport, hasNews, type ScanReport } from "./report.ts";
import { collectSnapshot, type Snapshot } from "./snapshot.ts";
import {
	claimScan,
	isRegistered,
	latestScan,
	markFailed,
	markUnverified,
	nextDueDomain,
	postponeUnverified,
	releaseScan,
	saveScan,
	type DomainRow,
} from "./store.ts";

export type ScanOutcome =
	| { status: "ok"; report: ScanReport }
	| { status: "unverified" }
	| { status: "error"; error: string }
	/** Another scan of the domain was already running, or took over, so this one kept nothing. */
	| { status: "busy" }
	/** The domain was removed (and perhaps another added) before or while it was scanned; nothing was kept or sent. */
	| { status: "gone" };

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;
/**
 * The cron runs every ten minutes. A scan is recorded a little after its tick
 * (the time it took), so "due" allows this much: otherwise each scan would
 * fall to the following tick and the interval would creep later every time.
 * Less than one tick, so a domain is never scanned a tick early.
 */
const SCHEDULE_SLACK_MS = 5 * MINUTE_MS;
/** A failed scan is tried again after an hour, then every two hours, never later than the interval. */
const FIRST_RETRY_MS = HOUR_MS;
const LATER_RETRY_MS = 2 * HOUR_MS;
/** The owner hears about failures once this many scans in a row have failed. */
export const FAILURES_BEFORE_ALERT = 3;
/** A claim older than this was left by a scan that died. Scans take about a minute at most. */
const CLAIM_LEASE_MS = 15 * MINUTE_MS;

/**
 * Scans one domain: re-check ownership, observe, compare with the last scan,
 * store, and alert if anything is new. Never throws; failures are recorded on
 * the domain so the schedule moves on to the next one. Only one scan of a
 * domain runs at a time; a second one returns "busy" without doing anything.
 * Every write matches the domain's name and token as well as its id, so a scan
 * of a domain removed while it ran ("gone") changes and sends nothing.
 */
export async function runScan(env: AppEnv, row: DomainRow, deps: Deps): Promise<ScanOutcome> {
	const settings = settingsFrom(env);
	const startedAt = deps.now().toISOString();
	let claimed: DomainRow | null = null;
	// Whether the challenge record was looked up and answered, present or not.
	let ownershipObserved = false;
	try {
		const staleBefore = new Date(Date.parse(startedAt) - CLAIM_LEASE_MS).toISOString();
		// The row as it is now, not as the caller read it: another scan may have just finished.
		// The claim matches the name and token too, so a domain removed since it was read is not scanned.
		claimed = await claimScan(env.DB, row, startedAt, staleBefore);
		if (!claimed)
			return (await isRegistered(env.DB, row)) ? { status: "busy" } : { status: "gone" };
		const domain = claimed;

		// The gate. Nothing below runs for a domain whose challenge record is
		// missing, including one that passed in the past.
		const owned = await checkOwnership(domain.name, domain.challenge_token, deps.fetch);
		ownershipObserved = true;
		if (!owned) {
			// Not recorded if a verify passed after this scan started, and alerted once per lapse.
			const recorded = await markUnverified(env.DB, domain, startedAt);
			if (recorded && domain.last_scan_status !== "unverified") {
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

		const stored = await latestScan(env.DB, domain.id);
		// Only a scan of this same domain is compared with, or has its hosts carried.
		const previous = stored?.snapshot.domain === domain.name ? stored : null;
		const snapshot = await collectSnapshot(domain.name, previous?.snapshot ?? null, settings, deps);
		const report = buildReport(
			snapshot,
			previous?.snapshot ?? null,
			previous?.report ?? null,
			settings,
			deps.now(),
		);
		if (
			!(await saveScan(env.DB, domain, startedAt, { snapshot, report }, settings.snapshotsToKeep))
		) {
			// Removed while it ran, or its claim was taken over: the scan is discarded, and nothing is sent.
			return (await isRegistered(env.DB, domain)) ? { status: "busy" } : { status: "gone" };
		}
		if (hasNews(report)) await sendAlert(env, deps, formatReport(report), report);
		if (domain.error_streak >= FAILURES_BEFORE_ALERT) {
			await sendAlert(
				env,
				deps,
				`Porchlight: scans of ${domain.name} are working again after ${domain.error_streak} failures in a row.`,
				{ domain: domain.name, status: "ok", recoveredAfter: domain.error_streak },
			);
		}
		return { status: "ok", report };
	} catch (err) {
		const error = errorMessage(err);
		console.error(`Scan of ${row.name} failed: ${error}`);
		if (claimed) await recordFailure(env, deps, claimed, startedAt, error, ownershipObserved);
		return { status: "error", error };
	} finally {
		if (claimed) await releaseScan(env.DB, claimed, startedAt).catch(() => {});
	}
}

/**
 * Counts the failure, and tells the owner once failures have run on long enough
 * to matter. A domain last seen without its record, whose record could not be
 * looked up this time, stays unverified: nothing was observed (invariant 5), so
 * neither its status nor the alert that it lapsed changes.
 */
async function recordFailure(
	env: AppEnv,
	deps: Deps,
	domain: DomainRow,
	startedAt: string,
	error: string,
	ownershipObserved: boolean,
): Promise<void> {
	const name = domain.name;
	try {
		if (!ownershipObserved && domain.last_scan_status === "unverified") {
			await postponeUnverified(env.DB, domain, startedAt);
			return;
		}
		const streak = await markFailed(env.DB, domain, startedAt);
		if (streak !== FAILURES_BEFORE_ALERT) return;
		await sendAlert(
			env,
			deps,
			`Porchlight: ${streak} scans of ${name} in a row have failed. ` +
				`The last error was: ${error}. Scans are retried every two hours until one succeeds.`,
			{ domain: name, status: "error", errorStreak: streak },
		);
	} catch (err) {
		console.error(`Could not record the failed scan of ${name}: ${errorMessage(err)}`);
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
			// Said for the owner, not in the setting's name; the README says how to raise the limit.
			`${unprobed} of ${hosts.length} known hosts were not checked this time: each scan checks ${settings.maxHosts}, ` +
				"and the rest take turns in later scans.",
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
	const intervalMs = settingsFrom(env).scanIntervalHours * HOUR_MS;
	const now = deps.now().getTime();
	const before = (ms: number) =>
		new Date(now - Math.min(ms, intervalMs) + SCHEDULE_SLACK_MS).toISOString();
	const domain = await nextDueDomain(env.DB, {
		interval: before(intervalMs),
		firstRetry: before(FIRST_RETRY_MS),
		laterRetry: before(LATER_RETRY_MS),
		staleClaim: new Date(now - CLAIM_LEASE_MS).toISOString(),
	});
	return domain ? runScan(env, domain, deps) : null;
}
