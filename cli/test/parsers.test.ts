import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { parseGitleaks } from "../src/repos/gitleaks.ts";
import { fixedVersion, parseOsv, severityFromCvss } from "../src/repos/osv.ts";

const leak = (overrides: object) => ({
	RuleID: "aws-access-token",
	Description: "Identified a pattern that may indicate AWS credentials, risking unauthorized cloud resource access.",
	StartLine: 1,
	Match: "REDACTED",
	Secret: "REDACTED",
	File: "config.ini",
	Commit: "7b8cd88473298dc0c885d92a47be77fd7a6db9db",
	Author: "Jo Dev",
	Email: "jo@example.invalid",
	Date: "2026-11-17T18:25:19Z",
	Message: "add config",
	...overrides,
});

test("gitleaks: normalises a finding and drops personal and secret fields", () => {
	const findings = parseGitleaks(JSON.stringify([leak({})]));

	assert.deepEqual(findings, [
		{
			tool: "gitleaks",
			kind: "secret",
			severity: "high",
			ruleId: "aws-access-token",
			title: "Identified a pattern that may indicate AWS credentials",
			location: "config.ini:1",
			detail: "commit 7b8cd884 on 2026-11-17",
		},
	]);
	const serialised = JSON.stringify(findings);
	for (const dropped of ["Jo Dev", "jo@example.invalid", "REDACTED", "add config"]) {
		assert.ok(!serialised.includes(dropped), `${dropped} must not be carried into the report`);
	}
});

test("gitleaks: ranks a match by how likely it is to be live, and says why when it ranks lower", () => {
	const findings = parseGitleaks(
		JSON.stringify([
			leak({ File: "tests/terminal/test_launch.py", RuleID: "generic-api-key" }),
			leak({ File: "server/redaction.test.mjs", RuleID: "private-key" }),
			leak({ File: "src/worker.js", RuleID: "generic-api-key" }),
			leak({ File: "src/lib/cesium-config.ts", RuleID: "jwt" }),
		]),
	);

	assert.deepEqual(
		findings.map((finding) => [finding.severity, finding.location, finding.note]),
		[
			["low", "tests/terminal/test_launch.py:1", "Ranked lower: generic pattern, not a known key format; in a test path"],
			["medium", "server/redaction.test.mjs:1", "Ranked lower: in a test path"],
			["medium", "src/worker.js:1", "Ranked lower: generic pattern, not a known key format"],
			["high", "src/lib/cesium-config.ts:1", undefined],
		],
	);
	assert.equal(findings.length, 4, "triage re-ranks; it never drops a finding");
});

test("gitleaks: reports a line once however many commits touched it", () => {
	const findings = parseGitleaks(
		JSON.stringify([
			leak({}),
			leak({ Commit: "1111111111111111111111111111111111111111" }),
			leak({ File: "other.ini" }),
			leak({ RuleID: "generic-api-key" }),
		]),
	);

	assert.deepEqual(
		findings.map((finding) => `${finding.ruleId} ${finding.location} ${finding.detail}`),
		[
			"aws-access-token config.ini:1 commit 7b8cd884 on 2026-11-17",
			"aws-access-token other.ini:1 commit 7b8cd884 on 2026-11-17",
			"generic-api-key config.ini:1 commit 7b8cd884 on 2026-11-17",
		],
	);
});

test("gitleaks: keeps different secrets on the same line apart, without their values", () => {
	const findings = parseGitleaks(
		JSON.stringify([
			leak({ Entropy: 3.91, StartColumn: 10 }),
			// A second key on the same line, in the same commit.
			leak({ Entropy: 4.42, StartColumn: 40 }),
			// A different key written to the same line later.
			leak({ Entropy: 4.17, Commit: "2222222222222222222222222222222222222222", Date: "2026-11-18T09:00:00Z" }),
			// The first key again, after the line was edited around it: the same secret, so no new finding.
			leak({ Entropy: 3.91, StartColumn: 12, Commit: "3333333333333333333333333333333333333333" }),
		]),
	);

	assert.deepEqual(
		findings.map((finding) => `${finding.location} ${finding.detail}`),
		[
			"config.ini:1 commit 7b8cd884 on 2026-11-17",
			"config.ini:1 commit 7b8cd884 on 2026-11-17, column 40",
			"config.ini:1 commit 22222222 on 2026-11-18",
		],
	);
	assert.ok(!JSON.stringify(findings).includes("3.91"), "the entropy only tells matches apart; it is not reported");
});

test("gitleaks: accepts an empty report and rejects a malformed one", () => {
	assert.deepEqual(parseGitleaks("[]"), []);
	assert.deepEqual(parseGitleaks(""), []);
	assert.throws(() => parseGitleaks('{"not":"an array"}'), /unexpected report shape/);
	assert.throws(() => parseGitleaks("not json"));
});

const osvReport = {
	results: [
		{
			source: { path: "/work/shop/web/package-lock.json", type: "lockfile" },
			packages: [
				{
					package: { name: "lodash", version: "4.17.20", ecosystem: "npm" },
					vulnerabilities: [
						{ id: "GHSA-35jh-r3h4-6jhm", summary: "Command Injection in lodash" },
						{ id: "GHSA-29mw-wpgm-hmr9", summary: "Regular Expression Denial of Service in lodash" },
					],
					groups: [
						{ ids: ["GHSA-35jh-r3h4-6jhm"], aliases: ["CVE-2021-23337"], max_severity: "7.2" },
						{ ids: ["GHSA-29mw-wpgm-hmr9"], aliases: ["CVE-2020-28500"], max_severity: "5.3" },
					],
				},
				{
					package: { name: "leftpad-ng", version: "0.0.1", ecosystem: "npm" },
					vulnerabilities: [{ id: "MAL-2026-1", summary: "Malicious code in leftpad-ng" }],
					groups: [{ ids: ["MAL-2026-1"], max_severity: "" }],
				},
			],
		},
	],
};

test("osv-scanner: one finding per vulnerability group, located relative to the repository", () => {
	assert.deepEqual(parseOsv(JSON.stringify(osvReport), "/work/shop"), [
		{
			tool: "osv-scanner",
			kind: "vulnerability",
			severity: "high",
			ruleId: "GHSA-35jh-r3h4-6jhm",
			title: "Command Injection in lodash",
			location: "web/package-lock.json",
			detail: "lodash@4.17.20",
		},
		{
			tool: "osv-scanner",
			kind: "vulnerability",
			severity: "medium",
			ruleId: "GHSA-29mw-wpgm-hmr9",
			title: "Regular Expression Denial of Service in lodash",
			location: "web/package-lock.json",
			detail: "lodash@4.17.20",
		},
		{
			tool: "osv-scanner",
			kind: "vulnerability",
			severity: "medium",
			ruleId: "MAL-2026-1",
			title: "Malicious code in leftpad-ng",
			location: "web/package-lock.json",
			detail: "leftpad-ng@0.0.1",
		},
	]);
});

test("osv-scanner: parses real output from version 2.7.1", async () => {
	// Captured from a scan of a lockfile pinning lodash 4.17.20 and minimist 1.2.5.
	const output = await readFile(join(import.meta.dirname, "fixtures/osv-scanner-2.7.1.json"), "utf8");

	const findings = parseOsv(output, "/work/shop");

	// Each advisory's own fix for this release line: lodash needs 4.18.0 to clear all four.
	assert.deepEqual(
		findings.map((finding) => `${finding.ruleId} ${finding.fixedIn}`),
		[
			"GHSA-29mw-wpgm-hmr9 4.17.21",
			"GHSA-35jh-r3h4-6jhm 4.17.21",
			"GHSA-r5fr-rjxr-66jc 4.18.0",
			"GHSA-xxjr-mmjv-4gpg 4.17.23",
			// minimist lists fixes for two release lines; 0.2.4 is below the installed 1.2.5.
			"GHSA-xvch-5gv4-984h 1.2.6",
		],
	);
	assert.deepEqual(
		findings.map((finding) => `${finding.severity} ${finding.ruleId} ${finding.detail} ${finding.location}: ${finding.title}`),
		[
			"medium GHSA-29mw-wpgm-hmr9 lodash@4.17.20 web/package-lock.json: Regular Expression Denial of Service (ReDoS) in lodash",
			"high GHSA-35jh-r3h4-6jhm lodash@4.17.20 web/package-lock.json: Command Injection in lodash",
			"high GHSA-r5fr-rjxr-66jc lodash@4.17.20 web/package-lock.json: " + titleOf(output, "GHSA-r5fr-rjxr-66jc"),
			"medium GHSA-xxjr-mmjv-4gpg lodash@4.17.20 web/package-lock.json: " + titleOf(output, "GHSA-xxjr-mmjv-4gpg"),
			"critical GHSA-xvch-5gv4-984h minimist@1.2.5 web/package-lock.json: Prototype Pollution in minimist",
		],
	);
});

function titleOf(output: string, id: string): string {
	const report = JSON.parse(output) as { results: { packages: { vulnerabilities: { id: string; summary: string }[] }[] }[] };
	const all = report.results.flatMap((result) => result.packages.flatMap((entry) => entry.vulnerabilities));
	return all.find((vuln) => vuln.id === id)!.summary;
}

test("osv-scanner: finds the fix for the right package and release line, or none", () => {
	const vuln = {
		id: "X",
		affected: [
			{ package: { name: "other-pkg", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { fixed: "9.9.9" }] }] },
			{ package: { name: "Some_Pkg", ecosystem: "PyPI" }, ranges: [{ type: "GIT", events: [{ fixed: "0a1b2c3d" }] }, { type: "ECOSYSTEM", events: [{ introduced: "0" }, { fixed: "1.4.2" }, { introduced: "2.0" }, { fixed: "2.3.1" }] }] },
			{ package: { name: "some-pkg", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ fixed: "7.0.0" }] }] },
		],
	};

	assert.equal(fixedVersion(vuln, "some-pkg", "PyPI", "1.3.0"), "1.4.2");
	assert.equal(fixedVersion(vuln, "some.pkg", "PyPI", "2.1.0"), "2.3.1");
	assert.equal(fixedVersion(vuln, "some-pkg", "PyPI", "2.3.1"), undefined, "already at the fix");
	assert.equal(fixedVersion(vuln, "some-pkg", "npm", "1.0.0"), "7.0.0");
	assert.equal(fixedVersion(vuln, "unlisted", "npm", "1.0.0"), undefined);
	assert.equal(fixedVersion({ id: "Y", affected: [{ package: { name: "p", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ introduced: "0" }, { last_affected: "3.0.0" }] }] }] } as never, "p", "npm", "2.0.0"), undefined, "no fixed release published");
});

test("osv-scanner: a package listed twice for one lockfile yields each advisory once", () => {
	const [result] = osvReport.results;
	const doubled = { results: [{ ...result!, packages: [...result!.packages, result!.packages[0]!] }, { ...result!, source: { path: "/work/shop/api/package-lock.json" } }] };

	const findings = parseOsv(JSON.stringify(doubled), "/work/shop");

	assert.deepEqual(
		findings.map((finding) => `${finding.ruleId} ${finding.location}`),
		[
			"GHSA-35jh-r3h4-6jhm web/package-lock.json",
			"GHSA-29mw-wpgm-hmr9 web/package-lock.json",
			"MAL-2026-1 web/package-lock.json",
			// The same advisory in another lockfile is a separate finding: it needs its own fix.
			"GHSA-35jh-r3h4-6jhm api/package-lock.json",
			"GHSA-29mw-wpgm-hmr9 api/package-lock.json",
			"MAL-2026-1 api/package-lock.json",
		],
	);
});

test("osv-scanner: tolerates log lines before the JSON and an empty result", () => {
	assert.equal(parseOsv(`Scanning dir /work/shop\n${JSON.stringify(osvReport)}`, "/work/shop").length, 3);
	assert.deepEqual(parseOsv('{"results":[]}', "/work/shop"), []);
	assert.deepEqual(parseOsv("", "/work/shop"), []);
});

test("CVSS scores map to severity bands; a missing score is not ignored", () => {
	assert.deepEqual(
		["9.8", "9.0", "8.9", "7.0", "6.9", "4.0", "3.9", "0.1", "", undefined, "n/a"].map(severityFromCvss),
		["critical", "critical", "high", "high", "medium", "medium", "low", "low", "medium", "medium", "medium"],
	);
});
