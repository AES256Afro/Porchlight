import assert from "node:assert/strict";
import { test } from "node:test";
import { auditGithub, GithubAuditError } from "../src/github/audit.ts";
import { githubAuditCommand } from "../src/github/audit-command.ts";
import { exportGithubAudit, renderGithubAuditText } from "../src/github/audit-export.ts";
import type { GhCheck, GhReport } from "../src/github/audit-types.ts";
import { auditAddress, validBranch } from "../src/github/github.ts";
import { failCode } from "../src/main.ts";
import { ALERT_SECRET, DEPLOY_KEY, fakeGithub, fakeGithubToken, FORMULA, HOOK_PATH, HOOK_QUERY, HOSTILE } from "./github-fake.ts";

const NOW = new Date("2026-11-21T10:00:00Z");
const noSleep = async () => {};

function checkOf(report: GhReport, repo: string, id: string): GhCheck {
	const found = report.repos.find((candidate) => candidate.name === repo)?.checks.find((check) => check.id === id);
	assert.ok(found, `${repo} has no ${id} check`);
	return found;
}

test("every request is a GET to api.github.com at an address built from GitHub names, with the token as a header only (invariant 24)", async () => {
	const token = fakeGithubToken();
	const world = fakeGithub();
	await auditGithub({ token, fetchFn: world.fetchFn, now: () => NOW, sleep: noSleep });
	assert.ok(world.sent.length > 20);
	for (const request of world.sent) {
		assert.equal(request.method, "GET", `${request.path} was not a read`);
		assert.equal(request.host, "api.github.com");
		assert.equal(request.authorization, `Bearer ${token}`);
		assert.equal(request.redirect, "error", "the token is never passed on to another host");
		assert.ok(!`${request.path}${request.query}`.includes(token), "the token is never in an address");
	}
	// Secret-scanning alerts are always asked for without the secret.
	const alerts = world.sent.filter((request) => request.path.endsWith("/secret-scanning/alerts"));
	assert.ok(alerts.length > 0);
	assert.ok(alerts.every((request) => new URLSearchParams(request.query).get("hide_secret") === "true"));
	// Archived repositories and ones the token cannot administer are not read beyond the list.
	assert.ok(!world.sent.some((request) => request.path.startsWith("/repos/octo/readonly") || request.path.startsWith("/repos/octo/old")));
});

test("addresses take only GitHub names, branch names git allows, and the audit's own query words", () => {
	assert.equal(auditAddress({ repo: "octo/weak", read: "hooks" }, { per_page: "100" }).href, "https://api.github.com/repos/octo/weak/hooks?per_page=100");
	assert.equal(auditAddress({ repo: "octo/weak", branch: "release/2.x", read: "protection" }).pathname, "/repos/octo/weak/branches/release/2.x/protection");
	for (const bad of ["octo/../x", "octo", "a/b/c", "octo/we ak", "-bad/x"]) assert.throws(() => auditAddress({ repo: bad, read: "repo" }), `${bad} is refused`);
	for (const branch of ["../main", "a//b", ".hidden", "main.lock", "x?y", "x#y", "x%2f", ""]) assert.equal(validBranch(branch), false, branch);
	assert.throws(() => auditAddress({ repo: "octo/weak", branch: "a/../b", read: "rules" }));
	assert.throws(() => auditAddress({ list: true }, { page: "1&x=2" }));
	assert.throws(() => auditAddress({ list: true }, { "Bad-Key": "1" }));
});

test("the rules: a weak repository fails each check, a strong one passes, a feature the plan lacks is unavailable", async () => {
	const world = fakeGithub();
	const report = await auditGithub({ token: fakeGithubToken(), fetchFn: world.fetchFn, now: () => NOW, sleep: noSleep });
	assert.deepEqual(report.repos.map((repo) => repo.name).sort(), ["octo/alerted", "octo/private-free", "octo/strong", "octo/weak"]);

	for (const id of ["branch-reviews", "branch-force-push", "branch-deletion", "secret-scanning", "push-protection", "dependabot-on", "actions-token", "actions-approve", "fork-approval", "deploy-keys", "webhooks"]) {
		assert.equal(checkOf(report, "octo/weak", id).status, "failed", id);
	}
	assert.equal(checkOf(report, "octo/weak", "webhooks").severity, "high", "plain http is the worse of the two");
	assert.deepEqual(checkOf(report, "octo/weak", "webhooks").items, ["hooks.example.net: plain http", "ci.example.org: the certificate is not checked"]);
	assert.equal(checkOf(report, "octo/weak", "deploy-keys").items?.length, 2);
	assert.ok(!report.repos.find((repo) => repo.name === "octo/weak")?.checks.some((check) => check.id === "secret-alerts"), "with scanning off there are no alerts to count");

	for (const check of report.repos.find((repo) => repo.name === "octo/strong")!.checks) assert.equal(check.status, "passed", check.id);

	// Alerts counted by type, and Dependabot's by severity, worst first.
	const alerts = checkOf(report, "octo/alerted", "secret-alerts");
	assert.equal(alerts.status, "failed");
	assert.equal(alerts.severity, "critical");
	assert.deepEqual(alerts.items, ["GitHub Personal Access Token: 2", `${HOSTILE}: 1`]);
	const dependabot = checkOf(report, "octo/alerted", "dependabot-open");
	assert.equal(dependabot.severity, "critical");
	assert.deepEqual(dependabot.items, ["critical: 1", "high: 1", "medium: 1"]);

	// A private repository on a free plan: branch protection and secret scanning are not offered, never a fault.
	for (const id of ["branch-reviews", "branch-force-push", "branch-deletion", "secret-scanning", "push-protection"]) assert.equal(checkOf(report, "octo/private-free", id).status, "unavailable", id);
	assert.ok(!report.repos.find((repo) => repo.name === "octo/private-free")?.checks.some((check) => check.id === "fork-approval"), "fork approval is asked of public repositories alone");

	assert.ok(report.notCovered.some((line) => line.startsWith("1 archived repository")));
	assert.ok(report.notCovered.some((line) => line.startsWith("1 repository you can read but do not administer")));
	assert.equal(report.rateLimited, false);
	assert.ok(report.permissions.every((permission) => permission.granted === true));
});

test("no secret, deploy key, webhook path or query is kept, in the report, an export or the terminal (invariant 3)", async () => {
	const token = fakeGithubToken();
	const report = await auditGithub({ token, fetchFn: fakeGithub().fetchFn, now: () => NOW, sleep: noSleep });
	const outputs = [JSON.stringify(report), ...(["md", "csv", "json"] as const).map((format) => exportGithubAudit(report, format).body), renderGithubAuditText(report)];
	for (const text of outputs) {
		for (const kept of [token, ALERT_SECRET, DEPLOY_KEY, HOOK_PATH, HOOK_QUERY, "********"]) assert.ok(!text.includes(kept), `${kept.slice(0, 12)}… is never kept`);
	}
});

test("exports escape what GitHub gives for their format, under a fixed name (invariant 11)", async () => {
	const report = await auditGithub({ token: fakeGithubToken(), fetchFn: fakeGithub().fetchFn, now: () => NOW, sleep: noSleep });
	const md = exportGithubAudit(report, "md");
	assert.equal(md.filename, "porchlight-github-settings-2026-11-21.md");
	// Names from GitHub are code spans or escaped text: raw markup is only ever inside a code span.
	assert.ok(md.body.includes(`- \`deploy ${HOSTILE}\``));
	assert.ok(!md.body.split("\n").some((line) => line.includes(HOSTILE) && !line.trim().startsWith("- `")), "no raw markup in Markdown outside a code span");
	assert.ok(md.body.includes("## Not covered"));
	const csv = exportGithubAudit(report, "csv");
	assert.equal(csv.filename, "porchlight-github-settings-2026-11-21.csv");
	assert.ok(!/(^|,)"?=HYPERLINK/m.test(csv.body), "a formula never starts a cell");
	assert.ok(csv.body.includes("'=HYPERLINK"));
	assert.ok(csv.body.includes("Not covered"));
	const json = exportGithubAudit(report, "json");
	assert.deepEqual(JSON.parse(json.body).repos.length, report.repos.length);
	assert.ok(!renderGithubAuditText(report).includes("\u001b"));
	void FORMULA;
});

test("a permission the token lacks is Could not check, naming the fine-grained permission and the classic scope, never passed (invariant 5)", async () => {
	const report = await auditGithub({ token: fakeGithubToken(), fetchFn: fakeGithub({ denyAdmin: true, denyHooks: true }).fetchFn, now: () => NOW, sleep: noSleep });
	const weak = report.repos.find((repo) => repo.name === "octo/weak")!;
	// The alerts list itself says Dependabot is off, which needs no Administration read.
	assert.equal(checkOf(report, "octo/weak", "dependabot-on").status, "failed");
	for (const id of ["secret-scanning", "push-protection", "actions-token", "actions-approve", "fork-approval", "deploy-keys"]) {
		const check = checkOf(report, "octo/weak", id);
		assert.equal(check.status, "unknown", id);
		assert.equal(check.permission, "Administration: Read-only", id);
		assert.match(check.detail, /"Administration: Read-only" \(a classic token: the repo scope\)/);
	}
	assert.equal(checkOf(report, "octo/weak", "webhooks").permission, "Webhooks: Read-only");
	assert.match(checkOf(report, "octo/weak", "webhooks").detail, /read:repo_hook/);
	// Branch protection could not be read and no ruleset does it: not known, so not failed and not passed.
	assert.equal(checkOf(report, "octo/weak", "branch-force-push").status, "unknown");
	// A ruleset proves it without the classic read.
	assert.equal(checkOf(report, "octo/strong", "branch-force-push").status, "passed");
	assert.ok(!weak.checks.some((check) => check.status === "passed"));
	// Dependabot on, but whether it is cannot be told from vulnerability-alerts alone without Administration.
	assert.equal(checkOf(report, "octo/strong", "dependabot-on").status, "passed", "the alerts list answered, so they are on");
	const administration = report.permissions.find((permission) => permission.name === "Administration: Read-only");
	assert.equal(administration?.granted, false);
	assert.equal(report.permissions.find((permission) => permission.name === "Metadata: Read-only")?.granted, true);
});

test("the rate limit: a short wait is waited out through the injected sleep; a long one is not, and what it stopped says Could not check", async () => {
	const waits: number[] = [];
	const sleep = async (ms: number) => {
		waits.push(ms);
	};
	const short = await auditGithub({ token: fakeGithubToken(), fetchFn: fakeGithub({ rateLimit: { path: "/octo/strong/hooks", times: 1, retryAfter: "2" } }).fetchFn, now: () => NOW, sleep });
	assert.deepEqual(waits, [2000]);
	assert.equal(short.rateLimited, false);
	assert.equal(checkOf(short, "octo/strong", "webhooks").status, "passed");

	waits.length = 0;
	const world = fakeGithub({ rateLimit: { path: "/keys", times: 100, resetInSeconds: 3600 }, now: () => NOW.getTime() });
	const long = await auditGithub({ token: fakeGithubToken(), fetchFn: world.fetchFn, now: () => NOW, sleep });
	assert.deepEqual(waits, [], "an hour is not waited");
	assert.equal(long.rateLimited, true);
	assert.ok(long.notCovered[0]?.includes("rate limit"));
	assert.ok(long.repos.flatMap((repo) => repo.checks).some((check) => check.status === "unknown"));
	assert.ok(!long.repos.flatMap((repo) => repo.checks).some((check) => check.id === "deploy-keys" && check.status === "passed"));
	// Once limited, the rest of the audit asks GitHub nothing more.
	const after = world.sent.findIndex((request) => request.path.endsWith("/keys"));
	assert.ok(world.sent.length - after < 15);

	waits.length = 0;
	const capped = await auditGithub({ token: fakeGithubToken(), fetchFn: fakeGithub({ rateLimit: { path: "/octo/strong/keys", times: 10, retryAfter: "1", status: 429 } }).fetchFn, now: () => NOW, sleep });
	assert.deepEqual(waits, [1000, 1000], "at most two retries");
	assert.equal(checkOf(capped, "octo/strong", "deploy-keys").status, "unknown");
});

test("the repository list is paged whole, and a cap on what is audited is said under Not covered", async () => {
	const world = fakeGithub({ extraRepos: 150 });
	const report = await auditGithub({ token: fakeGithubToken(), fetchFn: world.fetchFn, now: () => NOW, sleep: noSleep, maxRepos: 3 });
	assert.deepEqual(
		world.sent.filter((request) => request.path === "/user/repos").map((request) => new URLSearchParams(request.query).get("page")),
		["1", "2"],
	);
	assert.equal(report.repos.length, 3);
	assert.equal(report.reposSkipped, 151);
	assert.ok(report.notCovered.some((line) => line.startsWith("151 of the 154 repositories you administer")));
});

test("a token GitHub refuses stops the audit with words that never carry it", async () => {
	const token = fakeGithubToken();
	await assert.rejects(auditGithub({ token, fetchFn: fakeGithub({ refused: true }).fetchFn, now: () => NOW, sleep: noSleep }), (err) => err instanceof GithubAuditError && !err.message.includes(token) && /refused the token/.test(err.message));
});

test("porchlight github audit prints the audit and exits 2 under --fail-on, without a token it says what to set", async () => {
	const world = fakeGithub();
	let out = "";
	const deps = { fetchFn: world.fetchFn, env: { PORCHLIGHT_GITHUB_TOKEN: fakeGithubToken() }, sleep: noSleep, write: (text: string) => (out += text), warn: () => {}, failCode };
	assert.equal(await githubAuditCommand(["--json"], deps), 0);
	assert.equal(JSON.parse(out).repos.length, 4);
	out = "";
	assert.equal(await githubAuditCommand(["--fail-on", "critical"], deps), 2);
	assert.match(out, /^GitHub settings audit/);
	await assert.rejects(githubAuditCommand([], { ...deps, env: {} }), /PORCHLIGHT_GITHUB_TOKEN/);
	await assert.rejects(githubAuditCommand(["--fail-on", "urgent"], deps), /--fail-on/);
});

test("what a real account answers: no security block on a private repository, an empty repository, and Dependabot's cursor pages", async () => {
	const requests: string[] = [];
	const alert = (n: number) => ({ number: n, security_advisory: { severity: n === 1 ? "high" : "low" } });
	const fetchFn = (async (input: URL) => {
		const url = new URL(String(input));
		requests.push(`${url.pathname}${url.search}`);
		const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
		if (url.pathname === "/user/repos")
			return json([
				{ full_name: "me/secret-plans", private: true, fork: false, archived: false, default_branch: "main", permissions: { admin: true } },
				{ full_name: "me/empty", private: false, fork: false, archived: false, default_branch: "main", permissions: { admin: true } },
			]);
		if (url.pathname === "/repos/me/secret-plans") return json({ full_name: "me/secret-plans", private: true, default_branch: "main", size: 12, permissions: { admin: true }, security_and_analysis: null });
		if (url.pathname === "/repos/me/empty") return json({ full_name: "me/empty", private: false, default_branch: "main", size: 0, permissions: { admin: true } });
		if (url.pathname === "/repos/me/empty/branches/main/protection") return json({ message: "Branch not found" }, 404);
		// GitHub answers an empty list of rules, even for a branch that does not exist.
		if (url.pathname.includes("/rules/branches/")) return json([]);
		if (url.pathname === "/repos/me/secret-plans/dependabot/alerts") {
			if (url.searchParams.has("page")) return json({ message: "Pagination using the `page` parameter is not supported." }, 400);
			if (url.searchParams.get("after") === "Y3Vyc29yOjI=") return json([alert(2)]);
			// The next page's link, and one to another address that must not be followed.
			return json([alert(1)], 200, { link: `<https://api.github.com${url.pathname}?state=open&per_page=100&after=Y3Vyc29yOjI%3D>; rel="next", <https://evil.example/x?after=zzz>; rel="last"` });
		}
		return json({ message: "Not Found" }, 404);
	}) as unknown as typeof fetch;

	const report = await auditGithub({ token: fakeGithubToken(), fetchFn, now: () => NOW, sleep: noSleep });
	const status = (repo: string, id: string) => report.repos.find((entry) => entry.name === repo)?.checks.find((check) => check.id === id)?.status;
	assert.equal(status("me/secret-plans", "secret-scanning"), "unavailable", "an admin's token sees no block where GitHub does not offer the feature");
	assert.equal(status("me/empty", "branch-reviews"), "unavailable", "an empty repository has no branch to protect");
	assert.match(report.repos.find((entry) => entry.name === "me/empty")!.checks.find((check) => check.id === "branch-reviews")!.detail, /no commits yet/);
	assert.equal(status("me/secret-plans", "dependabot-open"), "failed", "both pages were read: one high alert is open");
	const alerts = requests.filter((path) => path.startsWith("/repos/me/secret-plans/dependabot/alerts"));
	assert.equal(alerts.length, 2);
	assert.ok(alerts.every((path) => !/[?&]page=/.test(path)));
	assert.match(alerts[1]!, /after=Y3Vyc29yOjI%3D|after=Y3Vyc29yOjI=/);
	assert.ok(requests.every((path) => !path.includes("evil")));
});
