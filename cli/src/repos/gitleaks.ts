import { firstLine, type Runner } from "./exec.ts";
import { triageSecret } from "./triage.ts";
import type { Finding } from "./types.ts";

/**
 * Scans a repository's whole commit history for secrets. `--redact` is not
 * optional: the secret values must never reach this process's output, so a
 * report can be shared or stored without becoming a leak itself.
 */
export async function runGitleaks(repo: string, run: Runner): Promise<Finding[]> {
	const { code, stdout, stderr } = await run("gitleaks", [
		"git",
		"--report-format",
		"json",
		"--report-path",
		"-",
		"--redact",
		"--no-banner",
		"--no-color",
		"--log-level",
		"error",
		"--exit-code",
		"0",
		repo,
	]);
	if (code !== 0) throw new Error(firstLine(stderr) || `gitleaks exited with code ${code}`);
	return parseGitleaks(stdout);
}

export function parseGitleaks(output: string): Finding[] {
	const rows: unknown = JSON.parse(output.trim() || "[]");
	if (!Array.isArray(rows)) throw new Error("gitleaks: unexpected report shape");

	// The same line is reported once per commit that touched it; keep the first.
	const byLocation = new Map<string, Finding>();
	for (const row of rows) {
		if (typeof row !== "object" || row === null) continue;
		const { RuleID, Description, File, StartLine, Commit, Date: date } = row as Record<string, unknown>;
		if (typeof RuleID !== "string" || typeof File !== "string") continue;
		const location = typeof StartLine === "number" ? `${File}:${StartLine}` : File;
		const key = `${RuleID}\n${location}`;
		if (byLocation.has(key)) continue;
		const commit = typeof Commit === "string" && Commit ? `commit ${Commit.slice(0, 8)}` : "working tree";
		const day = typeof date === "string" ? ` on ${date.slice(0, 10)}` : "";
		byLocation.set(key, {
			tool: "gitleaks",
			kind: "secret",
			ruleId: RuleID,
			title: typeof Description === "string" ? firstSentence(Description) : RuleID,
			location,
			detail: `${commit}${day}`,
			// A committed credential is exposed and must be rotated: high, unless
			// triage finds reasons to doubt that this match is a live one.
			...triageSecret(RuleID, File),
		});
	}
	return [...byLocation.values()];
}

function firstSentence(text: string): string {
	const end = text.indexOf(", ");
	return end > 0 ? text.slice(0, end) : text;
}
