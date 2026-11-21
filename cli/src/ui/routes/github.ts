// Repositories on GitHub (invariant 15): which can be fetched, fetching them, and removing a fetched
// one. The token is used here and never reaches the browser; the page only learns whether one is set.
import { join } from "node:path";
import { fetchedRepos, fetchRepo, GithubError, listRepos, parseRepoName, removeFetched, validOwner, type GithubConfig } from "../../github/github.ts";
import { plainError } from "../../../ui/plain-error.js";
import type { ServerContext } from "../context.ts";
import type { Call } from "../gate.ts";
import { bodyObject, HttpError, sendJson } from "../http.ts";
import { notFoundUnder, type Answer, type Route } from "../router.ts";
import type { FetchStatus } from "../types.ts";

/** Repositories one fetch may name. */
const MAX_FETCH = 300;

export function createGithub(ctx: ServerContext) {
	const { options, dataDir } = ctx;
	const github: GithubConfig = options.github ?? { dir: join(dataDir, "github") };
	let fetching: FetchStatus = { state: "idle" };

	/** GitHub's own refusals are said with its status. */
	function githubErrors(answer: Answer): Answer {
		return async (call) => {
			try {
				return await answer(call);
			} catch (err) {
				if (err instanceof GithubError) throw new HttpError(err.status, err.message);
				throw err;
			}
		};
	}

	async function overview({ res }: Call): Promise<void> {
		return sendJson(res, 200, { token: github.token !== undefined, fetched: await fetchedRepos(github.dir), job: fetching });
	}

	async function repos({ res, url }: Call): Promise<void> {
		const owner = url.searchParams.get("owner")?.trim() || undefined;
		if (owner !== undefined && !validOwner(owner)) throw new HttpError(400, "That is not a GitHub account name. Type the name alone, such as octocat.");
		return sendJson(res, 200, await listRepos(github, owner, options.fetchFn));
	}

	async function fetchRoute({ res, body }: Call): Promise<void> {
		if (fetching.state === "running") throw new HttpError(409, "Repositories are already being fetched");
		if (ctx.scanStatus().state === "running") throw new HttpError(409, "A scan is running. Fetch when it has finished.");
		const fields = bodyObject(body);
		// Running before the first await, so a second request is refused (B24); as it was if nothing is fetched.
		const earlierFetch = fetching;
		fetching = { state: "running", done: 0, total: 0, current: null, errors: [] };
		let names: unknown;
		try {
			names = fields.all === true ? await fetchedRepos(github.dir) : fields.repos;
		} catch (err) {
			fetching = earlierFetch;
			throw err;
		}
		if (!Array.isArray(names) || names.length === 0 || names.length > MAX_FETCH || !names.every((name) => typeof name === "string" && parseRepoName(name))) {
			fetching = earlierFetch;
			throw new HttpError(400, `Choose 1 to ${MAX_FETCH} repositories, each named owner/repository`);
		}
		const wanted = [...new Set(names as string[])];
		fetching = { state: "running", done: 0, total: wanted.length, current: null, errors: [] };
		// Not awaited: fetching outlives this request and the page polls for progress.
		void (async () => {
			const errors: { repo: string; message: string }[] = [];
			for (const [index, repo] of wanted.entries()) {
				fetching = { state: "running", done: index, total: wanted.length, current: repo, errors };
				try {
					await fetchRepo(github, repo, options.run);
				} catch (err) {
					errors.push({ repo, message: plainError(err instanceof Error ? err.message : String(err)) });
				}
			}
			fetching = { state: "done", finishedAt: new Date().toISOString(), total: wanted.length, errors };
		})();
		return sendJson(res, 202, { job: fetching });
	}

	async function removeRoute({ res, url }: Call): Promise<void> {
		if (fetching.state === "running" || ctx.scanStatus().state === "running") throw new HttpError(409, "Wait for the fetch or scan that is running to finish");
		const name = url.searchParams.get("repo") ?? "";
		if (!parseRepoName(name)) throw new HttpError(400, "Name the repository as owner/repository");
		await removeFetched(github.dir, name);
		return sendJson(res, 200, { fetched: await fetchedRepos(github.dir) });
	}

	const routes: Route[] = [
		["GET /api/github", githubErrors(overview)],
		["GET /api/github/repos", githubErrors(repos)],
		["POST /api/github/fetch", githubErrors(fetchRoute)],
		["DELETE /api/github/fetched", githubErrors(removeRoute)],
		notFoundUnder("/api/github"),
	];

	return { github, fetchStatus: () => fetching, routes };
}
