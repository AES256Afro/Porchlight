import { formatFor, noticeRequest, type Notice } from "../../cli/src/notify/format.ts";
import { errorMessage, type AppEnv, type Deps } from "./env.ts";

/**
 * Posts an alert to the configured webhook, in the format its service reads (ALERT_FORMAT, or the
 * one the address shows: Slack, Discord, ntfy; otherwise JSON with `text` and the structured
 * payload). Without a webhook the text goes to the Worker log, so nothing is lost silently.
 * Returns whether the webhook accepted it.
 *
 * `text`'s first line is the alert's title and the rest its detail.
 */
export async function sendAlert(
	env: AppEnv,
	deps: Deps,
	text: string,
	payload: object = {},
): Promise<boolean> {
	const target = webhookUrl(env.ALERT_WEBHOOK_URL);
	if (!target) {
		console.log(text);
		return false;
	}
	const format = formatFor(target, env.ALERT_FORMAT);
	if (!format) {
		console.error(
			"ALERT_FORMAT must be json, slack, discord or ntfy; alerts are going to the log only",
		);
		console.log(text);
		return false;
	}
	const [title = "Porchlight", ...rest] = text.split("\n");
	const notice: Notice = {
		title,
		lines: rest.filter((line, index) => line !== "" || index > 0),
		urgent: urgent(payload),
		payload,
	};
	const { headers, body } = noticeRequest(format, notice);
	try {
		const res = await deps.fetch(target, {
			method: "POST",
			headers,
			body,
			signal: AbortSignal.timeout(10_000),
		});
		await res.body?.cancel();
		if (!res.ok) console.error(`Alert webhook answered HTTP ${res.status}`);
		return res.ok;
	} catch (err) {
		console.error(`Alert webhook failed: ${errorMessage(err)}`);
		return false;
	}
}

/** A new high finding, failing scans or lost ownership: the alerts a phone should make a noise for. */
function urgent(payload: object): boolean {
	const fields = payload as { status?: unknown; newFindings?: { severity?: unknown }[] };
	if (fields.status === "error" || fields.status === "unverified") return true;
	return (
		Array.isArray(fields.newFindings) &&
		fields.newFindings.some((finding) => finding.severity === "high")
	);
}

function webhookUrl(value: string | undefined): URL | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		if (url.protocol === "https:") return url;
	} catch {
		// Fall through to the warning.
	}
	console.error("ALERT_WEBHOOK_URL is not an https URL; alerts are going to the log only");
	return null;
}
