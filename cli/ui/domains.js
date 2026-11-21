// @ts-check
import { api, ApiError } from "./api.js";
import { assistAction } from "./assist.js";
import { banner, copyButton, formatNumber, formatWhen, h, icon, isOff, pager, plural, replace, setOff, severityBadge, shownText, statTile, stepNodes, tileRow, toast } from "./dom.js";
import { exportButton, openExportDialog } from "./export.js";
import { domainFromInput, monitorSetupSteps, monitorStatusWords, overdueDomains } from "./hints.js";
import { paginate } from "./list.js";

const WATCHES = "Watches the domains you own for new subdomains, DNS changes, expiring certificates and missing security headers. It only looks at what is public.";

// The monitor's own types (monitor/src/types.ts). errorStreak and openFindings are absent from a monitor deployed before they were added.
/** @typedef {Omit<import("../../monitor/src/types.ts").DomainView, "errorStreak" | "openFindings"> & { errorStreak?: number, openFindings?: import("../../monitor/src/types.ts").DomainView["openFindings"] }} Domain */
/** @typedef {import("../../monitor/src/types.ts").Finding} MonitorFinding */
/** @typedef {import("../../monitor/src/types.ts").Change} Change */
/** @typedef {import("../../monitor/src/types.ts").ScanReport} MonitorReport */
/** @typedef {import("../../monitor/src/types.ts").HistoryEntry} HistoryEntry */

/** Rows of a domain's open findings on one page, and kept scans in its history. */
const PAGE_SIZE = 25;
const HISTORY_PAGE = 10;

/**
 * The Domains page: register domains with the monitor, prove ownership, scan, and read what changed.
 *
 * @param {HTMLElement} view
 * @param {import("./finding-parts.js").Route} route the domain named in the address, if any, is its second part
 * @returns {Promise<() => void>}
 */
export async function renderDomains(view, route) {
	const selected = route.path[1];
	let page = Number(route.params.get("page")) || 1;
	let historyPage = 1;
	const state = await api("GET", "/state");
	if (!state.monitor.configured) {
		replace(view, notConnected(state.monitor, state.service === true));
		return () => {};
	}

	/** @type {Domain[]} */
	let domains = [];
	/** Where alerts go and what last went wrong, from the monitor itself. */
	const monitorSlot = h("div");
	const list = h("ul", { class: "domain-list", "aria-label": "Domains" });
	const detail = h("div", { class: "detail" });
	const addProblem = h("p", { class: "form-error", id: "add-domain-problem", role: "alert", hidden: true });
	const input = /** @type {HTMLInputElement} */ (
		h("input", {
			type: "text",
			name: "domain",
			placeholder: "example.com",
			spellcheck: false,
			autocomplete: "off",
			required: true,
			"aria-label": "Domain to add, such as example.com",
			"aria-describedby": "add-domain-problem",
		})
	);
	/** What the last Check DNS record or Scan now said, shown on the domain until the next one. @type {{ domain: string, ok: boolean, text: string } | null} */
	let outcome = null;

	replace(
		view,
		h(
			"section",
			{ class: "page" },
			h(
				"div",
				{ class: "page-head" },
				h("div", null, h("h1", null, "Domains"), h("p", { class: "sub" }, `The domains you own, scanned by your monitor at ${state.monitor.host}.`)),
				h(
					"form",
					{ class: "add-domain", onsubmit: addDomain },
					h("div", { class: "inline-form" }, h("div", { class: "field grow" }, input), h("button", { type: "submit", class: "button primary" }, "Add a domain")),
					addProblem,
				),
			),
			monitorSlot,
			h("div", { class: "split" }, list, detail),
		),
	);

	// A monitor that cannot be reached shows its error, and nothing else: not "No domains yet".
	if (!(await refreshList())) return () => {};
	if (!selected && domains[0]) {
		// Changing the address re-renders this page with that domain selected, unless the owner has moved on meanwhile (B43).
		if (route.isCurrent()) location.replace(`#/domains/${encodeURIComponent(domains[0].name)}`);
		return () => {};
	}
	await showDetail();
	return () => {};

	/**
	 * Lists the monitor's domains. When the monitor cannot be reached the list is
	 * left empty and the error is shown in its place: an unreachable monitor
	 * says nothing about whether any domains are registered.
	 *
	 * @returns {Promise<boolean>} whether the list was loaded
	 */
	async function refreshList() {
		try {
			const answer = await api("GET", "/domains");
			domains = answer.domains;
			// Past 144 domains the monitor falls behind; this says so rather than leave it to each row's date (QL-8).
			const overdue = overdueDomains(domains);
			replace(monitorSlot, monitorStatusCard(answer.status), overdue ? banner("warning", "Some domains are overdue", [overdue.words]) : null);
		} catch (err) {
			domains = [];
			replace(list);
			// The monitor answered, and said no: waiting will not help, the right token will.
			if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
				replace(
					detail,
					banner("error", "Your monitor refused the admin token", [
						"The token Porchlight sends is not the one the monitor was given when it was deployed, so it shows nothing.",
						"The monitor's token is the ADMIN_TOKEN line of the file it was deployed with, .secrets.production in the project's monitor folder.",
					]),
					h("p", null, h("a", { class: "button primary", href: "#/settings/monitor" }, "Paste the right token in Settings")),
				);
				return false;
			}
			replace(detail, banner("error", "Could not load domains", [message(err), "Nothing is shown until the monitor answers. Try again in a moment."]));
			return false;
		}
		replace(
			list,
			...domains.map((domain) =>
				h(
					"li",
					null,
					h(
						"a",
						{ href: `#/domains/${domain.name}`, "aria-current": domain.name === selected ? "page" : null },
						h("span", { class: "domain-name" }, domain.name),
						statusPill(domain),
						openCount(domain),
						h("span", { class: "domain-meta" }, domain.lastScanAt ? `Scanned ${formatWhen(domain.lastScanAt)}` : "Never scanned"),
					),
				),
			),
		);
		if (domains.length === 0) {
			replace(
				detail,
				h(
					"div",
					{ class: "empty" },
					h("h2", null, "Add your first domain"),
					h("p", null, "Type its name above, such as example.com, and choose Add a domain."),
					h(
						"ol",
						{ class: "steps left" },
						h("li", null, h("strong", null, "Add it."), " One domain covers its subdomains too."),
						h("li", null, h("strong", null, "Prove it is yours."), " You are given one DNS record to add where the domain is managed. Nothing is checked before that."),
						h("li", null, h("strong", null, "Scan."), " The first scan records how things are now. After that the monitor checks each domain once a day and shows what changed."),
					),
				),
			);
		}
		return true;
	}

	/** @param {SubmitEvent} event */
	async function addDomain(event) {
		event.preventDefault();
		// People paste a whole address; the monitor wants the name alone.
		const name = domainFromInput(input.value);
		const problem = (/** @type {string} */ text) => {
			replace(addProblem, text);
			addProblem.hidden = false;
			input.setAttribute("aria-invalid", "true");
			input.focus();
		};
		addProblem.hidden = true;
		input.removeAttribute("aria-invalid");
		if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name)) return problem(`"${input.value.trim()}" is not a domain name. Type one such as example.com.`);
		try {
			const { domain } = await api("POST", "/domains", { domain: name });
			input.value = "";
			if (domain.name === selected) await refreshList().then(showDetail);
			else if (route.isCurrent()) location.hash = `#/domains/${encodeURIComponent(domain.name)}`;
		} catch (err) {
			// The monitor's own wording is for its API; a refused name is said in the page's words.
			problem(err instanceof ApiError && err.status === 400 ? `The monitor did not accept "${name}" as a domain name. Type one such as example.com.` : message(err));
		}
	}

	async function showDetail() {
		if (!selected) return;
		/** @type {{ domain: Domain, report: MonitorReport | null, suggestions?: Record<string, { title: string, how: string[] }> }} */
		let data;
		try {
			data = /** @type {any} */ (await api("GET", `/domains/${encodeURIComponent(selected)}`));
		} catch (err) {
			const missing = err instanceof ApiError && err.status === 404;
			replace(detail, missing ? h("div", { class: "empty" }, h("h2", null, "Domain not found"), h("p", null, `${selected} is not registered with the monitor.`)) : banner("error", "Could not load this domain", [message(err)]));
			return;
		}
		const { domain, report } = data;
		const suggestions = data.suggestions ?? {};
		// Filled in when it arrives, so the report is not held up. A monitor deployed before it kept
		// history this way answers "not found", and then nothing is shown.
		const historySlot = h("div");
		if (report) {
			void api("GET", `/domains/${encodeURIComponent(domain.name)}/history`)
				.then((answer) => {
					const kept = /** @type {HistoryEntry[]} */ (answer.history ?? []);
					const draw = () =>
						replace(
							historySlot,
							historyView(kept, historyPage, (next) => {
								historyPage = next;
								draw();
							}),
						);
					draw();
				})
				.catch(() => {});
		}
		const everVerified = domain.verifiedAt !== null;

		const scanButton = /** @type {HTMLButtonElement} */ (
			h(
				"button",
				{
					type: "button",
					class: "button primary",
					"aria-disabled": everVerified ? null : "true",
					title: everVerified ? null : "Scanning starts once the ownership record is found",
					onclick: () => act(scanButton, "Scanning…", "scan"),
				},
				"Scan now",
			)
		);
		const verifyButton = /** @type {HTMLButtonElement} */ (
			h("button", { type: "button", class: "button", onclick: () => act(verifyButton, "Checking DNS…", "verify") }, "Check DNS record")
		);
		/** @type {import("./generated.js").AssistantSettings | undefined} */
		const assistant = state.assistant;
		const explain =
			report && assistant?.configured
				? assistAction(
						`domain\n${domain.name}\n${report.takenAt}`,
						"/assist/domain",
						assistant,
						{ start: "Explain changes", busy: "Explaining…", again: "Explain again" },
						() => ({ domain: domain.name }),
					)
				: null;

		replace(
			detail,
			h(
				"div",
				{ class: "detail-head" },
				h("div", null, h("h2", null, domain.name), statusPill(domain)),
				h(
					"div",
					{ class: "actions" },
					scanButton,
					explain?.button,
					report && report.findings.length > 0 ? exportButton(() => openExportDialog({ domain: domain.name })) : null,
					h("button", { type: "button", class: "button danger", onclick: () => confirmRemove(domain.name) }, "Remove"),
				),
			),
			report ? null : journey(everVerified ? 3 : 2),
			outcome && outcome.domain === domain.name
				? h("p", { class: outcome.ok ? "outcome outcome-good" : "outcome form-error", role: outcome.ok ? "status" : "alert" }, icon(outcome.ok ? "good" : "warning"), outcome.text)
				: null,
			// Why the last scan failed, as the monitor kept it, until a scan succeeds.
			domain.lastScanStatus === "error"
				? banner("warning", (domain.errorStreak ?? 0) > 1 ? `The last ${domain.errorStreak} scans failed` : "The last scan failed", [
						domain.lastError ?? "The monitor did not say why.",
						...(report ? ["The report below is from the last scan that worked."] : []),
					])
				: null,
			domain.verified ? null : challengeCard(domain, verifyButton),
			explain?.panel,
			report
				? reportView(report, suggestions, page, (next) => {
						page = next;
						route.replace({ page: page > 1 ? page : undefined });
						void showDetail().then(() => /** @type {HTMLElement | null} */ (detail.querySelector("#domain-open-title"))?.focus());
					})
				: h(
						"div",
						{ class: "empty" },
						h("h2", null, everVerified ? "Ready for its first scan" : "Not scanned yet"),
						h("p", null, everVerified ? "Choose Scan now. The first scan records how things are today; later scans show what changed." : "Add the DNS record above, then choose Check DNS record. Scanning starts once it is found."),
					),
			historySlot,
		);

		/**
		 * @param {HTMLButtonElement} button
		 * @param {string} busyLabel
		 * @param {"scan" | "verify"} action
		 */
		async function act(button, busyLabel, action) {
			// aria-disabled, not disabled: a disabled button drops keyboard focus, and the owner may want to try again.
			if (isOff(button)) return;
			const label = button.textContent;
			setOff(button, true);
			button.textContent = busyLabel;
			// The result is said on the page, beside what it is about, until the next check: a DNS record
			// that is not there yet is the usual answer, and it needs reading, not a toast that leaves.
			try {
				await api("POST", `/domains/${encodeURIComponent(domain.name)}/${action}`);
				outcome = { domain: domain.name, ok: true, text: action === "scan" ? `Scanned ${domain.name}.` : `${domain.name} is verified. Keep the DNS record in place: it is checked again before every scan.` };
			} catch (err) {
				outcome = { domain: domain.name, ok: false, text: message(err) };
			}
			button.textContent = label;
			await refreshList();
			await showDetail();
		}
	}

	/** @param {string} name */
	function confirmRemove(name) {
		const dialog = /** @type {HTMLDialogElement} */ (
			h(
				"dialog",
				{ class: "dialog", "aria-labelledby": "remove-title", onclose: () => dialog.remove() },
				h("h2", { id: "remove-title" }, `Remove ${name}?`),
				h("p", null, "The monitor will stop scanning it and delete its scan history. This cannot be undone."),
				h(
					"div",
					{ class: "actions" },
					h("button", { type: "button", class: "button", autofocus: true, onclick: () => dialog.close() }, "Cancel"),
					h(
						"button",
						{
							type: "button",
							class: "button danger solid",
							onclick: async () => {
								dialog.close();
								try {
									await api("DELETE", `/domains/${encodeURIComponent(name)}`);
									toast(`Removed ${name}`);
									if (route.isCurrent()) location.hash = "#/domains";
								} catch (err) {
									toast(message(err), "error");
								}
							},
						},
						"Remove domain",
					),
				),
			)
		);
		document.body.append(dialog);
		dialog.showModal();
	}
}

/** @param {unknown} err */
function message(err) {
	return err instanceof Error ? err.message : String(err);
}

/** @param {Domain} domain */
function statusPill(domain) {
	if (domain.lastScanStatus === "unverified") return h("span", { class: "severity status-warning" }, icon("warning"), "Ownership check failed");
	if (!domain.verified) return h("span", { class: "severity status-pending" }, icon("pending"), "Awaiting verification");
	if (domain.lastScanStatus === "error") {
		const streak = domain.errorStreak ?? 0;
		const text = streak > 1 ? `${streak} scans failed in a row` : "Last scan failed";
		return h("span", { class: "severity status-warning" }, icon("warning"), text);
	}
	return h("span", { class: "severity status-good" }, icon("good"), "Verified");
}

/**
 * How many findings a domain has open, with the worst of them as shape, colour and word. Nothing for
 * a domain not scanned yet, or from a monitor that does not count them.
 *
 * @param {Domain} domain
 */
function openCount(domain) {
	const open = domain.openFindings;
	if (!open) return null;
	const total = open.high + open.medium + open.low;
	if (total === 0) return h("span", { class: "domain-meta" }, "No open findings");
	const worst = open.high > 0 ? "high" : open.medium > 0 ? "medium" : "low";
	return h("span", { class: "domain-open" }, severityBadge(worst), `${open[worst].toLocaleString("en-GB")} of ${plural(total, "open finding", "open findings")}`);
}

/**
 * The scans the monitor has kept for a domain, newest first: when each ran and what it saw change.
 * A scan in which something changed opens to show it. Paged, ten scans at a time.
 *
 * @param {HistoryEntry[]} history
 * @param {number} page
 * @param {(page: number) => void} go
 */
function historyView(history, page, go) {
	if (history.length < 2) return null;
	const shown = paginate(history, page, HISTORY_PAGE);
	return h(
		"section",
		{ class: "domain-history", "aria-labelledby": "domain-history-title" },
		h("h3", { id: "domain-history-title" }, `History (${plural(history.length, "scan", "scans")} kept)`),
		h(
			"ol",
			{ class: "timeline" },
			...shown.items.map((entry) => {
				const open = entry.openFindings.high + entry.openFindings.medium + entry.openFindings.low;
				const quiet = entry.changes.length + entry.newFindings.length + entry.resolvedFindings.length === 0;
				const what = entry.baseline
					? `First scan: ${plural(entry.hostCount, "host", "hosts")}`
					: quiet
						? "Nothing changed"
						: [
								entry.changes.length > 0 ? plural(entry.changes.length, "change", "changes") : null,
								entry.newFindings.length > 0 ? plural(entry.newFindings.length, "new finding", "new findings") : null,
								entry.resolvedFindings.length > 0 ? `${entry.resolvedFindings.length.toLocaleString("en-GB")} fixed` : null,
							]
								.filter(Boolean)
								.join(", ");
				const head = [h("span", { class: "timeline-when" }, formatWhen(entry.takenAt)), h("span", { class: "timeline-what" }, what), h("span", { class: "hint" }, `${open.toLocaleString("en-GB")} open`)];
				const detail = entry.baseline || quiet ? [] : timelineDetail(entry);
				return h("li", { class: quiet && !entry.baseline ? "timeline-quiet" : "" }, detail.length > 0 ? h("details", null, h("summary", null, ...head), ...detail) : h("div", { class: "timeline-line" }, ...head));
			}),
		),
		shown.pages > 1 ? pager(shown, "scans", go) : null,
	);
}

/** @param {HistoryEntry} entry */
function timelineDetail(entry) {
	/** @param {string} label @param {MonitorFinding[]} findings */
	const list = (label, findings) =>
		findings.length > 0
			? h("div", null, h("p", { class: "hint" }, label), h("ul", { class: "timeline-findings" }, ...findings.map((finding) => h("li", null, severityBadge(finding.severity), h("code", null, finding.host), ` ${finding.title}`))))
			: null;
	return /** @type {HTMLElement[]} */ (
		[
			entry.changes.length > 0 ? h("ul", { class: "changes" }, ...entry.changes.map(changeItem)) : null,
			list("New findings", entry.newFindings),
			list("Fixed", entry.resolvedFindings),
			entry.notes.length > 0 ? h("p", { class: "hint" }, entry.notes.join(" ")) : null,
		].filter(Boolean)
	);
}

/** @param {Domain} domain @param {HTMLButtonElement} verifyButton */
function challengeCard(domain, verifyButton) {
	const lapsed = domain.lastScanStatus === "unverified";
	return h(
		"div",
		{ class: "card" },
		h("h3", null, lapsed ? "The verification record is missing" : `Prove ${domain.name} is yours`),
		h(
			"p",
			null,
			lapsed
				? "Scanning is paused. Put this DNS record back, then check it."
				: `Open the place where DNS for ${domain.name} is managed (Cloudflare, Namecheap, GoDaddy or wherever you bought it) and add a new record with these three values. Then choose Check DNS record.`,
		),
		lapsed ? null : h("p", { class: "hint" }, "Nothing is scanned until the record is found. It is looked for again before every scan, so leave it in place."),
		h(
			"dl",
			{ class: "record" },
			h("dt", null, "Type"),
			h("dd", null, h("code", null, domain.challenge.type)),
			h("dt", null, "Name"),
			h("dd", null, h("code", null, domain.challenge.name), copyButton(domain.challenge.name, "name")),
			h("dt", null, "Value"),
			h("dd", null, h("code", null, domain.challenge.value), copyButton(domain.challenge.value, "value")),
		),
		h("div", { class: "actions" }, verifyButton, h("span", { class: "hint" }, "DNS changes can take a few minutes to appear.")),
	);
}


/**
 * A domain's latest report: one table of what is open, each new finding marked New rather than listed
 * twice, findings with the same repair on the same host in one row, paged (D-D1).
 *
 * @param {MonitorReport} report
 * @param {Record<string, { title: string, how: string[] }>} suggestions the repair for each open finding, by finding ID
 * @param {number} page
 * @param {(page: number) => void} go
 */
function reportView(report, suggestions, page, go) {
	const count = (/** @type {MonitorFinding["severity"]} */ severity) => report.findings.filter((finding) => finding.severity === severity).length;
	const summary = report.baseline
		? "First scan: this is the baseline that later scans are compared with."
		: `${plural(report.changes.length, "change", "changes")}, ${plural(report.newFindings.length, "new finding", "new findings")} and ${formatNumber(report.resolvedFindings.length)} fixed since the previous scan.`;
	const fresh = new Set(report.baseline ? [] : report.newFindings.map((finding) => finding.id));
	const rows = groupFindings(report.findings, suggestions);
	const shown = paginate(rows, page, PAGE_SIZE);
	return h(
		"div",
		{ class: "report" },
		h("p", { class: "sub" }, `Scanned ${formatWhen(report.takenAt)}. ${summary}`),
		report.notes.length > 0 ? banner("warning", "This scan could not see everything", report.notes) : null,
		tileRow(
			statTile("Hosts", report.hostCount),
			statTile("Open findings", report.findings.length),
			statTile("High", count("high"), icon("high", "severity-high")),
			statTile("Medium", count("medium"), icon("medium", "severity-medium")),
			statTile("Low", count("low"), icon("low", "severity-low")),
		),
		report.changes.length > 0
			? h("div", null, h("h3", null, "Changes since the previous scan"), h("ul", { class: "changes" }, ...report.changes.map(changeItem)))
			: null,
		report.findings.length > 0
			? h(
					"div",
					null,
					h("h3", { id: "domain-open-title", tabindex: "-1" }, `Open findings (${formatNumber(report.findings.length)}${fresh.size > 0 ? `, ${formatNumber(fresh.size)} new` : ""})`),
					findingsTable(shown.items, fresh, true),
					shown.pages > 1 ? pager(shown, "rows", go) : null,
				)
			: h("div", { class: "empty" }, h("h2", null, "No open findings"), h("p", null, "Nothing this scan checks for is wrong right now.")),
		report.resolvedFindings.length > 0
			? h(
					"details",
					{ class: "options" },
					h("summary", null, `Fixed since the previous scan (${formatNumber(report.resolvedFindings.length)})`),
					findingsTable(groupFindings(report.resolvedFindings, null), new Set(), false),
				)
			: null,
	);
}

/** @typedef {{ severity: MonitorFinding["severity"], host: string, titles: string[], ids: string[], fix: { title: string, how: string[] } | null }} FindingGroup */

/**
 * Findings on the same host with the same repair, as one row: six missing headers are one fix.
 *
 * @param {MonitorFinding[]} findings
 * @param {Record<string, { title: string, how: string[] }> | null} suggestions
 * @returns {FindingGroup[]}
 */
function groupFindings(findings, suggestions) {
	const rank = { high: 0, medium: 1, low: 2 };
	/** @type {Map<string, FindingGroup>} */
	const groups = new Map();
	for (const finding of findings) {
		const fix = suggestions?.[finding.id] ?? null;
		const key = fix ? `${finding.host}\n${fix.title}` : `\n${finding.id}`;
		const group = groups.get(key);
		if (!group) groups.set(key, { severity: finding.severity, host: finding.host, titles: [finding.title], ids: [finding.id], fix });
		else {
			group.titles.push(finding.title);
			group.ids.push(finding.id);
			if (rank[finding.severity] < rank[group.severity]) group.severity = finding.severity;
		}
	}
	return [...groups.values()].sort((a, b) => rank[a.severity] - rank[b.severity] || a.host.localeCompare(b.host));
}

/**
 * @param {FindingGroup[]} rows
 * @param {Set<string>} fresh ids of findings new in this scan
 * @param {boolean} withFix
 */
function findingsTable(rows, fresh, withFix) {
	return h(
		"div",
		{ class: "table-wrap" },
		h(
			"table",
			{ class: "data" },
			h(
				"thead",
				null,
				h("tr", null, h("th", { scope: "col" }, "Severity"), h("th", { scope: "col" }, "Host"), h("th", { scope: "col" }, "Finding"), withFix ? h("th", { scope: "col" }, "Suggested fix") : null),
			),
			h(
				"tbody",
				null,
				...rows.map((row) => {
					const isNew = row.ids.some((id) => fresh.has(id));
					return h(
						"tr",
						null,
						h("td", null, severityBadge(row.severity)),
						h("td", { class: "mono wrap col-where" }, row.host),
						h(
							"td",
							{ class: "wrap col-what" },
							isNew ? h("span", { class: "tag tag-new", title: "Not in the previous scan" }, "New") : null,
							row.titles.length === 1 ? ` ${row.titles[0]}` : h("ul", { class: "plain-list tight" }, ...row.titles.map((title) => h("li", null, title))),
						),
						withFix
							? h(
									"td",
									{ class: "wrap col-what" },
									row.fix ? h("details", { class: "fix-details" }, h("summary", null, row.fix.title), h("ol", null, ...row.fix.how.map((step) => h("li", null, ...stepNodes(step, { copy: true }))))) : null,
								)
							: null,
					);
				}),
			),
		),
	);
}

/**
 * Where the monitor's alerts go and what last went wrong with them or its daily run (B48, MON-C2):
 * otherwise only the Worker's log would know.
 *
 * @param {import("./hints.js").MonitorStatus | undefined} status
 */
function monitorStatusCard(status) {
	const words = monitorStatusWords(status, formatWhen);
	if (!words) return null;
	if (words.problems.length > 0) return banner("warning", "Your monitor has had a problem", [...words.problems, words.alerts, ...words.unknown]);
	if (words.unknown.length > 0 || !words.good) return banner("warning", words.good ? "Your monitor could not say everything" : "Nobody is told about changes", [words.alerts, ...words.unknown]);
	return h("p", { class: "hint monitor-status" }, h("span", { class: "severity status-good" }, icon("good"), words.alerts));
}

/** @param {Change} change */
function changeItem(change) {
	const values = (/** @type {string[]} */ list) => (list.length > 0 ? list.join(", ") : "none");
	switch (change.kind) {
		case "host_added":
			return h("li", null, icon("plus", "change-added"), h("span", null, "New host ", h("code", null, change.host)));
		case "host_removed":
			return h("li", null, icon("minus", "change-removed"), h("span", null, "Host gone ", h("code", null, change.host)));
		case "dns_changed":
			return h(
				"li",
				null,
				icon("change"),
				h("span", null, `${change.record} record for `, h("code", null, change.host), " changed from ", h("code", null, values(change.before)), " to ", h("code", null, values(change.after))),
			);
		case "https_changed":
			return h("li", null, icon("change"), h("span", null, "HTTPS on ", h("code", null, change.host), ` went from ${change.before} to ${change.after}`));
	}
}

/**
 * Where a newly added domain is on its way to a first scan.
 *
 * @param {2 | 3} current
 */
function journey(current) {
	const steps = ["Added", "Prove it is yours", "First scan"];
	return h(
		"ol",
		{ class: "journey", "aria-label": "Setting up this domain" },
		...steps.map((label, index) => {
			const number = index + 1;
			return h("li", { "aria-current": number === current ? "step" : null }, number < current ? icon("good", "status-done") : `${number}.`, label);
		}),
	);
}

/**
 * How to set up website checks. From a terminal, the settings are environment variables given at start;
 * as a service (a container, under BoxPilot) they are the app's settings where it is managed.
 *
 * @param {{ error?: string, unset?: boolean }} monitor
 * @param {boolean} service
 */
function notConnected(monitor, service) {
	const steps = monitorSetupSteps(service);
	return h(
		"section",
		{ class: "page" },
		h("div", { class: "page-head" }, h("div", null, h("h1", null, "Domains"), h("p", { class: "sub" }, WATCHES))),
		h(
			"div",
			{ class: "card" },
			h("h2", null, "Set up domain scans"),
			h(
				"p",
				null,
				"Domains are scanned by the Porchlight monitor: a small service that runs on your own Cloudflare account, not on this ",
				service ? "server" : "computer",
				". That way it can check every day and keep the history even when this page is closed. This page shows what it finds.",
			),
			// Nothing given yet is the usual state after installing, not a mistake to quote back.
			monitor.unset || !monitor.error ? null : banner("warning", "A monitor setting needs correcting", [monitor.error]),
			h(
				"ol",
				{ class: "steps setup-steps" },
				...steps.map((step) =>
					h(
						"li",
						null,
						h("p", null, ...stepNodes(step.text)),
						...(step.commands ?? []).map((command) => h("div", { class: "command-line" }, h("pre", { tabindex: "0" }, h("code", null, command)), copyButton(command, "command"))),
					),
				),
			),
			service ? null : h("p", null, h("a", { class: "button primary", href: "#/settings/monitor" }, "Connect in Settings")),
			h("p", { class: "hint" }, "Already have a monitor? Skip to the last step. The token stays inside Porchlight: once saved it is never sent back to this page."),
			service ? h("p", { class: "hint" }, "Running the image some other way? Set PORCHLIGHT_MONITOR_URL and PORCHLIGHT_ADMIN_TOKEN in the container's environment and restart it.") : null,
		),
	);
}
