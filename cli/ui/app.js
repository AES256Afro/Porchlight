// @ts-check
import { adoptSessionKey, ApiError, setSessionKey } from "./api.js";
import { h, replace } from "./dom.js";
import { renderDomains } from "./domains.js";
import { renderRepos } from "./repos.js";

const view = /** @type {HTMLElement} */ (document.getElementById("view"));
/** Stops whatever the current page left running (scan polling). */
let leave = () => {};
/** Guards against a slow page finishing after the user has moved on. */
let navigation = 0;

window.addEventListener("hashchange", route);
void route();

async function route() {
	// On every navigation, not only the first: pasting the printed link into
	// an already-open tab changes the fragment without reloading the page.
	adoptSessionKey();
	const [section = "repos", ...rest] = location.hash.replace(/^#\/?/, "").split("/");
	const tab = section === "domains" ? "domains" : "repos";
	for (const link of document.querySelectorAll("[data-tab]")) {
		if (/** @type {HTMLElement} */ (link).dataset.tab === tab) link.setAttribute("aria-current", "page");
		else link.removeAttribute("aria-current");
	}

	leave();
	leave = () => {};
	const current = ++navigation;
	if (!view.hasChildNodes()) replace(view, h("p", { class: "loading" }, "Loading…"));
	try {
		const cleanup = tab === "domains" ? await renderDomains(view, rest[0] ? decodeURIComponent(rest[0]) : undefined) : await renderRepos(view);
		if (current === navigation) leave = cleanup;
		else cleanup();
	} catch (err) {
		if (current !== navigation) return;
		if (err instanceof ApiError && err.status === 401) return askForKey();
		replace(
			view,
			h(
				"section",
				{ class: "page" },
				h("div", { class: "empty" }, h("h2", null, "Something went wrong"), h("p", null, err instanceof Error ? err.message : String(err))),
			),
		);
	}
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
