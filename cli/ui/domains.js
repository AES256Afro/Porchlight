// @ts-check
import { api, ApiError } from "./api.js";
import { assistAction } from "./assist.js";
import { banner, formatWhen, h, icon, plural, replace, severityBadge, statTile, stepNodes, toast } from "./dom.js";
import { exportButton, openExportDialog } from "./export.js";
import { domainFromInput, monitorSetupSteps } from "./hints.js";

const WATCHES = "Watches the domains you own for new subdomains, DNS changes, expiring certificates and missing security headers. It only looks at what is public.";
const README_MONITOR = "https://github.com/AES256Afro/SecurityX#monitor-domains";

/**
 * @typedef {object} Domain
 * @property {string} name
 * @property {boolean} verified
 * @property {string | null} verifiedAt
 * @property {string | null} lastScanAt
 * @property {"ok" | "unverified" | "error" | null} lastScanStatus
 * @property {{ type: string, name: string, value: string }} challenge
 */

/**
 * @typedef {object} MonitorFinding
 * @property {string} id
 * @property {"high" | "medium" | "low"} severity
 * @property {string} host
 * @property {string} title
 */

/**
 * @typedef {(
 *   | { kind: "host_added", host: string }
 *   | { kind: "host_removed", host: string }
 *   | { kind: "dns_changed", host: string, record: string, before: string[], after: string[] }
 *   | { kind: "https_changed", host: string, before: string, after: string }
 * )} Change
 */

/**
 * @typedef {object} MonitorReport
 * @property {string} domain
 * @property {string} takenAt
 * @property {boolean} baseline
 * @property {Change[]} changes
 * @property {MonitorFinding[]} newFindings
 * @property {MonitorFinding[]} resolvedFindings
 * @property {MonitorFinding[]} findings
 * @property {number} hostCount
 * @property {string[]} notes
 */

/**
 * The Domains page: register domains with the monitor, prove ownership, scan, and read what changed.
 *
 * @param {HTMLElement} view
 * @param {string | undefined} selected the domain named in the address, if any
 * @returns {Promise<() => void>}
 */
export async function renderDomains(view, selected) {
	const state = await api("GET", "/state");
	if (!state.monitor.configured) {
		replace(view, notConnected(state.monitor, state.service === true));
		return () => {};
	}

	/** @type {Domain[]} */
	let domains = [];
	const list = h("ul", { class: "domain-list", "aria-label": "Domains" });
	const detail = h("div", { class: "detail" });
	const input = /** @type {HTMLInputElement} */ (
		h("input", { type: "text", name: "domain", placeholder: "example.com", spellcheck: false, autocomplete: "off", required: true, "aria-label": "Website to add, as a domain name such as example.com" })
	);

	replace(
		view,
		h(
			"section",
			{ class: "page" },
			h(
				"div",
				{ class: "page-head" },
				h("div", null, h("h1", null, "Domains"), h("p", { class: "sub" }, `The websites you own, checked by your monitor at ${state.monitor.host}.`)),
				h("form", { class: "inline-form", onsubmit: addDomain }, h("div", { class: "field grow" }, input), h("button", { type: "submit", class: "button primary" }, "Add a website")),
			),
			h("div", { class: "split" }, list, detail),
		),
	);

	// A monitor that cannot be reached shows its error, and nothing else: not "No domains yet".
	if (!(await refreshList())) return () => {};
	if (!selected && domains[0]) {
		// Changing the address re-renders this page with that domain selected.
		location.hash = `#/domains/${domains[0].name}`;
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
			domains = (await api("GET", "/domains")).domains;
		} catch (err) {
			domains = [];
			replace(list);
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
					h("h2", null, "Add your first website"),
					h("p", null, "Type its domain name above, such as example.com, and choose Add a website."),
					h(
						"ol",
						{ class: "steps left" },
						h("li", null, h("strong", null, "Add it."), " One domain covers its subdomains too."),
						h("li", null, h("strong", null, "Prove it is yours."), " You are given one DNS record to add where the domain is managed. Nothing is checked before that."),
						h("li", null, h("strong", null, "Scan."), " The first scan records how things are now. After that the monitor checks every hour and shows what changed."),
					),
				),
			);
		}
		return true;
	}

	/** @param {SubmitEvent} event */
	async function addDomain(event) {
		event.preventDefault();
		try {
			// People paste a whole address; the monitor wants the name alone.
			const { domain } = await api("POST", "/domains", { domain: domainFromInput(input.value) });
			input.value = "";
			if (domain.name === selected) await refreshList().then(showDetail);
			else location.hash = `#/domains/${domain.name}`;
		} catch (err) {
			toast(message(err), "error");
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
		const everVerified = domain.verifiedAt !== null;

		const scanButton = /** @type {HTMLButtonElement} */ (
			h("button", { type: "button", class: "button primary", disabled: !everVerified, onclick: () => act(scanButton, "Scanning…", "scan") }, "Scan now")
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
			domain.verified ? null : challengeCard(domain, verifyButton),
			explain?.panel,
			report
				? reportView(report, suggestions)
				: h(
						"div",
						{ class: "empty" },
						h("h2", null, everVerified ? "Ready for its first scan" : "Not scanned yet"),
						h("p", null, everVerified ? "Choose Scan now. The first scan records how things are today; later scans show what changed." : "Add the DNS record above, then choose Check DNS record. Scanning starts once it is found."),
					),
		);

		/**
		 * @param {HTMLButtonElement} button
		 * @param {string} busyLabel
		 * @param {"scan" | "verify"} action
		 */
		async function act(button, busyLabel, action) {
			const label = button.textContent;
			button.disabled = true;
			button.textContent = busyLabel;
			try {
				await api("POST", `/domains/${encodeURIComponent(domain.name)}/${action}`);
				toast(action === "scan" ? `Scanned ${domain.name}` : `${domain.name} is verified`);
			} catch (err) {
				toast(message(err), "error");
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
				{ class: "dialog", onclose: () => dialog.remove() },
				h("h2", null, `Remove ${name}?`),
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
									location.hash = "#/domains";
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
	if (domain.lastScanStatus === "error") return h("span", { class: "severity status-warning" }, icon("warning"), "Last scan failed");
	return h("span", { class: "severity status-good" }, icon("good"), "Verified");
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

/** @param {string} text @param {string} what */
function copyButton(text, what) {
	return h(
		"button",
		{
			type: "button",
			class: "button quiet icon-only",
			"aria-label": `Copy ${what}`,
			title: `Copy ${what}`,
			onclick: async () => {
				try {
					await navigator.clipboard.writeText(text);
					toast(`Copied the record ${what}`);
				} catch {
					toast("Could not copy. Select the text and copy it by hand.", "error");
				}
			},
		},
		icon("copy"),
	);
}

/**
 * @param {MonitorReport} report
 * @param {Record<string, { title: string, how: string[] }>} suggestions the repair for each open finding, by finding ID
 */
function reportView(report, suggestions) {
	const count = (/** @type {MonitorFinding["severity"]} */ severity) => report.findings.filter((finding) => finding.severity === severity).length;
	const summary = report.baseline
		? "First scan: this is the baseline that later scans are compared with."
		: `${plural(report.changes.length, "change", "changes")}, ${plural(report.newFindings.length, "new finding", "new findings")} and ${report.resolvedFindings.length.toLocaleString()} resolved since the previous scan.`;
	return h(
		"div",
		{ class: "report" },
		h("p", { class: "sub" }, `Scanned ${formatWhen(report.takenAt)}. ${summary}`),
		report.notes.length > 0 ? banner("warning", "This scan could not see everything", report.notes) : null,
		h(
			"div",
			{ class: "tiles" },
			statTile("Hosts", report.hostCount),
			statTile("Open findings", report.findings.length),
			statTile("High", count("high"), icon("high", "severity-high")),
			statTile("Medium", count("medium"), icon("medium", "severity-medium")),
			statTile("Low", count("low"), icon("low", "severity-low")),
		),
		report.changes.length > 0
			? h("div", null, h("h3", null, "Changes since the previous scan"), h("ul", { class: "changes" }, ...report.changes.map(changeItem)))
			: null,
		!report.baseline && report.newFindings.length > 0 ? findingsTable("New findings", report.newFindings, suggestions) : null,
		report.resolvedFindings.length > 0 ? findingsTable("Resolved", report.resolvedFindings, null) : null,
		report.findings.length > 0
			? findingsTable("Open findings", report.findings, suggestions)
			: h("div", { class: "empty" }, h("h2", null, "No open findings"), h("p", null, "Nothing this scan checks for is wrong right now.")),
	);
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
 * @param {string} title
 * @param {MonitorFinding[]} findings
 * @param {Record<string, { title: string, how: string[] }> | null} suggestions null for findings that need no fix
 */
function findingsTable(title, findings, suggestions) {
	return h(
		"div",
		null,
		h("h3", null, `${title} (${findings.length.toLocaleString()})`),
		h(
			"div",
			{ class: "table-wrap" },
			h(
				"table",
				{ class: "data" },
				h(
					"thead",
					null,
					h("tr", null, h("th", { scope: "col" }, "Severity"), h("th", { scope: "col" }, "Host"), h("th", { scope: "col" }, "Finding"), suggestions ? h("th", { scope: "col" }, "Suggested fix") : null),
				),
				h(
					"tbody",
					null,
					...findings.map((finding) => {
						const fix = suggestions?.[finding.id];
						return h(
							"tr",
							null,
							h("td", null, severityBadge(finding.severity)),
							h("td", { class: "mono wrap col-where" }, finding.host),
							h("td", { class: "wrap col-what" }, finding.title),
							suggestions
								? h(
										"td",
										{ class: "wrap col-what" },
										fix ? h("details", { class: "fix-details" }, h("summary", null, fix.title), h("ol", null, ...fix.how.map((step) => h("li", null, ...stepNodes(step))))) : null,
									)
								: null,
						);
					}),
				),
			),
		),
	);
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
		{ class: "journey", "aria-label": "Setting up this website" },
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
			h("h2", null, "Set up website checks"),
			h(
				"p",
				null,
				"Websites are checked by the SecurityX monitor: a small service that runs on your own Cloudflare account, not on this ",
				service ? "server" : "computer",
				". That way it can check every hour and keep the history even when this page is closed. This page shows what it finds.",
			),
			// Nothing given yet is the usual state after installing, not a mistake to quote back.
			monitor.unset || !monitor.error ? null : banner("warning", "A monitor setting needs correcting", [monitor.error]),
			h(
				"ol",
				{ class: "steps" },
				...steps.map((step, index) =>
					h(
						"li",
						null,
						...stepNodes(step),
						index === 0 ? h("span", null, " ", h("a", { href: README_MONITOR, target: "_blank", rel: "noreferrer" }, "Open the instructions")) : null,
						!service && index === steps.length - 1
							? h("pre", null, h("code", null, "export SECURITYX_MONITOR_URL=<the monitor's address>\nexport SECURITYX_ADMIN_TOKEN=<its admin token>\nsecurityx ui"))
							: null,
					),
				),
			),
			h("p", { class: "hint" }, "The token stays inside SecurityX. It is never sent to this page."),
			service ? h("p", { class: "hint" }, "Running the image some other way? Set SECURITYX_MONITOR_URL and SECURITYX_ADMIN_TOKEN in the container's environment and restart it.") : null,
		),
	);
}
