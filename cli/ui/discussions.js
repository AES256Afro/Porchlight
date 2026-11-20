// @ts-check
// Discussions: every answer a model gave on these pages, kept on this computer so it can be read
// again after Porchlight closes and followed up. The list and one discussion in full. A discussion
// sits beside the findings and changes none of them. Every element is built with h(): titles hold
// finding titles and file paths from scans, and answers are a model's words.
import { api, ApiError, apiText, download } from "./api.js";
import { aboutLink, filterDiscussions, KIND_LABELS, kindLabel } from "./discussion-links.js";
import { followUpBox, turnNodes } from "./discussion.js";
import { emptyState, formatWhen, h, icon, plural, replace, select, toast } from "./dom.js";
import { debounce } from "./list.js";
import { announceSaved, ownFolder, revealButton } from "./projects.js";
import { currentProject, load, store } from "./store.js";

/** @typedef {import("../src/discussions/discussions.ts").DiscussionSummary} DiscussionSummary */
/** @typedef {import("../src/discussions/discussions.ts").DiscussionView} DiscussionView */

/**
 * @param {HTMLElement} view
 * @param {import("./finding-parts.js").Route} context
 * @returns {Promise<() => void>}
 */
export async function renderDiscussions(view, context) {
	// The projects come with the shared settings: which one a transcript is kept in, and the one in use.
	await load();
	const id = context.path[1];
	return id ? renderOne(view, id) : renderList(view, context);
}

/**
 * @param {HTMLElement} view
 * @param {import("./finding-parts.js").Route} context
 */
async function renderList(view, context) {
	const data = await api("GET", "/discussions");
	const all = /** @type {DiscussionSummary[]} */ (Array.isArray(data.discussions) ? data.discussions : []);
	let kind = context.params.get("kind") ?? "";
	let project = context.params.get("project") ?? "";
	let query = context.params.get("q") ?? "";
	const results = h("div");
	const remember = () => context.replace({ kind, project, q: query });
	const search = /** @type {HTMLInputElement} */ (
		h("input", {
			type: "search",
			value: query,
			placeholder: "Search titles, models, repositories and domains",
			"aria-label": "Search discussions",
			oninput: debounce(() => {
				query = search.value;
				remember();
				draw();
			}, 150),
		})
	);
	const kinds = select("Kind of discussion", [["", "Every kind"], ...KIND_LABELS.map(([key, label]) => /** @type {[string, string]} */ ([key, label]))], kind, (value) => {
		kind = value;
		remember();
		draw();
	});
	// Which project a discussion's transcript is kept in, once there are projects to choose from.
	const listed = store.projects.projects;
	const projects =
		listed.length > 0
			? select(
					"Project",
					[["", "Every project"], ...listed.map((one) => /** @type {[string, string]} */ ([one.id, one.name])), ["none", "No project"]],
					project,
					(value) => {
						project = value;
						remember();
						draw();
					},
				)
			: null;

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
					h("h1", null, "Discussions"),
					h(
						"p",
						{ class: "sub" },
						"Every answer a model gave on these pages, kept on this computer so you can read it again and ask follow-up questions. A discussion never changes a finding.",
					),
					// An investigation is a model's work too, but it is a run with steps and evidence, kept where it ran.
					h("p", { class: "hint" }, "An investigation a model ran is not listed here. It is kept with its steps and evidence on the ", h("a", { href: "#/investigate" }, "Investigate"), " page, under Earlier investigations."),
				),
			),
			all.length > 0 ? h("div", { class: "filters" }, h("div", { class: "field grow" }, search), kinds, projects) : null,
			results,
		),
	);
	draw();
	return () => {};

	function draw() {
		if (all.length === 0) {
			replace(
				results,
				emptyState(
					"No discussions yet",
					"Ask a model to explain a finding, summarise the roadmap, answer a question about a scan or analyse a Cloudflare audit. Its answer is kept here, and you can ask follow-up questions under it.",
					h("a", { class: "button primary", href: "#/findings" }, "Go to the findings"),
				),
			);
			return;
		}
		const shown = filterDiscussions(all, { kind, project, q: query });
		replace(
			results,
			shown.length === 0
				? emptyState("Nothing matches", "Clear the search, or choose every kind and every project.")
				: h(
						"ul",
						{ class: "discussion-list" },
						...shown.map((discussion) =>
							h(
								"li",
								{ class: "discussion-row" },
								h("a", { class: "discussion-title", href: `#/discussions/${discussion.id}` }, discussion.title),
								h(
									"span",
									{ class: "hint" },
									`${kindLabel(discussion.kind)} · ${discussion.model}${discussion.hosted ? " (hosted)" : ""} · ${plural(discussion.answers, "answer", "answers")} · ${formatWhen(discussion.updatedAt)}`,
								),
							),
						),
					),
		);
	}
}

/**
 * One discussion in full, with a box for a follow-up question.
 *
 * @param {HTMLElement} view
 * @param {string} id
 */
async function renderOne(view, id) {
	/** @type {{ discussion: DiscussionView, followUp: { ok: boolean, reason?: string } }} */
	let data;
	try {
		data = /** @type {any} */ (await api("GET", `/discussions/one?id=${encodeURIComponent(id)}`));
	} catch (err) {
		if (!(err instanceof ApiError && err.status === 404)) throw err;
		replace(view, h("section", { class: "page" }, emptyState("There is no such discussion", "It may have been deleted. Porchlight keeps the last 200.", h("a", { class: "button", href: "#/discussions" }, "All discussions"))));
		return () => {};
	}
	const { discussion, followUp } = data;
	const [first, ...later] = discussion.turns;
	const meta = h("p", { class: "sub" });
	const drawMeta = () =>
		replace(
			meta,
			`${kindLabel(discussion.kind)} · ${discussion.model} at ${discussion.host}${discussion.hosted ? " (hosted: what it read left this computer)" : ""} · started ${formatWhen(discussion.createdAt)} · ${plural(discussion.turns.length, "answer", "answers")}`,
		);
	drawMeta();
	// Where its transcript is kept in a project folder, written again after every answer.
	const keptIn = h("div", { class: "kept-in" });
	const drawKept = () => {
		const kept = discussion.saved;
		const project = kept ? store.projects.projects.find((one) => one.id === kept.project) : undefined;
		const here = currentProject();
		replace(
			keptIn,
			kept
				? h(
						"p",
						{ class: "hint" },
						icon("folder"),
						project ? ` Kept in ${project.name}: Porchlight/Discussions/${kept.name}. It is written again after every answer. ` : ` Kept in a project that is no longer listed, as ${kept.name}. `,
						project ? revealButton(`${ownFolder(project)}/Discussions/${kept.name}`) : null,
					)
				: null,
			here && kept?.project !== here.id ? h("button", { type: "button", class: "button", onclick: () => void keep() }, icon("folder"), `Save in ${here.name}`) : null,
		);
	};
	const keep = async () => {
		try {
			const answer = /** @type {any} */ (await api("POST", "/discussions/save", { id: discussion.id }));
			discussion.saved = answer.discussion.saved;
			drawKept();
			if (answer.saved) announceSaved(answer.saved);
		} catch (err) {
			toast(err instanceof Error ? err.message : String(err), "error");
		}
	};
	drawKept();
	const about = aboutLink(discussion);
	let confirming = false;
	const remove = /** @type {HTMLButtonElement} */ (
		h(
			"button",
			{
				type: "button",
				class: "button",
				onclick: async () => {
					// Two presses, so a stray click deletes nothing. It cannot be undone.
					if (!confirming) {
						confirming = true;
						replace(remove, discussion.saved ? "Delete here? The project's copy stays" : "Delete for good?");
						setTimeout(() => {
							confirming = false;
							replace(remove, "Delete");
						}, 5000);
						return;
					}
					try {
						await api("POST", "/discussions/delete", { id: discussion.id });
						toast("Discussion deleted");
						location.hash = "#/discussions";
					} catch (err) {
						toast(err instanceof Error ? err.message : String(err), "error");
					}
				},
			},
			"Delete",
		)
	);

	replace(
		view,
		h(
			"section",
			{ class: "page discussion-page" },
			h("p", null, h("a", { href: "#/discussions" }, "← All discussions")),
			h("div", { class: "page-head" }, h("div", null, h("h1", null, discussion.title), meta)),
			keptIn,
			h(
				"div",
				{ class: "actions" },
				about ? h("a", { class: "button", href: about.href }, about.label) : null,
				h("button", { type: "button", class: "button", onclick: () => void copyText(discussion.id) }, icon("copy"), "Copy as text"),
				h("button", { type: "button", class: "button", onclick: () => void save(discussion.id) }, icon("download"), "Export"),
				remove,
			),
			h(
				"div",
				{ class: "card full discussion-thread" },
				...(first ? turnNodes(first, [discussion.about.partial ? `Sent only part of the scan: ${discussion.about.partial}.` : undefined, discussion.cut]) : []),
				followUpBox(discussion, {
					turns: later,
					blocked: followUp.ok ? null : (followUp.reason ?? "This discussion cannot take a follow-up question."),
					onTurn: (turn) => {
						discussion.turns.push(turn);
						discussion.updatedAt = turn.at;
						drawMeta();
					},
				}),
			),
		),
	);
	return () => {};
}

/** The discussion as plain text, on the clipboard. The server writes the text, the same as the export's. */
async function copyText(/** @type {string} */ id) {
	try {
		await navigator.clipboard.writeText(await apiText(`/discussions/export?id=${encodeURIComponent(id)}&format=txt`));
		toast("Copied");
	} catch (err) {
		toast(err instanceof Error ? err.message : "Could not copy", "error");
	}
}

async function save(/** @type {string} */ id) {
	try {
		toast(`Saved ${await download(`/discussions/export?id=${encodeURIComponent(id)}&format=md`)}`);
	} catch (err) {
		toast(err instanceof Error ? err.message : String(err), "error");
	}
}
