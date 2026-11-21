/**
 * A fake GitHub account for the settings audit's tests: GitHub's API answering from fixed data. Nothing
 * touches the network. Token-, key- and secret-shaped values are assembled at run time, so this
 * repository's own secret scan has nothing to find.
 */

/** A fine-grained token's shape: `github_pat_` and letters, digits and underscores. */
export function fakeGithubToken(): string {
	return ["github", "pat", "11ABCDEFG0", "q9xR2mT7vL4pZ8nB3kW6cY1hF5jD0sA9gE2uN7qX"].join("_");
}

/** What GitHub would never send with hide_secret=true; the fake sends it anyway, to prove it is not kept. */
export const ALERT_SECRET = ["ghp", "Zq8Xw2Lm4Np6Rt1Vy3Bc5Df7Hj9Kk0Ss2Uu4"].join("_");
/** A deploy key's public half, which the audit never keeps. */
export const DEPLOY_KEY = ["ssh-ed25519", "AAAAC3NzaC1lZDI1NTE5AAAAIFakeKeyForTestsOnly0123456789abcdef"].join(" ");
/** A webhook address's path and query, which the audit never keeps. */
export const HOOK_PATH = "/hooks/receive";
export const HOOK_QUERY = ["key", "=", "Qw7Er9Ty2Ui4"].join("");
export const HOSTILE = "<script>alert(1)</script>";
export const FORMULA = "=HYPERLINK(\"http://evil.example\")";

export interface FakeGithubOptions {
	/** Every Administration read answers 403, and the repository leaves out security_and_analysis. */
	denyAdmin?: boolean;
	/** Webhooks answer 403. */
	denyHooks?: boolean;
	/** The token is refused (401) everywhere. */
	refused?: boolean;
	/** Answer the rate limit to the first `times` requests whose path ends with `path`. */
	rateLimit?: { path: string; times: number; retryAfter?: string; resetInSeconds?: number; status?: 403 | 429 };
	/** Extra administered public repositories, all well set, to make the list run to several pages. */
	extraRepos?: number;
	now?: () => number;
}

export interface GhSent {
	method: string;
	host: string;
	path: string;
	query: string;
	authorization: string | null;
	redirect: string | undefined;
}

interface RepoFixture {
	full_name: string;
	private: boolean;
	fork: boolean;
	archived: boolean;
	admin: boolean;
	default_branch: string;
	security: Record<string, { status: string }> | null;
	protection: { status: number; body: unknown };
	rules: unknown[];
	vulnerability: number;
	dependabot: { status: number; body: unknown };
	secrets: { status: number; body: unknown };
	workflow: unknown;
	fork_policy: { status: number; body: unknown };
	keys: unknown[];
	hooks: unknown[];
}

function strong(name: string): RepoFixture {
	return {
		full_name: name,
		private: false,
		fork: false,
		archived: false,
		admin: true,
		default_branch: "main",
		security: { secret_scanning: { status: "enabled" }, secret_scanning_push_protection: { status: "enabled" } },
		protection: { status: 404, body: { message: "Branch not protected" } },
		rules: [{ type: "pull_request", parameters: { required_approving_review_count: 1 } }, { type: "non_fast_forward" }, { type: "deletion" }],
		vulnerability: 204,
		dependabot: { status: 200, body: [] },
		secrets: { status: 200, body: [] },
		workflow: { default_workflow_permissions: "read", can_approve_pull_request_reviews: false },
		fork_policy: { status: 200, body: { approval_policy: "first_time_contributors" } },
		keys: [],
		hooks: [],
	};
}

export function fakeGithub(options: FakeGithubOptions = {}) {
	const sent: GhSent[] = [];
	const limited = new Map<string, number>();
	const weak: RepoFixture = {
		...strong("octo/weak"),
		security: { secret_scanning: { status: "disabled" }, secret_scanning_push_protection: { status: "disabled" } },
		rules: [],
		vulnerability: 404,
		dependabot: { status: 403, body: { message: "Dependabot alerts are disabled for this repository." } },
		secrets: { status: 404, body: { message: "Secret scanning is disabled on this repository." } },
		workflow: { default_workflow_permissions: "write", can_approve_pull_request_reviews: true },
		fork_policy: { status: 200, body: { approval_policy: "first_time_contributors_new_to_github" } },
		keys: [
			{ id: 2, key: DEPLOY_KEY, title: FORMULA, read_only: false },
			{ id: 1, key: DEPLOY_KEY, title: `deploy ${HOSTILE}`, read_only: false },
			{ id: 3, key: DEPLOY_KEY, title: "reader", read_only: true },
		],
		hooks: [
			{ id: 1, active: true, config: { url: `http://hooks.example.net${HOOK_PATH}?${HOOK_QUERY}`, insecure_ssl: "0", secret: "********" } },
			{ id: 2, active: true, config: { url: `https://ci.example.org${HOOK_PATH}`, insecure_ssl: "1" } },
			{ id: 3, active: true, config: { url: "https://fine.example.com/x", insecure_ssl: "0" } },
		],
	};
	const alerted: RepoFixture = {
		...strong("octo/alerted"),
		secrets: {
			status: 200,
			body: [
				{ number: 1, secret_type: "github_personal_access_token", secret_type_display_name: "GitHub Personal Access Token", secret: ALERT_SECRET, locations_url: "https://api.github.com/x" },
				{ number: 2, secret_type: "github_personal_access_token", secret_type_display_name: "GitHub Personal Access Token", secret: ALERT_SECRET },
				{ number: 3, secret_type: "slack_webhook", secret_type_display_name: HOSTILE, secret: ALERT_SECRET },
			],
		},
		dependabot: { status: 200, body: [{ security_advisory: { severity: "high" } }, { security_advisory: { severity: "critical" } }, { security_advisory: { severity: "medium" } }] },
	};
	const privateFree: RepoFixture = {
		...strong("octo/private-free"),
		private: true,
		security: { dependabot_security_updates: { status: "disabled" } },
		protection: { status: 403, body: { message: "Upgrade to GitHub Pro or make this repository public to enable this feature." } },
		rules: [],
		secrets: { status: 404, body: { message: "Secret scanning is disabled on this repository." } },
	};
	const repos: RepoFixture[] = [
		weak,
		alerted,
		privateFree,
		strong("octo/strong"),
		{ ...strong("octo/readonly"), admin: false },
		{ ...strong("octo/old"), archived: true },
		...Array.from({ length: options.extraRepos ?? 0 }, (_, index) => strong(`octo/extra-${index}`)),
	];

	const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
	const answer = (fixture: { status: number; body: unknown }) => json(fixture.body, fixture.status);
	const denied = () => json({ message: "Resource not accessible by personal access token" }, 403);
	const page = (items: unknown[], url: URL) => {
		const perPage = Number(url.searchParams.get("per_page") ?? "30");
		const n = Number(url.searchParams.get("page") ?? "1");
		return json(items.slice((n - 1) * perPage, n * perPage));
	};

	const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
		const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
		const headers = new Headers(init?.headers);
		sent.push({ method: init?.method ?? "GET", host: url.host, path: url.pathname, query: url.search, authorization: headers.get("authorization"), redirect: init?.redirect });
		if (url.host !== "api.github.com") throw new Error(`the fake GitHub only answers api.github.com, not ${url.host}`);
		if (options.refused) return json({ message: "Bad credentials" }, 401);
		if (options.rateLimit && url.pathname.endsWith(options.rateLimit.path)) {
			const times = limited.get(url.pathname) ?? 0;
			if (times < options.rateLimit.times) {
				limited.set(url.pathname, times + 1);
				const rateHeaders: Record<string, string> = { "x-ratelimit-remaining": "0" };
				if (options.rateLimit.retryAfter) rateHeaders["retry-after"] = options.rateLimit.retryAfter;
				if (options.rateLimit.resetInSeconds !== undefined) rateHeaders["x-ratelimit-reset"] = String(Math.floor((options.now?.() ?? Date.now()) / 1000) + options.rateLimit.resetInSeconds);
				return json({ message: "API rate limit exceeded" }, options.rateLimit.status ?? 403, rateHeaders);
			}
		}
		if (url.pathname === "/user/repos") {
			return page(
				repos.map((repo) => ({ full_name: repo.full_name, private: repo.private, fork: repo.fork, archived: repo.archived, default_branch: repo.default_branch, permissions: { admin: repo.admin, push: true, pull: true } })),
				url,
			);
		}
		const match = /^\/repos\/([^/]+)\/([^/]+)(\/.*)?$/.exec(url.pathname);
		const repo = match ? repos.find((candidate) => candidate.full_name === `${match[1]}/${match[2]}`) : undefined;
		if (!match || !repo) return json({ message: "Not Found" }, 404);
		const rest = match[3] ?? "";
		const admin = (respond: () => Response) => (options.denyAdmin ? denied() : respond());
		switch (rest) {
			case "":
				return json({ full_name: repo.full_name, private: repo.private, default_branch: repo.default_branch, ...(repo.security && !options.denyAdmin ? { security_and_analysis: repo.security } : {}) });
			case `/branches/${repo.default_branch}/protection`:
				return admin(() => answer(repo.protection));
			case `/rules/branches/${repo.default_branch}`:
				return page(repo.rules, url);
			case "/vulnerability-alerts":
				return admin(() => json(null, repo.vulnerability));
			case "/dependabot/alerts":
				return answer(repo.dependabot);
			case "/secret-scanning/alerts":
				return answer(repo.secrets);
			case "/actions/permissions":
				return admin(() => json({ enabled: true, allowed_actions: "all" }));
			case "/actions/permissions/workflow":
				return admin(() => json(repo.workflow));
			case "/actions/permissions/fork-pr-contributor-approval":
				return admin(() => answer(repo.fork_policy));
			case "/keys":
				return admin(() => page(repo.keys, url));
			case "/hooks":
				return options.denyHooks ? denied() : page(repo.hooks, url);
			default:
				return json({ message: "Not Found" }, 404);
		}
	}) as typeof fetch;

	return { fetchFn, sent };
}
