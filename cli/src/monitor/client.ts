const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export interface MonitorConfig {
	url: URL;
	token: string;
}

/**
 * Reads where the monitor is and how to authenticate from the environment.
 * The token is deliberately not a command-line option, so it does not end up
 * in shell history or process listings.
 */
export function monitorConfig(env: Record<string, string | undefined>): MonitorConfig {
	const rawUrl = env.SECURITYX_MONITOR_URL;
	const token = env.SECURITYX_ADMIN_TOKEN;
	if (!rawUrl) throw new Error("Set SECURITYX_MONITOR_URL to the monitor's address, for example http://localhost:5173");
	if (!token) throw new Error("Set SECURITYX_ADMIN_TOKEN to the monitor's ADMIN_TOKEN");
	let url: URL;
	try {
		url = new URL(rawUrl);
	} catch {
		throw new Error(`SECURITYX_MONITOR_URL is not a URL: ${rawUrl}`);
	}
	const local = LOCAL_HOSTS.has(url.hostname);
	if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
		throw new Error("SECURITYX_MONITOR_URL must use https, so the admin token is never sent in clear text");
	}
	return { url, token };
}

export interface MonitorResponse {
	status: number;
	// The Worker's API is the source of truth for these shapes; see monitor/src/api.ts.
	body: Record<string, any>;
}

export async function callMonitor(
	config: MonitorConfig,
	method: string,
	path: string,
	body?: unknown,
	fetchFn: typeof fetch = fetch,
): Promise<MonitorResponse> {
	const response = await fetchFn(new URL(path, config.url), {
		method,
		headers: {
			authorization: `Bearer ${config.token}`,
			...(body === undefined ? {} : { "content-type": "application/json" }),
		},
		body: body === undefined ? undefined : JSON.stringify(body),
		redirect: "error", // Never follow a redirect with the token attached.
		signal: AbortSignal.timeout(120_000),
	});
	const text = await response.text();
	try {
		return { status: response.status, body: JSON.parse(text) };
	} catch {
		return { status: response.status, body: { error: text.slice(0, 200) || `HTTP ${response.status}` } };
	}
}
