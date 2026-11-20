// @ts-check
// Settings → Cloudflare: the API token the Cloudflare audit reads the owner's account with. It is
// typed here and sent once to Porchlight's own server, which checks it with Cloudflare, keeps it on
// this computer (0600) and never sends it back. The page only ever learns whether one is saved.
import { api } from "./api.js";
import { h, icon, replace, stepNodes, toast } from "./dom.js";
import { updateCloudflare } from "./store.js";

/** @typedef {import("./store.js").CloudflareToken} CloudflareToken */
/** @typedef {import("./store.js").CloudflareGuide} CloudflareGuide */

/** @returns {Promise<HTMLElement>} */
export async function cloudflareSection() {
	const section = h("section", { id: "settings-cloudflare", tabindex: "-1", class: "card full cloudflare-settings", "aria-labelledby": "cloudflare-title" });
	const data = await api("GET", "/cloudflare/token");
	/** @type {CloudflareToken} */
	let token = data.token;
	/** @type {CloudflareGuide} */
	const guide = data.guide;
	const canChange = data.canChange === true;
	let busy = false;
	/** @type {Node | null} */
	let result = null;
	const input = /** @type {HTMLInputElement} */ (h("input", { type: "password", name: "cloudflare-token", autocomplete: "off", spellcheck: false, "aria-label": "Cloudflare API token", placeholder: "Paste the token Cloudflare showed you" }));

	/**
	 * @param {() => Promise<void>} work
	 */
	async function run(work) {
		if (busy) return;
		busy = true;
		result = null;
		draw();
		try {
			await work();
		} catch (err) {
			result = h("p", { class: "model-result error", role: "alert" }, icon("warning"), " ", err instanceof Error ? err.message : String(err));
		} finally {
			busy = false;
			draw();
		}
	}

	const save = () =>
		run(async () => {
			const answer = await api("POST", "/cloudflare/token", { token: input.value.trim() });
			input.value = "";
			token = answer.token;
			updateCloudflare({ token });
			toast("Cloudflare token checked and saved");
		});

	const remove = () =>
		run(async () => {
			const answer = await api("POST", "/cloudflare/token/remove");
			token = answer.token;
			updateCloudflare({ token });
			toast("Cloudflare token removed from this computer");
		});

	draw();
	return section;

	function draw() {
		const verified = token.verified;
		const status = token.configured
			? h(
					"p",
					null,
					h("span", { class: "severity status-good" }, icon("good"), "Connected"),
					" ",
					token.source === "startup" ? "Using PORCHLIGHT_CLOUDFLARE_TOKEN, set when Porchlight started." : `Token saved${token.savedAt ? ` ${new Date(token.savedAt).toLocaleDateString()}` : ""}.`,
					verified
						? h(
								"span",
								{ class: "hint block" },
								`Cloudflare says it is ${verified.status}, ${verified.kind === "account" ? "an account token" : "a user token"}${verified.expiresOn ? `, expiring ${new Date(verified.expiresOn).toLocaleDateString()}` : ", with no end date"}.`,
							)
						: null,
				)
			: h("p", null, h("span", { class: "severity status-pending" }, icon("pending"), "Not connected"), token.error ? h("span", { class: "hint block" }, `The token given at start-up is not used: ${token.error}`) : null);

		replace(
			section,
			h("h2", { id: "cloudflare-title" }, "Cloudflare"),
			h(
				"p",
				{ class: "sub" },
				"The Cloudflare page checks every domain in your Cloudflare account with an API token you make. The token is sent once to Porchlight on this computer, kept here readable only by you, and sent nowhere but Cloudflare's API. This page never sees it again, and no model ever does.",
			),
			status,
			h("h3", null, "Make a read-only token"),
			h(
				"ol",
				{ class: "steps" },
				h(
					"li",
					null,
					"Open ",
					h("a", { href: guide.templateUrl, target: "_blank", rel: "noopener noreferrer", title: "Opens dash.cloudflare.com in your browser" }, "Create token on Cloudflare"),
					". It opens Cloudflare's token page with most of the read permissions below ticked. Cloudflare leaves out any it does not recognise without saying so, so check the list.",
				),
				h("li", null, "Give it Read, never Edit, for each of these, for all zones and accounts (or only the ones to audit):"),
			),
			h(
				"ul",
				{ class: "plain-list cloudflare-permissions" },
				...guide.read.map((permission) => h("li", null, h("strong", null, `${permission.scope} · ${permission.name}`), `: ${permission.purpose}`)),
			),
			h(
				"p",
				{ class: "hint" },
				"Optional, only if you want Porchlight to make changes for you. Each change is shown to you as the exact request first, and sent only when you approve it on this computer:",
			),
			h(
				"ul",
				{ class: "plain-list cloudflare-permissions" },
				...guide.write.map((permission) => h("li", null, h("strong", null, `${permission.scope} · ${permission.name}`), `: ${permission.purpose}`)),
			),
			h("p", { class: "hint" }, ...stepNodes("A permission the token lacks is shown as Could not check on the Cloudflare page, never as passed. Tokens you made are listed in Cloudflare → My Profile → API Tokens.")),
			canChange
				? h(
						"form",
						{
							class: "inline-form",
							onsubmit: (/** @type {SubmitEvent} */ event) => {
								event.preventDefault();
								void save();
							},
						},
						h("div", { class: "field grow" }, input),
						h("button", { type: "submit", class: "button primary", disabled: busy }, busy ? "Checking…" : token.source === "settings" ? "Replace token" : "Check and save"),
						token.source === "settings" ? h("button", { type: "button", class: "button", disabled: busy, onclick: () => void remove() }, "Remove") : null,
					)
				: h(
						"p",
						{ class: "hint" },
						...stepNodes(
							"The token can be changed only on the page of the computer that runs Porchlight. When Porchlight runs as a service, set PORCHLIGHT_CLOUDFLARE_TOKEN in Apps → Porchlight → Settings.",
						),
					),
			result,
		);
	}
}
