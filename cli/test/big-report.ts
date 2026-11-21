// A made-up report of any size, shaped like a real one: each repository has packages with several
// advisories each (which share one repair), secrets found in history, and private data. Used by the
// tests of the report's response and by scripts/measure-speed.ts. No value in it is credential-shaped.
import { join } from "node:path";
import type { Finding, ScanReport } from "../src/repos/types.ts";

/** Findings in each made-up repository. */
const PER_REPO = 100;

export function bigReport(root: string, findings: number): ScanReport {
	const repos: ScanReport["repos"] = [];
	for (let r = 0; repos.length * PER_REPO < findings; r++) {
		const count = Math.min(PER_REPO, findings - r * PER_REPO);
		const list: Finding[] = [];
		for (let i = 0; i < count; i++) list.push(madeUp(r, i));
		repos.push({ path: join(root, `team-${r % 7}`, `service-${r}`), findings: list, errors: [] });
	}
	return {
		format: 2,
		root,
		scannedAt: "2026-11-20T09:00:00.000Z",
		tools: [
			{ tool: "gitleaks", status: "ok", version: "8.30.1", installHint: "brew install gitleaks" },
			{ tool: "osv-scanner", status: "ok", version: "2.7.1", installHint: "brew install osv-scanner" },
		],
		repos,
		choices: { preset: "standard", secrets: true, dependencies: true, privateData: false, history: "all", localFiles: false, skip: [], analyse: false },
	};
}

const SEVERITIES = ["critical", "high", "medium", "low"] as const;

function madeUp(repo: number, i: number): Finding {
	const severity = SEVERITIES[(i * 7 + repo) % 4]!;
	if (i % 10 < 6) {
		// Four advisories against each of 15 packages.
		const pkg = `package-${(i % 15) + repo * 3}`;
		return {
			tool: "osv-scanner",
			kind: "vulnerability",
			severity,
			ruleId: `GHSA-${hex(repo * 1000 + i, 4)}-${hex(i * 31, 4)}-${hex(repo * 17 + i, 4)}`,
			title: `${pkg} is open to a crafted request that exhausts memory when parsing nested input`,
			location: i % 2 === 0 ? "package-lock.json" : "web/package-lock.json",
			detail: `${pkg}@1.${i % 9}.0`,
			fixedIn: `1.${(i % 9) + 1}.0`,
			safeIn: `1.${(i % 9) + 2}.0`,
		};
	}
	if (i % 10 < 9) {
		return {
			tool: "gitleaks",
			kind: "secret",
			severity,
			ruleId: i % 3 === 0 ? "generic-api-key" : "aws-access-token",
			title: i % 3 === 0 ? "Detected a Generic API Key, potentially exposing access to various services and sensitive operations." : "Identified a pattern that may indicate AWS credentials, risking unauthorized cloud resource access and data breaches on AWS platforms.",
			location: `src/module-${i}/settings.ts:${(i % 40) + 1}`,
			detail: hex(repo * 7919 + i * 104729, 40),
			source: "history",
		};
	}
	return {
		tool: "gitleaks",
		kind: "private-data",
		severity: "medium",
		ruleId: "private-email",
		title: "Email addresses",
		location: `docs/people-${i}.md`,
		detail: hex(repo * 31 + i, 40),
		count: (i % 5) + 1,
		source: "history",
	};
}

function hex(seed: number, length: number): string {
	let out = "";
	let x = (seed * 2654435761) >>> 0;
	while (out.length < length) {
		x = (x * 1103515245 + 12345) >>> 0;
		out += (x >>> 8).toString(16).padStart(6, "0");
	}
	return out.slice(0, length);
}
