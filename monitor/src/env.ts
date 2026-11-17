/**
 * Bindings the Worker reads. Declared here rather than taken from the
 * generated `Env` so the optional webhook secret is expressible and tests can
 * pass a plain object.
 */
export interface AppEnv {
	DB: D1Database;
	ADMIN_TOKEN?: string;
	ALERT_WEBHOOK_URL?: string;
	SCAN_INTERVAL_HOURS?: string;
	MAX_HOSTS?: string;
	CERT_EXPIRY_WARN_DAYS?: string;
	SNAPSHOTS_TO_KEEP?: string;
}

export interface Settings {
	scanIntervalHours: number;
	maxHosts: number;
	certExpiryWarnDays: number;
	snapshotsToKeep: number;
}

function positiveInt(value: string | undefined, fallback: number): number {
	const n = Number.parseInt(value ?? "", 10);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function settingsFrom(env: AppEnv): Settings {
	return {
		scanIntervalHours: positiveInt(env.SCAN_INTERVAL_HOURS, 24),
		maxHosts: positiveInt(env.MAX_HOSTS, 12),
		certExpiryWarnDays: positiveInt(env.CERT_EXPIRY_WARN_DAYS, 14),
		snapshotsToKeep: positiveInt(env.SNAPSHOTS_TO_KEEP, 30),
	};
}

export type FetchFn = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** Everything that reaches outside the Worker, injected so tests can replace it. */
export interface Deps {
	fetch: FetchFn;
	now: () => Date;
}

export const liveDeps: Deps = {
	fetch: (input, init) => fetch(input, init),
	now: () => new Date(),
};

export const USER_AGENT = "securityx-monitor (attack-surface monitor for verified domains)";

export function errorMessage(err: unknown): string {
	return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}
