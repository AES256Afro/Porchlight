// Projects (invariant 23): a folder the owner chose, where exports, discussions and a daily log are
// written, under its `Porchlight` subfolder alone. /api/projects, the log, and saving an export there.
import { mkdir } from "node:fs/promises";
import type { ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";
import { appendLog, checkFolder, cleanName, FILE_TITLES, isProjectId, OWN_FOLDER, prepareProject, ProjectStore, saveFile, type FileTitle, type Project } from "../../projects/projects.ts";
import { onOwnPage, type Call, type Gate } from "../gate.ts";
import { bodyObject, HttpError, sendJson } from "../http.ts";
import { readReport } from "../report-cache.ts";
import { notFoundUnder, type Route } from "../router.ts";
import type { UiOptions } from "../server.ts";

export async function createProjects(options: UiOptions, dataDir: string, loopbackOnly: boolean, note: (text: string) => void) {
	const projects = new ProjectStore(join(dataDir, "projects.json"));
	// A service (a container) keeps project folders in its data volume, in a folder of their own.
	const projectsWithin = loopbackOnly ? undefined : join(dataDir, "projects");
	if (projectsWithin) await mkdir(projectsWithin, { recursive: true, mode: 0o700 }).catch(() => {});
	let logging: Promise<void> = Promise.resolve();

	/**
	 * Adds a line to a project's log: the one given, or the one in use. Lines are written in order, and
	 * a log that cannot be written never stops the work it records. Only Porchlight's own words and
	 * figures go in: never a key, a token, a secret value or a model's text.
	 */
	function log(text: string, project?: Project | null): void {
		const at = new Date();
		note(text);
		logging = logging
			.then(async () => {
				const target = project === undefined ? await projects.current() : project;
				if (target) await appendLog(target, text, at);
			})
			.catch((err) => console.error(`porchlight ui: could not write the project's log: ${err instanceof Error ? err.message : String(err)}`));
	}

	/** An export written into the project in use instead of downloaded, and said in its log. */
	async function saveExport(res: ServerResponse, file: { body: string; filename: string }, title: FileTitle): Promise<void> {
		const project = await projects.current();
		if (!project) throw new HttpError(409, "Choose a project first, under Settings → Projects, or download the file instead.");
		const extension = /\.([a-z]+)$/.exec(file.filename)?.[1] ?? "txt";
		const saved = await saveFile(project, "Exports", title, extension, file.body);
		log(`Exported ${FILE_TITLES[title]} (${extension}) to ${OWN_FOLDER}/Exports/${saved.name}`, project);
		return sendJson(res, 200, { saved: { ...saved, projectName: project.name } });
	}

	async function projectsState(gate: Gate) {
		const file = await projects.read();
		return {
			current: file.current,
			projects: file.projects,
			// The page on this computer, or a service's own page; never another device over the tailnet.
			canChange: onOwnPage(gate),
			// A service keeps its project folders inside its data folder.
			...(projectsWithin ? { within: projectsWithin } : {}),
		};
	}

	/** Projects are added and removed only from the owner's own page; another device can only move between them. */
	function ownPage(gate: Gate): void {
		if (!onOwnPage(gate)) throw new HttpError(403, "Projects are added and removed from the page on the computer that runs Porchlight");
	}

	async function checkOptions() {
		const report = await readReport(options.reportPath).catch(() => null);
		return { home: homedir(), scanRoots: [options.defaultRoot, ...(report ? [report.root] : [])], ...(projectsWithin ? { within: projectsWithin } : {}) };
	}

	/** Moving between projects already chosen is open to any page with the key: it chooses no folder. */
	async function use({ res, body, gate }: Call): Promise<void> {
		const fields = bodyObject(body);
		const id = fields.id ?? null;
		if (id !== null && !isProjectId(id)) throw new HttpError(400, "Choose a project");
		const project = await projects.use(id);
		if (project) log(`Using this project, ${project.name}`, project);
		return sendJson(res, 200, await projectsState(gate));
	}

	async function preview({ res, url, gate }: Call): Promise<void> {
		ownPage(gate);
		return sendJson(res, 200, { check: await checkFolder(url.searchParams.get("folder"), await checkOptions()) });
	}

	async function add({ res, body, gate }: Call): Promise<void> {
		const fields = bodyObject(body);
		ownPage(gate);
		const name = cleanName(fields.name);
		if (!name) throw new HttpError(400, "Name the project in 1 to 60 characters, such as acme-audit");
		const check = await checkFolder(fields.folder, await checkOptions());
		if (check.error) throw new HttpError(400, check.error);
		const project = await projects.add(name, check.folder);
		try {
			await prepareProject(project);
		} catch (err) {
			await projects.remove(project.id).catch(() => {});
			throw err;
		}
		log(`Project started: ${project.name}, in ${project.folder}`, project);
		return sendJson(res, 200, { ...(await projectsState(gate)), added: project.id });
	}

	async function remove({ res, body, gate }: Call): Promise<void> {
		const fields = bodyObject(body);
		ownPage(gate);
		if (!isProjectId(fields.id)) throw new HttpError(400, "Choose a project");
		const project = await projects.remove(fields.id);
		log("Project taken off Porchlight's list. Its folder and files are left as they are.", project);
		return sendJson(res, 200, await projectsState(gate));
	}

	const routes: Route[] = [
		["GET /api/projects", async ({ res, gate }) => sendJson(res, 200, await projectsState(gate))],
		["POST /api/projects/use", use],
		["GET /api/projects/preview", preview],
		["POST /api/projects", add],
		["POST /api/projects/remove", remove],
		notFoundUnder("/api/projects", "any", ({ req, body, gate }) => {
			if (req.method === "POST") bodyObject(body);
			ownPage(gate);
		}),
	];

	return { projects, projectsWithin, log, saveExport, projectsState, routes };
}
