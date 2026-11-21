import {
	formatFor,
	noticeRequest,
	type Notice,
	type NotifyFormat,
} from "../../cli/src/notify/format.ts";
import { errorMessage, scrubbedError, type AppEnv, type Deps } from "./env.ts";
import { recordAlertDelivery } from "./store.ts";

/**
 * Posts an alert to the configured webhook, in the format its service reads (ALERT_FORMAT, or the
 * one the address shows: Slack, Discord, ntfy; otherwise JSON with `text` and the structured
 * payload). Without a webhook the text goes to the Worker log, so nothing is lost silently, and the
 * domain list says alerts go only there. Each delivery, or why it failed, is recorded for the same
 * list. Returns whether the webhook accepted it.
 *
 * `text`'s first line is the alert's title and the rest its detail.
 */
export async function sendAlert(
	env: AppEnv,
	deps: Deps,
	text: string,
	payload: object = {},
): Promise<boolean> {
	const target = alertTarget(env);
	if (!("url" in target)) {
		if (target.problem) console.error(`${target.problem}; alerts are going to the log only`);
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
	const { headers, body } = noticeRequest(target.format, notice);
	let error: string | null = null;
	try {
		const res = await deps.fetch(target.url, {
			method: "POST",
			headers,
			body,
			signal: AbortSignal.timeout(10_000),
		});
		await res.body?.cancel();
		if (!res.ok) error = `The webhook answered HTTP ${res.status}`;
	} catch (err) {
		error = `The webhook could not be reached: ${scrubbedError(env, err)}`;
	}
	if (error) console.error(`Alert not delivered. ${error}`);
	// Kept so the owner can see it through the API: a failed delivery otherwise reaches only this log.
	await recordAlertDelivery(env.DB, deps.now().toISOString(), error).catch((err) =>
		console.error(`Could not record the alert's delivery: ${errorMessage(err)}`),
	);
	return error === null;
}

/** Where alerts go: a webhook in a format, or the log alone, with why when a webhook was set but cannot be used. */
export type AlertTarget = { url: URL; format: NotifyFormat } | { problem?: string };

export function alertTarget(env: AppEnv): AlertTarget {
	const value = env.ALERT_WEBHOOK_URL?.trim();
	if (!value) return {};
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return { problem: "ALERT_WEBHOOK_URL is not an https URL" };
	}
	if (url.protocol !== "https:") return { problem: "ALERT_WEBHOOK_URL is not an https URL" };
	const format = formatFor(url, env.ALERT_FORMAT);
	if (!format) return { problem: "ALERT_FORMAT must be json, slack, discord or ntfy" };
	return { url, format };
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
