// @ts-check
// Settings → Monitor: where the monitor that watches your domains is, and its admin token. Both are
// typed here and sent once to Porchlight's own server, which asks the monitor whether they work,
// keeps them on this computer (0600) and never sends the token back. The page only ever learns the
// monitor's host name and whether a connection is saved.
import { api } from "./api.js";
import { formatDay, h, icon, replace, stepNodes, toast } from "./dom.js";
import { store, updateMonitor } from "./store.js";

/** @returns {HTMLElement} */
export function monitorSection() {
	const section = h("section", { id: "settings-monitor", tabindex: "-1", class: "card full", "aria-labelledby": "monitor-title" });
	let busy = false;
	/** @type {Node | null} */
	let result = null;
	const address = /** @type {HTMLInputElement} */ (
		h("input", { type: "text", inputmode: "url", name: "monitor-address", autocomplete: "off", spellcheck: false, required: true, placeholder: "https://porchlight-monitor.your-name.workers.dev" })
	);
	const token = /** @type {HTMLInputElement} */ (h("input", { type: "password", name: "monitor-token", autocomplete: "off", spellcheck: false, required: true, placeholder: "The ADMIN_TOKEN you made for it" }));

	/** @param {() => Promise<void>} work */
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
			const answer = await api("POST", "/monitor", { address: address.value, token: token.value });
			address.value = "";
			token.value = "";
			updateMonitor(answer.monitor);
			toast(`Connected to the monitor at ${answer.monitor.host}`);
		});

	const remove = () =>
		run(async () => {
			const answer = await api("POST", "/monitor/remove");
			updateMonitor(answer.monitor);
			toast("The monitor's address and token were removed from this computer");
		});

	draw();
	return section;

	function draw() {
		const settings = store.settings;
		const monitor = settings?.monitor;
		// A service is given its monitor where it is managed; another device only looks.
		const canChange = settings !== null && !settings.service && !settings.remote;
		const saved = monitor?.source === "settings";
		const status = monitor?.configured
			? h(
					"p",
					null,
					h("span", { class: "severity status-good" }, icon("good"), "Connected"),
					` ${monitor.host}. `,
					saved ? `Saved here${monitor.savedAt ? ` ${formatDay(monitor.savedAt)}` : ""}.` : "Given when Porchlight started.",
				)
			: h(
					"p",
					null,
					h("span", { class: "severity status-pending" }, icon("pending"), "Not connected"),
					// Nothing given yet is the usual state after installing, not a mistake to quote back.
					monitor?.error && !monitor.unset ? h("span", { class: "hint block" }, `The setting given at start-up is not used: ${monitor.error}`) : null,
				);

		replace(
			section,
			h("h2", { id: "monitor-title" }, "Monitor"),
			h(
				"p",
				{ class: "sub" },
				"The Domains page reads from the Porchlight monitor, a small service on your own Cloudflare account. Its admin token is sent once to Porchlight on this computer, kept here readable only by you, and sent nowhere but the address you give. This page never sees it again, and no model ever does.",
			),
			status,
			monitor?.configured ? null : h("p", { class: "hint" }, "No monitor yet? The ", h("a", { href: "#/domains" }, "Domains"), " page walks through putting one on your Cloudflare account, with each command to copy."),
			canChange
				? h(
						"form",
						{
							class: "monitor-form",
							onsubmit: (/** @type {SubmitEvent} */ event) => {
								event.preventDefault();
								void save();
							},
						},
						h("label", { class: "field" }, h("span", null, "Monitor address"), address),
						h("label", { class: "field" }, h("span", null, "Admin token"), token),
						h(
							"div",
							{ class: "actions" },
							h("button", { type: "submit", class: "button primary", "aria-disabled": busy ? "true" : null }, busy ? "Checking…" : monitor?.configured ? "Check and replace" : "Check and connect"),
							saved ? h("button", { type: "button", class: "button", "aria-disabled": busy ? "true" : null, onclick: () => void remove() }, "Remove") : null,
						),
						h("p", { class: "hint" }, "Porchlight asks the monitor for its list of domains with this token before saving anything, so a mistake never replaces a connection that works. No restart is needed."),
					)
				: h(
						"p",
						{ class: "hint" },
						...stepNodes(
							settings?.service
								? 'When Porchlight runs on BoxPilot, paste them into "Monitor address" and "Monitor admin token" in Apps → Porchlight → Settings.'
								: "The monitor can be connected only on the page of the computer that runs Porchlight.",
						),
					),
			result,
		);
	}
}
