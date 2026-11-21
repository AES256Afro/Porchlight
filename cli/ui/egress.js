// @ts-check
// The egress log on the Activity page (R6F-3): every request Porchlight's server has sent out since it
// started, by host and purpose. The server keeps hosts, methods, purposes, times and statuses only,
// never a path, a body, a key or a token; the page shows them as text.
import { api } from "./api.js";
import { formatNumber, h, replace } from "./dom.js";
import { clock } from "./activity.js";

/** @typedef {import("../src/egress.ts").EgressRecord} EgressRecord */

/** The card: requests by host, the latest requests, and a button to look again. */
export function egressSection() {
	const body = h("div", null, h("p", { class: "loading" }, "Loading…"));
	const section = h(
		"section",
		{ class: "card full", "aria-labelledby": "egress-title" },
		h("h2", { id: "egress-title" }, "What left this computer"),
		h(
			"p",
			{ class: "sub" },
			"Every request Porchlight's server sent out since it started: where to, why, and the answer's status. Never what was sent. Programs it runs (git, osv-scanner, softwareupdate) make their own requests, which are not listed; an investigation lists each of its requests in its own steps.",
		),
		body,
		h("div", { class: "actions" }, h("button", { type: "button", class: "button", onclick: () => void draw() }, "Look again")),
	);
	void draw();
	return section;

	async function draw() {
		try {
			const answer = /** @type {{ records: EgressRecord[], byHost: { host: string, purpose: string, requests: number }[] }} */ (await api("GET", "/egress"));
			if (answer.records.length === 0) return replace(body, h("p", null, "Nothing yet: Porchlight has sent no request since it started."));
			replace(
				body,
				h(
					"table",
					{ class: "table" },
					h("thead", null, h("tr", null, h("th", { scope: "col" }, "Host"), h("th", { scope: "col" }, "Why"), h("th", { scope: "col" }, "Requests"))),
					h("tbody", null, ...answer.byHost.map((row) => h("tr", null, h("td", { class: "mono" }, row.host), h("td", null, row.purpose), h("td", null, formatNumber(row.requests))))),
				),
				h(
					"details",
					null,
					h("summary", null, `The last ${formatNumber(Math.min(answer.records.length, 100))} requests`),
					h(
						"ul",
						{ class: "plain-list" },
						...answer.records
							.slice(-100)
							.reverse()
							.map((record) => h("li", null, h("span", { class: "mono" }, `${clock(record.at)} ${record.method} ${record.host}`), ` ${record.purpose}, `, record.failed ? "no answer" : `HTTP ${record.status}`)),
					),
				),
			);
		} catch (err) {
			replace(body, h("p", { class: "form-error" }, err instanceof Error ? err.message : String(err)));
		}
	}
}
