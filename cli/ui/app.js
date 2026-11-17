// @ts-check
import { adoptSessionKey, ApiError, setSessionKey } from "./api.js";
import { emptyState, formatWhen, h, icon, plural, replace, toast } from "./dom.js";
import { renderDomains } from "./domains.js";
import { renderFindings } from "./findings.js";
import { buildHash, parseHash } from "./list.js";
import { renderOverview } from "./overview.js";
import { renderByRepo } from "./repos.js";
import { renderRoadmap } from "./roadmap.js";
import { reset, store, subscribe } from "./store.js";

const view = /** @type {HTMLElement} */ (document.getElementById("view"));
const nav = /** @type {HTMLElement} */ (document.getElementById("nav"));
const scanStatus = /** @type {HTMLElement} */ (document.getElementById("scan-status"));

const SECTIONS = /** @type {const} */ ([
	["overview", "Overview"],
	["findings", "Findings"],
	["roadmap", "Roadmap"],
	["domains", "Domains"],
]);

/** Stops whatever the current page left running. */
let leave = () => {};
/** Guards against a slow page finishing after the user has moved on. */
let navigation = 0;
let firstRoute = true;
/** The state of the last scan the sidebar announced, so "finished" is said once. */
let announced = "";

replace(nav, ...SECTIONS.map(([key, label]) => h("a", { href: `#/${key}`, dataset: { nav: key } }, icon(key), label)));
subscribe(drawScanStatus);
window.addEventListener("hashchange", route);
void route();

async function route() {
	// On every navigation, not only the first: pasting the printed link into
	// an already-open tab changes the fragment without reloading the page.
	adoptSessionKey();
	const { path, params } = parseHash(location.hash);
	// Addresses from before the pages were reorganised still work.
	if (path[0] === "repos") return void location.replace("#/findings/by-repo");
	const section = SECTIONS.some(([key]) => key === path[0]) ? /** @type {string} */ (path[0]) : "overview";
	if (path[0] !== section) path.splice(0, path.length, section);

	for (const link of nav.querySelectorAll("a")) {
		if (link.dataset.nav === section) link.setAttribute("aria-current", "page");
		else link.removeAttribute("aria-current");
	}
	document.title = `${SECTIONS.find(([key]) => key === section)?.[1]} · SecurityX`;

	leave();
	leave = () => {};
	const current = ++navigation;
	if (!view.hasChildNodes()) replace(view, h("p", { class: "loading" }, "Loading…"));
	/** @type {import("./findings.js").Route} */
	const context = {
		path,
		params,
		// Filters are written into the address without adding a history entry for every keystroke.
		replace: (settings) => {
			if (current === navigation) history.replaceState(null, "", buildHash(path, settings));
		},
	};
	try {
		const cleanup = await page(section, context);
		if (current !== navigation) return cleanup();
		leave = cleanup;
		drawScanStatus();
		// A new page starts at its top, with keyboard and screen-reader focus on it. The first load is left alone.
		if (!firstRoute) {
			window.scrollTo(0, 0);
			view.focus({ preventScroll: true });
		}
		firstRoute = false;
	} catch (err) {
		if (current !== navigation) return;
		if (err instanceof ApiError && err.status === 401) return askForKey();
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
 * @param {import("./findings.js").Route} context
 * @returns {Promise<() => void>}
 */
function page(section, context) {
	if (section === "findings") return context.path[1] === "by-repo" ? renderByRepo(view, context) : renderFindings(view, context);
	if (section === "roadmap") return renderRoadmap(view, context);
	if (section === "domains") return renderDomains(view, context.path[1]);
	return renderOverview(view);
}

/** The foot of the sidebar: whether a scan is running, and what the last one covered. Visible on every page. */
function drawScanStatus() {
	const scan = store.scan;
	if (scan.state === "running") {
		const known = scan.total > 0;
		replace(
			scanStatus,
			h("strong", null, known ? `Scanning ${Math.min(scan.done + 1, scan.total)} of ${scan.total}` : "Finding repositories"),
			h("progress", { max: known ? scan.total : null, value: known ? scan.done : null, "aria-label": "Scan progress" }),
		);
	} else if (scan.state === "failed") {
		replace(scanStatus, h("span", { class: "severity status-warning" }, icon("warning"), "Last scan failed"), h("a", { href: "#/overview" }, "See why"));
	} else if (store.report) {
		replace(scanStatus, h("span", null, `Last scan ${formatWhen(store.report.scannedAt)}`), h("span", null, plural(store.report.repos.length, "repository", "repositories")));
	} else {
		replace(scanStatus, store.settings ? h("span", null, "No scan yet") : null);
	}
	const state = scan.state === "done" ? `done ${scan.finishedAt}` : scan.state;
	if (state !== announced && scan.state === "done" && announced.startsWith("running")) toast("Scan finished");
	announced = state;
}

/** Shown when the page was opened without the link `securityx ui` printed. */
function askForKey() {
	const input = /** @type {HTMLInputElement} */ (
		h("input", { type: "password", name: "key", autocomplete: "off", required: true, "aria-label": "Session key" })
	);
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
						reset();
						void route();
					},
				},
				h("h2", null, "Session key needed"),
				h(
					"p",
					null,
					"SecurityX only answers pages opened from the link it printed when it started. Open that link, or paste it, or the part after ",
					h("code", null, "#k="),
					", here. When BoxPilot runs SecurityX, paste the access key from the app's sign-in details.",
				),
				h("div", { class: "inline-form" }, h("div", { class: "field grow" }, input), h("button", { type: "submit", class: "button primary" }, "Continue")),
			),
		),
	);
	input.focus();
}
