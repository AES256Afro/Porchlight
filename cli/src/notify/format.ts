// How a notice is sent to where the owner reads it: a plain JSON webhook, Slack, Discord or ntfy.
// No imports and no I/O, so the monitor (a Cloudflare Worker) and the CLI's container share it: the
// escaping each service needs lives here once.
//
// A notice carries hosts, DNS values, file paths and titles, which someone else may control. So in
// every format the text is shown as text: Slack's and Discord's markup is disarmed by putting the
// lines in a code block that nothing in them can close, mentions are switched off, and ntfy gets
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

/** The longest message each service takes; a longer notice is cut, saying so. */
const LIMITS: Record<NotifyFormat, number> = { json: 100_000, slack: 3_500, discord: 1_900, ntfy: 3_800 };

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
 * Where a notice may be sent: https anywhere, and plain http only to this machine or a private
 * network address (an ntfy server on the same box), never across the internet unencrypted. Null when
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
	const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
	const privateV4 = /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(host);
	const local = host === "localhost" || host === "::1" || host === "host.docker.internal" || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".ts.net");
	return privateV4 || local ? url : null;
}

/** The headers and body to POST for `notice` in `format`. */
export function noticeRequest(format: NotifyFormat, notice: Notice): NotifyRequest {
	const title = oneLine(notice.title);
	const body = cut(notice.lines.map(oneLine), LIMITS[format] - title.length - 40);
	switch (format) {
		case "slack":
			// Slack reads &, < and > as markup (<!channel>, <url|text>), even inside a code block.
			return json({ text: `*${slackText(title)}*${body ? `\n\`\`\`\n${slackText(fenceSafe(body))}\n\`\`\`` : ""}` });
		case "discord":
			return json({
				content: `**${discordText(title)}**${body ? `\n\`\`\`\n${fenceSafe(body)}\n\`\`\`` : ""}`,
				// A DNS value saying "@everyone" must not ping anyone.
				allowed_mentions: { parse: [] },
			});
		case "ntfy":
			// Plain text unless ntfy is told otherwise; the headers hold fixed words and the title, cut to ASCII.
			return {
				headers: {
					"content-type": "text/plain; charset=utf-8",
					title: title.replace(/[^\x20-\x7e]/g, "?").slice(0, 200),
					priority: notice.urgent ? "high" : "default",
					tags: notice.urgent ? "rotating_light" : "mag",
				},
				body: body || title,
			};
		default:
			return json({ text: chatSafe([title, ...(body ? ["", body] : [])].join("\n")), ...(notice.payload ?? {}) });
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

/** The lines, cut at a line's end once they pass `limit` characters, saying how many were left out. */
function cut(lines: string[], limit: number): string {
	const kept: string[] = [];
	let size = 0;
	for (const [index, line] of lines.entries()) {
		const short = line.length > 500 ? `${line.slice(0, 497)}...` : line;
		if (size + short.length + 1 > limit) {
			kept.push(`... and ${lines.length - index} more ${lines.length - index === 1 ? "line" : "lines"}`);
			break;
		}
		kept.push(short);
		size += short.length + 1;
	}
	return kept.join("\n");
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
