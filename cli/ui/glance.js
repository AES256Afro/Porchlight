// @ts-check
// The Overview's morning check (QL-1): one row per area, how old it is, what is new since the last
// time, the worst open finding, and one "Check everything" button. Then what wants another look
// (QL-3) and what the schedule did (QL-5). Nothing here hides a finding or changes a count.
import { api } from "./api.js";
import { formatNumber, formatWhen, h, icon, isOff, plural, replace, setOff, severityBadge, stepNodes, toast } from "./dom.js";
import { overdueDomains, reviewQueue, scheduleLines } from "./hints.js";
import { hostName } from "./host.js";
import { buildHash } from "./list.js";
import { describeChoices, standardChoices } from "./scan-choices.js";
import { findingRows, loadHost, noteFor, startCloudflareAudit, startHostCheck, startScan, store } from "./store.js";
import { statusLabel } from "./tracking.js";

const SEVERITIES = /** @type {const} */ (["critical", "high", "medium", "low"]);

/** @typedef {{ verified: boolean, lastScanAt: string | null, verifiedAt?: string | null, openFindings?: Record<string, number> | null, lastScanStatus?: string | null }} DomainRow */

/**
 * The "At a glance" card. `refresh` draws it again from the store; the domains are asked of the monitor
 * once, when the card is made.
 *
 * @param {() => boolean} gone whether the page has been left
 */
export function glanceCard(gone) {
	const node = h("section", { class: "card full glance", "aria-labelledby": "glance-title" });
	/** @type {DomainRow[] | null | undefined} undefined: not asked yet; null: could not be read */
	let domains;
	const service = store.settings?.service === true;
	// This computer's last check, for its row; a service has none.
	if (!service && !store.host.loaded) void loadHost().catch(() => {});
	if (store.settings?.monitor?.configured) {
		void api("GET", "/domains")
			.then((answer) => (domains = Array.isArray(answer.domains) ? answer.domains : []))
			.catch(() => (domains = null))
			.finally(() => {
				if (!gone()) refresh();
			});
	}
	refresh();
	return { node, refresh };

	function refresh() {
		replace(
			node,
			h("div", { class: "glance-head" }, h("h2", { id: "glance-title" }, "At a glance"), checkEverything()),
			h("ul", { class: "glance-rows" }, codeRow(), domainRow(), cloudflareRow(), service ? null : hostRow()),
			...scheduleLines(store.settings?.schedule, { cloudflareEnds: store.settings?.cloudflare?.verified?.expiresOn }, formatWhen).map((line) => h("p", { class: "hint" }, ...stepNodes(line))),
		);
	}

	function codeRow() {
		const report = store.report;
		if (!report) return row("Your code", "pending", "Not scanned yet", "#/overview", "Scan it below");
		const rows = findingRows();
		const worst = SEVERITIES.find((severity) => rows.some((finding) => finding.severity === severity));
		const change = store.change;
		const parts = [`Scanned ${formatWhen(report.scannedAt)}`];
		if (change) parts.push(`${formatNumber(change.newCount)} new, ${formatNumber(change.fixedCount)} fixed since the scan before`);
		return row(
			"Your code",
			worst === "critical" || worst === "high" ? "warning" : "good",
			`${plural(rows.length, "finding", "findings")}${worst ? `, the worst ${worst}` : ""}`,
			change?.newCount ? buildHash(["findings"], { new: "1" }) : "#/findings",
			parts.join(". "),
			worst ? severityBadge(worst) : null,
		);
	}

	function domainRow() {
		const monitor = store.settings?.monitor;
		if (!monitor?.configured) return row("Your domains", "pending", "Not watched yet", "#/domains", "Set up the monitor on the Domains page");
		if (domains === undefined) return row("Your domains", "pending", "Asking the monitor…", "#/domains", `The monitor at ${monitor.host} checks them every day by itself`);
		if (domains === null) return row("Your domains", "warning", "The monitor did not answer", "#/domains", "Settings → Monitor can check the connection");
		const open = domains.reduce((sum, domain) => sum + SEVERITIES.reduce((total, severity) => total + (domain.openFindings?.[severity] ?? 0), 0), 0);
		const failing = domains.filter((domain) => domain.lastScanStatus === "error").length;
		const overdue = overdueDomains(domains);
		const notes = [`The monitor checks them every day by itself`];
		if (failing > 0) notes.push(`${plural(failing, "scan", "scans")} failed`);
		if (overdue) notes.push(overdue.words);
		return row("Your domains", failing > 0 || overdue ? "warning" : "good", `${plural(domains.length, "domain", "domains")}, ${plural(open, "open finding", "open findings")}`, "#/domains", notes.join(". "));
	}

	function cloudflareRow() {
		const cloudflare = store.cloudflare;
		if (!cloudflare.token.configured && !cloudflare.report) return row("Cloudflare", "pending", "Not connected", "#/settings/cloudflare", "Optional: a read-only token audits your account");
		if (!cloudflare.report) return row("Cloudflare", "pending", "Not audited yet", "#/cloudflare", "Check everything audits it");
		const failed = cloudflare.report.zones.flatMap((zone) => zone.checks).filter((check) => check.status === "failed").length;
		const change = cloudflare.change;
		return row(
			"Cloudflare",
			failed > 0 ? "warning" : "good",
			`${plural(failed, "finding", "findings")} across ${plural(cloudflare.report.zones.length, "domain", "domains")}`,
			"#/cloudflare",
			`Audited ${formatWhen(cloudflare.report.checkedAt)}${change ? `. ${formatNumber(change.newCount)} new, ${formatNumber(change.fixedCount)} fixed since the audit before` : ""}`,
		);
	}

	function hostRow() {
		const label = hostName();
		const report = store.host.report;
		if (!report) return row(label, "pending", "Not checked yet", "#/host", "Check everything checks it");
		const failed = report.checks.filter((check) => check.status === "failed").length;
		const change = store.host.change;
		return row(
			label,
			failed > 0 ? "warning" : "good",
			plural(failed, "finding", "findings"),
			"#/host",
			`Checked ${formatWhen(report.checkedAt)}${change ? `. ${formatNumber(change.newCount)} new, ${formatNumber(change.fixedCount)} fixed since the check before` : ""}`,
		);
	}

	/**
	 * Scans the code again with the last scan's options (without a model's analysis), audits Cloudflare
	 * when it is connected, and checks this computer with the lookups it used last time. Each only reads.
	 */
	function checkEverything() {
		const running = store.scan.state === "running" || store.host.status.state === "running" || store.cloudflare.status.state === "running";
		const button = /** @type {HTMLButtonElement} */ (
			h(
				"button",
				{
					type: "button",
					class: "button primary",
					title: "Scans your code with the last scan's options, audits your Cloudflare account and checks this computer. Each only reads; a model is not asked.",
					onclick: async () => {
						if (isOff(button)) return;
						setOff(button, true);
						const started = [];
						const problems = [];
						const report = store.report;
						if (report) {
							try {
								// The last scan's choices, without a model's analysis: nothing is sent to a model from here.
								await startScan(report.root, store.settings?.scanDepth ?? 3, { ...(report.choices ?? standardChoices()), analyse: false });
								started.push("your code");
							} catch (err) {
								problems.push(err instanceof Error ? err.message : String(err));
							}
						}
						if (store.cloudflare.token.configured) {
							try {
								await startCloudflareAudit({ lookups: true });
								started.push("Cloudflare");
							} catch (err) {
								problems.push(err instanceof Error ? err.message : String(err));
							}
						}
						if (!service && !store.settings?.remote) {
							try {
								const lookups = store.host.report?.lookups;
								await startHostCheck({ askApple: lookups?.apple ?? false, lookUpPackages: lookups?.packages ?? false });
								started.push(hostName());
							} catch (err) {
								problems.push(err instanceof Error ? err.message : String(err));
							}
						}
						setOff(button, false);
						if (started.length > 0) toast(`Checking ${started.join(", ")}. This page follows along.`);
						for (const problem of problems) toast(problem, "error");
						if (started.length === 0 && problems.length === 0) toast("There is nothing to check yet: scan your code below first.");
					},
				},
				running ? "Checking…" : "Check everything",
			)
		);
		if (running) setOff(button, true);
		return h("div", { class: "actions" }, button, store.report ? h("span", { class: "hint" }, describeChoices({ ...(store.report.choices ?? standardChoices()), analyse: false })) : null);
	}
}

/**
 * @param {string} area
 * @param {"good" | "warning" | "pending"} state
 * @param {string} headline
 * @param {string} href
 * @param {string} detail
 * @param {Node | null} [mark]
 */
function row(area, state, headline, href, detail, mark = null) {
	return h(
		"li",
		{ class: "glance-row" },
		h("a", { href }, h("span", { class: "link-title" }, area), h("span", { class: `severity status-${state}` }, icon(state), headline), mark),
		h("span", { class: "hint block" }, ...stepNodes(detail)),
	);
}

/**
 * "Look at these again" (QL-3): accepted risks that have ended or end within two weeks, and findings you
 * marked Fixed that the latest scan still reports. Each opens on the Findings page. Null when there are none.
 */
export function reviewCard() {
	if (!store.report) return null;
	const queue = reviewQueue(findingRows(), (row) => noteFor(row.repo, row));
	const groups = /** @type {const} */ ([
		["ended", "Accepted risks whose end day has passed"],
		["ending", "Accepted risks that end within two weeks"],
		["stillReported", "Marked Fixed, but the latest scan still finds them"],
	]);
	if (groups.every(([key]) => queue[key].length === 0)) return null;
	return h(
		"section",
		{ class: "card full", "aria-labelledby": "review-title" },
		h("h2", { id: "review-title" }, "Look at these again"),
		h("p", { class: "sub" }, "Your own statuses that need a decision. They change no count and hide nothing."),
		...groups.flatMap(([key, title]) =>
			queue[key].length === 0
				? []
				: [
						h("h3", null, `${title} (${formatNumber(queue[key].length)})`),
						h(
							"ul",
							{ class: "link-list" },
							...queue[key].slice(0, 5).map((finding) =>
								h(
									"li",
									null,
									h(
										"a",
										{ href: buildHash(["findings"], { repo: finding.repo, q: finding.location }) },
										h("span", { class: "link-title wrap" }, finding.title),
										h("span", { class: "link-meta" }, severityBadge(finding.severity), `${finding.repo} · ${statusLabel(noteFor(finding.repo, finding)?.status ?? "open")}${noteFor(finding.repo, finding)?.until ? ` until ${noteFor(finding.repo, finding)?.until}` : ""}`),
									),
								),
							),
						),
						queue[key].length > 5 ? h("p", { class: "hint" }, `And ${formatNumber(queue[key].length - 5)} more.`) : null,
					],
		),
	);
}

/**
 * "Check connections" (US-8): asks the monitor and the model whether they answer now, so "connected"
 * means working and not only set up. The answers say when they were asked. Nothing is sent to a hosted
 * model, and no token reaches the page.
 */
export function connectionsCheck() {
	const result = h("div", { class: "connections" });
	const button = /** @type {HTMLButtonElement} */ (
		h(
			"button",
			{
				type: "button",
				class: "button",
				onclick: async () => {
					if (isOff(button)) return;
					setOff(button, true);
					button.textContent = "Checking…";
					try {
						const answer = await api("GET", "/connections");
						/** @type {[string, { ok: boolean, detail: string } | null][]} */
						const rows = [
							["Monitor", answer.monitor],
							["Model", answer.model],
							["Cloudflare", answer.cloudflare],
						];
						replace(
							result,
							h(
								"ul",
								{ class: "plain-list" },
								...rows.map(([name, check]) =>
									h(
										"li",
										null,
										h("strong", null, `${name}: `),
										check
											? h("span", { class: `severity status-${check.ok ? "good" : "warning"}` }, icon(check.ok ? "good" : "warning"), check.ok ? "Working" : "Not working")
											: h("span", { class: "hint" }, "Not set up"),
										check ? h("span", { class: "hint" }, ` ${check.detail}.`) : null,
									),
								),
							),
							h("p", { class: "hint" }, `Asked ${formatWhen(answer.at)}.`),
						);
					} catch (err) {
						replace(result, h("p", { class: "form-error" }, err instanceof Error ? err.message : String(err)));
					} finally {
						setOff(button, false);
						button.textContent = "Check connections";
					}
				},
			},
			"Check connections",
		)
	);
	return h("div", { class: "connections-check" }, button, result);
}
