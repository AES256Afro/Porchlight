import { randomBytes } from "node:crypto";
import { mkdir, readdir, rename, rm, rmdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { firstLine, run as defaultRun, type Runner } from "../repos/exec.ts";

/**
 * Fetching repositories from GitHub, so a copy of SecurityX on a server has something to scan.
 *
 * What keeps this safe:
 * - The only host ever contacted is GitHub's, at addresses built here from an owner and a
 *   repository name that match GitHub's own naming rules. No address comes from a request.
 * - The token goes to api.github.com in a header, and to git through its environment. It is never
 *   in an argument, an address, a repository's configuration, a report, a log or the browser.
 * - A fetched repository is hostile input like any other (see gitleaks.ts): cloning runs none of
 *   its code. Hooks, submodules, symbolic links, credential helpers, the user's own git settings
 *   and every transport but https are switched off, and redirects are not followed.
 */
export interface GithubConfig {
	/** A token that can read the repositories to fetch. Without one, only public repositories. */
	token?: string;
	/** Folder that holds the fetched repositories, as `<owner>/<repository>`. */
	dir: string;
}

export interface GithubRepo {
	/** `owner/repository`. */
	name: string;
	private: boolean;
	fork: boolean;
	archived: boolean;
	sizeKb: number;
	pushedAt: string | null;
}

export class GithubError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
		this.name = "GithubError";
	}
}

const API = "https://api.github.com";
const OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
/** Classic (`ghp_…`) and fine-grained (`github_pat_…`) tokens are letters, digits and underscores. */
const TOKEN_PATTERN = /^[A-Za-z0-9_]{20,255}$/;
const PAGE_SIZE = 100;
/** Pages of repositories asked for before stopping: 1,000 repositories. */
const MAX_PAGES = 10;
const API_TIMEOUT_MS = 20_000;

/** Why a token cannot be used, or null when it is well formed. Says nothing about whether GitHub accepts it. */
export function tokenProblem(token: string): string | null {
	return TOKEN_PATTERN.test(token) ? null : "SECURITYX_GITHUB_TOKEN is not a GitHub token: expected 20 or more letters, digits and underscores";
}

export function validOwner(owner: string): boolean {
	return OWNER_PATTERN.test(owner);
}

/** `owner/repository` split into its parts, or null when either part is not a name GitHub allows. */
export function parseRepoName(name: string): { owner: string; repo: string } | null {
	const [owner = "", repo = "", ...rest] = name.split("/");
	if (rest.length > 0 || !OWNER_PATTERN.test(owner) || !REPO_PATTERN.test(repo)) return null;
	// A folder named like these would be mistaken for something else on disk.
	if (repo === "." || repo === ".." || repo.toLowerCase() === ".git") return null;
	return { owner, repo };
}

/**
 * Repositories to choose from: with no owner, everything the token can read; with one, that
 * account's public repositories.
 */
export async function listRepos(config: GithubConfig, owner: string | undefined, fetchFn: typeof fetch = fetch): Promise<GithubRepo[]> {
	if (owner === undefined && !config.token) throw new GithubError(400, "Name a GitHub account, or add a token to list your own repositories");
	if (owner !== undefined && !validOwner(owner)) throw new GithubError(400, "That is not a GitHub account name");
	const path = owner === undefined ? "/user/repos?affiliation=owner,collaborator,organization_member&" : `/users/${owner}/repos?type=owner&`;

	const repos: GithubRepo[] = [];
	for (let page = 1; page <= MAX_PAGES; page++) {
		let response: Response;
		try {
			response = await fetchFn(`${API}${path}sort=pushed&per_page=${PAGE_SIZE}&page=${page}`, {
				headers: {
					accept: "application/vnd.github+json",
					"x-github-api-version": "2022-11-28",
					"user-agent": "securityx",
					...(config.token ? { authorization: `Bearer ${config.token}` } : {}),
				},
				// The token is for this host alone, so the request is never passed on to another.
				redirect: "error",
				signal: AbortSignal.timeout(API_TIMEOUT_MS),
			});
		} catch (err) {
			throw new GithubError(502, `Could not reach GitHub: ${err instanceof Error ? err.message : String(err)}`);
		}
		if (!response.ok) throw new GithubError(response.status === 404 ? 404 : 502, apiProblem(response.status, owner));
		const items: unknown = await response.json().catch(() => null);
		if (!Array.isArray(items)) throw new GithubError(502, "GitHub's answer was not a list of repositories");
		for (const item of items) {
			const repo = toRepo(item);
			if (repo) repos.push(repo);
		}
		if (items.length < PAGE_SIZE) break;
	}
	return repos;
}

function apiProblem(status: number, owner: string | undefined): string {
	if (status === 401) return "GitHub refused the token. It may have expired or been revoked: make a new one and replace it.";
	if (status === 403 || status === 429) return "GitHub's request limit is used up for now. Try again in a few minutes; a token raises the limit.";
	if (status === 404) return owner === undefined ? "GitHub did not find the token's account" : `There is no GitHub account named ${owner}`;
	return `GitHub answered HTTP ${status}`;
}

function toRepo(item: unknown): GithubRepo | null {
	if (typeof item !== "object" || item === null) return null;
	const fields = item as Record<string, unknown>;
	// A name that is not a GitHub name is dropped: it would become a folder and an address.
	if (typeof fields.full_name !== "string" || !parseRepoName(fields.full_name)) return null;
	return {
		name: fields.full_name,
		private: fields.private === true,
		fork: fields.fork === true,
		archived: fields.archived === true,
		sizeKb: typeof fields.size === "number" ? fields.size : 0,
		pushedAt: typeof fields.pushed_at === "string" ? fields.pushed_at : null,
	};
}

/** The repositories already fetched, as `owner/repository`, in name order. */
export async function fetchedRepos(dir: string): Promise<string[]> {
	const names: string[] = [];
	for (const owner of await folders(dir)) {
		if (!validOwner(owner)) continue;
		for (const repo of await folders(join(dir, owner))) {
			const name = `${owner}/${repo}`;
			if (parseRepoName(name) && (await stat(join(dir, owner, repo, ".git")).catch(() => null))) names.push(name);
		}
	}
	return names.sort((a, b) => a.localeCompare(b));
}

async function folders(dir: string): Promise<string[]> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
	return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

/** Git settings for every command here: nothing a repository carries can run, and only https is spoken. */
export const GIT_SAFE_ARGS = [
	...["core.hooksPath=/dev/null", "core.symlinks=false", "core.fsmonitor=false", "credential.helper=", "submodule.recurse=false"],
	...["protocol.allow=never", "protocol.https.allow=always", "http.followRedirects=false"],
].flatMap((setting) => ["-c", setting]);

/**
 * The environment git runs in: no prompts, none of the user's or the system's git settings (which
 * could name filters, helpers or rewritten addresses), and the token as a header for GitHub only.
 */
export function gitEnv(token: string | undefined): Record<string, string> {
	const env: Record<string, string> = {
		GIT_TERMINAL_PROMPT: "0",
		GIT_ASKPASS: "",
		GIT_CONFIG_GLOBAL: "/dev/null",
		GIT_CONFIG_NOSYSTEM: "1",
		GIT_LFS_SKIP_SMUDGE: "1",
	};
	if (token) {
		env.GIT_CONFIG_COUNT = "1";
		env.GIT_CONFIG_KEY_0 = "http.https://github.com/.extraheader";
		env.GIT_CONFIG_VALUE_0 = `Authorization: Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
	}
	return env;
}

/**
 * Fetches one repository, or brings an already fetched one up to date. A new clone is made beside
 * its final place and moved there when complete, so a failed one leaves nothing half-written to scan.
 */
export async function fetchRepo(config: GithubConfig, name: string, run: Runner = defaultRun): Promise<void> {
	const parsed = parseRepoName(name);
	if (!parsed) throw new GithubError(400, `${name} is not a GitHub repository name`);
	const env = gitEnv(config.token);
	const target = join(config.dir, parsed.owner, parsed.repo);
	const git = async (args: string[]): Promise<void> => {
		const { code, stderr } = await run("git", [...GIT_SAFE_ARGS, ...args], { env });
		if (code !== 0) throw new Error(gitProblem(stderr, code, config.token));
	};

	if (await stat(join(target, ".git")).catch(() => null)) {
		await git(["-C", target, "fetch", "--prune", "--quiet", "--no-recurse-submodules", "origin"]);
		await git(["-C", target, "reset", "--hard", "--quiet", "origin/HEAD"]);
		return;
	}
	await mkdir(join(config.dir, parsed.owner), { recursive: true, mode: 0o700 });
	// Hidden, so a scan that starts meanwhile does not look inside.
	const temporary = join(config.dir, `.fetching-${randomBytes(6).toString("hex")}`);
	try {
		await git(["clone", "--quiet", "--no-recurse-submodules", "--", `https://github.com/${parsed.owner}/${parsed.repo}.git`, temporary]);
		await rm(target, { recursive: true, force: true });
		await rename(temporary, target);
	} finally {
		await rm(temporary, { recursive: true, force: true });
	}
}

function gitProblem(stderr: string, code: number, token: string | undefined): string {
	let text = stderr.replace(/^(?:fatal|error|remote): /gm, "");
	// git does not print the token, but nothing that might hold it is passed on.
	if (token) text = text.replaceAll(token, "[token]").replaceAll(Buffer.from(`x-access-token:${token}`).toString("base64"), "[token]");
	const line = firstLine(text);
	if (/could not read Username|Authentication failed|Repository not found|returned error: 40[134]/i.test(text)) {
		return token ? "GitHub would not give this repository to the token. Check the token can read it." : "This repository is private or does not exist. A token is needed for private repositories.";
	}
	return line || `git exited with code ${code}`;
}

/** Deletes a fetched repository from this machine. GitHub's copy is untouched. */
export async function removeFetched(dir: string, name: string): Promise<void> {
	const parsed = parseRepoName(name);
	if (!parsed) throw new GithubError(400, `${name} is not a GitHub repository name`);
	await rm(join(dir, parsed.owner, parsed.repo), { recursive: true, force: true });
	// The owner's folder goes too once it is empty; a folder that still has repositories stays.
	await rmdir(join(dir, parsed.owner)).catch(() => {});
}
