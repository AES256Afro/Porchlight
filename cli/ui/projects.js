// @ts-check
// Projects: a folder the owner chooses for an audit or a scan, where saved exports, the model's
// discussions and a daily log of what Porchlight did are written, inside a "Porchlight" folder of its
// own. Settings → Projects adds and removes them, on the computer that runs Porchlight or a
// service's own page; the switcher at the top of the sidebar moves between them from any page.
import { api } from "./api.js";
import { banner, h, icon, replace, toast } from "./dom.js";
import { currentProject, setProjects, store, subscribe } from "./store.js";

/** @typedef {import("./store.js").Project} Project */
/** @typedef {import("../src/projects/projects.ts").Saved & { projectName?: string }} Saved */
/** @typedef {import("../src/projects/projects.ts").FolderCheck} FolderCheck */

/** The one folder Porchlight writes in, inside the folder chosen (`OWN_FOLDER` on the server). */
const OWN = "Porchlight";

/** Redraws Settings → Projects while it is on screen; one listener for every time the page is opened. */
let redrawSection = () => {};
subscribe((what) => {
	if (what === "projects") redrawSection();
});

/**
 * The Mac app's bridge, when this page is shown in it: it opens a folder picker and shows a file in
 * Finder, and hands back a folder's path or whether it showed one, nothing else.
 *
 * @returns {{ postMessage: (message: { action: "chooseFolder" } | { action: "reveal", path: string }) => Promise<unknown> } | null}
 */
function macApp() {
	const handler = /** @type {any} */ (window).webkit?.messageHandlers?.porchlight;
	return handler && typeof handler.postMessage === "function" ? handler : null;
}

/** Whether "Choose…" and "Show in Finder" are offered: only in the Mac app. */
export function inMacApp() {
	return macApp() !== null;
}

/** The folder a project's files are in. */
export function ownFolder(/** @type {Project} */ project) {
	return `${project.folder}/${OWN}`;
}

/**
 * Shows a file or folder in Finder from the Mac app; in a browser, copies its path instead.
 *
 * @param {string} path
 */
export async function reveal(path) {
	const app = macApp();
	if (app) {
		const shown = await app.postMessage({ action: "reveal", path }).catch(() => false);
		if (shown !== true) toast("Finder could not show it. It may have been moved or deleted.", "error");
		return;
	}
	try {
		await navigator.clipboard.writeText(path);
		toast(`Copied ${path}`);
	} catch {
		toast(path);
	}
}

/**
 * "Show in Finder" in the Mac app, "Copy path" in a browser.
 *
 * @param {string} path
 */
export function revealButton(path) {
	return h("button", { type: "button", class: "button", onclick: () => void reveal(path) }, icon(inMacApp() ? "folder" : "copy"), inMacApp() ? "Show in Finder" : "Copy path");
}

/**
 * Where a file was written, said in a toast with a way to find it.
 *
 * @param {Saved} saved
 */
export function announceSaved(saved) {
	const name = saved.projectName ?? store.projects.projects.find((project) => project.id === saved.project)?.name ?? "the project";
	toast(`Saved in ${name}: ${OWN}/${saved.part}/${saved.name}`, "info", { label: inMacApp() ? "Show in Finder" : "Copy path", run: () => void reveal(saved.path) });
}

/**
 * The switcher at the top of the sidebar: which project exports, discussions and the log go to.
 *
 * @returns {HTMLElement}
 */
export function projectSwitcher() {
	const select = /** @type {HTMLSelectElement} */ (h("select", { id: "project-select", onchange: () => void change() }));
	const box = h("div", { class: "project-switcher" }, h("label", { for: "project-select" }, icon("folder"), h("span", null, "Project")), select);

	function draw() {
		const { projects, current, canChange } = store.projects;
		replace(
			select,
			h("option", { value: "", selected: current === null }, "No project"),
			...projects.map((project) => h("option", { value: project.id, selected: project.id === current }, project.name)),
			canChange ? h("option", { value: "new" }, "New project…") : null,
		);
		const project = currentProject();
		select.title = project ? `Saved exports, discussions and the log go to ${ownFolder(project)}` : "Exports are downloaded. Choose a project to keep them in one folder.";
	}

	async function change() {
		const value = select.value;
		if (value === "new") {
			draw();
			location.hash = "#/settings/projects";
			return;
		}
		try {
			setProjects(/** @type {any} */ (await api("POST", "/projects/use", { id: value || null })));
			const project = currentProject();
			toast(project ? `Using ${project.name}. Saved exports, discussions and the log go to its ${OWN} folder.` : "No project. Exports are downloaded, and nothing is written to a project folder.");
		} catch (err) {
			draw();
			toast(err instanceof Error ? err.message : String(err), "error");
		}
	}

	subscribe((what) => {
		if (what === "projects") draw();
	});
	draw();
	return box;
}

/**
 * Settings → Projects: the list, moving between them, and adding one.
 *
 * @returns {HTMLElement}
 */
export function projectsSection() {
	const section = h("section", { id: "settings-projects", tabindex: "-1", class: "card full projects-settings", "aria-labelledby": "projects-title" });
	const within = store.projects.within;
	// Kept across redraws, so a half-filled form survives a change elsewhere.
	const nameBox = /** @type {HTMLInputElement} */ (h("input", { type: "text", id: "project-name", maxlength: 60, placeholder: "acme-audit", autocomplete: "off" }));
	const folderBox = /** @type {HTMLInputElement} */ (
		h("input", {
			type: "text",
			id: "project-folder",
			placeholder: within ? `${within}/acme-audit` : "~/Projects/acme-audit",
			autocomplete: "off",
			spellcheck: false,
			// Looked into once the box is settled (left, or Return), never on each keystroke.
			onchange: () => void preview(),
		})
	);
	const previewBox = h("div", { class: "project-preview", "aria-live": "polite" });
	const formError = h("p", { class: "form-error", role: "alert", hidden: true });
	const addButton = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "button primary" }, icon("plus"), "Add project"));
	/** @type {FolderCheck | null} */
	let check = null;
	let asked = 0;
	/** The project whose Remove was pressed once, waiting for the second press. */
	let removing = /** @type {string | null} */ (null);

	async function preview() {
		const typed = folderBox.value.trim();
		const mine = ++asked;
		if (typed === "") {
			check = null;
			drawPreview();
			return;
		}
		try {
			const answer = /** @type {{ check: FolderCheck }} */ (/** @type {any} */ (await api("GET", `/projects/preview?folder=${encodeURIComponent(typed)}`)));
			if (mine !== asked) return;
			check = answer.check;
		} catch (err) {
			if (mine !== asked) return;
			check = { folder: typed, creates: [], warnings: [], error: err instanceof Error ? err.message : String(err) };
		}
		drawPreview();
	}

	function drawPreview() {
		if (!check) return replace(previewBox);
		if (check.error) return replace(previewBox, h("p", { class: "form-error" }, check.error));
		const made = check.creates.length > 0;
		// Named from the folder above the one chosen, so each reads as a short path.
		const above = check.folder.slice(0, check.folder.lastIndexOf("/") + 1);
		replace(
			previewBox,
			h(
				"p",
				{ class: "hint" },
				made
					? `Porchlight will make ${check.creates.length === 1 ? "this folder" : "these folders"} in ${above}, and write only inside the ${OWN} one:`
					: `These folders are there already. Porchlight writes only inside ${check.folder}/${OWN}.`,
			),
			made ? h("ul", { class: "plain-list project-paths" }, ...check.creates.map((path) => h("li", null, h("code", null, `${path.startsWith(above) ? path.slice(above.length) : path}/`)))) : null,
			check.warnings.length > 0 ? banner("warning", "Before you add it", check.warnings) : null,
		);
	}

	/** @param {SubmitEvent} event */
	async function add(event) {
		event.preventDefault();
		formError.hidden = true;
		addButton.disabled = true;
		try {
			const state = /** @type {any} */ (await api("POST", "/projects", { name: nameBox.value, folder: folderBox.value }));
			setProjects(state);
			const project = currentProject();
			nameBox.value = "";
			folderBox.value = "";
			check = null;
			drawPreview();
			if (project) toast(`Using ${project.name}. Saved exports, discussions and the log go to ${ownFolder(project)}.`, "info", { label: inMacApp() ? "Show in Finder" : "Copy path", run: () => void reveal(ownFolder(project)) });
		} catch (err) {
			// Said once: the refusal takes the place of the preview's own error, if it showed one.
			if (check?.error) {
				check = null;
				drawPreview();
			}
			formError.textContent = err instanceof Error ? err.message : String(err);
			formError.hidden = false;
		} finally {
			addButton.disabled = false;
		}
	}

	async function choose() {
		const app = macApp();
		if (!app) return;
		const folder = await app.postMessage({ action: "chooseFolder" }).catch(() => null);
		if (typeof folder !== "string" || folder === "") return;
		folderBox.value = folder;
		if (nameBox.value.trim() === "") nameBox.value = folder.split("/").filter(Boolean).pop()?.slice(0, 60) ?? "";
		void preview();
	}

	/** @param {string | null} id */
	async function use(id) {
		try {
			setProjects(/** @type {any} */ (await api("POST", "/projects/use", { id })));
			const project = currentProject();
			toast(project ? `Using ${project.name}` : "No project. Exports are downloaded.");
		} catch (err) {
			toast(err instanceof Error ? err.message : String(err), "error");
		}
	}

	/** @param {Project} project */
	async function remove(project) {
		// Two presses, so a stray click changes nothing. The folder and its files stay either way.
		if (removing !== project.id) {
			removing = project.id;
			draw();
			setTimeout(() => {
				if (removing !== project.id) return;
				removing = null;
				draw();
			}, 5000);
			return;
		}
		removing = null;
		try {
			setProjects(/** @type {any} */ (await api("POST", "/projects/remove", { id: project.id })));
			toast(`${project.name} is off the list. Its folder and files are as they were.`);
		} catch (err) {
			toast(err instanceof Error ? err.message : String(err), "error");
			draw();
		}
	}

	function draw() {
		const { projects, current, canChange } = store.projects;
		replace(
			section,
			h("h2", { id: "projects-title" }, "Projects"),
			h(
				"p",
				{ class: "sub" },
				`Choose a folder for an audit or a scan. Exports you save, your discussions with a model and a daily log of what Porchlight did go into a ${OWN} folder inside it, under names that say what each file is, such as "2026-11-19 15.30 Repair roadmap.md". Porchlight writes nowhere else in the folder, and its files there are readable only by you.`,
			),
			projects.length > 0
				? h(
						"ul",
						{ class: "project-list" },
						...projects.map((project) =>
							h(
								"li",
								{ class: `project-row${project.id === current ? " current" : ""}` },
								h("div", { class: "project-what" }, h("strong", null, project.name), h("code", null, ownFolder(project))),
								h(
									"div",
									{ class: "actions" },
									project.id === current
										? h("span", { class: "project-in-use" }, icon("good"), "In use")
										: h("button", { type: "button", class: "button", onclick: () => void use(project.id) }, "Use"),
									revealButton(ownFolder(project)),
									canChange
										? h("button", { type: "button", class: "button", onclick: () => void remove(project) }, removing === project.id ? "Take it off the list? Files stay" : "Remove")
										: null,
								),
							),
						),
					)
				: h("p", { class: "hint" }, "No project yet. Until you add one, exports are downloaded and nothing is written to a project folder."),
			current ? h("p", null, h("button", { type: "button", class: "link-button", onclick: () => void use(null) }, "Stop using a project"), h("span", { class: "hint" }, " Exports are then downloaded.")) : null,
			canChange
				? h(
						"form",
						{ class: "project-form", onsubmit: add },
						h("h3", null, "New project"),
						h("label", { class: "field" }, h("span", null, "Name"), nameBox),
						h(
							"div",
							{ class: "field" },
							h("label", { for: "project-folder" }, h("span", null, "Folder")),
							h(
								"div",
								{ class: "project-folder-row" },
								folderBox,
								inMacApp() && !within ? h("button", { type: "button", class: "button", onclick: () => void choose() }, icon("folder"), "Choose…") : null,
							),
							within
								? h("span", { class: "hint" }, `Here, project folders are kept in Porchlight's data folder: ${within}`)
								: inMacApp()
									? null
									: h("span", { class: "hint" }, "Type the whole path. In the Mac app, Choose… opens a folder picker."),
						),
						previewBox,
						formError,
						h("div", { class: "actions" }, addButton),
					)
				: h("p", { class: "hint" }, "You're on another device. Only the computer that runs Porchlight can add or remove a project; you can move between them here."),
		);
	}

	redrawSection = () => {
		if (section.isConnected) draw();
	};
	draw();
	return section;
}
