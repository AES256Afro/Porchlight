// FT-9: SARIF output and a CI baseline for `repos scan`.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { baselineSummary, beyondBaseline } from "../src/repos/baseline.ts";
import { exitCode } from "../src/repos/report.ts";
import { renderSarif } from "../src/repos/sarif.ts";
import { REPORT_FORMAT, type Finding, type ScanReport } from "../src/repos/types.ts";
import { reposScan } from "../src/main.ts";
import { fakeRunner, tempDir } from "./helpers.ts";

const secret: Finding = { tool: "gitleaks", kind: "secret", severity: "high", ruleId: "aws-access-token", title: "AWS access key <script>", location: "src/config.ts:12", detail: "commit 1111111 on 2026-11-01", source: "history" };
const vulnerability: Finding = { tool: "osv-scanner", kind: "vulnerability", severity: "medium", ruleId: "GHSA-aaaa-bbbb-cccc", title: "Prototype pollution in lodash", location: "package-lock.json", detail: "lodash 4.17.20", fixedIn: "4.17.21", safeIn: "4.17.21" };

function report(findings: Finding[], overrides: Partial<ScanReport> = {}): ScanReport {
	return {
		format: REPORT_FORMAT,
		root: "/home/someone/code",
		scannedAt: "2026-11-21T10:00:00.000Z",
		tools: [
			{ tool: "gitleaks", status: "ok", version: "8.30.0", installHint: "" },
			{ tool: "osv-scanner", status: "ok", version: "2.3.0", installHint: "" },
		],
		repos: [{ path: "/home/someone/code/shop", findings, errors: [] }],
		...overrides,
	};
}

test("SARIF carries each finding's rule, place and words as plain text, with no path of this computer", () => {
	const sarif = JSON.parse(renderSarif(report([secret, vulnerability]), "0.10.0"));
	assert.equal(sarif.version, "2.1.0");
	const run = sarif.runs[0];
	assert.equal(run.tool.driver.name, "Porchlight");
	assert.equal(run.tool.driver.version, "0.10.0");
	assert.deepEqual(run.tool.driver.rules.map((rule: { id: string }) => rule.id), ["aws-access-token", "GHSA-aaaa-bbbb-cccc"]);
	const [first, second] = run.results;
	assert.equal(first.level, "error");
	assert.equal(first.message.text, "AWS access key <script> (commit 1111111 on 2026-11-01)");
	assert.deepEqual(first.locations[0].physicalLocation, { artifactLocation: { uri: "shop/src/config.ts" }, region: { startLine: 12 } });
	assert.match(first.partialFingerprints.porchlightFinding, /^[0-9a-f]{64}$/);
	assert.equal(second.level, "warning");
	assert.equal(second.properties.upgradeTo, "4.17.21");
	assert.deepEqual(second.locations[0].physicalLocation, { artifactLocation: { uri: "shop/package-lock.json" } });
	assert.deepEqual(run.properties, { complete: true, notCovered: [], settingNotes: [] });
	assert.equal(run.invocations[0].executionSuccessful, true);
	assert.doesNotMatch(JSON.stringify(sarif), /home\/someone/);
});

test("SARIF of a scanned folder that is itself the repository names files from its top, and says what was not covered", () => {
	const incomplete = report([secret], {
		root: "/home/someone/code/shop",
		tools: [
			{ tool: "gitleaks", status: "ok", installHint: "" },
			{ tool: "osv-scanner", status: "missing", installHint: "brew install osv-scanner" },
		],
	});
	const run = JSON.parse(renderSarif(incomplete, "0.10.0")).runs[0];
	assert.equal(run.results[0].locations[0].physicalLocation.artifactLocation.uri, "src/config.ts");
	assert.equal(run.properties.complete, false);
	assert.match(run.properties.notCovered[0], /^Dependencies were not checked: osv-scanner is not installed/);
	assert.equal(run.invocations[0].executionSuccessful, false);
});

test("with a baseline, --fail-on counts only the findings the baseline does not hold", () => {
	const before = report([secret]);
	const after = report([secret, vulnerability]);
	assert.equal(exitCode(beyondBaseline(before, after), "high"), 0, "the high secret is in the baseline");
	assert.equal(exitCode(beyondBaseline(before, after), "medium"), 2, "the medium advisory is new");
	assert.deepEqual(baselineSummary(before, after, "medium"), { total: 2, newCount: 1, atOrAbove: 1 });
	// A baseline that did not look for dependencies holds none: the advisory counts against the gate.
	const blind = report([secret], { choices: { preset: "custom", secrets: true, dependencies: false, privateData: false, history: "all", localFiles: false, skip: [], analyse: false } });
	assert.equal(exitCode(beyondBaseline(blind, after), "medium"), 2);
	// An incomplete scan still cannot pass, whatever the baseline holds.
	const failing = report([secret], { repos: [{ path: "/home/someone/code/shop", findings: [secret], errors: [{ tool: "osv-scanner", message: "exit 127" }] }] });
	assert.equal(exitCode(beyondBaseline(report([secret]), failing), "high"), 1);
});

test("repos scan takes --format sarif and --baseline, and refuses a baseline it cannot read", async () => {
	const dir = await tempDir();
	await assert.rejects(reposScan([dir, "--format", "xml"], { run: fakeRunner({}) }), /--format must be one of: md, json, sarif/);
	await assert.rejects(reposScan([dir, "--baseline", join(dir, "missing.json")], { run: fakeRunner({}) }), /Cannot read the baseline/);
	await writeFile(join(dir, "not-a-report.json"), "{}");
	await assert.rejects(reposScan([dir, "--baseline", join(dir, "not-a-report.json")], { run: fakeRunner({}) }), /Not a Porchlight scan report/);
});
