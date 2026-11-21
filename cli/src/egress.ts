/**
 * The egress log (R6F-3): one record of every request the interface's server sends out, so the owner
 * can check what leaves the computer against what the README says.
 *
 * A record holds the time, the method, the destination's host, a purpose in Porchlight's own words,
 * and the answer's status (or that there was none). Never a path, a query, a header, a body, a key or
 * a token: a webhook's or a provider's address can carry a token in its path, so only the host is
 * kept. It lives in memory, the last MAX_RECORDS, like the Activity view, and is gone when Porchlight
 * stops.
 *
 * It covers what passes through the server's one `fetch`: the monitor, models, GitHub's API,
 * Cloudflare, DNS-over-HTTPS lookups, model search and downloads, and notices. Programs Porchlight
 * runs (git fetching from GitHub, osv-scanner asking OSV.dev, softwareupdate asking Apple) make their
 * own requests, which cannot be seen from here; an investigation's requests are listed step by step
 * in the investigation itself.
 */

export const MAX_RECORDS = 500;

export interface EgressRecord {
	n: number;
	at: string;
	method: string;
	/** The destination's host, with its port when it is not the default. */
	host: string;
	purpose: string;
	/** The answer's status, or absent when no answer came (`failed`). */
	status?: number;
	failed?: true;
}

/** Hosts whose purpose is fixed. Others are named by what the server knows of them at the time. */
const FIXED: [RegExp, string][] = [
	[/^api\.github\.com$/, "GitHub: listing repositories"],
	[/^(?:github\.com|codeload\.github\.com)$/, "GitHub"],
	[/^api\.cloudflare\.com$/, "Cloudflare: audit or approved change"],
	[/^(?:cloudflare-dns\.com|one\.one\.one\.one|dns\.google|dns\.quad9\.net|1\.1\.1\.1)$/, "DNS over HTTPS: ownership or investigation lookup"],
	[/^api\.osv\.dev$/, "OSV.dev: package advisories"],
	[/^(?:huggingface\.co|hf\.co)$/, "Model search"],
	[/^api\.anthropic\.com$/, "Hosted model: Claude"],
	[/^api\.openai\.com$/, "Hosted model: OpenAI"],
	[/^generativelanguage\.googleapis\.com$/, "Hosted model: Gemini"],
	[/^api\.deepseek\.com$/, "Hosted model: DeepSeek"],
	[/^(?:hooks\.slack\.com|discord\.com|discordapp\.com|ntfy\.sh)$/, "Notice"],
];

/** What the server knows of the hosts it uses now: the monitor's, the model's, the notices'. */
export interface KnownHosts {
	monitor?: () => string | undefined;
	models?: () => string[];
	notify?: () => string | undefined;
}

/** The purpose of a request to `url`, in Porchlight's own words. */
export function purposeOf(url: URL, known: KnownHosts = {}): string {
	const host = url.host.toLowerCase();
	if (known.monitor?.() === host) return "Your monitor";
	if (known.notify?.() === host) return "Notice";
	if (known.models?.().includes(host)) return "Model";
	for (const [pattern, purpose] of FIXED) if (pattern.test(url.hostname.toLowerCase())) return purpose;
	if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return "A server on this computer (a local model)";
	return "Other";
}

export class EgressLog {
	private readonly records: EgressRecord[] = [];
	private count = 0;
	private readonly now: () => Date;

	constructor(now: () => Date = () => new Date()) {
		this.now = now;
	}

	add(entry: Omit<EgressRecord, "n" | "at">): EgressRecord {
		this.count += 1;
		const record = { n: this.count, at: this.now().toISOString(), ...entry };
		this.records.push(record);
		if (this.records.length > MAX_RECORDS) this.records.splice(0, this.records.length - MAX_RECORDS);
		return record;
	}

	/** The records after number `since`, oldest first. */
	list(since = 0): EgressRecord[] {
		return this.records.filter((record) => record.n > since);
	}

	/** How many requests went to each host, most first. */
	byHost(): { host: string; purpose: string; requests: number }[] {
		const counts = new Map<string, { host: string; purpose: string; requests: number }>();
		for (const record of this.records) {
			const key = `${record.host}\n${record.purpose}`;
			const entry = counts.get(key) ?? { host: record.host, purpose: record.purpose, requests: 0 };
			entry.requests += 1;
			counts.set(key, entry);
		}
		return [...counts.values()].sort((a, b) => b.requests - a.requests || a.host.localeCompare(b.host, "en"));
	}
}

function urlOf(input: Parameters<typeof fetch>[0]): URL | null {
	try {
		return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
	} catch {
		return null;
	}
}

/**
 * `fetchFn` with each request recorded in `log`. The request itself is passed on untouched, and a
 * record that cannot be made never stops it.
 */
export function loggedFetch(fetchFn: typeof fetch, log: EgressLog, known: KnownHosts = {}): typeof fetch {
	const wrapped = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]): Promise<Response> => {
		const url = urlOf(input);
		const method = (init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET")).toUpperCase();
		let purpose = "Other";
		try {
			if (url) purpose = purposeOf(url, known);
		} catch {
			// What the server knows is not ready yet (a request made while it starts): named "Other".
		}
		const base = { method, host: url ? url.host.toLowerCase() : "(not an address)", purpose };
		try {
			const response = await fetchFn(input, init);
			log.add({ ...base, status: response.status });
			return response;
		} catch (err) {
			log.add({ ...base, failed: true });
			throw err;
		}
	};
	return wrapped as typeof fetch;
}
