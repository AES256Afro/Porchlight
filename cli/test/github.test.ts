import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fetchedRepos, fetchRepo, GIT_SAFE_ARGS, gitEnv, GithubError, listRepos, parseRepoName, removeFetched, tokenProblem } from "../src/github/github.ts";
import { fakeRunner, makeTree, tempDir } from "./helpers.ts";

/** Token-shaped, assembled at run time so nothing credential-like is committed. */
const TOKEN = ["github", "pat", "x".repeat(30)].join("_");

test("accepts only names GitHub allows, since a name becomes a folder and an address", () => {
	assert.deepEqual(parseRepoName("octocat/Hello-World"), { owner: "octocat", repo: "Hello-World" });
	assert.deepEqual(parseRepoName("octocat/.github"), { owner: "octocat", repo: ".github" });
	for (const bad of ["", "octocat", "octocat/", "/repo", "a/b/c", "octocat/..", "octocat/.", "octocat/.git", "../etc/passwd", "-bad/repo", "octocat/a b", "octocat/a;b", "https://evil.example/x", "octo cat/repo", "octocat/repo\n"]) {
		assert.equal(parseRepoName(bad), null, bad);
	}
	assert.equal(tokenProblem(TOKEN), null);
	assert.match(tokenProblem("short") ?? "", /not a GitHub token/);
	assert.match(tokenProblem(`${TOKEN} `) ?? "", /not a GitHub token/);
});

test("clones with git settings that run nothing a repository carries, and keeps the token out of every argument", async () => {
	const dir = await tempDir();
	// Stands in for git: makes the folder a clone would have made.
	const run = fakeRunner({ git: (args) => (mkdirSync(join(args.at(-1) ?? "", ".git"), { recursive: true }), {}) });

	await fetchRepo({ dir, token: TOKEN }, "octocat/Hello-World", run);
	assert.deepEqual(await fetchedRepos(dir), ["octocat/Hello-World"]);

	const [clone = []] = run.calls;
	assert.deepEqual(clone.slice(0, 1 + GIT_SAFE_ARGS.length), ["git", ...GIT_SAFE_ARGS]);
	for (const setting of ["core.hooksPath=/dev/null", "core.symlinks=false", "credential.helper=", "protocol.allow=never", "protocol.https.allow=always", "http.followRedirects=false"]) {
		assert.ok(GIT_SAFE_ARGS.includes(setting), setting);
	}
	const rest = clone.slice(1 + GIT_SAFE_ARGS.length);
	assert.deepEqual(rest.slice(0, 5), ["clone", "--quiet", "--no-recurse-submodules", "--", "https://github.com/octocat/Hello-World.git"]);
	// Cloned beside its final place, in a hidden folder a scan does not enter.
	assert.match(rest[5] ?? "", /\/\.fetching-[0-9a-f]+$/);

	const encoded = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
	assert.ok(!run.calls.flat().some((arg) => arg.includes(TOKEN) || arg.includes(encoded)), "the token is in no argument");
	const env = run.envs[0] ?? {};
	assert.equal(env.GIT_CONFIG_KEY_0, "http.https://github.com/.extraheader");
	assert.equal(env.GIT_CONFIG_VALUE_0, `Authorization: Basic ${encoded}`);
	assert.equal(env.GIT_CONFIG_GLOBAL, "/dev/null");
	assert.equal(env.GIT_CONFIG_NOSYSTEM, "1");
	assert.equal(env.GIT_TERMINAL_PROMPT, "0");
	// Without a token there is no header at all.
	assert.equal(gitEnv(undefined).GIT_CONFIG_COUNT, undefined);
});

test("refuses a name that is not a repository before git runs", async () => {
	const run = fakeRunner({ git: () => ({}) });
	await assert.rejects(fetchRepo({ dir: await tempDir() }, "octocat/../../etc", run), GithubError);
	await assert.rejects(fetchRepo({ dir: await tempDir() }, "--upload-pack=x/y", run), GithubError);
	assert.deepEqual(run.calls, []);
});

test("brings a fetched repository up to date instead of cloning it again", async () => {
	const dir = await tempDir();
	await makeTree(dir, { "octocat/Hello-World/.git/HEAD": "ref" });
	const run = fakeRunner({ git: () => ({}) });

	await fetchRepo({ dir }, "octocat/Hello-World", run);

	const commands = run.calls.map((call) => call.slice(1 + GIT_SAFE_ARGS.length));
	const target = join(dir, "octocat", "Hello-World");
	assert.deepEqual(commands, [
		["-C", target, "fetch", "--prune", "--quiet", "--no-recurse-submodules", "origin"],
		["-C", target, "reset", "--hard", "--quiet", "origin/HEAD"],
	]);
});

test("a failed clone leaves nothing behind, and its message never carries the token", async () => {
	const dir = await tempDir();
	const encoded = Buffer.from(`x-access-token:${TOKEN}`).toString("base64");
	const failing = fakeRunner({ git: () => ({ code: 128, stderr: `fatal: unable to access 'https://github.com/a/b.git/': header ${encoded} ${TOKEN} rejected\n` }) });
	await assert.rejects(fetchRepo({ dir, token: TOKEN }, "a/b", failing), (err: Error) => {
		assert.doesNotMatch(err.message, new RegExp(TOKEN));
		assert.doesNotMatch(err.message, new RegExp(encoded));
		assert.match(err.message, /unable to access/);
		return true;
	});
	assert.deepEqual(await fetchedRepos(dir), []);

	const denied = fakeRunner({ git: () => ({ code: 128, stderr: "remote: Repository not found.\nfatal: repository 'https://github.com/a/b.git/' not found\n" }) });
	await assert.rejects(fetchRepo({ dir }, "a/b", denied), /private or does not exist/);
	await assert.rejects(fetchRepo({ dir, token: TOKEN }, "a/b", denied), /would not give this repository to the token/);
});

test("lists what was fetched, and removing one deletes only that repository", async () => {
	const dir = await tempDir();
	await makeTree(dir, { "octocat/one/.git/HEAD": "ref", "octocat/two/.git/HEAD": "ref", "octocat/not-a-repo/readme.md": "x", ".fetching-abc/.git/HEAD": "ref", "other/three/.git/HEAD": "ref" });
	assert.deepEqual(await fetchedRepos(dir), ["octocat/one", "octocat/two", "other/three"]);
	assert.deepEqual(await fetchedRepos(join(dir, "missing")), []);

	await removeFetched(dir, "other/three");
	assert.deepEqual(await fetchedRepos(dir), ["octocat/one", "octocat/two"]);
	assert.equal(await stat(join(dir, "other")).catch(() => null), null, "an owner's folder goes once it is empty");
	await assert.rejects(removeFetched(dir, "octocat/.."), GithubError);
	assert.ok(await stat(join(dir, "octocat", "one")));
});

test("lists a token's repositories page by page, sending the token only as a header to GitHub", async () => {
	const requests: { url: string; headers: Record<string, string>; redirect: unknown }[] = [];
	const page = (count: number, start: number) =>
		Array.from({ length: count }, (_, i) => ({ full_name: `me/repo-${start + i}`, private: i % 2 === 0, fork: false, archived: false, size: 10, pushed_at: "2026-11-01T00:00:00Z" }));
	const fetchFn = (async (url: string, init: RequestInit) => {
		requests.push({ url, headers: init.headers as Record<string, string>, redirect: init.redirect });
		const number = Number(new URL(url).searchParams.get("page"));
		return Response.json(number === 1 ? [...page(99, 0), { full_name: "../../evil", private: false }] : page(3, 100));
	}) as unknown as typeof fetch;

	const { repos, more } = await listRepos({ dir: "/unused", token: TOKEN }, undefined, fetchFn);
	assert.equal(more, false);

	assert.equal(repos.length, 102, "a name that is not a GitHub name is dropped");
	assert.deepEqual(repos[0], { name: "me/repo-0", private: true, fork: false, archived: false, sizeKb: 10, pushedAt: "2026-11-01T00:00:00Z" });
	assert.equal(requests.length, 2);
	for (const request of requests) {
		assert.ok(request.url.startsWith("https://api.github.com/user/repos?"));
		assert.ok(!request.url.includes(TOKEN));
		assert.equal(request.headers.authorization, `Bearer ${TOKEN}`);
		assert.equal(request.redirect, "error");
	}
});

test("lists an account's public repositories without a token, and explains GitHub's refusals", async () => {
	const urls: string[] = [];
	const answer = (status: number, body: unknown) =>
		(async (url: string, init: RequestInit) => {
			urls.push(url);
			assert.equal((init.headers as Record<string, string>).authorization, undefined);
			return Response.json(body, { status });
		}) as unknown as typeof fetch;

	const { repos } = await listRepos({ dir: "/unused" }, "octocat", answer(200, [{ full_name: "octocat/Hello-World", fork: true }]));
	assert.deepEqual(repos.map((repo) => [repo.name, repo.fork, repo.pushedAt]), [["octocat/Hello-World", true, null]]);
	assert.ok(urls[0]?.startsWith("https://api.github.com/users/octocat/repos?type=owner&"));

	await assert.rejects(listRepos({ dir: "/unused" }, "nobody", answer(404, {})), /no GitHub account named nobody/);
	await assert.rejects(listRepos({ dir: "/unused" }, "octocat", answer(403, {})), /request limit/);
	await assert.rejects(listRepos({ dir: "/unused", token: TOKEN }, undefined, (async () => Response.json({}, { status: 401 })) as unknown as typeof fetch), /refused the token/);
	await assert.rejects(listRepos({ dir: "/unused" }, "octocat", (async () => { throw new Error("offline"); }) as unknown as typeof fetch), /Could not reach GitHub: offline/);
	// Never asked: no account named and no token, or a name that is not one.
	const before = urls.length;
	await assert.rejects(listRepos({ dir: "/unused" }, undefined, answer(200, [])), /Name a GitHub account/);
	await assert.rejects(listRepos({ dir: "/unused" }, "../users", answer(200, [])), /not a GitHub account name/);
	assert.equal(urls.length, before);
});

test("an account with more repositories than one list holds is said to have more, never cut short silently (B62)", async () => {
	const full = (async (url: string) => {
		const number = Number(new URL(url).searchParams.get("page"));
		return Response.json(Array.from({ length: 100 }, (_, index) => ({ full_name: `big/repo-${number}-${index}` })));
	}) as unknown as typeof fetch;
	const { repos, more } = await listRepos({ dir: "/unused" }, "big", full);
	assert.equal(repos.length, 1000);
	assert.equal(more, true);
});
