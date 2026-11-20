import { fileURLToPath } from "node:url";
import { firstLine, type Runner } from "./exec.ts";
import { triageSecret } from "./triage.ts";
import type { Finding } from "./types.ts";

/**
 * gitleaks' built-in rules, shipped with Porchlight. Passing it with --config
 * means a scanned repository's own .gitleaks.toml is never loaded, so a
 * repository cannot switch detection off.
 */
export const GITLEAKS_CONFIG = fileURLToPath(new URL("./gitleaks.toml", import.meta.url));

/**
 * What gitleaks hands to `git log`. A scanned repository is hostile input, and
 * its .git/config can name programs for git to run while it prints diffs: a
 * textconv driver, an external diff, a signature checker. These options switch
 * all three off. `--full-history --all` are gitleaks' own defaults, which a
 * custom --log-opts replaces.
 */
export const GIT_LOG_OPTIONS = "--full-history --all --no-textconv --no-ext-diff --no-show-signature";

/**
 * Scans a repository's whole commit history for secrets. `--redact` is not
 * optional: the secret values must never reach this process's output, so a
 * report can be shared or stored without becoming a leak itself.
 */
export async function runGitleaks(repo: string, run: Runner): Promise<Finding[]> {
	const { code, stdout, stderr } = await run("gitleaks", [
		"git",
		"--config",
		GITLEAKS_CONFIG,
		`--log-opts=${GIT_LOG_OPTIONS}`,
		// Read .gitleaksignore from the repository only, never from the folder Porchlight runs in.
		"--gitleaks-ignore-path",
		repo,
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
	if (code !== 0) throw new Error(errorLine(stderr) || `gitleaks exited with code ${code}`);
	// When git cannot read the repository (another user's, a broken worktree, a
	// corrupt .git), gitleaks logs the error, reports nothing and still exits 0.
	// At --log-level error a good run writes nothing to stderr, so anything
	// there means the history was not read: a failure, never a clean result.
	if (stderr.trim() !== "") throw new Error(errorLine(stderr));
	return parseGitleaks(stdout);
}

/** gitleaks' first error line without its timestamp and level, e.g. "[git] fatal: detected dubious ownership…". */
function errorLine(stderr: string): string {
	return firstLine(stderr.replace(/^.*?\bERR\s+/gm, ""));
}

export function parseGitleaks(output: string): Finding[] {
	const rows: unknown = JSON.parse(output.trim() || "[]");
	if (!Array.isArray(rows)) throw new Error("gitleaks: unexpected report shape");

	// The same secret is reported again by each commit that rewrote its line; keep the first.
	// Which secret a match is cannot be told by its value (gitleaks runs with --redact), but its
	// entropy is a property of the value: equal for the same secret, all but never for two others.
	// It is used only to tell matches apart here and is never kept.
	const bySecret = new Map<string, Finding>();
	const details = new Set<string>();
	for (const row of rows) {
		if (typeof row !== "object" || row === null) continue;
		const { RuleID, Description, File, StartLine, StartColumn, Entropy, Commit, Date: date } = row as Record<string, unknown>;
		if (typeof RuleID !== "string" || typeof File !== "string") continue;
		const location = typeof StartLine === "number" ? `${File}:${StartLine}` : File;
		const key = `${RuleID}\n${location}\n${typeof Entropy === "number" ? Entropy : ""}`;
		if (bySecret.has(key)) continue;
		const commit = typeof Commit === "string" && Commit ? `commit ${Commit.slice(0, 8)}` : "working tree";
		const day = typeof date === "string" ? ` on ${date.slice(0, 10)}` : "";
		// Two secrets on one line in one commit would otherwise read the same, and share one note and status.
		let detail = `${commit}${day}`;
		const place = `${RuleID}\n${location}\n`;
		if (details.has(place + detail)) {
			let extra = typeof StartColumn === "number" ? `, column ${StartColumn}` : ", another match";
			for (let n = 2; details.has(place + detail + extra); n++) extra = `, match ${n}`;
			detail += extra;
		}
		details.add(place + detail);
		bySecret.set(key, {
			tool: "gitleaks",
			kind: "secret",
			ruleId: RuleID,
			title: typeof Description === "string" ? firstSentence(Description) : RuleID,
			location,
			detail,
			// A committed credential is exposed and must be rotated: high, unless
			// triage finds reasons to doubt that this match is a live one.
			...triageSecret(RuleID, File),
		});
	}
	return [...bySecret.values()];
}

function firstSentence(text: string): string {
	const end = text.indexOf(", ");
	return end > 0 ? text.slice(0, end) : text;
}
