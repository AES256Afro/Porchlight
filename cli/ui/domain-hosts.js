// @ts-check
// A domain's subdomain inventory (R6F-5): every name the monitor's latest scan holds, learnt from the
// certificate log and DNS, never guessed. Asked for when the owner opens it, a page at a time; the
// monitor answers from its database, so this makes no request about the domain.
import { api } from "./api.js";
import { banner, formatDay, formatNumber, formatWhen, h, hostName, pager, plural, replace } from "./dom.js";

/** @typedef {import("../../monitor/src/types.ts").HostsPage} HostsPage */
/** @typedef {import("../../monitor/src/types.ts").HostView} HostView */

/** Rows on one page here; the monitor sends 200 a page, which this page shows in parts. */
const ROWS = 25;

/**
 * What its one `GET /` answered, in words. Not made is said as not made (invariant 5).
 *
 * @param {HostView} host
 */
export function httpsWords(host) {
	if (host.https === null) return host.probed ? "No address to ask" : "Not checked this time";
	return host.https.ok ? `HTTP ${host.https.status}` : `Failed: ${host.https.error}`;
}

/**
 * Its aliases and addresses, or why there are none. A failed lookup is never "none" (invariant 5).
 *
 * @param {HostView} host
 * @returns {string[]}
 */
export function dnsWords(host) {
	if (host.dns === null) return [host.probed ? "Lookup failed" : "Not checked this time"];
	const values = [...host.dns.cname.map((name) => `alias of ${name}`), ...host.dns.a, ...host.dns.aaaa];
	return values.length > 0 ? values : ["No records"];
}

/**
 * The page of rows to show, and which of the monitor's pages holds it.
 *
 * @param {number} page 1-based, on this page
 * @param {number} monitorPageSize
 */
export function hostsWindow(page, monitorPageSize) {
	const start = (page - 1) * ROWS;
	const monitorPage = Math.floor(start / monitorPageSize) + 1;
	return { monitorPage, offset: start - (monitorPage - 1) * monitorPageSize, rows: ROWS };
}

/**
 * The inventory, folded away until opened.
 *
 * @param {string} domain
 * @param {number} count the names the latest report counted
 */
export function hostsSection(domain, count) {
	const body = h("div", { class: "domain-hosts-body" });
	/** @type {Map<number, HostsPage>} */
	const fetched = new Map();
	let pageSize = 200;
	let started = false;
	const details = /** @type {HTMLDetailsElement} */ (
		h(
			"details",
			{
				class: "options domain-hosts",
				ontoggle: () => {
					if (!details.open || started) return;
					started = true;
					void show(1);
				},
			},
			h("summary", null, `Hosts (${plural(count, "name", "names")})`),
			body,
		)
	);
	return details;

	/** @param {number} page */
	async function show(page) {
		replace(body, h("p", { class: "hint" }, "Loading the names…"));
		let window = hostsWindow(page, pageSize);
		try {
			if (!fetched.has(1)) {
				const first = /** @type {HostsPage} */ ((await api("GET", `/domains/${encodeURIComponent(domain)}/hosts`)).hosts);
				fetched.set(1, first);
				pageSize = first.pageSize;
				window = hostsWindow(page, pageSize);
			}
			if (!fetched.has(window.monitorPage)) {
				fetched.set(window.monitorPage, /** @type {HostsPage} */ ((await api("GET", `/domains/${encodeURIComponent(domain)}/hosts?page=${window.monitorPage}`)).hosts));
			}
		} catch (err) {
			started = false;
			replace(body, banner("warning", "Could not load the names", [err instanceof Error ? err.message : String(err), "A monitor deployed before it kept them answers \"not found\": deploy it again to see them."]));
			return;
		}
		const first = /** @type {HostsPage} */ (fetched.get(1));
		const part = /** @type {HostsPage} */ (fetched.get(window.monitorPage));
		const rows = part.hosts.slice(window.offset, window.offset + window.rows);
		const pages = Math.max(1, Math.ceil(first.total / ROWS));
		const from = first.total === 0 ? 0 : (page - 1) * ROWS + 1;
		replace(
			body,
			h("p", { class: "hint" }, `${plural(first.total, "name", "names")} from the scan of ${formatWhen(first.takenAt)}, learnt from the certificate log and DNS. No name was guessed, and nothing was asked to list them.`),
			rows.length > 0 ? hostsTable(rows) : h("p", null, "The latest scan holds no names."),
			pages > 1 ? pager({ page, pages, from, to: from + rows.length - 1, total: first.total }, "names", (next) => void show(next)) : null,
			first.gone.length > 0 && page === 1
				? h(
						"div",
						null,
						h("h4", null, `Gone (${formatNumber(first.gone.length)})`),
						h("p", { class: "hint" }, "Still in the certificate log, but DNS no longer answers for them."),
						h("ul", { class: "plain-list tight" }, ...first.gone.map((gone) => h("li", null, hostName(gone.name), ` since ${formatDay(gone.since)}`))),
					)
				: null,
		);
	}
}

/** Whether its DNS cell holds records, shown as code, rather than words about them. @param {HostView} host */
function hasRecords(host) {
	return host.dns !== null && host.dns.a.length + host.dns.aaaa.length + host.dns.cname.length > 0;
}

/** @param {HostView[]} rows */
function hostsTable(rows) {
	return h(
		"div",
		{ class: "table-wrap" },
		h(
			"table",
			{ class: "data hosts-table" },
			h(
				"thead",
				null,
				h(
					"tr",
					null,
					h("th", { scope: "col" }, "Name"),
					h("th", { scope: "col" }, "HTTPS"),
					h("th", { scope: "col" }, "DNS"),
					h("th", { scope: "col" }, "Certificate until"),
					h("th", { scope: "col", class: "num" }, "Open findings"),
				),
			),
			h(
				"tbody",
				null,
				...rows.map((host) =>
					h(
						"tr",
						null,
						h("td", { class: "col-where", title: host.checkedAt ? `Checked ${formatWhen(host.checkedAt)}` : "Not checked in the latest scan" }, hostName(host.name)),
						h("td", null, httpsWords(host)),
						h("td", null, h("ul", { class: "plain-list tight" }, ...dnsWords(host).map((value) => h("li", null, hasRecords(host) ? h("code", null, value) : value)))),
						h("td", null, host.cert ? formatDay(host.cert.notAfter) : "None logged"),
						h("td", { class: "num" }, formatNumber(host.findings)),
					),
				),
			),
		),
	);
}
