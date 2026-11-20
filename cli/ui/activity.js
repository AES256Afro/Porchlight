// @ts-check
// Activity: what Porchlight is doing, as it happens. Scans, audits, investigations step by step, and
// every Cloudflare change as it is sent and answered. The lines are Porchlight's own words, kept in
// memory by the server since it started; like everything else they are shown as text, built with h().
import { api } from "./api.js";
import { h, icon, replace } from "./dom.js";

/** @typedef {import("../src/ui/server.ts").ActivityLine} ActivityLine */

const POLL_MS = 1000;
const ICONS = /** @type {const} */ ({ info: "minus", good: "good", warning: "warning" });

/** The time of day, to the second: a log is read by the clock. @param {string} iso */
export function clock(iso) {
	const at = new Date(iso);
	return Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/**
 * A live list of activity lines, newest last, that follows the server until `stop` is called.
 *
 * @param {{ limit?: number, since?: number, empty?: string }} [options] `since`: only lines after this number
 * @returns {{ node: HTMLElement, stop: () => void }}
 */
export function activityList(options = {}) {
	const limit = options.limit ?? 400;
	const list = h("ol", { class: "activity-list", "aria-live": "polite", "aria-label": "Activity" });
	const node = h("div", { class: "activity" }, list);
	/** @type {ActivityLine[]} */
	let lines = [];
	let last = options.since ?? 0;
	let stopped = false;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;

	const draw = () => {
		// Stay at the bottom while the reader is there; leave them alone once they scroll up.
		const following = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
		replace(
			list,
			...(lines.length === 0
				? [h("li", { class: "activity-empty hint" }, options.empty ?? "Nothing has happened yet.")]
				: lines.map((line) => h("li", { class: `activity-line activity-${line.kind}` }, h("time", { datetime: line.at }, clock(line.at)), icon(ICONS[line.kind] ?? "minus"), h("span", null, line.text)))),
		);
		if (following) node.scrollTop = node.scrollHeight;
	};

	const poll = async () => {
		try {
			const answer = await api("GET", `/activity?after=${last}`);
			if (stopped) return;
			if (Array.isArray(answer.lines) && answer.lines.length > 0) {
				lines = [...lines, ...answer.lines].slice(-limit);
				last = lines.at(-1)?.n ?? last;
				draw();
			}
		} catch {
			// A missed poll is made up by the next one.
		}
		if (!stopped) timer = setTimeout(poll, POLL_MS);
	};
	draw();
	void poll();
	return {
		node,
		stop: () => {
			stopped = true;
			clearTimeout(timer);
		},
	};
}

/**
 * The Activity page.
 *
 * @param {HTMLElement} view
 * @returns {Promise<() => void>}
 */
export async function renderActivity(view) {
	const live = activityList({ empty: "Nothing yet. Start a scan, an audit or an investigation and its steps appear here as they happen." });
	replace(
		view,
		h(
			"section",
			{ class: "page" },
			h(
				"div",
				{ class: "page-head" },
				h(
					"div",
					null,
					h("h1", null, "Activity"),
					h(
						"p",
						{ class: "sub" },
						"What Porchlight is doing, as it happens: scans, Cloudflare audits and each change sent, an investigation step by step, models asked. It covers the time since Porchlight was opened and is not kept; a project's log keeps the main events.",
					),
				),
			),
			h("div", { class: "card full activity-card" }, live.node),
		),
	);
	return () => live.stop();
}
