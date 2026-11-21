// @ts-check
// Activity: what Porchlight is doing, as it happens. Scans, audits, investigations step by step, and
// every Cloudflare change as it is sent and answered. The lines are Porchlight's own words, kept in
// memory by the server since it started; like everything else they are shown as text, built with h().
import { api } from "./api.js";
import { h, icon, LOCALE, pageVisibility, replace } from "./dom.js";
import { poller } from "./poller.js";
import { egressSection } from "./egress.js";

/** @typedef {import("../src/ui/server.ts").ActivityLine} ActivityLine */

/** Asked again after a second while lines are arriving, then less often while nothing happens, up to 15 seconds (R6O-4). */
const POLL_MS = 1000;
const IDLE_POLL_MS = 15_000;

/**
 * How long to wait before asking again: a second after new lines, doubling while none come, and not
 * at all while the tab is hidden (it asks again when shown).
 *
 * @param {number} previous the wait before
 * @param {boolean} arrived whether the last answer brought lines
 */
export function nextPoll(previous, arrived) {
	return arrived ? POLL_MS : Math.min(IDLE_POLL_MS, previous * 2);
}
const ICONS = /** @type {const} */ ({ info: "minus", good: "good", warning: "warning" });

/** The time of day, to the second: a log is read by the clock. @param {string} iso */
export function clock(iso) {
	const at = new Date(iso);
	return Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString(LOCALE, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

/**
 * A live list of activity lines, newest last, that follows the server until `stop` is called. It is a
 * log (`role="log"`): new lines are added at the end and the oldest dropped from the top, so a screen
 * reader hears each new line once rather than the whole list again (I-U2).
 *
 * @param {{ limit?: number, since?: number, empty?: string }} [options] `since`: only lines after this number
 * @returns {{ node: HTMLElement, stop: () => void }}
 */
export function activityList(options = {}) {
	const limit = options.limit ?? 400;
	const list = h("ol", { class: "activity-list", role: "log", "aria-label": "Activity" });
	const node = h("div", { class: "activity" }, list);
	const empty = h("li", { class: "activity-empty hint" }, options.empty ?? "Nothing has happened yet.");
	list.append(empty);
	let last = options.since ?? 0;
	let wait = POLL_MS;

	/** @param {ActivityLine[]} lines */
	const add = (lines) => {
		// Stay at the bottom while the reader is there; leave them alone once they scroll up.
		const following = node.scrollHeight - node.scrollTop - node.clientHeight < 40;
		empty.remove();
		for (const line of lines) {
			list.append(h("li", { class: `activity-line activity-${line.kind}` }, h("time", { datetime: line.at }, clock(line.at)), icon(ICONS[line.kind] ?? "minus"), h("span", null, line.text)));
		}
		while (list.childElementCount > limit) list.firstElementChild?.remove();
		if (following) node.scrollTop = node.scrollHeight;
	};

	const follow = poller({
		every: POLL_MS,
		// The server keeps its lines in memory: a missed poll is made up by the next one, so it never gives up.
		tries: Number.POSITIVE_INFINITY,
		maxWait: IDLE_POLL_MS,
		visibility: pageVisibility(),
		run: async () => {
			const answer = await api("GET", `/activity?after=${last}`);
			// Porchlight started again (a service with a fixed key): its lines start again from 1 (UI-B12).
			if (typeof answer.last === "number" && answer.last < last) {
				last = 0;
				return 0;
			}
			const lines = Array.isArray(answer.lines) ? /** @type {ActivityLine[]} */ (answer.lines) : [];
			if (lines.length > 0) {
				add(lines);
				last = lines.at(-1)?.n ?? last;
			}
			wait = nextPoll(wait, lines.length > 0);
			return wait;
		},
	});
	follow.now();
	return { node, stop: () => follow.stop() };
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
			egressSection(),
		),
	);
	return () => live.stop();
}
