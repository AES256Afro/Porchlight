/**
 * `porchlight github audit`: the GitHub settings audit from a terminal (invariant 24). It only reads,
 * with PORCHLIGHT_GITHUB_TOKEN, and prints the result; the interface keeps it as github-audit.json.
 */
import { parseArgs } from "node:util";
import { jsonText } from "../roadmap/escape.ts";
import { SEVERITIES, type Severity } from "../repos/types.ts";
import { auditGithub } from "./audit.ts";
import { renderGithubAuditText } from "./audit-export.ts";
import type { Sleep } from "./audit-client.ts";
import { tokenProblem } from "./github.ts";

export interface GithubAuditDeps {
	fetchFn?: typeof fetch;
	env?: NodeJS.ProcessEnv;
	sleep?: Sleep;
	write: (text: string) => void;
	warn: (text: string) => void;
	/** The exit code under --fail-on, as `host check` and `cloudflare audit` give it. */
	failCode: (checks: { status: string; severity?: string }[], failOn: Severity | undefined) => number;
}

export async function githubAuditCommand(args: string[], deps: GithubAuditDeps): Promise<number> {
	const { values } = parseArgs({ args, options: { json: { type: "boolean", default: false }, "fail-on": { type: "string" } } });
	const failOn = values["fail-on"];
	if (failOn !== undefined && !SEVERITIES.includes(failOn as Severity)) throw new Error(`--fail-on must be one of: ${SEVERITIES.join(", ")}`);
	// BoxPilot passes an optional setting left empty as an empty variable, so empty counts as not given.
	const token = (deps.env ?? process.env).PORCHLIGHT_GITHUB_TOKEN?.trim() || undefined;
	if (!token) throw new Error("No GitHub token. Set PORCHLIGHT_GITHUB_TOKEN to a token with read permissions only; `porchlight github audit --help` lists them.");
	const problem = tokenProblem(token);
	if (problem) throw new Error(problem);
	const report = await auditGithub({
		token,
		fetchFn: deps.fetchFn,
		sleep: deps.sleep,
		onProgress: ({ done, total, current }) => {
			if (current) deps.warn(`Reading ${Math.min(done + 1, total)} of ${total}: ${current}`);
		},
	});
	deps.write(values.json ? jsonText(report) : renderGithubAuditText(report));
	return deps.failCode(
		report.repos.flatMap((repo) => repo.checks),
		failOn as Severity | undefined,
	);
}
