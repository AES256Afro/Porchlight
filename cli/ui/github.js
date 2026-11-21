// @ts-check
import { api } from "./api.js";
import { announce, banner, formatNumber, h, icon, isOff, pager, pageVisibility, plural, replace, setOff, shownText, stepNodes, toast } from "./dom.js";
import { fetchByDefault, githubTokenSteps } from "./hints.js";
import { paginate } from "./list.js";
import { poller } from "./poller.js";
import { store } from "./store.js";

/** @typedef {import("../src/github/github.ts").GithubRepo} GithubRepo */
/** @typedef {import("../src/ui/server.ts").FetchStatus} FetchStatus */

const POLL_MS = 1000;
/** Repositories listed from GitHub at a time. */
const PICK_PAGE = 50;

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
	/** The page of GitHub's list on show. */
	let pickPage = 1;
	/** @type {string[]} */
	let fetched = [];
	/** @type {GithubRepo[] | null} */
	let listed = null;
	/** Whether GitHub has more repositories than the list holds. */
	let more = false;
	/** @type {Set<string>} */
	const chosen = new Set();
	/** @type {FetchStatus} */
	let job = { state: "idle" };

	const fetchedSlot = h("div");
	const listSlot = h("div");
	// Not a live region: the fetch moves every second. Its start and end are said with announce().
	const jobSlot = h("div");
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
				? "Porchlight copies the repositories you choose onto this server, then checks them along with anything in the server's folder."
				: "Porchlight copies the repositories you choose onto this computer, then checks them along with the folder above.",
		),
		store.settings?.github?.error ? banner("warning", "The GitHub token is not being used", [store.settings.github.error]) : null,
		hasToken
			? h("p", null, h("span", { class: "severity status-good" }, icon("good"), "A GitHub token is set, so private repositories can be fetched too."))
			: h(
					"details",
					{ class: "options" },
					h("summary", null, "Private repositories need a token. How to add one"),
					h("ol", { class: "steps" }, ...githubTokenSteps(service).map((step) => h("li", null, ...stepNodes(step)))),
					h("p", { class: "hint" }, "The token stays inside Porchlight. It is never sent to this page."),
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
	/** Reads what is fetched and whether a fetch is running, and keeps reading while one is. */
	const follow = poller({
		every: POLL_MS,
		visibility: pageVisibility(),
		run: async () => {
			const state = await api("GET", "/github");
			if (stopped) return false;
			const finished = job.state === "running" && state.job.state !== "running";
			const changed = fetched.join("\n") !== state.fetched.join("\n");
			fetched = state.fetched;
			job = state.job;
			draw();
			if (finished) announce("Fetching from GitHub finished");
			if (finished || changed) onChange();
			return job.state === "running";
		},
		onGiveUp: (err) => {
			if (!stopped) replace(jobSlot, banner("error", "Could not read what has been fetched", [message(err)]));
		},
	});
	follow.now();
	return {
		node,
		stop: () => {
			stopped = true;
			follow.stop();
		},
	};

	async function list() {
		const owner = ownerInput.value.trim().replace(/^@/, "").replace(/^https?:\/\/github\.com\//i, "").replace(/\/.*$/, "");
		if (owner === "" && !hasToken) return toast("Type a GitHub account name first", "error");
		if (isOff(listButton)) return;
		setOff(listButton, true);
		replace(listSlot, h("p", { class: "hint" }, "Asking GitHub…"));
		try {
			const answer = await api("GET", `/github/repos${owner ? `?owner=${encodeURIComponent(owner)}` : ""}`);
			if (stopped) return;
			listed = /** @type {GithubRepo[]} */ (answer.repos);
			more = answer.more === true;
			pickPage = 1;
			chosen.clear();
			for (const repo of listed) if (fetchByDefault(repo) && !fetched.includes(repo.name)) chosen.add(repo.name);
		} catch (err) {
			listed = null;
			replace(listSlot, banner("error", "Could not list repositories", [message(err)]));
			setOff(listButton, false);
			return;
		}
		setOff(listButton, false);
		draw();
	}

	/** @param {Record<string, unknown>} body */
	async function start(body) {
		try {
			const answer = await api("POST", "/github/fetch", body);
			job = answer.job;
			draw();
			announce("Fetching from GitHub started");
			follow.start();
		} catch (err) {
			toast(message(err), "error");
		}
	}

	/** @param {string} name */
	async function remove(name) {
		try {
			await api("DELETE", `/github/fetched?repo=${encodeURIComponent(name)}`);
			toast(`Removed ${name} from this ${service ? "server" : "computer"}`);
			follow.now();
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
						h("div", { class: "actions" }, h("button", { type: "button", class: "button", "aria-disabled": running ? "true" : null, onclick: () => void start({ all: true }) }, "Update all from GitHub")),
						h(
							"ul",
							{ class: "repo-pick" },
							...fetched.map((name) =>
								h("li", null, h("span", { class: "wrap" }, name), h("button", { type: "button", class: "button quiet", "aria-disabled": running ? "true" : null, "aria-label": `Remove ${name}`, onclick: () => void remove(name) }, "Remove")),
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
			setOff(fetchButton, running || chosen.size === 0);
			fetchButton.textContent = shownText(chosen.size === 0 ? "Choose repositories to fetch" : `Fetch ${plural(chosen.size, "repository", "repositories")}`);
		};
		// A long list is paged (UI-B13); what is ticked is kept across pages.
		const page = paginate(listed, pickPage, PICK_PAGE);
		pickPage = page.page;
		/** @type {HTMLInputElement[]} */
		const boxes = [];
		const rows = page.items.map((repo) => {
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
			for (const repo of listed ?? []) {
				if (on) chosen.add(repo.name);
				else chosen.delete(repo.name);
			}
			for (const box of boxes) box.checked = on;
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
				more ? h("p", { class: "hint" }, `GitHub has more than these ${formatNumber(listed.length)}: the list holds the ones pushed to most recently.`) : null,
				h("ul", { class: "repo-pick" }, ...rows),
				page.pages > 1
					? pager(page, "repositories", (next) => {
							pickPage = next;
							drawList(running);
						})
					: null,
				h("div", { class: "actions" }, fetchButton),
			),
		);
	}
}

/** @param {unknown} err */
function message(err) {
	return err instanceof Error ? err.message : String(err);
}
