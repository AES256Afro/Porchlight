// @ts-check
// "Cloudflare": the audit of the owner's Cloudflare account. Built-in rules judge every zone; this
// page starts the audit, follows it, and shows what it found, worst first, with each fix. A change
// Porchlight can make is shown as the exact request and sent only when the owner approves it here
// (invariant 21). Every element is built with h(): record names and values come from DNS, which
// others can influence, and are never treated as HTML.
import { api, download } from "./api.js";
import { assistAction } from "./assist.js";
import { banner, formatWhen, h, icon, plural, replace, select, severityBadge, statTile, stepNodes, toast } from "./dom.js";
import { announceSaved } from "./projects.js";
import { currentProject, load, loadCloudflare, startCloudflareAudit, store, subscribe, updateCloudflare } from "./store.js";

/** @typedef {import("../src/cloudflare/types.ts").CfCheck} CfCheck */
/** @typedef {import("../src/cloudflare/types.ts").CfReport} CfReport */
/** @typedef {import("../src/cloudflare/types.ts").CfZoneReport} CfZoneReport */
/**
 * @typedef {(
 *   | { state: "loading" }
 *   | { state: "shown", pending: { id: string, title: string, permission: string, expiresAt: string, request: { method: string, url: string, headers: Record<string, string>, body: unknown } } }
 *   | { state: "sending" }
 *   | { state: "done", ok: boolean, result: string }
 *   | { state: "failed", error: string }
 * )} ChangeState
 */

const AREA_TITLES = /** @type {const} */ ({ tls: "SSL/TLS", dns: "DNS", email: "Email", firewall: "Firewall and bots", ownership: "Proof of ownership", account: "Account" });
const SEVERITIES = /** @type {const} */ (["critical", "high", "medium", "low"]);

/**
 * Changes asked for while the page is open, by zone and change, so a redraw keeps the request on show.
 *
 * @type {Map<string, ChangeState>}
 */
const changes = new Map();

/**
 * @param {HTMLElement} view
 * @returns {Promise<() => void>}
 */
export async function renderCloudflare(view) {
	await load();
	await loadCloudflare();
	const lookups = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", name: "lookups", checked: true }));
	const button = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "button primary" }, "Audit my account"));
	const statusSlot = h("div", { "aria-live": "polite" });
	const intro = h("div");
	const results = h("div");

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
					h("h1", null, "Cloudflare"),
					h(
						"p",
						{ class: "sub" },
						"Checks every domain in your Cloudflare account against built-in rules: SSL/TLS, DNS and email records, the firewall, and who can change the account. It only reads. The rules need no model; one can analyse the result if you ask.",
					),
				),
			),
			intro,
			results,
		),
	);

	const form = h(
		"div",
		{ class: "card full" },
		h("h2", null, "Audit your account"),
		h("p", { class: "sub" }, "Reads your zones, their settings and DNS records, and your account's members and API tokens through Cloudflare's API. Nothing is changed. What it finds stays on this computer, readable only by you."),
		h(
			"form",
			{
				class: "scan-form",
				onsubmit: async (/** @type {SubmitEvent} */ event) => {
					event.preventDefault();
					try {
						await startCloudflareAudit({ lookups: lookups.checked });
					} catch (err) {
						toast(err instanceof Error ? err.message : String(err), "error");
					}
				},
			},
			h(
				"div",
				{ class: "actions" },
				button,
				h(
					"details",
					{ class: "options" },
					h("summary", null, "Options"),
					h(
						"label",
						{ class: "check-line" },
						lookups,
						"Look up where CNAME records point, to find ones left pointing at services that are gone. Only for domains whose Porchlight ownership record proves them; sends those names to Cloudflare's DNS resolver.",
					),
				),
			),
		),
		statusSlot,
	);

	draw();
	const unsubscribe = subscribe((change) => {
		if (change === "cloudflare" || change === "settings" || change === "projects") draw();
	});
	return () => unsubscribe();

	function draw() {
		const state = store.cloudflare;
		const running = state.status.state === "running";
		button.disabled = running || !state.token.configured;
		button.textContent = state.report ? "Audit again" : "Audit my account";
		if (running && state.status.state === "running") {
			const status = state.status;
			const known = status.total > 0;
			replace(
				statusSlot,
				h(
					"div",
					{ class: "host-progress" },
					h("strong", null, known && status.current ? `Reading ${Math.min(status.done + 1, status.total)} of ${status.total}: ${status.current}` : "Starting"),
					h("progress", { max: known ? status.total : null, value: known ? status.done : null, "aria-label": "Audit progress" }),
				),
			);
		} else if (state.status.state === "failed") {
			replace(statusSlot, h("p", { class: "form-error", role: "alert" }, `The audit stopped: ${state.status.error}`));
		} else {
			replace(statusSlot);
		}
		replace(intro, state.token.configured ? form : connectCard(state.service));
		replace(results, ...(state.report ? drawReport(state.report) : state.token.configured ? [h("p", { class: "sub" }, "Your account has not been audited yet.")] : []), changesCard());
	}

	/** @param {CfReport} report */
	function drawReport(report) {
		const checks = [...report.zones.flatMap((zone) => zone.checks), ...report.accounts.flatMap((account) => account.checks), ...report.userChecks];
		const failed = checks.filter((item) => item.status === "failed");
		const unknown = checks.filter((item) => item.status === "unknown");
		const passed = checks.filter((item) => item.status === "passed");
		const denied = report.permissions.filter((permission) => permission.granted === false);
		const token = report.token;
		return [
			h(
				"p",
				{ class: "sub scan-line" },
				`Last audited ${formatWhen(report.checkedAt)} · ${plural(report.zones.length, "domain", "domains")} · ${token.kind === "account" ? "account token" : "user token"}${token.expiresOn ? `, expiring ${formatWhen(token.expiresOn)}` : ""}.`,
			),
			h(
				"div",
				{ class: "tiles" },
				statTile("Problems", failed.length),
				statTile("Could not check", unknown.length, unknown.length > 0 ? icon("pending") : null),
				statTile("Passed", passed.length, icon("good")),
				statTile("Domains", report.zones.length, icon("cloudflare")),
			),
			failed.length > 0
				? h(
						"div",
						{ class: "cf-severities", "aria-label": "Problems by severity" },
						...SEVERITIES.map((severity) => h("span", { class: "cf-severity-count" }, severityBadge(severity), h("strong", null, failed.filter((item) => item.severity === severity).length.toLocaleString()))),
					)
				: null,
			denied.length > 0
				? banner(
						"warning",
						"This token could not read everything, so some checks say Could not check",
						denied.map((permission) => `Add "${permission.name}" to read ${permission.purpose}.`),
					)
				: null,
			report.zonesSkipped > 0 ? banner("warning", `${report.zonesSkipped} more domains were not audited`, ["An audit covers the first 200 domains of an account."]) : null,
			...report.zones.map((zone) => zoneCard(zone)),
			...report.accounts.map((account) => groupCard(`Account: ${account.name}`, null, account.checks, null)),
			report.userChecks.length > 0 ? groupCard("Your user", null, report.userChecks, null) : null,
			h(
				"div",
				{ class: "card full" },
				h("h2", null, "Not covered"),
				h("p", { class: "sub" }, "A clean result here does not mean these are safe:"),
				h("ul", { class: "host-not-covered" }, ...report.notCovered.map((line) => h("li", null, line))),
			),
			exportCard(),
			analysisCard(report),
		].filter((node) => node !== null);
	}

	/** @param {CfZoneReport} zone */
	function zoneCard(zone) {
		const failed = zone.checks.filter((item) => item.status === "failed");
		const counts = SEVERITIES.filter((severity) => failed.some((item) => item.severity === severity)).map((severity) =>
			h("span", { class: "cf-severity-count" }, severityBadge(severity), h("strong", null, String(failed.filter((item) => item.severity === severity).length))),
		);
		const head = h(
			"div",
			{ class: "cf-zone-head" },
			h("span", { class: "cf-plan" }, `${zone.planName}${zone.paused ? ", paused" : ""}${zone.status !== "active" ? `, ${zone.status}` : ""}`),
			...(counts.length > 0 ? counts : [h("span", { class: "severity status-good" }, icon("good"), "No problems")]),
		);
		return groupCard(zone.name, head, zone.checks, zone);
	}

	/**
	 * @param {string} title
	 * @param {Node | null} head
	 * @param {CfCheck[]} checks
	 * @param {CfZoneReport | null} zone
	 */
	function groupCard(title, head, checks, zone) {
		const attention = checks.filter((item) => item.status === "failed" || item.status === "unknown");
		const passed = checks.filter((item) => item.status === "passed");
		const unavailable = checks.filter((item) => item.status === "unavailable");
		return h(
			"div",
			{ class: "card full" },
			h("h2", null, title),
			head,
			attention.length > 0 ? h("div", { class: "host-list" }, ...attention.map((item) => checkRow(item, zone))) : h("p", { class: "sub" }, "Nothing here needs attention."),
			passed.length > 0 ? h("details", { class: "host-passed" }, h("summary", null, `${plural(passed.length, "check", "checks")} passed`), h("div", { class: "host-list" }, ...passed.map((item) => checkRow(item, zone)))) : null,
			unavailable.length > 0
				? h("details", { class: "host-passed" }, h("summary", null, `${plural(unavailable.length, "feature", "features")} not on this plan`), h("div", { class: "host-list" }, ...unavailable.map((item) => checkRow(item, zone))))
				: null,
		);
	}

	/**
	 * @param {CfCheck} check
	 * @param {CfZoneReport | null} zone
	 */
	function checkRow(check, zone) {
		const mark =
			check.status === "failed"
				? severityBadge(check.severity)
				: check.status === "unknown"
					? h("span", { class: "severity status-pending" }, icon("pending"), "Could not check")
					: check.status === "unavailable"
						? h("span", { class: "severity status-pending" }, icon("minus"), "Not on this plan")
						: h("span", { class: "severity status-good" }, icon("good"), "Passed");
		const items = check.items ?? [];
		return h(
			"div",
			{ class: `host-check host-${check.status === "unavailable" ? "passed" : check.status}` },
			h("div", { class: "host-check-head" }, mark, h("strong", null, check.title), h("span", { class: "hint" }, AREA_TITLES[check.area])),
			h("p", { class: "host-detail" }, check.detail),
			check.status !== "passed" ? h("p", { class: "hint" }, check.why) : null,
			items.length > 0 ? h("details", { class: "fix-details" }, h("summary", null, plural(items.length, "item", "items")), h("ul", null, ...items.map((item) => h("li", null, h("code", null, item))))) : null,
			check.fix?.length ? h("ol", { class: "host-fix" }, ...check.fix.map((step) => h("li", null, ...stepNodes(step)))) : null,
			check.api ? h("p", { class: "hint" }, "API: ", h("code", null, check.api)) : null,
			check.change && zone ? changeBlock(zone, check) : null,
		);
	}

	/**
	 * The change Porchlight can make for a check: first the exact request, then the owner's answer.
	 *
	 * @param {CfZoneReport} zone
	 * @param {CfCheck} check
	 */
	function changeBlock(zone, check) {
		if (!store.cloudflare.canChange) return h("p", { class: "hint" }, "Porchlight can make this change from the page on the computer it runs on, once you approve the exact request.");
		const key = `${zone.id} ${check.change}`;
		const state = changes.get(key);
		const ask = async () => {
			changes.set(key, { state: "loading" });
			draw();
			try {
				const answer = await api("POST", "/cloudflare/changes/preview", { zone: zone.id, change: check.change });
				changes.set(key, { state: "shown", pending: answer.pending });
			} catch (err) {
				changes.set(key, { state: "failed", error: err instanceof Error ? err.message : String(err) });
			}
			draw();
		};
		/** @param {string} id @param {boolean} approve */
		const answer = async (id, approve) => {
			changes.set(key, { state: "sending" });
			draw();
			try {
				const reply = await api("POST", "/cloudflare/changes/approve", { id, approve });
				if (!reply.applied) changes.delete(key);
				else {
					changes.set(key, { state: "done", ok: reply.ok === true, result: String(reply.result ?? "") });
					updateCloudflare({ changes: reply.changes });
					toast(reply.ok ? "Change applied. Audit again to see it." : "Cloudflare refused the change", reply.ok ? "info" : "error");
				}
			} catch (err) {
				changes.set(key, { state: "failed", error: err instanceof Error ? err.message : String(err) });
			}
			draw();
		};
		if (!state) return h("p", null, h("button", { type: "button", class: "button", onclick: () => void ask() }, icon("change"), "Let Porchlight make this change…"));
		if (state.state === "loading" || state.state === "sending") return h("p", { class: "assist-wait" }, icon("pending"), state.state === "loading" ? "Preparing the request…" : "Sending it to Cloudflare…");
		if (state.state === "failed") return h("div", null, banner("error", "The change could not be made", [state.error]), h("button", { type: "button", class: "button", onclick: () => void ask() }, "Try again"));
		if (state.state === "done") {
			return h(
				"p",
				null,
				h("span", { class: `severity ${state.ok ? "status-good" : "status-warning"}` }, icon(state.ok ? "good" : "warning"), state.ok ? "Applied" : "Not applied"),
				" ",
				state.result,
			);
		}
		const { pending } = state;
		const request = [`${pending.request.method} ${pending.request.url}`, ...Object.entries(pending.request.headers).map(([name, value]) => `${name}: ${value}`), "", JSON.stringify(pending.request.body, null, 2)].join("\n");
		return h(
			"div",
			{ class: "cf-approval", role: "group", "aria-label": `Approve: ${pending.title}` },
			h("p", null, h("strong", null, pending.title), h("span", { class: "hint block" }, `Porchlight will send exactly this request to Cloudflare, once, if you approve it. The token needs "${pending.permission}". It is recorded below either way.`)),
			h("pre", { class: "cf-request", tabindex: "0" }, h("code", null, request)),
			h(
				"div",
				{ class: "actions" },
				h("button", { type: "button", class: "button primary", onclick: () => void answer(pending.id, true) }, "Approve and send"),
				h("button", { type: "button", class: "button", onclick: () => void answer(pending.id, false) }, "Cancel"),
				h("span", { class: "hint" }, `You can approve it until ${formatWhen(pending.expiresAt)}.`),
			),
		);
	}

	/** With a project in use, exports go into its folder unless the owner chooses to download. */
	let exportTo = "project";

	function exportCard() {
		const project = currentProject();
		/** @param {string} format */
		const save = async (format) => {
			try {
				if (project && exportTo === "project") {
					const { saved } = await api("POST", `/cloudflare/export?format=${format}`);
					announceSaved(saved);
					return;
				}
				const name = await download(`/cloudflare/export?format=${format}`);
				toast(`Saved ${name}`);
			} catch (err) {
				toast(err instanceof Error ? err.message : String(err), "error");
			}
		};
		return h(
			"div",
			{ class: "card full" },
			h("h2", null, "Export"),
			h("p", { class: "sub" }, "The whole audit, problems first, with each fix. Never the token."),
			h(
				"div",
				{ class: "actions" },
				project
					? select(
							"Where to export",
							[
								["project", `Save in ${project.name}`],
								["download", "Download"],
							],
							exportTo,
							(value) => {
								exportTo = value;
							},
						)
					: null,
				...[
					["md", "Markdown"],
					["html", "HTML"],
					["csv", "CSV"],
					["json", "JSON"],
				].map(([format, label]) => h("button", { type: "button", class: "button", onclick: () => void save(/** @type {string} */ (format)) }, icon("download"), label)),
			),
		);
	}

	/** @param {CfReport} report */
	function analysisCard(report) {
		const assistant = store.settings?.assistant;
		if (!assistant?.configured) {
			return h("div", { class: "card full" }, h("h2", null, "Analysis by a model"), h("p", { class: "sub" }, ...stepNodes("Optional. Choose a model in Settings → Model to have it read this audit and suggest what to fix first. The rules above need none.")));
		}
		const where = assistant.hosted ? `${assistant.model}, through its provider's API (${assistant.host}): what this page shows leaves your machines` : `${assistant.model} at ${assistant.host}`;
		const action = assistAction(`cloudflare ${report.checkedAt}`, "/assist/cloudflare", assistant, { start: "Analyse with the model", busy: "Analysing…", again: "Analyse again", note: "Advice only: it changes no check, severity or fix above." }, () => ({}));
		return h(
			"div",
			{ class: "card full" },
			h("h2", null, "Analysis by a model"),
			h("p", { class: "sub" }, `Optional. Sends ${where}: the checks as this page shows them. Never the token, members' emails, token names or ownership records.`),
			h("p", null, action.button),
			action.panel,
		);
	}

	function changesCard() {
		const log = store.cloudflare.changes;
		if (log.length === 0) return null;
		return h(
			"div",
			{ class: "card full" },
			h("h2", null, "Changes Porchlight made"),
			h("p", { class: "sub" }, "Each one after you approved the exact request, newest first."),
			h(
				"ul",
				{ class: "plain-list" },
				...log.map((entry) =>
					h(
						"li",
						null,
						h("span", { class: `severity ${entry.ok ? "status-good" : "status-warning"}` }, icon(entry.ok ? "good" : "warning"), entry.ok ? "Applied" : "Refused"),
						" ",
						h("strong", null, entry.title),
						h("span", { class: "hint block" }, `${formatWhen(entry.at)} · ${entry.request.method} ${entry.request.url} · ${entry.result}`),
					),
				),
			),
		);
	}
}

/**
 * What to do when no token is connected yet.
 *
 * @param {boolean} service
 */
function connectCard(service) {
	return h(
		"div",
		{ class: "card full" },
		h("h2", null, "Connect your Cloudflare account"),
		h(
			"p",
			null,
			...stepNodes(
				service
					? 'Make a read-only API token on Cloudflare (Settings → Cloudflare lists the permissions). In BoxPilot, open Apps → Porchlight → Settings, paste it into "Cloudflare API token" and confirm. Porchlight restarts with it.'
					: "Make a read-only API token on Cloudflare and paste it in Settings → Cloudflare. That section lists the permissions it needs and opens Cloudflare's token page for you.",
			),
		),
		service ? null : h("p", null, h("a", { class: "button primary", href: "#/settings/cloudflare" }, "Connect in Settings")),
		h("p", { class: "hint" }, "The token stays on this computer and goes only to Cloudflare's API. No model ever sees it."),
	);
}
