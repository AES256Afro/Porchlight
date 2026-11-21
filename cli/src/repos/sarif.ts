/**
 * A scan as SARIF 2.1.0 (FT-9), for code-scanning tools such as GitHub's. It carries what the
 * Markdown report carries and no more: each finding's rule, title, place and detail as plain
 * `message.text`, never a secret's value, author or email (invariant 3). File places are inside the
 * repository; no path of this computer is written (S35). A scan that did not cover everything says
 * so in the run's properties (invariant 12), and the invocation is then not called successful.
 */
import { createHash } from "node:crypto";
import { findingKey } from "../../ui/tracking.js";
import { coverageNotes, rank, repoName, settingNotes } from "./report.ts";
import type { Finding, ScanReport, Severity } from "./types.ts";

const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json";

/** SARIF's levels: a finding worth fixing now is an error. */
const LEVEL: Record<Severity, "error" | "warning" | "note"> = { critical: "error", high: "error", medium: "warning", low: "note" };

/** GitHub orders code-scanning alerts by this number, from 0.0 to 10.0. */
const SECURITY_SEVERITY: Record<Severity, string> = { critical: "9.5", high: "8.0", medium: "5.5", low: "2.0" };

/** A place as "file:line" split into the file and its line, when it has one. */
function place(location: string): { file: string; line?: number } {
	const match = /^(.*):(\d+)$/.exec(location);
	return match ? { file: match[1]!, line: Number(match[2]) } : { file: location };
}

/** The file's address for SARIF: inside the repository, under the repository's name unless the scanned folder is the repository itself. */
function uri(report: ScanReport, repo: ScanReport["repos"][number], file: string): string {
	const inside = file.split("/").map(encodeURIComponent).join("/");
	if (repo.path === report.root) return inside;
	return `${repoName(report, repo).split("/").map(encodeURIComponent).join("/")}/${inside}`;
}

/** `version` is Porchlight's own, named as the tool. */
export function renderSarif(report: ScanReport, version: string): string {
	const rules = new Map<string, { id: string; name: string; kind: Finding["kind"]; severity: Severity }>();
	const results: unknown[] = [];
	for (const repo of report.repos) {
		const name = repoName(report, repo);
		for (const finding of rank(repo.findings)) {
			const known = rules.get(finding.ruleId);
			if (!known) rules.set(finding.ruleId, { id: finding.ruleId, name: finding.title, kind: finding.kind, severity: finding.severity });
			const { file, line } = place(finding.location);
			results.push({
				ruleId: finding.ruleId,
				level: LEVEL[finding.severity],
				message: { text: `${finding.title} (${finding.detail})${finding.note ? `. ${finding.note}` : ""}` },
				locations: [
					{
						physicalLocation: {
							artifactLocation: { uri: uri(report, repo, file) },
							...(line !== undefined && line > 0 ? { region: { startLine: line } } : {}),
						},
					},
				],
				// The finding's identity across scans (tracking.js), hashed: the same as --baseline compares by.
				partialFingerprints: { porchlightFinding: createHash("sha256").update(findingKey(name, finding)).digest("hex") },
				properties: {
					repository: name,
					kind: finding.kind,
					severity: finding.severity,
					...(finding.source ? { source: finding.source } : {}),
					...(finding.safeIn ? { upgradeTo: finding.safeIn } : finding.fixedIn ? { fixedIn: finding.fixedIn } : {}),
				},
			});
		}
	}
	const notCovered = coverageNotes(report);
	const sarif = {
		$schema: SARIF_SCHEMA,
		version: "2.1.0",
		runs: [
			{
				tool: {
					driver: {
						name: "Porchlight",
						version,
						rules: [...rules.values()].map((rule) => ({
							id: rule.id,
							name: rule.id,
							shortDescription: { text: rule.name },
							defaultConfiguration: { level: LEVEL[rule.severity] },
							properties: { kind: rule.kind, "security-severity": SECURITY_SEVERITY[rule.severity], tags: ["security", rule.kind] },
						})),
					},
				},
				invocations: [{ executionSuccessful: notCovered.length === 0, endTimeUtc: report.scannedAt }],
				results,
				properties: {
					complete: notCovered.length === 0,
					// What the scan did not cover, so an empty list of results is not read as clean.
					notCovered,
					settingNotes: settingNotes(report),
				},
			},
		],
	};
	return `${JSON.stringify(sarif, null, 2)}\n`;
}
