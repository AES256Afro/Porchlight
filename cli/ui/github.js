// @ts-check
import { api } from "./api.js";
import { banner, h, icon, plural, replace, stepNodes, toast } from "./dom.js";
import { fetchByDefault, githubTokenSteps } from "./hints.js";
import { store } from "./store.js";

/** @typedef {import("../src/github/github.ts").GithubRepo} GithubRepo */
/** @typedef {import("../src/ui/server.ts").FetchStatus} FetchStatus */

const POLL_MS = 1000;

/**
 * "Get repositories from GitHub": choose repositories, fetch them onto this machine, keep them up
 * to date and remove them. Once fetched they are scanned along with the folder.
 *
 * @param {() => void} onChange called when the set of fetched repositories has changed
 * @returns {{ node: HTMLElement, stop: () => void }}
 */
export function githubPanel(onChange) {
	const service = store.settings?.service === true;
	const hasToken = store.settings?.github?.token === true;
	let stopped = false;
	/** @type {ReturnType<typeof setTimeout> | undefined} */
	let timer;
	/** @type {string[]} */
	let fetched = [];
	/** @type {GithubRepo[] | null} */
	let listed = null;
	/** @type {Set<string>} */
	const chosen = new Set();
	/** @type {FetchStatus} */
	let job = { state: "idle" };

	const fetchedSlot = h("div");
	const listSlot = h("div");
	const jobSlot = h("div", { "aria-live": "polite" });
	const ownerInput = /** @type {HTMLInputElement} */ (
		h("input", { type: "text", name: "owner", placeholder: "your-github-name", spellcheck: false, autocomplete: "off", "aria-label": "GitHub account name" })
	);
	const listButton = /** @type {HTMLButtonElement} */ (h("button", { type: "submit", class: "button" }, hasToken ? "Show my repositories" : "Show public repositories"));

	const node = h(
		"div",
		{ class: "github" },
		h("h3", null, "Get repositories from GitHub"),
		h(
			"p",
			{ class: "sub" },
			service
				? "SecurityX copies the repositories you choose onto this server, then checks them along with anything in the server's folder."
				: "SecurityX copies the repositories you choose onto this computer, then checks them along with the folder above.",
		),
		store.settings?.github?.error ? banner("warning", "The GitHub token is not being used", [store.settings.github.error]) : null,
		hasToken
			? h("p", null, h("span", { class: "severity status-good" }, icon("good"), "A GitHub token is set, so private repositories can be fetched too."))
			: h(
					"details",
					{ class: "options" },
					h("summary", null, "Private repositories need a token. How to add one"),
					h("ol", { class: "steps" }, ...githubTokenSteps(service).map((step) => h("li", null, ...stepNodes(step)))),
					h("p", { class: "hint" }, "The token stays inside SecurityX. It is never sent to this page."),
				),
		h(
			"form",
			{
				class: "inline-form",
				onsubmit: (/** @type {SubmitEvent} */ event) => {
					event.preventDefault();
					void list();
				},
			},
			h("div", { class: "field grow" }, ownerInput),
			listButton,
		),
		hasToken ? h("p", { class: "hint" }, "Leave the name empty for everything your token can read, or type an account name to see its public repositories.") : null,
		listSlot,
		jobSlot,
		fetchedSlot,
	);
	void refresh();
	return {
		node,
		stop: () => {
			stopped = true;
			clearTimeout(timer);
		},
	};

	/** Reads what is fetched and whether a fetch is running, and keeps reading while one is. */
	async function refresh() {
		try {
			const state = await api("GET", "/github");
			if (stopped) return;
			const finished = job.state === "running" && state.job.state !== "running";
			const changed = fetched.join("\n") !== state.fetched.join("\n");
			fetched = state.fetched;
			job = state.job;
			draw();
			if (finished || changed) onChange();
			if (job.state === "running") timer = setTimeout(refresh, POLL_MS);
		} catch (err) {
			if (!stopped) replace(jobSlot, banner("error", "Could not read what has been fetched", [message(err)]));
		}
	}

	async function list() {
		const owner = ownerInput.value.trim().replace(/^@/, "").replace(/^https?:\/\/github\.com\//i, "").replace(/\/.*$/, "");
		if (owner === "" && !hasToken) return toast("Type a GitHub account name first", "error");
		listButton.disabled = true;
		replace(listSlot, h("p", { class: "hint" }, "Asking GitHub…"));
		try {
			const answer = await api("GET", `/github/repos${owner ? `?owner=${encodeURIComponent(owner)}` : ""}`);
			if (stopped) return;
			listed = /** @type {GithubRepo[]} */ (answer.repos);
			chosen.clear();
			for (const repo of listed) if (fetchByDefault(repo) && !fetched.includes(repo.name)) chosen.add(repo.name);
		} catch (err) {
			listed = null;
			replace(listSlot, banner("error", "Could not list repositories", [message(err)]));
			listButton.disabled = false;
			return;
		}
		listButton.disabled = false;
		draw();
	}

	/** @param {Record<string, unknown>} body */
	async function start(body) {
		try {
			const answer = await api("POST", "/github/fetch", body);
			job = answer.job;
			draw();
			clearTimeout(timer);
			timer = setTimeout(refresh, POLL_MS);
		} catch (err) {
			toast(message(err), "error");
		}
	}

	/** @param {string} name */
	async function remove(name) {
		try {
			await api("DELETE", `/github/fetched?repo=${encodeURIComponent(name)}`);
			toast(`Removed ${name} from this ${service ? "server" : "computer"}`);
			await refresh();
		} catch (err) {
			toast(message(err), "error");
		}
	}

	function draw() {
		const running = job.state === "running";
		drawList(running);

		if (job.state === "running") {
			replace(
				jobSlot,
				h(
					"div",
					{ class: "progress" },
					h("div", { class: "progress-text" }, h("strong", null, `Fetching ${Math.min(job.done + 1, job.total)} of ${job.total}`), job.current ? h("span", { class: "path" }, job.current) : null),
					h("progress", { max: job.total, value: job.done, "aria-label": "Fetch progress" }),
				),
			);
		} else if (job.state === "done" && job.errors.length > 0) {
			replace(
				jobSlot,
				banner(
					"warning",
					`${plural(job.errors.length, "repository", "repositories")} of ${job.total} could not be fetched`,
					job.errors.map((error) => `${error.repo}: ${error.message}`),
				),
			);
		} else {
			replace(jobSlot);
		}

		replace(
			fetchedSlot,
			fetched.length === 0
				? null
				: h(
						"details",
						{ class: "options fetched" },
						h("summary", null, `${plural(fetched.length, "repository", "repositories")} fetched from GitHub`),
						h("p", { class: "hint" }, "These are copies. A scan checks them as they were when last fetched, so update them before checking again."),
						h("div", { class: "actions" }, h("button", { type: "button", class: "button", disabled: running, onclick: () => void start({ all: true }) }, "Update all from GitHub")),
						h(
							"ul",
							{ class: "repo-pick" },
							...fetched.map((name) =>
								h("li", null, h("span", { class: "wrap" }, name), h("button", { type: "button", class: "button quiet", disabled: running, "aria-label": `Remove ${name}`, onclick: () => void remove(name) }, "Remove")),
							),
						),
					),
		);
	}

	/** @param {boolean} running */
	function drawList(running) {
		if (!listed) return;
		if (listed.length === 0) return replace(listSlot, h("p", { class: "hint" }, "GitHub listed no repositories for that."));
		const fetchButton = /** @type {HTMLButtonElement} */ (h("button", { type: "button", class: "button primary", onclick: () => void start({ repos: [...chosen] }) }));
		const label = () => {
			fetchButton.disabled = running || chosen.size === 0;
			fetchButton.textContent = chosen.size === 0 ? "Choose repositories to fetch" : `Fetch ${plural(chosen.size, "repository", "repositories")}`;
		};
		/** @type {HTMLInputElement[]} */
		const boxes = [];
		const rows = listed.map((repo) => {
			const box = /** @type {HTMLInputElement} */ (
				h("input", {
					type: "checkbox",
					checked: chosen.has(repo.name),
					onchange: () => {
						if (box.checked) chosen.add(repo.name);
						else chosen.delete(repo.name);
						label();
					},
				})
			);
			boxes.push(box);
			const marks = [repo.private ? "private" : null, repo.fork ? "fork" : null, repo.archived ? "archived" : null, fetched.includes(repo.name) ? "already fetched" : null].filter(Boolean);
			return h("li", null, h("label", null, box, h("span", { class: "wrap" }, repo.name), marks.length > 0 ? h("span", { class: "hint" }, marks.join(" · ")) : null));
		});
		/** @param {boolean} on */
		const setAll = (on) => {
			for (const [index, repo] of (listed ?? []).entries()) {
				if (on) chosen.add(repo.name);
				else chosen.delete(repo.name);
				const box = boxes[index];
				if (box) box.checked = on;
			}
			label();
		};
		label();
		replace(
			listSlot,
			h(
				"div",
				{ class: "pick" },
				h(
					"div",
					{ class: "actions" },
					h("strong", null, `${plural(listed.length, "repository", "repositories")} on GitHub`),
					h("button", { type: "button", class: "button quiet", onclick: () => setAll(true) }, "Tick all"),
					h("button", { type: "button", class: "button quiet", onclick: () => setAll(false) }, "Untick all"),
				),
				h("p", { class: "hint" }, "Forks and archived repositories start unticked."),
				h("ul", { class: "repo-pick scroll" }, ...rows),
				h("div", { class: "actions" }, fetchButton),
			),
		);
	}
}

/** @param {unknown} err */
function message(err) {
	return err instanceof Error ? err.message : String(err);
}
