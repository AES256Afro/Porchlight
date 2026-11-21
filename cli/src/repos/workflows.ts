import { GIT_SAFE_ARGS } from "../github/github.ts";
import type { Runner } from "./exec.ts";
import { gitReadEnv } from "./git-copy.ts";
import { readBlobs } from "./gitleaks.ts";
import type { Finding, Severity } from "./types.ts";

// Risks in a repository's GitHub Actions workflows (FT-2): how its code is built and changed, which a
// leaked key is not. Four patterns that let an outsider run code with the repository's secrets, or
// widen what a run may do:
//
// - `pull_request_target` that checks out the pull request's own code: the workflow runs with the
//   repository's secrets and a write token, on code anyone can send;
// - text an outsider writes (an issue's or a pull request's title or body, a branch name, a comment)
//   placed straight into a `run:` step with `${{ }}`, which the shell then runs;
// - a third-party action named by a tag or a branch, which its owner can move to other code;
// - `permissions: write-all`.
//
// The workflows are read from git's index with `cat-file` (readBlobs), which converts nothing, so no
// filter a repository names can run (invariant 14). They are read as text, line by line, with no YAML
// library (invariant 6): a check that cannot tell is left out rather than guessed. Nothing here is a
// secret, so the line itself may be named, never quoted.

/** Where workflows live; GitHub reads only these. */
const WORKFLOW_FILE = /^\.github\/workflows\/[^/]+\.ya?ml$/;
/** The largest workflow read; GitHub's own limit is far below. */
const MAX_BYTES = 1024 * 1024;

/** Outsiders' text a workflow can read from an event: titles, bodies, names, messages, labels, branches. */
const UNTRUSTED =
	/\$\{\{\s*(?:github\.event\.(?:issue|pull_request|comment|review|review_comment|discussion|discussion_comment|pages|commits|head_commit|workflow_run)(?:\.[\w.*\[\]'"-]+)*\.(?:title|body|name|message|label|ref|email|head_branch|default_branch|page_name)|github\.head_ref)\b[^}]*\}\}/;

/** A step that checks out the pull request's own code. */
const PR_CODE = /github\.event\.pull_request\.head\.(?:sha|ref)|github\.head_ref|refs\/pull\/|github\.event\.number|merge_commit_sha/;

interface Rule {
	ruleId: string;
	severity: Severity;
	title: string;
}

const RULES = {
	prTarget: { ruleId: "workflow-pr-target-checkout", severity: "critical", title: "A pull_request_target workflow checks out the pull request's code, so anyone's pull request runs with this repository's secrets" },
	injection: { ruleId: "workflow-script-injection", severity: "high", title: "Text an outsider writes is put straight into a run step, so it can run commands in the workflow" },
	unpinned: { ruleId: "workflow-unpinned-action", severity: "medium", title: "A third-party action is named by a tag or a branch its owner can move" },
	writeAll: { ruleId: "workflow-write-all", severity: "medium", title: "The workflow's token may write to everything (permissions: write-all)" },
} satisfies Record<string, Rule>;

/** The risky patterns in one workflow file, by line. `path` is the file's path inside the repository. */
export function workflowFindings(path: string, text: string): Finding[] {
	const lines = text.split(/\r?\n/);
	const findings: Finding[] = [];
	const add = (rule: Rule, line: number, detail: string) =>
		findings.push({ tool: "gitleaks", kind: "workflow", severity: rule.severity, ruleId: rule.ruleId, title: rule.title, location: `${path}:${line}`, detail, source: "files" });

	/** A line without its comment, which in YAML starts at a # outside quotes; good enough for the patterns here. */
	const code = (line: string) => line.replace(/(^|\s)#.*$/, "$1");
	const indent = (line: string) => line.length - line.trimStart().length;

	const prTarget = lines.some((line) => /(^|[\s,[{])pull_request_target\b/.test(code(line)));
	for (let index = 0; index < lines.length; index++) {
		const line = code(lines[index]!);
		const number = index + 1;

		if (/^\s*permissions\s*:\s*["']?write-all["']?\s*$/.test(line)) add(RULES.writeAll, number, "permissions: write-all");

		const uses = /^\s*(?:-\s*)?uses\s*:\s*["']?([^"'\s]+)/.exec(line)?.[1];
		if (uses) {
			const [action = "", ref] = uses.split("@");
			const local = action.startsWith("./") || action.startsWith("docker://");
			const firstParty = /^(?:actions|github)\//i.test(action);
			// A full commit id cannot be moved; a tag or a branch can. GitHub's own actions are left to its care.
			if (!local && !firstParty && ref !== undefined && !/^[0-9a-f]{40}$/i.test(ref)) add(RULES.unpinned, number, `${action}@${ref}`);
			// A pull_request_target workflow that checks out the pull request's code: the checkout step's
			// own lines, up to the next step, are where its ref is set.
			if (prTarget && /^actions\/checkout$/i.test(action)) {
				const step = indent(lines[index]!);
				for (let next = index + 1; next < lines.length; next++) {
					const text = lines[next]!;
					if (text.trim() !== "" && (indent(text) < step || (indent(text) === step && /^\s*-/.test(text)))) break;
					if (PR_CODE.test(code(text))) {
						add(RULES.prTarget, number, "pull_request_target with the pull request's code checked out");
						break;
					}
				}
			}
		}

		// A run step: one line, or a block below `run: |` or `run: >`, every line indented past it.
		const run = /^(\s*)(?:-\s*)?run\s*:\s*(.*)$/.exec(line);
		if (run) {
			const body = [{ text: run[2] ?? "", number }];
			if (/^[|>][-+]?\d*\s*$/.test((run[2] ?? "").trim())) {
				const base = indent(lines[index]!);
				for (let next = index + 1; next < lines.length; next++) {
					const text = lines[next]!;
					if (text.trim() !== "" && indent(text) <= base) break;
					body.push({ text, number: next + 1 });
				}
			}
			const injected = body.find((part) => UNTRUSTED.test(part.text));
			if (injected) add(RULES.injection, injected.number, "an event's text inside ${{ }} in a run step");
		}
	}
	return findings;
}

/**
 * The workflow risks of a repository, from the workflows git's index holds. A workflow that cannot be
 * read is left out; one larger than MAX_BYTES too. Both are rare enough not to make the scan incomplete,
 * and are said in `unread`.
 */
export async function scanWorkflows(repo: string, run: Runner): Promise<{ findings: Finding[]; unread: number }> {
	const listed = await run("git", [...GIT_SAFE_ARGS, "-C", repo, "ls-files", "--stage", "-z", "--", ".github/workflows"], { env: gitReadEnv() }).catch(() => null);
	if (!listed || listed.code !== 0) return { findings: [], unread: 0 };
	const files = new Map<string, string>();
	for (const entry of listed.stdout.split("\0")) {
		const found = /^(100644|100755) ([0-9a-f]{40,64}) 0\t(.+)$/s.exec(entry);
		if (found && WORKFLOW_FILE.test(found[3]!)) files.set(found[3]!, found[2]!);
	}
	if (files.size === 0) return { findings: [], unread: 0 };
	const blobs = await readBlobs(repo, [...new Set(files.values())], run);
	const findings: Finding[] = [];
	let unread = 0;
	for (const [path, id] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
		const content = blobs.get(id);
		if (!content || content.length > MAX_BYTES) {
			unread++;
			continue;
		}
		for (const finding of workflowFindings(path, content.toString("utf8"))) findings.push(finding);
	}
	return { findings, unread };
}
