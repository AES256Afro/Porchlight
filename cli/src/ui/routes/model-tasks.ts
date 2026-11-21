// A model per task (R6F-10): GET and POST /api/model-tasks. Settings chooses which of the models set up
// does Deeper analysis, murals and investigations; Explain, Summarise and Ask use the model chosen
// under Settings → Model. A choice is an id from Porchlight's own list (`sendTargets`), never an address
// or a key from the request, and it holds no key (model-tasks.json, 0600). Every request to a task's
// model still names the model the page showed, and a hosted one still needs the page's word that it
// said what is sent there (confirmModel, S22, invariant 13).
import { join } from "node:path";
import { isModelTask, MODEL_TASKS, ModelSettingError, readTaskChoices, saveTaskChoices, TASK_WORDS, taskTarget, withTask, type ModelTask, type SendTarget, type TaskChoices } from "../../assist/settings.ts";
import { oneAtATime, UnreadableFileError } from "../../private-files.ts";
import type { ServerContext } from "../context.ts";
import type { Call, Gate } from "../gate.ts";
import { onOwnPage } from "../gate.ts";
import { bodyObject, HttpError, sendJson } from "../http.ts";
import { otherMethods, type Route } from "../router.ts";
import type { ModelInUse } from "../types.ts";

/** The tasks a model can be chosen for here. Explain, Summarise and Ask follow Settings → Model. */
export const CHOSEN_TASKS: readonly ModelTask[] = MODEL_TASKS.filter((task) => task !== "explain");

export async function createModelTasks(dataDir: string, targets: () => SendTarget[]) {
	const path = join(dataDir, "model-tasks.json");
	const kept = await readTaskChoices(path);
	let choices: TaskChoices = kept.tasks;
	/** Why the file could not be read, when it could not: nothing is then written over it. */
	const unreadable = kept.unreadable;

	/** The model a task uses: its own when one is chosen and still set up, or null for the one in use. */
	function modelFor(task: ModelTask): ModelInUse | null {
		if (!CHOSEN_TASKS.includes(task)) return null;
		const target = taskTarget(choices, task, targets());
		return target ? { config: target.config, unset: false, source: "settings" } : null;
	}

	function describe(ctx: ServerContext, gate: Gate) {
		return {
			tasks: CHOSEN_TASKS.map((task) => ({ task, words: TASK_WORDS[task], target: taskTarget(choices, task, targets())?.id ?? null, using: ctx.assistantSummary(task) })),
			targets: targets().map((target) => ({ id: target.id, label: target.label, hosted: target.hosted })),
			canChange: onOwnPage(gate),
		};
	}

	async function choose(ctx: ServerContext, { res, body, gate }: Call): Promise<void> {
		const fields = bodyObject(body);
		if (!isModelTask(fields.task) || !CHOSEN_TASKS.includes(fields.task)) throw new HttpError(400, "Choose a task");
		const target = fields.target === null || fields.target === "" ? null : fields.target;
		if (target !== null && typeof target !== "string") throw new HttpError(400, "Choose one of the models listed");
		const task = fields.task;
		if (unreadable) throw new HttpError(409, new UnreadableFileError("Your model for each task", unreadable).message);
		await oneAtATime(path, async () => {
			try {
				const next = withTask(choices, task, target, targets());
				await saveTaskChoices(path, next);
				choices = next;
			} catch (err) {
				if (err instanceof ModelSettingError) throw new HttpError(400, err.message);
				throw err;
			}
		});
		const using = modelFor(task);
		ctx.log(`${TASK_WORDS[task]}: ${using?.config ? ctx.modelWords(using.config) : "the model chosen under Settings, Model"}`);
		return sendJson(res, 200, describe(ctx, gate));
	}

	/** Chosen from the owner's own page, never another device (S20). */
	function routes(ctx: ServerContext): Route[] {
		return [
			["GET /api/model-tasks", ({ res, gate }) => sendJson(res, 200, describe(ctx, gate)), "owner"],
			["POST /api/model-tasks", (call) => choose(ctx, call), "owner"],
			otherMethods(["/api/model-tasks"], "owner"),
		];
	}

	return { modelFor, routes };
}
