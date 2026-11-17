import { errorMessage, type AppEnv, type Deps } from "./env.ts";

/**
 * Posts `text` and the structured `payload` to the configured webhook as JSON.
 * Without a webhook the text goes to the Worker log, so nothing is lost
 * silently. Returns whether the webhook accepted it.
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
	try {
		const res = await deps.fetch(target, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ text, ...payload }),
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
