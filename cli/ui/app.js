// @ts-check
import { renderActivity } from "./activity.js";
import { adoptSessionKey, api, ApiError, hasSessionKey, setOfflineMessage, setSessionKey } from "./api.js";
import { announce, emptyState, formatNumber, formatWhen, h, icon, isOff, pageVisibility, plural, replace, scrollMotion, severityBadge, shownText, stepNodes, toast } from "./dom.js";
import { poller } from "./poller.js";
import { keyRejectedWords, offlineWords } from "./hints.js";
import { renderCloudflare } from "./cloudflare.js";
import { renderDiscussions } from "./discussions.js";
import { renderDomains } from "./domains.js";
import { renderFindings } from "./findings.js";
import { renderInvestigate } from "./investigate.js";
import { hostName, renderHost } from "./host.js";
import { applyLook, homeSection, rememberedLook } from "./appearance.js";
import { buildHash, isPageAddress, parseHash } from "./list.js";
import { settingsAnchor } from "./paths.js";
import { renderOverview } from "./overview.js";
import { projectSwitcher } from "./projects.js";
import { renderByRepo } from "./repos.js";
import { renderRoadmap } from "./roadmap.js";
import { renderSettings } from "./settings.js";
import { findingRows, load, reset, store, subscribe } from "./store.js";
import { changeSummary, rescanWords } from "./tracking.js";

const view = /** @type {HTMLElement} */ (document.getElementById("view"));
const nav = /** @type {HTMLElement} */ (document.getElementById("nav"));
const scanStatus = /** @type {HTMLElement} */ (document.getElementById("scan-status"));
/** Help and the version, at the foot of the sidebar on every page (R6U-6, R6Q-4). */
const aboutLine = h("p", { class: "about-line" });
scanStatus.after(aboutLine);

const SECTIONS = /** @type {const} */ ([
	["overview", "Overview"],
	["findings", "Findings"],
	["roadmap", "Roadmap"],
	["domains", "Domains"],
	["cloudflare", "Cloudflare"],
	["investigate", "Investigate"],
	["host", "This Mac"],
	["discussions", "Discussions"],
	["activity", "Activity"],
	["settings", "Settings"],
]);

// The last look this browser showed, until the server says which was chosen.
applyLook(rememberedLook());

/** Stops whatever the current page left running. */
let leave = () => {};
/** Guards against a slow page finishing after the user has moved on. */
let navigation = 0;
let firstRoute = true;
/** The state of the last scan the sidebar announced, so "finished" is said once. */
let announced = "";

const WAITING_MARK = "(Waiting) ";

/** Says which of the two jobs a section belongs to, above the first section of each. */
const GROUPS = /** @type {Record<string, string>} */ ({ findings: "Your code", domains: "Your domains", host: "Your computer", discussions: "Porchlight" });
const findingCount = h("span", { class: "count" });
/** "1 waiting" beside Investigate, while a step waits for the owner's approval (E-Q1). */
const waitingCount = h("span", { class: "count count-waiting" });
const HELP_URL = "https://github.com/AES256Afro/porchlight#readme";
/** "This Mac", or "This computer" when Porchlight runs on something else. */
const hostLabel = h("span", null, "This Mac");

replace(
	nav,
	...SECTIONS.flatMap(([key, label]) => [
		GROUPS[key] ? h("span", { class: "nav-group" }, GROUPS[key]) : null,
		h("a", { href: `#/${key}`, dataset: { nav: key } }, icon(key), key === "host" ? hostLabel : label, key === "findings" ? findingCount : key === "investigate" ? waitingCount : null),
	]),
);
// Which project saved exports, discussions and the log go to, above the sections.
nav.before(projectSwitcher());
/** Counts by severity in the sidebar; shown only by the "Severity dashboard" look. */
const severityStrip = h("div", { class: "severity-strip", "aria-label": "Findings by severity" });
scanStatus.before(severityStrip);
subscribe((change) => {
	if (change === "settings" && store.settings) {
		applyLook(store.settings.appearance);
		hostLabel.textContent = shownText(hostName());
		replace(
			aboutLine,
			h("a", { href: HELP_URL, target: "_blank", rel: "noopener noreferrer", title: "Opens the documentation on github.com" }, "Help"),
			store.settings.version ? ` · Porchlight ${store.settings.version}` : null,
		);
		setOfflineMessage(offlineWords(store.settings.service ? "service" : inMacApp() ? "mac" : "terminal"));
	}
	drawScanStatus();
});
// The chosen look applies on every page, including the first one opened.
// Opened fresh (from the app or the printed link, not a reload or a shared address): go back to where the owner left off.
const freshStart = location.hash === "" || location.hash === "#" || /^#k=/.test(location.hash);
// The key comes first: a load started without it would fail for every page waiting on it.
adoptSessionKey();
void load()
	.then(() => {
		const last = store.settings?.lastView;
		if (freshStart && last && last !== location.hash && (location.hash === "" || location.hash === "#/overview")) location.replace(last);
	})
	.catch(() => {});

/** Where the owner is, kept by the server as they move, so closing the app at any moment loses nothing. */
let viewTimer = /** @type {ReturnType<typeof setTimeout> | undefined} */ (undefined);
function rememberView() {
	clearTimeout(viewTimer);
	viewTimer = setTimeout(() => {
		if (location.hash.startsWith("#/")) void api("POST", "/view", { view: location.hash }).catch(() => {});
	}, 600);
}

/** For the Mac app, before it quits: what would be lost, one item a line, or "" when nothing would. */
/** @type {any} */ (window).porchlightBusy = async () => {
	try {
		const { busy } = await api("GET", "/busy");
		return Array.isArray(busy) ? busy.join("\n") : "";
	} catch {
		return "";
	}
};
// A Mac app built before the rename asks under the earlier name.
/** @type {any} */ (window).securityxBusy = /** @type {any} */ (window).porchlightBusy;
window.addEventListener("hashchange", route);
// A button marked aria-disabled keeps keyboard focus but does nothing: its click, and a form's submit
// through it (Return in a field), stop here before any handler hears them.
document.addEventListener(
	"click",
	(event) => {
		const off = event.target instanceof Element ? event.target.closest('[aria-disabled="true"]') : null;
		if (off && off.matches("button, a, [role='button'], [role='tab']")) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	},
	true,
);
document.addEventListener(
	"submit",
	(event) => {
		if (isOff(event.submitter)) {
			event.preventDefault();
			event.stopImmediatePropagation();
		}
	},
	true,
);
// "Skip to content" moves focus to the page without changing the address, so the page and its filters stay (B45).
document.querySelector(".skip-link")?.addEventListener("click", (event) => {
	event.preventDefault();
	view.focus();
	view.scrollIntoView({ block: "start" });
});
void route();
followAttention();

/**
 * Whether an investigation step waits for approval, asked every few seconds from any page (E-Q1): the
 * Investigate section shows how many, and the tab's title starts "(Waiting)", so a run does not stall
 * unseen while the owner is elsewhere.
 */
function followAttention() {
	/** @type {string} */
	let lastTitle = "";
	poller({
		every: 4000,
		visibility: pageVisibility(),
		run: async () => {
			if (!hasSessionKey()) return true;
			/** @type {{ approval: { domain: string, waiting: number } | null }} */
			let answer;
			try {
				answer = /** @type {{ approval: { domain: string, waiting: number } | null }} */ (await api("GET", "/attention"));
			} catch {
				// Signed out, or the server away for a moment: asked again later, never given up on.
				return 30_000;
			}
			const { approval } = answer;
			const waiting = approval ? Number(approval.waiting) || 0 : 0;
			waitingCount.textContent = shownText(waiting > 0 ? `${waiting} waiting` : "");
			const marked = document.title.startsWith(WAITING_MARK);
			if (waiting > 0 && !marked) document.title = shownText(`${WAITING_MARK}${document.title}`);
			if (waiting === 0 && marked) document.title = shownText(document.title.slice(WAITING_MARK.length));
			if (approval && waiting > 0 && lastTitle !== approval.domain) announce(`An investigation of ${approval.domain} is waiting for your approval`);
			lastTitle = approval && waiting > 0 ? approval.domain : "";
			return true;
		},
		onGiveUp: () => {},
	}).start();
}

async function route() {
	// On every navigation, not only the first: pasting the printed link into
	// an already-open tab changes the fragment without reloading the page.
	adoptSessionKey();
	// A fragment that is not a page's address ("#view") leaves the page as it is.
	if (!isPageAddress(location.hash)) return;
	const { path, params } = parseHash(location.hash);
	// Addresses from before the pages were reorganised still work.
	if (path[0] === "repos") return void location.replace("#/findings/by-repo");
	const section = SECTIONS.some(([key]) => key === path[0]) ? /** @type {string} */ (path[0]) : homeSection();
	if (path[0] !== section) path.splice(0, path.length, section);

	for (const link of nav.querySelectorAll("a")) {
		if (link.dataset.nav === section) link.setAttribute("aria-current", "page");
		else link.removeAttribute("aria-current");
	}
	// On a phone the sections scroll sideways; the current one is brought into sight.
	if (nav.scrollWidth > nav.clientWidth) {
		const currentLink = /** @type {HTMLElement | null} */ (nav.querySelector('[aria-current="page"]'));
		if (currentLink) nav.scrollTo({ left: currentLink.offsetLeft - (nav.clientWidth - currentLink.offsetWidth) / 2, behavior: scrollMotion() });
	}
	document.title = shownText(`${waitingCount.textContent ? WAITING_MARK : ""}${section === "host" ? hostName() : SECTIONS.find(([key]) => key === section)?.[1]} · Porchlight`);

	leave();
	leave = () => {};
	const current = ++navigation;
	if (!view.hasChildNodes()) replace(view, h("p", { class: "loading" }, "Loading…"));
	// Each page draws into a slot of its own, put on screen only while it is still the page asked for:
	// one that finishes after the owner has moved on draws nothing over the page they moved to (B43).
	const slot = h("div", { class: "view-slot" });
	// The last page stays on screen, dimmed, until the next one is ready (base.css delays the dimming, so a quick page does not flicker).
	view.setAttribute("aria-busy", "true");
	view.classList.add("is-loading");
	/** @type {import("./finding-parts.js").Route} */
	const context = {
		path,
		params,
		isCurrent: () => current === navigation,
		// Filters are written into the address without adding a history entry for every keystroke.
		replace: (settings) => {
			if (current !== navigation) return;
			history.replaceState(null, "", buildHash(path, settings));
			rememberView();
		},
	};
	try {
		const cleanup = await page(section, context, slot);
		if (current !== navigation) return cleanup();
		if (slot.parentNode !== view) view.replaceChildren(slot);
		view.removeAttribute("aria-busy");
		view.classList.remove("is-loading");
		leave = cleanup;
		drawScanStatus();
		rememberView();
		// A new page starts at its top, with keyboard and screen-reader focus on it. The first load is left alone.
		if (!firstRoute) {
			window.scrollTo(0, 0);
			view.focus({ preventScroll: true });
		}
		firstRoute = false;
		// "#/settings/model" and the like: the part of the page a link named.
		const anchor = settingsAnchor(path);
		const target = anchor ? document.getElementById(anchor) : null;
		if (target) {
			target.scrollIntoView({ block: "start" });
			target.focus({ preventScroll: true });
		}
	} catch (err) {
		if (current !== navigation) return;
		view.removeAttribute("aria-busy");
		view.classList.remove("is-loading");
		if (err instanceof ApiError && err.status === 401) return askForKey(err.body.tailnet === true ? "tailnet" : err.body.service === true ? "service" : "local");
		replace(
			view,
			h(
				"section",
				{ class: "page" },
				emptyState("This page could not be shown", err instanceof Error ? err.message : String(err), h("button", { type: "button", class: "button primary", onclick: () => void route() }, "Try again")),
			),
		);
	}
}

/**
 * @param {string} section
 * @param {import("./finding-parts.js").Route} context
 * @param {HTMLElement} view the page's own slot
 * @returns {Promise<() => void>}
 */
function page(section, context, view) {
	if (section === "findings") return context.path[1] === "by-repo" ? renderByRepo(view, context) : renderFindings(view, context);
	if (section === "roadmap") return renderRoadmap(view, context);
	if (section === "domains") return renderDomains(view, context);
	if (section === "cloudflare") return renderCloudflare(view, context);
	if (section === "investigate") return renderInvestigate(view, context);
	if (section === "discussions") return renderDiscussions(view, context);
	if (section === "activity") return renderActivity(view);
	if (section === "settings") return renderSettings(view);
	if (section === "host") return renderHost(view);
	return renderOverview(view, context);
}

/** The foot of the sidebar: whether a scan is running, and what the last one covered. Visible on every page. */
function drawScanStatus() {
	const scan = store.scan;
	const rows = store.report ? findingRows() : [];
	findingCount.textContent = shownText(store.report ? formatNumber(rows.length) : "");
	replace(
		severityStrip,
		...(store.report
			? /** @type {const} */ (["critical", "high", "medium", "low"]).map((severity) =>
					h(
						"a",
						{ class: "severity-count", href: `#/findings?severity=${severity}` },
						severityBadge(severity),
						h("strong", null, formatNumber(rows.filter((row) => row.severity === severity).length)),
					),
				)
			: []),
	);
	// Under 900 px the sidebar is a header without its foot; a running or failed scan still shows there (A-U4, I-U3).
	scanStatus.classList.toggle("is-live", scan.state === "running" || scan.state === "failed");
	if (scan.state === "running") {
		const known = scan.total > 0;
		const progress = known ? `Scanning ${Math.min(scan.done + 1, scan.total)} of ${scan.total}` : "Finding repositories";
		replace(
			scanStatus,
			h("strong", null, progress),
			h("progress", { max: known ? scan.total : null, value: known ? scan.done : null, "aria-label": "Scan progress" }),
		);
		// The bar moves every second; a screen reader hears that the scan started, then where it is twice a minute.
		if (!announced.startsWith("running")) announce("Scan started", { topic: "scan" });
		else announce(progress, { topic: "scan", every: 30_000 });
	} else if (scan.state === "failed") {
		replace(scanStatus, h("span", { class: "severity status-warning" }, icon("warning"), "Last scan failed"), h("a", { href: "#/overview" }, "See why"));
	} else if (store.report) {
		replace(scanStatus, h("span", null, `Last scan ${formatWhen(store.report.scannedAt)}`), h("span", null, plural(store.report.repos.length, "repository", "repositories")));
	} else {
		replace(scanStatus, store.settings ? h("span", null, "No scan yet") : null);
	}
	const state = scan.state === "done" ? `done ${scan.finishedAt}` : scan.state;
	if (state !== announced && announced.startsWith("running")) {
		// What the scan changed, so "fix, scan again, see it fixed" ends on "fixed" (US-4, A-Q4).
		if (scan.state === "done") toast(scanDoneWords(scan), "info", { label: "Open Findings", run: () => void (location.hash = scan.change?.newCount ? "#/findings?new=1" : "#/findings") });
		else if (scan.state === "failed") announce("The scan failed. The Overview says why.");
	}
	announced = state;
}

/**
 * "Scan finished" with what it changed: one repository's fixed and new, or the whole scan's against the one before.
 *
 * @param {Extract<import("./store.js").ScanStatus, { state: "done" }>} scan
 */
function scanDoneWords(scan) {
	if (scan.rescan) return rescanWords(scan.rescan);
	const change = scan.change ? changeSummary({ previousScannedAt: "", ...scan.change }) : null;
	return change ? `Scan finished: ${change}` : "Scan finished";
}

/** Set when a key is pasted, so the page that comes back can say whether it was refused. */
let keyPasted = false;

/** Whether this page is shown inside the Mac app, which says how to start Porchlight again. */
function inMacApp() {
	return Boolean(/** @type {any} */ (window).webkit?.messageHandlers?.porchlight);
}

/**
 * Shown when the page has no key: opened without the link `porchlight ui` printed, or, as a service
 * or from another device, before the access key has been pasted in this tab.
 *
 * @param {"local" | "service" | "tailnet"} where
 */
function askForKey(where) {
	const service = where !== "local";
	// A key was given and refused: say so, rather than showing the same request again as if nothing happened.
	const refused = keyPasted ? keyRejectedWords("pasted", where) : hasSessionKey() ? keyRejectedWords("stale", where) : null;
	keyPasted = false;
	// A password manager is offered the key under a fixed name, so it can be kept there rather than in a bookmark (R6U-5).
	const input = /** @type {HTMLInputElement} */ (
		h("input", { type: "password", name: "key", autocomplete: "current-password", required: true, "aria-label": service ? "Access key" : "Session key", "aria-invalid": refused ? "true" : null })
	);
	const account = h("input", { type: "text", name: "username", autocomplete: "username", value: service ? "Porchlight access key" : "Porchlight session key", readOnly: true, hidden: true, tabindex: "-1", "aria-hidden": "true" });
	replace(
		view,
		h(
			"section",
			{ class: "page narrow-page" },
			h(
				"form",
				{
					class: "card",
					onsubmit: (/** @type {SubmitEvent} */ event) => {
						event.preventDefault();
						// Accept the whole printed link as well as the key on its own.
						setSessionKey(input.value.replace(/^.*#k=/, ""));
						keyPasted = true;
						reset();
						void route();
					},
				},
				h("h2", null, service ? "Paste your access key" : "Session key needed"),
				refused ? h("p", { class: "form-error", role: "alert", id: "key-refused" }, refused) : null,
				where === "tailnet"
					? h(
							"p",
							null,
							"This is Porchlight on another of your computers, opened from this device. On that computer, open Settings → Access from other devices and copy the link or the key, then paste it here. This tab remembers it until you close it.",
						)
					: service
					? h(
							"p",
							null,
							...stepNodes("Scan results name the files where secrets were found, so this page is locked. In BoxPilot, open Apps → Porchlight and copy the "),
							h("strong", null, "Access key"),
							" from its sign-in details, then paste it here. This tab remembers it until you close it.",
						)
					: h(
							"p",
							null,
							"Porchlight only answers pages opened from the link it printed when it started. Open that link, or paste it, or the part after ",
							h("code", null, "#k="),
							", here.",
						),
				account,
				h("div", { class: "inline-form" }, h("div", { class: "field grow" }, input), h("button", { type: "submit", class: "button primary" }, "Continue")),
			),
		),
	);
	input.focus();
}
