// @ts-check
// A model per task (R6F-10): which of the models set up does Deeper analysis, murals and investigations.
// Explain, Summarise and Ask use the model chosen under Settings → Model. The server takes each task's
// model from its own list, never from the page; the page only names one of the ids the server offered,
// and every request still says which model the page showed (S22).
import { api } from "./api.js";
import { h, replace, toast } from "./dom.js";
import { store } from "./store.js";

/** @typedef {import("./generated.js").AssistantSettings} AssistantSettings */
/** @typedef {"analysis" | "mural" | "investigate"} ChosenTask */
/** @typedef {{ tasks: { task: ChosenTask, words: string, target: string | null, using: AssistantSettings }[], targets: { id: string, label: string, hosted: boolean }[], canChange: boolean }} TaskState */

/** @type {Partial<Record<ChosenTask, AssistantSettings>>} */
let using = {};
/** @type {Promise<void> | null} */
let loading = null;

/** Asks the server which model each task uses now. */
export function loadTaskModels() {
	loading = api("GET", "/model-tasks")
		.then((answer) => {
			const state = /** @type {TaskState} */ (answer);
			using = Object.fromEntries(state.tasks.map((entry) => [entry.task, entry.using]));
		})
		.catch(() => {
			using = {};
		});
	return loading;
}

/**
 * The model a task uses, as the page shows it: its own when one is chosen, else the one in use. Before
 * the server has answered, the one in use: a request that names it while the task has another is
 * refused by the server, never sent to the wrong model.
 *
 * @param {ChosenTask} task
 * @returns {AssistantSettings | undefined}
 */
export function taskAssistant(task) {
	return using[task] ?? store.settings?.assistant;
}

// Asked once as the page opens, so the pages that start a task show its model. Not where there is no page (tests).
if (typeof window !== "undefined" && typeof document !== "undefined") void loadTaskModels();

/** Settings → Model for each task. */
export function modelTasksSection() {
	const body = h("div", null, h("p", { class: "loading" }, "Loading…"));
	const section = h(
		"section",
		{ id: "settings-model-tasks", tabindex: "-1", class: "card full", "aria-labelledby": "settings-model-tasks-title" },
		h("h2", { id: "settings-model-tasks-title" }, "A model for each task"),
		h(
			"p",
			{ class: "sub" },
			"Explain, Summarise and Ask use the model chosen above. Deeper analysis, murals and investigations can each use another model you have set up, such as a small local one for quick answers and a larger one for analysis. Each page says which model it sends to, and what goes outside your machines, before anything is sent.",
		),
		body,
	);
	void draw();
	return section;

	async function draw() {
		try {
			const state = /** @type {TaskState} */ (await api("GET", "/model-tasks"));
			using = Object.fromEntries(state.tasks.map((entry) => [entry.task, entry.using]));
			replace(
				body,
				...state.tasks.map((entry) => {
					const id = `model-task-${entry.task}`;
					const select = /** @type {HTMLSelectElement} */ (
						h(
							"select",
							{
								id,
								"aria-disabled": state.canChange ? null : "true",
								onchange: async () => {
									if (!state.canChange) return;
									try {
										await api("POST", "/model-tasks", { task: entry.task, target: select.value || null });
										toast(`${entry.words}: ${select.selectedOptions[0]?.textContent ?? ""}`);
										await draw();
									} catch (err) {
										toast(err instanceof Error ? err.message : String(err), "error");
										await draw();
									}
								},
							},
							h("option", { value: "", selected: entry.target === null }, "The model in use"),
							...state.targets.map((target) => h("option", { value: target.id, selected: entry.target === target.id }, `${target.label}${target.hosted ? " (hosted, outside your machines)" : ""}`)),
						)
					);
					return h(
						"div",
						{ class: "field" },
						h("label", { for: id }, entry.words),
						select,
						h("p", { class: "hint" }, entry.using.configured ? `Uses ${entry.using.model} at ${entry.using.host}.` : "No model is set up for it."),
					);
				}),
				state.canChange ? null : h("p", { class: "hint" }, "Changed from the page on the computer that runs Porchlight."),
			);
		} catch (err) {
			replace(body, h("p", { class: "form-error" }, err instanceof Error ? err.message : String(err)));
		}
	}
}
