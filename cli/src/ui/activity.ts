// What Porchlight is doing, as it happens, for the page's Activity view: the last MAX_ACTIVITY lines,
// kept in memory only. Like the project log it holds Porchlight's own words and figures, one line
// each: never a key, a token, a secret value, a request's body or a model's text.
import { oneLine } from "../projects/projects.ts";
import type { ActivityLine } from "./types.ts";

const MAX_ACTIVITY = 400;

export function createActivity(loopbackOnly: boolean) {
	const activity: ActivityLine[] = [];
	let activityCount = 0;

	function note(text: string, kind: ActivityLine["kind"] = "info"): void {
		activityCount += 1;
		const line = { n: activityCount, at: new Date().toISOString(), kind, text: oneLine(text).slice(0, 400) };
		activity.push(line);
		// A service's operator reads `docker logs`: each line goes there too, with its time, and nothing more (R6Q-1).
		if (!loopbackOnly) process.stdout.write(`${line.at} ${line.text}\n`);
		if (activity.length > MAX_ACTIVITY) activity.splice(0, activity.length - MAX_ACTIVITY);
	}

	return {
		note,
		/** The lines after line `after`, and the number of the last. */
		since: (after: number) => ({ lines: activity.filter((line) => line.n > after), last: activityCount }),
	};
}
