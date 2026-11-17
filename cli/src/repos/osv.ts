import { relative } from "node:path";
import { lastLine, type Runner } from "./exec.ts";
import type { Finding, Severity } from "./types.ts";

/**
 * osv-scanner's exit codes. Anything else is a failure, notably 127 when the
 * vulnerability database cannot be reached: it then still prints a report
 * with no results, which must not be read as "no vulnerabilities".
 */
const VULNERABILITIES_FOUND = 1;
const NO_PACKAGES_FOUND = 128;

/** Checks the dependencies named in a repository's lockfiles against the OSV database. */
export async function runOsvScanner(repo: string, run: Runner): Promise<Finding[]> {
	const { code, stdout, stderr } = await run("osv-scanner", ["scan", "source", "--recursive", "--format", "json", repo]);
	if (code === NO_PACKAGES_FOUND) return [];
	if (code !== 0 && code !== VULNERABILITIES_FOUND) {
		// Progress lines come first on stderr; the reason for the failure is last.
		throw new Error(lastLine(stderr) || `osv-scanner exited with code ${code}`);
	}
	return parseOsv(stdout, repo);
}

interface OsvPackage {
	package?: { name?: string; version?: string; ecosystem?: string };
	vulnerabilities?: { id?: string; summary?: string }[];
	groups?: { ids?: string[]; max_severity?: string }[];
}

export function parseOsv(output: string, repo: string): Finding[] {
	const start = output.indexOf("{");
	if (start < 0) return [];
	const report = JSON.parse(output.slice(start)) as { results?: { source?: { path?: string }; packages?: OsvPackage[] }[] };

	// osv-scanner can list one package twice for the same lockfile; an advisory
	// for a package version in a file is one finding however often it is listed.
	const findings = new Map<string, Finding>();
	for (const result of report.results ?? []) {
		const lockfile = result.source?.path ? relative(repo, result.source.path) : "unknown lockfile";
		for (const entry of result.packages ?? []) {
			const name = entry.package?.name ?? "unknown package";
			const version = entry.package?.version ?? "?";
			const summaries = new Map((entry.vulnerabilities ?? []).map((vuln) => [vuln.id, vuln.summary]));
			// A group is one underlying flaw, which may be listed under several IDs.
			for (const group of entry.groups ?? []) {
				const id = group.ids?.[0];
				if (!id) continue;
				const summary = group.ids!.map((alias) => summaries.get(alias)).find(Boolean);
				const detail = `${name}@${version}`;
				const key = `${id}\n${lockfile}\n${detail}`;
				if (findings.has(key)) continue;
				findings.set(key, {
					tool: "osv-scanner",
					kind: "vulnerability",
					severity: severityFromCvss(group.max_severity),
					ruleId: id,
					title: summary ?? `Known vulnerability in ${name}`,
					location: lockfile,
					detail,
				});
			}
		}
	}
	return [...findings.values()];
}

/** CVSS base score to the usual bands. An advisory with no score is treated as medium, not ignored. */
export function severityFromCvss(score: string | undefined): Severity {
	const value = Number.parseFloat(score ?? "");
	if (!Number.isFinite(value) || value <= 0) return "medium";
	if (value >= 9) return "critical";
	if (value >= 7) return "high";
	if (value >= 4) return "medium";
	return "low";
}
