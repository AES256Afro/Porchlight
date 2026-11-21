// A made-up repository scan for the demo: eight repositories, vulnerable packages and possible
// secrets, and no values (no report ever holds one). `earlierReport` is the scan a day before, so
// the Overview has something new and something fixed to show.
//
// Run directly: node demo/make-demo-report.mjs <out.json> <root>
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const SEVERITIES = ["critical", "high", "medium", "low"];
const PACKAGES = [
	["lodash", "4.17.20", "4.17.21"],
	["next", "15.2.6", "16.0.1"],
	["axios", "1.6.0", "1.7.4"],
	["tinyorm", "0.4.1", "0.5.0"],
	["pillow", "12.3.0", "12.4.1"],
	["express", "4.18.2", "4.21.2"],
	["leftpad", "1.0.0", null],
];
export const REPOSITORIES = [
	"shop",
	"api",
	"marketing-site",
	"infra",
	"mobile-app",
	"docs",
	"billing",
	"clean-one",
];
const TOOLS = [
	{ tool: "gitleaks", status: "ok", version: "8.30.1", installHint: "brew install gitleaks" },
	{ tool: "osv-scanner", status: "ok", version: "2.7.1", installHint: "brew install osv-scanner" },
];

export function demoReport(root, scannedAt = "2026-11-20T15:00:00.000Z") {
	const repos = REPOSITORIES.map((name, r) => {
		const findings = [];
		if (name !== "clean-one") {
			for (let i = 0; i < 6 + r * 3; i++) {
				const [pkg, version, fix] = PACKAGES[(i + r) % PACKAGES.length];
				findings.push({
					tool: "osv-scanner",
					kind: "vulnerability",
					severity: SEVERITIES[(i + r) % 4],
					ruleId: `GHSA-${name.slice(0, 2)}${r}${i}-demo`,
					title: `Demo advisory ${i} in ${pkg}`,
					location: pkg === "pillow" ? "api/requirements.txt" : "package-lock.json",
					detail: `${pkg}@${version}`,
					...(fix ? { fixedIn: fix } : {}),
				});
			}
			for (let i = 0; i < 2 + (r % 3); i++) {
				findings.push({
					tool: "gitleaks",
					kind: "secret",
					severity: i === 0 ? "high" : "medium",
					ruleId: i === 0 ? "aws-access-token" : "generic-api-key",
					title:
						i === 0
							? "Identified a pattern that may indicate AWS credentials"
							: "Detected a Generic API Key",
					location:
						i === 0
							? `src/config/settings-${r}.ts:${10 + i}`
							: `tests/fixtures/sample-${i}.json:${4 + i}`,
					detail: `commit ${(0xabcdef12 + r * 7 + i).toString(16)} on 2026-11-1${i}`,
					...(i > 0
						? { note: "Ranked lower: generic pattern, not a known key format; in a test path" }
						: {}),
				});
			}
		}
		return { path: `${root}/${name}`, findings, errors: [] };
	});
	return { root, scannedAt, tools: TOOLS, repos };
}

/** The scan a day earlier: two of today's findings were not there yet, and one since fixed was. */
export function earlierReport(root) {
	const report = demoReport(root, "2026-11-19T15:00:00.000Z");
	const shop = report.repos.find((repo) => repo.path.endsWith("/shop"));
	shop.findings = shop.findings.slice(2);
	shop.findings.push({
		tool: "osv-scanner",
		kind: "vulnerability",
		severity: "critical",
		ruleId: "GHSA-sh00-fixed-demo",
		title: "Demo advisory fixed since in express",
		location: "package-lock.json",
		detail: "express@4.17.1",
		fixedIn: "4.18.2",
	});
	return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const [out, root] = process.argv.slice(2);
	const report = demoReport(root ?? "/home/demo/projects");
	writeFileSync(out, JSON.stringify(report, null, "\t"));
	console.log(`${report.repos.reduce((n, repo) => n + repo.findings.length, 0)} findings`);
}
