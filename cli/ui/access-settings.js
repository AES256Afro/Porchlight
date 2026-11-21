// @ts-check
// Settings → Access from other devices: open this computer's Porchlight from another one on the tailnet.
// Only the computer that runs Porchlight can turn it on or off, and only it is shown the key.
import { api } from "./api.js";
import { banner, h, icon, replace, toast } from "./dom.js";

/**
 * @typedef {{ enabled: boolean, listening: boolean, url?: string, error?: string, canChange: boolean, link?: string }} AccessState
 */

/** @returns {Promise<HTMLElement>} */
export async function accessSection() {
	const section = h("section", { id: "settings-access", tabindex: "-1", class: "card full access-settings", "aria-labelledby": "access-title" });
	/** @type {AccessState} */
	let state = /** @type {AccessState} */ (await api("GET", "/access"));
	let busy = false;
	let revealed = false;

	/**
	 * @param {string} path
	 * @param {unknown} [body]
	 * @param {string} [done]
	 */
	const change = async (path, body, done) => {
		if (busy) return;
		busy = true;
		draw();
		try {
			state = /** @type {AccessState} */ (await api("POST", path, body));
			if (done) toast(done);
		} catch (err) {
			toast(err instanceof Error ? err.message : String(err), "error");
		} finally {
			busy = false;
			draw();
		}
	};

	draw();
	return section;

	function draw() {
		replace(
			section,
			h("h2", { id: "access-title" }, "Access from other devices"),
			h(
				"p",
				{ class: "sub" },
				"Open this computer's Porchlight from your other computers, such as a Windows PC, over Tailscale. They see the same scans, settings and model. Nothing is reachable from your Wi-Fi or the internet.",
			),
			status(),
			state.canChange ? controls() : h("p", { class: "hint" }, "You're on another device. Only the computer that runs Porchlight can turn this off or change the key."),
		);
	}

	function status() {
		if (state.listening) {
			return h(
				"p",
				{ class: "model-now" },
				h("span", { class: "severity status-good" }, icon("good"), "On"),
				" Devices on your tailnet can open ",
				h("strong", { class: "mono" }, state.url ?? ""),
				" with the access key.",
			);
		}
		if (state.enabled) {
			return h("p", { class: "model-now" }, h("span", { class: "severity status-warning" }, icon("warning"), "Waiting"), ` ${state.error ?? "Not listening yet."}`);
		}
		return h("p", { class: "model-now" }, h("span", { class: "severity status-pending" }, icon("pending"), "Off"), " Porchlight answers only on this computer.");
	}

	function controls() {
		const link = state.link;
		return h(
			"div",
			{ class: "access-controls" },
			state.listening && link
				? h(
						"div",
						{ class: "field" },
						h("label", { for: "access-link" }, h("span", null, "Link for your other devices (it carries the key)")),
						h(
							"div",
							{ class: "inline-form" },
							h("input", { id: "access-link", type: revealed ? "text" : "password", readOnly: true, value: link, class: "mono", onfocus: (/** @type {Event} */ event) => /** @type {HTMLInputElement} */ (event.target).select() }),
							h("button", { type: "button", class: "button", onclick: () => ((revealed = !revealed), draw()) }, revealed ? "Hide" : "Show"),
							h("button", { type: "button", class: "button primary", onclick: () => void copy(link) }, "Copy link"),
						),
						h(
							"span",
							{ class: "hint" },
							"Open it on the other device, for example by pasting it into a note you sync, or a message to yourself. Each new tab asks for the key again; bookmark the link to skip that. Treat it like a password.",
						),
					)
				: null,
			banner("warning", "Before you turn this on", [
				"Anyone on your tailnet who has the link or the key sees your scans, including where secrets were found, and can start scans and use your model.",
				"It works only while Porchlight runs on this computer: quitting it, or closing the Mac app's window, stops it for every device.",
				"The connection is encrypted by Tailscale. Use Tailscale's access controls if others share your tailnet.",
			]),
			h(
				"div",
				{ class: "actions" },
				h(
					"button",
					{ type: "button", class: state.enabled ? "button" : "button primary", "aria-disabled": busy ? "true" : null, onclick: () => void change("/access", { enabled: !state.enabled }, state.enabled ? "Access from other devices is off" : "Access from other devices is on") },
					busy ? "Working…" : state.enabled ? "Turn off" : "Turn on",
				),
				state.enabled && !state.listening ? h("button", { type: "button", class: "button", "aria-disabled": busy ? "true" : null, onclick: () => void change("/access", { enabled: true }) }, "Try again") : null,
				state.enabled
					? h(
							"button",
							{
								type: "button",
								class: "button quiet",
								"aria-disabled": busy ? "true" : null,
								onclick: () => {
									if (window.confirm("Make a new key? Every device using the old link or key is signed out.")) void change("/access/key", undefined, "New key made. Give your devices the new link.");
								},
							},
							"Make a new key",
						)
					: null,
			),
		);
	}

	/** @param {string} text */
	async function copy(text) {
		try {
			await navigator.clipboard.writeText(text);
			toast("Link copied");
		} catch {
			// Clipboard access can be refused; the field is selectable instead.
			revealed = true;
			draw();
			const input = /** @type {HTMLInputElement | null} */ (section.querySelector("#access-link"));
			input?.focus();
			input?.select();
			toast(`Copy the selected link with ${/Mac/.test(navigator.platform) ? "⌘C" : "Ctrl+C"}`);
		}
	}
}
