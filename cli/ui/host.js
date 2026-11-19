// @ts-check
// "This Mac": what SecurityX can see of the computer it runs on. The check only reads; this page
// starts it, follows it, and shows what it found. Every element is built with h(): program names,
// paths and update titles come from the system and are never treated as HTML.
import { formatWhen, h, icon, plural, replace, severityBadge, statTile, stepNodes, toast } from "./dom.js";
import { AREA_TITLES, combinedCommands, hostName as nameFor, splitChecks } from "./host-areas.js";
import { load, loadHost, startHostCheck, store, subscribe } from "./store.js";

/** @typedef {import("../src/host/types.ts").HostCheck} HostCheck */

/** The page's own name for the computer, as the sidebar shows it. */
export function hostName() {
	return nameFor(store.settings?.platform);
}

/**
 * @param {HTMLElement} view
 * @returns {Promise<() => void>}
 */
export async function renderHost(view) {
	await load();
	await loadHost();
	const name = hostName();
	const label = name === "This Mac" ? "Check this Mac" : "Check this computer";
	const askApple = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", name: "askApple", checked: true }));
	const lookUp = /** @type {HTMLInputElement} */ (h("input", { type: "checkbox", name: "lookUpPackages", checked: true }));
	const button = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "button primary" }, label));
	const statusSlot = h("div", { "aria-live": "polite" });
	const results = h("div");
	const mac = (store.settings?.platform ?? "darwin") === "darwin";

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
					h("h1", null, name),
					h(
						"p",
						{ class: "sub" },
						mac
							? "Checks the Mac SecurityX runs on: updates, built-in protection, what accepts connections from the network, credentials kept in files, and installed packages with known vulnerabilities."
							: "Checks the computer SecurityX runs on: credentials kept in files and installed packages with known vulnerabilities.",
					),
				),
			),
			store.host.service
				? h(
						"div",
						{ class: "card" },
						h("h2", null, "Not available here"),
						h(
							"p",
							null,
							"SecurityX runs in a container here, so it would see the container, not the computer it runs on. To check a computer, run SecurityX on it: the Mac app, or securityx ui in a terminal.",
						),
					)
				: h(
						"div",
						{ class: "card full" },
						h("h2", null, label),
						h(
							"p",
							{ class: "sub" },
							"It only reads. It never changes a setting, asks for no password, and looks at no other computer. What it finds stays on this computer, readable only by you.",
						),
						h(
							"form",
							{
								class: "scan-form",
								onsubmit: async (/** @type {SubmitEvent} */ event) => {
									event.preventDefault();
									try {
										await startHostCheck({ askApple: askApple.checked, lookUpPackages: lookUp.checked });
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
									mac
										? h(
												"label",
												{ class: "check-line" },
												askApple,
												"Ask Apple for updates now. Off: use the list from macOS's own last check.",
											)
										: null,
									h(
										"label",
										{ class: "check-line" },
										lookUp,
										"Look up installed npm and Python packages on OSV.dev. Sends their names and versions, never your files.",
									),
								),
							),
						),
						statusSlot,
					),
			results,
		),
	);

	draw();
	const unsubscribe = subscribe((change) => {
		if (change === "host") draw();
	});
	return () => unsubscribe();

	function draw() {
		const { status, report } = store.host;
		const running = status.state === "running";
		button.disabled = running;
		button.textContent = report ? "Check again" : label;
		if (running) {
			const known = status.total > 0;
			replace(
				statusSlot,
				h(
					"div",
					{ class: "host-progress" },
					h("strong", null, known && status.current ? `Checking ${Math.min(status.done + 1, status.total)} of ${status.total}: ${status.current}` : "Starting"),
					h("progress", { max: known ? status.total : null, value: known ? status.done : null, "aria-label": "Check progress" }),
				),
			);
		} else if (status.state === "failed") {
			replace(statusSlot, h("p", { class: "form-error", role: "alert" }, `The check stopped: ${status.error}`));
		} else {
			replace(statusSlot);
		}
		replace(results, ...(report ? drawReport(report) : store.host.service ? [] : [h("p", { class: "sub" }, `${name} has not been checked yet.`)]));
	}
}

/**
 * @param {import("../src/host/types.ts").HostReport} report
 * @returns {Node[]}
 */
function drawReport(report) {
	const failed = report.checks.filter((check) => check.status === "failed");
	const unknown = report.checks.filter((check) => check.status === "unknown");
	const passed = report.checks.filter((check) => check.status === "passed");
	const os = report.os ? `${report.os.name} ${report.os.version}${report.os.build ? ` (${report.os.build})` : ""}` : null;
	return [
		h("p", { class: "sub scan-line" }, `Last checked ${formatWhen(report.checkedAt)}${os ? ` · ${os}` : ""}.`),
		h(
			"div",
			{ class: "tiles" },
			statTile("Problems", failed.length),
			statTile("Could not check", unknown.length, unknown.length > 0 ? icon("pending") : null),
			statTile("Passed", passed.length, icon("good")),
		),
		...AREA_TITLES.map(([area, title]) => {
			const checks = report.checks.filter((check) => check.area === area);
			if (checks.length === 0) return null;
			const { attention, passed: fine } = splitChecks(checks);
			return h(
				"div",
				{ class: "card full" },
				h("h2", null, title),
				attention.length > 0 ? h("div", { class: "host-list" }, ...attention.map(checkRow)) : h("p", { class: "sub" }, "Nothing here needs attention."),
				fine.length > 0
					? h("details", { class: "host-passed" }, h("summary", null, `${plural(fine.length, "check", "checks")} passed`), h("div", { class: "host-list" }, ...fine.map(checkRow)))
					: null,
			);
		}).filter((node) => node !== null),
		h(
			"div",
			{ class: "card full" },
			h("h2", null, "Not covered"),
			h("p", { class: "sub" }, "A clean result here does not mean these are safe:"),
			h("ul", { class: "host-not-covered" }, ...report.notCovered.map((line) => h("li", null, line))),
		),
		commandsCard(combinedCommands(report.checks)),
	].filter((node) => node !== null);
}

/**
 * Every repair command from the checks above, combined, to paste into a terminal in one go.
 *
 * @param {string[]} commands
 */
function commandsCard(commands) {
	if (commands.length === 0) return null;
	const text = `${commands.join("\n")}\n`;
	const block = h("pre", { class: "host-commands", tabindex: "0", "aria-label": "Commands to fix these" }, h("code", null, text));
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(text);
			toast(commands.length === 1 ? "Command copied" : `${commands.length} commands copied`);
		} catch {
			// Clipboard access can be refused: select the block so ⌘C copies it.
			const range = document.createRange();
			range.selectNodeContents(block);
			const selection = window.getSelection();
			selection?.removeAllRanges();
			selection?.addRange(range);
			toast("Copy the selected commands with ⌘C");
		}
	};
	return h(
		"div",
		{ class: "card full" },
		h("div", { class: "host-commands-head" }, h("h2", null, "Commands to fix these"), h("button", { type: "button", class: "button", onclick: () => void copy() }, icon("copy"), "Copy all")),
		h(
			"p",
			{ class: "sub" },
			"The repairs above that need no decision first, in one place, to paste into Terminal. Read each line before you run it: lines with sudo ask for your password, and updates can take a while. Steps that need a decision, such as turning off a Sharing service or adding a passphrase to an SSH key, stay with their checks.",
		),
		block,
	);
}

/** @param {HostCheck} check */
function checkRow(check) {
	const mark =
		check.status === "failed"
			? severityBadge(check.severity)
			: check.status === "unknown"
				? h("span", { class: "severity status-pending" }, icon("pending"), "Could not check")
				: h("span", { class: "severity status-good" }, icon("good"), "Passed");
	const items = check.items ?? [];
	return h(
		"div",
		{ class: `host-check host-${check.status}` },
		h("div", { class: "host-check-head" }, mark, h("strong", null, check.title)),
		h("p", { class: "host-detail" }, check.detail),
		items.length > 0
			? h("details", { class: "fix-details" }, h("summary", null, plural(items.length, ...itemNoun(check))), h("ul", null, ...items.map((item) => h("li", null, item))))
			: null,
		check.status !== "passed" && check.fix?.length ? h("ol", { class: "host-fix" }, ...check.fix.map((step) => h("li", null, ...stepNodes(step)))) : null,
	);
}

/**
 * What a check's list holds, in words.
 *
 * @param {HostCheck} check
 * @returns {[string, string]}
 */
function itemNoun(check) {
	if (check.id.startsWith("package:")) return ["advisory", "advisories"];
	if (check.id === "software-updates") return ["update", "updates"];
	if (check.id === "homebrew") return ["package", "packages"];
	return ["item", "items"];
}
