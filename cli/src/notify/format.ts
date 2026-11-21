// How a notice is sent to where the owner reads it: a plain JSON webhook, Slack, Discord or ntfy.
// No imports and no I/O, so the monitor (a Cloudflare Worker) and the CLI's container share it: the
// escaping each service needs lives here once.
//
// A notice carries hosts, DNS values, file paths and titles, which someone else may control. So in
// every format the text is shown as text: Slack's and Discord's markup is disarmed by putting the
// lines in code blocks that nothing in them can close (one a section, under a heading of Porchlight's
// own words, see `sections`), mentions are switched off, and ntfy gets
// plain text with only fixed words in its headers.

export type NotifyFormat = "json" | "slack" | "discord" | "ntfy";

export const NOTIFY_FORMATS: readonly NotifyFormat[] = ["json", "slack", "discord", "ntfy"];

export interface Notice {
	/** One line: what happened, such as "Porchlight: example.com: 2 new findings". */
	title: string;
	/** The detail, one line each. */
	lines: string[];
	/** Something that wants looking at soon: a high finding, failures, lost ownership. */
	urgent: boolean;
	/** Sent as it is, beside `text`, in the JSON format only: what a script reading it needs. */
	payload?: object;
}

export interface NotifyRequest {
	headers: Record<string, string>;
	body: string;
}

/**
 * The longest message each service takes, in the unit it counts: Discord's 2,000 characters of
 * content, ntfy's 4,096 bytes of body (a CJK file name is three bytes a character), and our own
 * caps for Slack's text and the JSON `text`. A longer notice is cut, saying so. Measured on the
 * message as sent, after escaping, which can lengthen it several times over.
 */
const LIMITS: Record<NotifyFormat, { max: number; measure: (text: string) => number }> = {
	json: { max: 100_000, measure: (text) => text.length },
	slack: { max: 3_500, measure: (text) => text.length },
	discord: { max: 2_000, measure: (text) => text.length },
	ntfy: { max: 4_096, measure: (text) => new TextEncoder().encode(text).length },
};

/**
 * The format for a webhook address: the one asked for, or else the one its host shows (Slack's and
 * Discord's webhooks, ntfy.sh). Null when the one asked for is not a format, so the caller can say so.
 */
export function formatFor(url: URL, asked?: string): NotifyFormat | null {
	const wanted = asked?.trim().toLowerCase();
	if (wanted) return (NOTIFY_FORMATS as readonly string[]).includes(wanted) ? (wanted as NotifyFormat) : null;
	const host = url.hostname.toLowerCase();
	if (host === "hooks.slack.com") return "slack";
	if ((host === "discord.com" || host === "discordapp.com") && url.pathname.startsWith("/api/webhooks/")) return "discord";
	if (host === "ntfy.sh") return "ntfy";
	return "json";
}

/**
 * Where a notice may be sent: https anywhere, and plain http only to this machine or the owner's own
 * network (an ntfy server on the same box, a NAS), never across the internet unencrypted. Null when
 * the address may not be used.
 */
export function notifyTarget(value: string | undefined): URL | null {
	if (!value?.trim()) return null;
	let url: URL;
	try {
		url = new URL(value.trim());
	} catch {
		return null;
	}
	if (url.username || url.password) return null;
	if (url.protocol === "https:") return url;
	if (url.protocol !== "http:") return null;
	return onOwnNetwork(url.hostname.toLowerCase()) ? url : null;
}

/**
 * Whether `host` (a URL's hostname, so an IPv4 address is already in dotted decimal and an IPv6
 * one in brackets) is this machine or a private network. An address counts only when it is one:
 * `10.example.com` is a name like any other, and goes across the internet.
 */
function onOwnNetwork(host: string): boolean {
	const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 100 && b >= 64 && b <= 127);
	}
	if (host.startsWith("[")) {
		const v6 = host.slice(1, -1);
		if (v6 === "::1") return true;
		// The first group as a number: "fd00::5" is fd00, but "fc::1" is 00fc, which is not private.
		const first = v6.startsWith("::") ? 0 : Number.parseInt(v6.split(":")[0]!, 16);
		// Unique local addresses (fc00::/7) and link-local ones (fe80::/10).
		return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
	}
	// A name of one label (http://nas:8080/) is found on the local network or the search domains set
	// there, never in public DNS; so are the names reserved or kept for home and private networks.
	if (!host.includes(".")) return true;
	return host === "host.docker.internal" || [".local", ".internal", ".ts.net", ".lan", ".home.arpa"].some((suffix) => host.endsWith(suffix));
}

/** A notice address and format that can be used, or why they cannot, in words fit to show the owner. */
export type NotifySetting = { url: URL; format: NotifyFormat } | { problem: string };

/**
 * The notice address (PORCHLIGHT_NOTIFY_URL) and format (PORCHLIGHT_NOTIFY_FORMAT, or the one the
 * address shows) as read at start-up. Undefined when no address is given. The problem never repeats
 * the address, which may hold a token.
 */
export function notifySetting(address: string | undefined, format: string | undefined): NotifySetting | undefined {
	if (!address?.trim()) return undefined;
	const url = notifyTarget(address);
	if (!url) return { problem: "PORCHLIGHT_NOTIFY_URL must be an https address, or plain http on this machine or the local network, with no user name or password" };
	const chosen = formatFor(url, format);
	if (!chosen) return { problem: `PORCHLIGHT_NOTIFY_FORMAT must be one of: ${NOTIFY_FORMATS.join(", ")}, or empty` };
	return { url, format: chosen };
}

/**
 * The headers and body to POST for `notice` in `format`, within the service's limit: as many lines
 * as fit once escaped, then a line saying how many were left out.
 */
export function noticeRequest(format: NotifyFormat, notice: Notice): NotifyRequest {
	const title = oneLine(notice.title).slice(0, 300);
	const lines = notice.lines.map(oneLine).map((line) => (line.length > 500 ? `${line.slice(0, 497)}...` : line));
	const { max, measure } = LIMITS[format];
	const build = (kept: number) => {
		const rendered = render(format, title, withRest(lines, kept), notice);
		return { rendered, fits: measure(rendered.measured) <= max };
	};
	// The most lines that fit. Each line kept makes the message longer, so the search can halve.
	let low = 0;
	let high = lines.length;
	while (low < high) {
		const mid = Math.ceil((low + high) / 2);
		if (build(mid).fits) low = mid;
		else high = mid - 1;
	}
	// The count of lines left out has its own length, so step back until the message truly fits.
	let best = build(low);
	while (!best.fits && low > 0) best = build(--low);
	return best.rendered.request;
}

/** The first `kept` lines, and a line saying how many more there were. */
function withRest(lines: string[], kept: number): string {
	const left = lines.length - kept;
	const shown = lines.slice(0, kept);
	if (left > 0) shown.push(`... and ${left} more ${left === 1 ? "line" : "lines"}`);
	return shown.join("\n");
}

/** The request for one body, and the text the service's limit applies to. */
function render(format: NotifyFormat, title: string, body: string, notice: Notice): { request: NotifyRequest; measured: string } {
	switch (format) {
		case "slack": {
			// Slack reads &, < and > as markup (<!channel>, <url|text>), even inside a code block.
			const text = [`*${slackText(title)}*`, ...sections(body).map(({ heading, text }) => `${heading ? `*${slackText(heading)}*\n` : ""}\`\`\`\n${slackText(fenceSafe(text))}\n\`\`\``)].join("\n");
			return { request: json({ text }), measured: text };
		}
		case "discord": {
			const content = [`**${discordText(title)}**`, ...sections(body).map(({ heading, text }) => `${heading ? `**${discordText(heading)}**\n` : ""}\`\`\`\n${fenceSafe(text)}\n\`\`\``)].join("\n");
			// A DNS value saying "@everyone" must not ping anyone.
			return { request: json({ content, allowed_mentions: { parse: [] } }), measured: content };
		}
		case "ntfy": {
			// Plain text unless ntfy is told otherwise; the headers hold fixed words and the title, cut to ASCII.
			const text = body || title;
			return {
				request: {
					headers: {
						"content-type": "text/plain; charset=utf-8",
						title: title.replace(/[^\x20-\x7e]/g, "?").slice(0, 200),
						priority: notice.urgent ? "high" : "default",
						tags: notice.urgent ? "rotating_light" : "mag",
					},
					body: text,
				},
				measured: text,
			};
		}
		default: {
			const text = chatSafe([title, ...(body ? ["", body] : [])].join("\n"));
			return { request: json({ text, ...(notice.payload ?? {}) }), measured: text };
		}
	}
}

function json(value: unknown): NotifyRequest {
	return { headers: { "content-type": "application/json" }, body: JSON.stringify(value) };
}

/** Control characters out, so a value cannot rewrite a line in a terminal-style client or add one. */
function oneLine(text: string): string {
	// Line and paragraph separators too: some clients break a line at them (S38).
	return text.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ");
}

/**
 * The JSON format goes to any webhook, and Mattermost, Rocket.Chat and Google Chat render its `text` as
 * Markdown: a file named `@channel ![](https://x.example/p).env` would ping everyone and load an image
 * from someone else's server (S52). A zero-width space after each `@` and `<`, and between `]` and `(`,
 * leaves the text as it reads while no mention, link, image or tag can be formed from it.
 */
function chatSafe(text: string): string {
	return text.replace(/@/g, "@\u200b").replace(/</g, "<\u200b").replace(/\]\(/g, "]\u200b(");
}

/**
 * A notice's body as Slack and Discord show it (R6V-4): each paragraph a section of its own, in its own
 * code block. A paragraph whose first line is a heading in Porchlight's own words ("New findings",
 * "Fixed:") with indented lines under it shows that heading in bold above its block. A heading is
 * recognised by its shape, never trusted for its source: letters, digits, spaces and commas, with no
 * dot, slash, `@`, `<` or other character a link or a mention needs, so data that looks like one still
 * cannot form either; it is escaped as the title is all the same. Everything else stays in a block.
 */
export function sections(body: string): { heading?: string; text: string }[] {
	if (!body) return [];
	const parts: { heading?: string; text: string }[] = body
		.split(/\n{2,}/)
		.filter((part) => part.trim() !== "")
		.map((part) => {
			const [first = "", ...rest] = part.split("\n");
			if (rest.length > 0 && HEADING.test(first) && rest.every((line) => line.startsWith("  ") || /^\.\.\. and \d+ more lines?$/.test(line))) return { heading: first.replace(/:$/, ""), text: rest.join("\n") };
			return { text: part };
		});
	// Paragraphs with no heading of their own, one after another, share one block.
	const merged: { heading?: string; text: string }[] = [];
	for (const part of parts) {
		const last = merged.at(-1);
		if (last && part.heading === undefined && last.heading === undefined) last.text = `${last.text}\n\n${part.text}`;
		else merged.push({ ...part });
	}
	return merged;
}

/** A heading's shape: Porchlight's fixed words, short, with nothing a link or a mention could be made of. */
const HEADING = /^[A-Z][A-Za-z0-9 ,'-]{0,79}:?$/;

/** Three backticks would end the code block early; the text keeps its meaning with them broken up. */
function fenceSafe(text: string): string {
	return text.replace(/`{3,}/g, (run) => run.split("").join("​"));
}

function slackText(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Discord's markup characters, escaped in the one line not in a code block. */
function discordText(text: string): string {
	return text.replace(/[\\*_~`|>#[\]()@]/g, "\\$&");
}
