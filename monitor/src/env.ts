/**
 * Bindings the Worker reads. Declared here rather than taken from the
 * generated `Env` so the optional webhook secret is expressible and tests can
 * pass a plain object.
 */
export interface AppEnv {
	DB: D1Database;
	ADMIN_TOKEN?: string;
	ALERT_WEBHOOK_URL?: string;
	/** json, slack, discord or ntfy; empty: the one ALERT_WEBHOOK_URL shows, else json. */
	ALERT_FORMAT?: string;
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

export const USER_AGENT = "porchlight-monitor (attack-surface monitor for verified domains)";

export function errorMessage(err: unknown): string {
	return (err instanceof Error ? err.message : String(err)).slice(0, 200);
}

/**
 * `text` with the admin token and the webhook's address taken out, for an error that is kept and
 * shown through the API. The webhook's path and query are its secret (a Slack or Discord token, an
 * ntfy topic), so they go even where the error names them without the rest of the address.
 */
export function scrubbed(env: AppEnv, text: string): string {
	const secrets: string[] = [];
	if (env.ADMIN_TOKEN) secrets.push(env.ADMIN_TOKEN);
	const webhook = env.ALERT_WEBHOOK_URL?.trim();
	if (webhook) {
		secrets.push(webhook);
		try {
			const url = new URL(webhook);
			secrets.push(url.href);
			if (url.pathname.length > 1) secrets.push(url.pathname);
			if (url.search) secrets.push(url.search.slice(1));
		} catch {
			// Not an address; the value itself is taken out above.
		}
	}
	let out = text;
	for (const secret of secrets.sort((a, b) => b.length - a.length)) {
		if (secret) out = out.split(secret).join("(hidden)");
	}
	return out;
}

/** An error's message, scrubbed as `scrubbed` says before it is cut short, so no part of a secret is left at the cut. */
export function scrubbedError(env: AppEnv, err: unknown): string {
	return scrubbed(env, err instanceof Error ? err.message : String(err)).slice(0, 200);
}
