// @ts-check
// "Cloudflare": the audit of the owner's Cloudflare account. Built-in rules judge every zone; this
// page starts the audit, follows it, and shows what it found, worst first, with each fix. A change
// Porchlight can make is shown as the exact request and sent only when the owner approves it here
// (invariant 21). Every element is built with h(): record names and values come from DNS, which
// others can influence, and are never treated as HTML.
import { activityList } from "./activity.js";
import { api, ApiError, download } from "./api.js";
import { assistAction } from "./assist.js";
import { announce, banner, formatNumber, formatWhen, h, icon, pager, plural, replace, scrollMotion, select, setOff, severityBadge, shownText, statTile, stepNodes, tileRow, toast } from "./dom.js";
import { fixBrief, fixGroups, tokenFixSteps } from "./hints.js";
import { debounce, paginate } from "./list.js";
import { announceSaved } from "./projects.js";
import { currentProject, load, loadCloudflare, startCloudflareAudit, store, subscribe, updateCloudflare } from "./store.js";

/** @typedef {import("../src/cloudflare/types.ts").CfCheck} CfCheck */
/** @typedef {ReturnType<typeof import("../src/cloudflare/apply.ts").describeChange>} PendingChange */
/** @typedef {import("../src/cloudflare/types.ts").CfReport} CfReport */
/** @typedef {import("../src/cloudflare/types.ts").CfZoneReport} CfZoneReport */
/** @typedef {import("./store.js").AppliedChange} AppliedChange */
/**
 * @typedef {(
 *   | { state: "loading" }
 *   | { state: "shown", pending: { id: string, title: string, permission: string, care?: string, expiresAt: string, request: { method: string, url: string, headers: Record<string, string>, body: unknown } } }
 *   | { state: "sending" }
 *   | { state: "done", ok: boolean, result: string }
 *   | { state: "failed", error: string }
 * )} ChangeState
 */

const AREA_TITLES = /** @type {const} */ ({ tls: "SSL/TLS", dns: "DNS", email: "Email", firewall: "Firewall and bots", ownership: "Proof of ownership", account: "Account" });
const SEVERITIES = /** @type {const} */ (["critical", "high", "medium", "low"]);

/** Domains shown at a time, and changes in the log. */
const ZONE_PAGE = 10;
const CHANGE_PAGE = 20;

/**
 * Changes asked for while the page is open, by audit, zone and change, so a redraw keeps the request
 * on show. Keyed by the audit's time: after a new audit a problem that came back is offered again,
 * not shown as "Applied" from before (UI-B12).
 *
 * @type {Map<string, ChangeState>}
 */
const changes = new Map();

/**
 * @param {HTMLElement} view
 * @param {import("./finding-parts.js").Route} route the zones' filter and page live in its address
 * @returns {Promise<() => void>}
 */
export async function renderCloudflare(view, route) {
	await load();
	await loadCloudflare();
	const lookups = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", name: "lookups", checked: true }));
	const button = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "button primary" }, "Audit my account"));
	// Not a live region: the bar moves every second. A screen reader hears the start, then where it is twice a minute, then the end.
	const statusSlot = h("div");
	const intro = h("div");
	const results = h("div");
	/** Which domains are listed: those with something to look at, or all; matching a name; which page. */
	let zoneShow = route.params.get("zones") === "all" ? "all" : "problems";
	let zoneQuery = route.params.get("q") ?? "";
	let zonePage = Number(route.params.get("page")) || 1;
	let changePage = 1;
	const zoneSlot = h("div");
	/** What the results were last drawn from: a poll that changes none of it redraws only the status (F-F2). */
	let drawnFrom = "";
	/** The audit's state last said to a screen reader. */
	let said = "";
	/** With a project in use, exports go into its folder unless the owner chooses to download. */
	let exportTo = "project";
	/**
	 * "Fix these": the changes shown and waiting for one answer, with the ones left unticked.
	 *
	 * @type {{ id: string, expiresAt: string, scope: string, changes: PendingChange[], offered: number, left: Set<string> } | null}
	 */
	let batch = null;
	let batchBusy = false;
	const batchSlot = h("div");
	/** The live activity under a set of changes being sent, from the moment they were approved. */
	/** @type {ReturnType<typeof activityList> | null} */
	let batchActivity = null;

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
		if (change === "cloudflare") drawStatus();
		else if (change === "settings" || change === "projects") draw();
	});
	return () => {
		unsubscribe();
		batchActivity?.stop();
	};

	/** @param {CfZoneReport | null} zone one domain, or null for every domain of the audit */
	async function previewBatch(zone) {
		if (batchBusy) return;
		batchBusy = true;
		try {
			const answer = await api("POST", "/cloudflare/changes/batch/preview", zone ? { zone: zone.id } : {});
			// A change that could affect the site starts unticked: it is the owner's to choose, never Porchlight's.
			const careful = /** @type {PendingChange[]} */ (answer.batch.changes).filter((change) => change.care).map((change) => change.id);
			batch = { ...answer.batch, offered: typeof answer.batch.offered === "number" ? answer.batch.offered : answer.batch.changes.length, scope: zone ? zone.name : "every domain", left: new Set(careful) };
		} catch (err) {
			toast(err instanceof Error ? err.message : String(err), "error");
		} finally {
			batchBusy = false;
		}
		if (batch) {
			drawBatch();
			// Focus goes to the requests to approve, not only the view (F-U3).
			batchSlot.scrollIntoView({ block: "start", behavior: scrollMotion() });
			/** @type {HTMLElement | null} */ (batchSlot.querySelector("h2"))?.focus({ preventScroll: true });
		}
	}

	/** @param {boolean} approve */
	async function answerBatch(approve) {
		const waiting = batch;
		if (!waiting || batchBusy) return;
		batchBusy = true;
		try {
			const include = waiting.changes.filter((change) => !waiting.left.has(change.id)).map((change) => change.id);
			const before = (await api("GET", "/activity?after=0")).last;
			const reply = await api("POST", "/cloudflare/changes/batch/approve", { id: waiting.id, approve, ...(approve ? { include } : {}) });
			batch = null;
			if (reply.started) {
				batchActivity?.stop();
				batchActivity = activityList({ since: before, limit: 600 });
				await loadCloudflare();
			}
		} catch (err) {
			toast(err instanceof Error ? err.message : String(err), "error");
			if (err instanceof ApiError && err.status === 409) batch = null;
		} finally {
			batchBusy = false;
			drawBatch();
		}
	}

	/**
	 * What to do about permissions Cloudflare refused this token: the steps, with where to go.
	 *
	 * @param {string} title
	 */
	function permissionHelp(title) {
		const lacking = store.cloudflare.lacking;
		if (lacking.length === 0) return null;
		return h(
			"div",
			{ class: "banner banner-warning cf-next", role: "note" },
			icon("warning"),
			h(
				"div",
				null,
				h("strong", null, title),
				h("p", null, "Your token is read-only for this, which is how Porchlight asks you to start. To let it make these changes:"),
				h("ol", { class: "host-fix" }, ...tokenFixSteps(lacking.map((name) => ({ name, scope: "Zone" })), "change").map((step) => h("li", null, ...stepNodes(step)))),
			),
		);
	}

	/** The card for a set of changes: the requests to approve, then their progress, then what happened. */
	function drawBatch() {
		const status = store.cloudflare.batch;
		if (batch) {
			const waiting = batch;
			const chosen = waiting.changes.length - waiting.left.size;
			const permissions = [...new Set(waiting.changes.map((change) => change.permission))];
			replace(
				batchSlot,
				h(
					"div",
					{ class: "card full cf-batch", role: "group", "aria-label": `Fix these: ${waiting.scope}` },
					h("h2", { tabindex: "-1" }, `Fix these: ${waiting.scope}`),
					h(
						"p",
						null,
						`Porchlight will send exactly these ${plural(waiting.changes.length, "request", "requests")} to Cloudflare, one after another, each once, if you approve. Untick any you do not want. Nothing else is sent, and each is recorded below whether Cloudflare accepts it or not.`,
					),
					// One approval covers at most MAX_BATCH (apply.ts); the rest are said, not dropped in silence (F-F5).
					waiting.offered > waiting.changes.length
						? banner("warning", `These are ${waiting.changes.length} of the ${waiting.offered} changes the audit offers`, [
								"One approval covers that many at most. Once these are sent, audit again, then use Fix these for the rest.",
							])
						: null,
					h("p", { class: "hint" }, `The token needs ${permissions.map((permission) => `"${permission}"`).join(" and ")}. If it lacks one, the first request that needs it is refused and the rest that need it are not sent.`),
					waiting.changes.some((change) => change.care)
						? banner("warning", `${plural(waiting.changes.filter((change) => change.care).length, "change needs", "changes need")} a look first, and start unticked`, [
								"Each can affect how a site or its mail behaves, and says how under its name. Tick the ones you have decided on.",
							])
						: null,
					waiting.changes.some((change) => change.care)
						? h(
								"div",
								{ class: "actions" },
								h(
									"button",
									{
										type: "button",
										class: "button quiet",
										onclick: () => {
											waiting.left = tickAllPlain(waiting.changes, waiting.left);
											drawBatch();
										},
									},
									"Tick all without a warning",
								),
								h(
									"button",
									{
										type: "button",
										class: "button quiet",
										onclick: () => {
											for (const change of waiting.changes) if (change.care) waiting.left.add(change.id);
											drawBatch();
										},
									},
									"Untick the ones with a warning",
								),
							)
						: null,
					h(
						"ul",
						{ class: "cf-batch-list" },
						...waiting.changes.map((change) => {
							const box = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", checked: !waiting.left.has(change.id) }));
							box.addEventListener("change", () => {
								if (box.checked) waiting.left.delete(change.id);
								else waiting.left.add(change.id);
								drawBatch();
							});
							return h(
								"li",
								null,
								h("label", { class: "check-line" }, box, h(
									"span",
									null,
									h("strong", null, change.title),
									change.care ? h("span", { class: "hint block cf-care" }, icon("warning"), " ", change.care) : null,
									h("code", { class: "hint block" }, `${change.request.method} ${change.request.url}  ${JSON.stringify(change.request.body)}`),
								),
							),
							);
						}),
					),
					h("p", { class: "hint" }, "Every request carries the header Authorization: Bearer (your saved token, not shown)."),
					h(
						"div",
						{ class: "actions" },
						h("button", { type: "button", class: "button primary", "aria-disabled": chosen === 0 || batchBusy ? "true" : null, onclick: () => chosen > 0 && void answerBatch(true) }, `Approve and send ${chosen}`),
						h("button", { type: "button", class: "button", "aria-disabled": batchBusy ? "true" : null, onclick: () => void answerBatch(false) }, "Cancel"),
						h("span", { class: "hint" }, `You can approve them until ${formatWhen(waiting.expiresAt)}.`),
					),
				),
			);
			return;
		}
		if (status.state === "idle") return replace(batchSlot);
		// A set sent before this page was opened: its lines are still in the server's activity.
		batchActivity ??= activityList({ limit: 600 });
		const counts = `${status.applied} applied, ${status.failed} refused, ${status.skipped} not sent`;
		replace(
			batchSlot,
			h(
				"div",
				{ class: "card full cf-batch" },
				h("h2", null, status.state === "running" ? "Sending your changes" : status.stopped ? "Changes stopped" : "Changes sent"),
				status.state === "running"
					? h(
							"div",
							{ class: "host-progress" },
							h("strong", null, `${Math.min(status.done + 1, status.total)} of ${status.total}: ${status.current || "starting"}`),
							h("progress", { max: status.total, value: status.done, "aria-label": "Changes sent" }),
						)
					: h("p", null, h("span", { class: `severity ${status.failed + status.skipped === 0 ? "status-good" : "status-warning"}` }, icon(status.failed + status.skipped === 0 ? "good" : "warning"), `${counts}.`), " Audit again to see what changed."),
				status.state === "running"
					? h(
							"div",
							{ class: "actions" },
							h("button", { type: "button", class: "button danger", onclick: () => void api("POST", "/cloudflare/changes/batch/stop").catch(() => {}) }, "Stop"),
							h("span", { class: "hint" }, `${counts} so far. Stopping leaves what was already sent in place.`),
						)
					: null,
				status.state === "finished" ? permissionHelp("Cloudflare refused these because of the token's permissions") : null,
				batchActivity.node,
				h("p", { class: "hint" }, "The same lines, with everything else Porchlight is doing, are on the ", h("a", { href: "#/activity" }, "Activity"), " page."),
			),
		);
	}

	/** Everything: the form, the status and the results. */
	function draw() {
		drawnFrom = "";
		drawStatus();
	}

	/**
	 * What a poll changes: the button, the progress and a set of changes being sent. The report under it
	 * is drawn again only when a new audit, a change or the token's state says so, so a section the owner
	 * opened stays open while the audit runs (F-F2, UI-B12).
	 */
	function drawStatus() {
		drawBatch();
		const state = store.cloudflare;
		const running = state.status.state === "running";
		setOff(button, running || !state.token.configured);
		button.textContent = running ? "Auditing…" : state.report ? "Audit again" : "Audit my account";
		if (state.status.state === "running") {
			const status = state.status;
			const known = status.total > 0;
			const where = known && status.current ? `Reading ${Math.min(status.done + 1, status.total)} of ${status.total}: ${status.current}` : "Starting";
			replace(
				statusSlot,
				h(
					"div",
					{ class: "host-progress" },
					h("strong", null, where),
					h("progress", { max: known ? status.total : null, value: known ? status.done : null, "aria-label": "Audit progress" }),
				),
			);
			if (said !== "running") announce("The audit started", { topic: "cloudflare" });
			else announce(where, { topic: "cloudflare", every: 30_000 });
		} else if (state.status.state === "failed") {
			// Said once: a later redraw with the same failure leaves the alert as it is.
			const text = `The audit stopped: ${state.status.error}`;
			if (statusSlot.textContent !== text) replace(statusSlot, h("p", { class: "form-error", role: "alert" }, text));
		} else {
			replace(statusSlot);
			if (said === "running" && state.status.state === "done") announce("The audit finished");
		}
		said = state.status.state;
		const from = [state.report?.checkedAt ?? "", state.changes.length, state.token.configured, state.canChange, state.lacking.join(","), state.batch.state].join("|");
		if (from === drawnFrom) return;
		drawnFrom = from;
		replace(intro, state.token.configured ? form : connectCard(state.service));
		replace(results, batchSlot, ...(state.report ? drawReport(state.report) : state.token.configured ? [h("p", { class: "sub" }, "Your account has not been audited yet.")] : []), changesCard());
	}

	/** Writes the zones' filter and page into the address, so a reload or a shared link keeps them. */
	function rememberZones() {
		route.replace({ zones: zoneShow === "all" ? "all" : undefined, q: zoneQuery.trim() || undefined, page: zonePage > 1 ? zonePage : undefined });
	}

	/**
	 * Every domain of the audit as a card, a page at a time, with those needing a look first by default
	 * and a box to find one by name (F-D1).
	 *
	 * @param {CfReport} report
	 */
	function zonesSection(report) {
		const needsLook = (/** @type {CfZoneReport} */ zone) => zone.checks.some((item) => item.status === "failed" || item.status === "unknown");
		const looking = report.zones.filter(needsLook).length;
		const search = /** @type {HTMLInputElement} */ (
			h("input", {
				type: "search",
				value: zoneQuery,
				placeholder: "Find a domain",
				"aria-label": "Find a domain",
				oninput: debounce(() => {
					zoneQuery = search.value;
					zonePage = 1;
					drawZones();
				}, 150),
			})
		);
		const drawZones = () => {
			const query = zoneQuery.trim().toLowerCase();
			const chosen = report.zones.filter((zone) => (zoneShow === "all" || needsLook(zone)) && (query === "" || zone.name.toLowerCase().includes(query)));
			const shown = paginate(chosen, zonePage, ZONE_PAGE);
			zonePage = shown.page;
			rememberZones();
			replace(
				zoneSlot,
				chosen.length === 0
					? h("p", { class: "sub" }, query ? "No domain matches that name." : zoneShow === "problems" ? "No domain has anything to look at. Show all domains to see each one's checks." : "No domains.")
					: null,
				...shown.items.map((zone) => zoneCard(zone)),
				pager(shown, "domains", (next) => {
					zonePage = next;
					drawZones();
					/** @type {HTMLElement | null} */ (view.querySelector("#cf-zones-title"))?.focus();
				}),
			);
		};
		drawZones();
		return h(
			"section",
			{ class: "cf-zones", "aria-labelledby": "cf-zones-title" },
			h("h2", { id: "cf-zones-title", tabindex: "-1" }, `Domains (${formatNumber(report.zones.length)})`),
			h(
				"div",
				{ class: "filters" },
				h("div", { class: "field grow" }, search),
				select(
					"Which domains",
					[
						["problems", `With something to look at (${formatNumber(looking)})`],
						["all", `All domains (${formatNumber(report.zones.length)})`],
					],
					zoneShow,
					(value) => {
						zoneShow = value === "all" ? "all" : "problems";
						zonePage = 1;
						drawZones();
					},
				),
			),
			zoneSlot,
		);
	}

	/** @param {CfReport} report */
	function drawReport(report) {
		const checks = [...report.zones.flatMap((zone) => zone.checks), ...report.accounts.flatMap((account) => account.checks), ...report.userChecks];
		const failed = checks.filter((item) => item.status === "failed");
		const unknown = checks.filter((item) => item.status === "unknown");
		const passed = checks.filter((item) => item.status === "passed");
		const refused = report.permissions.filter((permission) => permission.granted === false);
		// Reading the owner's own tokens is a permission of the user, not of an account or a zone, and a
		// token given every account and zone permission still lacks it. It is said quietly, not as a fault.
		const denied = refused.filter((permission) => !isOptional(permission));
		const optional = refused.filter(isOptional);
		const token = report.token;
		return [
			h(
				"p",
				{ class: "sub scan-line" },
				`Last audited ${formatWhen(report.checkedAt)} · ${plural(report.zones.length, "domain", "domains")} · ${token.kind === "account" ? "account token" : "user token"}${token.expiresOn ? `, expiring ${formatWhen(token.expiresOn)}` : ""}.`,
			),
			tileRow(
				statTile("Problems", failed.length),
				statTile("Could not check", unknown.length, unknown.length > 0 ? icon("pending") : null),
				statTile("Passed", passed.length, icon("good")),
				statTile("Domains", report.zones.length, icon("cloudflare")),
			),
			failed.length > 0
				? h(
						"div",
						{ class: "cf-severities", "aria-label": "Problems by severity" },
						...SEVERITIES.map((severity) => h("span", { class: "cf-severity-count" }, severityBadge(severity), h("strong", null, failed.filter((item) => item.severity === severity).length.toLocaleString("en-GB")))),
					)
				: null,
			denied.length > 0
				? h(
						"div",
						null,
						banner(
							"warning",
							"This token could not read everything, so some checks say Could not check",
							denied.map((permission) => `"${permission.name}" is missing: it reads ${permission.purpose}.`),
						),
						h(
							"details",
							{ class: "cf-next-read", open: true },
							h("summary", null, "How to add them"),
							h("ol", { class: "host-fix" }, ...tokenFixSteps(denied, "read").map((step) => h("li", null, ...stepNodes(step)))),
						),
					)
				: null,
			optional.length > 0
				? h(
						"p",
						{ class: "hint" },
						`One optional check was not made: your own API tokens and how broad they are. It needs "User, API Tokens, Read", which belongs to your user and is not among a token's account or zone permissions. If Cloudflare's token editor does not offer it, leave it: every other check is complete.`,
					)
				: null,
			report.zonesSkipped > 0 ? banner("warning", `${report.zonesSkipped} more domains were not audited`, ["An audit covers the first 200 domains of an account."]) : null,
			fixable(report.zones) > 0 && store.cloudflare.canChange
				? h(
						"div",
						{ class: "card full" },
						h("h2", null, "Fix what Porchlight can"),
						h(
							"p",
							{ class: "sub" },
							`${plural(fixable(report.zones), "problem has", "problems have")} a change Porchlight can make for you, across ${plural(report.zones.filter((zone) => fixable([zone]) > 0).length, "domain", "domains")}. You see every request first and approve them once; each domain below also has its own Fix these.`,
						),
						h("button", { type: "button", class: "button primary", onclick: () => void previewBatch(null) }, icon("change"), "Fix these…"),
						store.cloudflare.batch.state === "idle" ? permissionHelp("The last change was refused because of the token's permissions") : null,
					)
				: null,
			remainingCard(report),
			// Said before the domains, so they are not at the foot of a long list (F-D1).
			h(
				"details",
				{ class: "card full cf-not-covered" },
				h("summary", null, h("h2", null, `Not covered (${formatNumber(report.notCovered.length)})`)),
				h("p", { class: "sub" }, "A clean result here does not mean these are safe:"),
				h("ul", { class: "host-not-covered" }, ...report.notCovered.map((line) => h("li", null, line))),
			),
			exportCard(),
			analysisCard(report),
			...report.accounts.map((account) => groupCard(`Account: ${account.name}`, null, account.checks, null)),
			report.userChecks.length > 0 ? groupCard("Your user", null, report.userChecks, null) : null,
			zonesSection(report),
		].filter((node) => node !== null);
	}

	/**
	 * What is left, by fix: each kind of problem once, with the domains it affects, so the same repair
	 * is read once and not twenty times. The whole list can be copied as a brief for a model.
	 *
	 * @param {CfReport} report
	 */
	function remainingCard(report) {
		const groups = fixGroups(report.zones);
		if (groups.length === 0) return null;
		const mine = groups.reduce((count, group) => count + group.fixable, 0);
		const applied = store.cloudflare.changes.filter((change) => change.ok).length;
		const copy = async () => {
			try {
				await navigator.clipboard.writeText(shownText(fixBrief(groups, formatWhen(report.checkedAt))));
				toast("Copied. Paste it into Claude, or any model that can act on your Cloudflare account.");
			} catch {
				toast("Could not copy. Use Export below instead.", "error");
			}
		};
		return h(
			"div",
			{ class: "card full" },
			h("h2", null, "What is left, by fix"),
			h(
				"p",
				{ class: "sub" },
				mine > 0
					? `${plural(groups.length, "kind of problem", "kinds of problem")}. Porchlight can make ${plural(mine, "of these changes", "of these changes")} itself: use Fix these above. The rest need a decision from you or work on your server.`
					: `${plural(groups.length, "kind of problem", "kinds of problem")}.${applied > 0 ? ` Porchlight has made every change it can make itself (${applied} so far), so there is no Fix these button now.` : ""} What is left needs a decision from you or work on your server, so Porchlight does not do it for you.`,
			),
			h(
				"div",
				{ class: "actions" },
				h("button", { type: "button", class: "button primary", onclick: () => void copy() }, icon("copy"), "Copy all as a brief for a model"),
				h("span", { class: "hint" }, "Plain text: each problem, its domains and its fix. No token, member or record value. Paste it where your model can reach Cloudflare."),
			),
			h(
				"div",
				{ class: "host-list" },
				...groups.map((group) =>
					h(
						"div",
						{ class: "host-check host-failed" },
						h("div", { class: "host-check-head" }, severityBadge(/** @type {any} */ (group.severity)), h("strong", null, group.title), h("span", { class: "hint" }, plural(group.zones.length, "domain", "domains"))),
						h("p", { class: "hint" }, group.why),
						h("details", { class: "fix-details" }, h("summary", null, "Which domains"), h("ul", null, ...group.zones.map((name) => h("li", null, h("code", null, name))))),
						group.fix.length > 0 ? h("ol", { class: "host-fix" }, ...group.fix.map((step) => h("li", null, ...stepNodes(step)))) : null,
					),
				),
			),
		);
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
			zoneActions(zone),
		);
		return groupCard(zone.name, head, zone.checks, zone);
	}

	/**
	 * Where else this domain can go: the monitor's watch list, and an investigation. Each only adds
	 * the name to that page's list; proving ownership and starting anything happen there.
	 *
	 * @param {CfZoneReport} zone
	 */
	function zoneActions(zone) {
		const watched = store.settings?.monitor.configured === true;
		const watch = async () => {
			try {
				await api("POST", "/domains", { domain: zone.name });
			} catch (err) {
				// Already on the list is fine: show it there.
				if (!(err instanceof ApiError && err.status === 409)) return toast(err instanceof Error ? err.message : String(err), "error");
			}
			location.hash = `#/domains/${encodeURIComponent(zone.name)}`;
		};
		const investigate = async () => {
			try {
				await api("POST", "/investigate/domains", { domain: zone.name });
				location.hash = "#/investigate";
			} catch (err) {
				toast(err instanceof Error ? err.message : String(err), "error");
			}
		};
		return h(
			"span",
			{ class: "cf-zone-actions" },
			store.cloudflare.canChange && fixable([zone]) > 0
				? h("button", { type: "button", class: "button quiet", title: `See every change Porchlight can make for ${zone.name}, and approve them once`, onclick: () => void previewBatch(zone) }, icon("change"), `Fix these (${fixable([zone])})…`)
				: null,
			watched
				? h("button", { type: "button", class: "button quiet", title: `Add ${zone.name} to the websites the monitor watches`, onclick: () => void watch() }, icon("domains"), "Watch in Domains")
				: h("a", { class: "button quiet", href: "#/domains", title: "Set up the monitor first" }, icon("domains"), "Set up watching"),
			store.cloudflare.canChange ? h("button", { type: "button", class: "button quiet", title: `Add ${zone.name} to the domains a model can investigate`, onclick: () => void investigate() }, icon("investigate"), "Investigate") : null,
		);
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
		const key = `${store.cloudflare.report?.checkedAt ?? ""} ${zone.id} ${check.change}`;
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
					updateCloudflare({ changes: reply.changes, lacking: reply.lacking });
					toast(reply.ok ? "Change applied. Audit again to see it." : reply.notSent ? "Not sent: the setting is not what the audit found" : "Cloudflare refused the change", reply.ok ? "info" : "error");
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
			pending.care ? banner("warning", "Read this before you approve", [pending.care]) : null,
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
		// The log only grows, so it is paged (UI-B13).
		const card = h("div", { class: "card full" });
		const fill = () => {
			const shown = paginate(log, changePage, CHANGE_PAGE);
			changePage = shown.page;
			replace(
				card,
				h("h2", null, "Changes Porchlight made"),
				h("p", { class: "sub" }, "Each one after you approved the exact request, newest first. Just before sending, Porchlight reads the current value; a change no longer needed is not sent."),
				changeList(shown.items),
				pager(shown, "changes", (next) => {
					changePage = next;
					fill();
				}),
			);
		};
		fill();
		return card;
	}

	/** @param {AppliedChange[]} log */
	function changeList(log) {
		return h(
				"ul",
				{ class: "plain-list" },
				...log.map((entry) =>
					h(
						"li",
						null,
						h("span", { class: `severity ${entry.ok ? "status-good" : "status-warning"}` }, icon(entry.ok ? "good" : "warning"), entry.ok ? "Applied" : /** @type {{ notSent?: boolean }} */ (entry).notSent ? "Not sent" : "Refused"),
						" ",
						h("strong", null, entry.title),
						h("span", { class: "hint block" }, `${formatWhen(entry.at)} · ${entry.request.method} ${entry.request.url} · ${entry.result}`),
					),
				),
		);
	}
}

/**
 * "Tick all" in Fix these: ticks every change without a warning and leaves each one with a warning as
 * the owner set it. Those are the owner's to choose one by one, never Porchlight's (invariant 21, F-U4).
 *
 * @param {readonly { id: string, care?: string }[]} changes
 * @param {ReadonlySet<string>} left the ids left unticked
 * @returns {Set<string>} the ids left unticked afterwards
 */
export function tickAllPlain(changes, left) {
	const careful = new Set(changes.filter((change) => change.care).map((change) => change.id));
	return new Set([...left].filter((id) => careful.has(id)));
}

/**
 * Whether a missing permission is one the audit is complete without: the one that reads the owner's own tokens.
 *
 * @param {{ name: string, scope: string }} permission
 */
export function isOptional(permission) {
	return permission.scope === "User" && permission.name === "API Tokens Read";
}

/**
 * How many problems in these zones come with a change Porchlight can make.
 *
 * @param {readonly CfZoneReport[]} zones
 */
export function fixable(zones) {
	return zones.reduce((count, zone) => count + zone.checks.filter((check) => check.status === "failed" && check.change).length, 0);
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
