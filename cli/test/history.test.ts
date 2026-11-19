import assert from "node:assert/strict";
import { test } from "node:test";
import { compareScans } from "../src/repos/history.ts";
import type { Finding, ScanReport } from "../src/repos/types.ts";
import { changeSummary } from "../ui/tracking.js";

const secret: Finding = { tool: "gitleaks", kind: "secret", severity: "high", ruleId: "aws-access-token", title: "AWS key", location: "config.ts:3", detail: "commit abc" };
const advisory: Finding = { tool: "osv-scanner", kind: "vulnerability", severity: "critical", ruleId: "GHSA-1", title: "lodash", location: "package-lock.json", detail: "lodash@4.17.20" };

function scan(scannedAt: string, repos: ScanReport["repos"], osv: "ok" | "missing" = "ok"): ScanReport {
	return {
		root: "/p",
		scannedAt,
		tools: [
			{ tool: "gitleaks", status: "ok", installHint: "" },
			{ tool: "osv-scanner", status: osv, installHint: "" },
		],
		repos,
	};
}

const before = scan("2026-11-18T00:00:00.000Z", [
	{ path: "/p/api", findings: [secret, advisory], errors: [] },
	{ path: "/p/web", findings: [advisory], errors: [] },
]);

test("a finding the later scan looked for and did not find is fixed", () => {
	const after = scan("2026-11-19T00:00:00.000Z", [
		{ path: "/p/api", findings: [advisory], errors: [] },
		{ path: "/p/web", findings: [advisory], errors: [] },
	]);
	const change = compareScans(before, after);
	assert.deepEqual([change.fixedCount, change.newCount, change.uncheckedCount], [1, 0, 0]);
	assert.equal(change.fixed[0]!.title, "AWS key");
});

test("a scanner that was missing or failed never makes a finding look fixed or new", () => {
	// osv-scanner could not run (offline, say): its findings were not looked for, so none is fixed.
	const offline = scan(
		"2026-11-19T00:00:00.000Z",
		[
			{ path: "/p/api", findings: [secret], errors: [] },
			{ path: "/p/web", findings: [], errors: [] },
		],
		"missing",
	);
	assert.deepEqual(
		(({ fixedCount, newCount, uncheckedCount }) => [fixedCount, newCount, uncheckedCount])(compareScans(before, offline)),
		[0, 0, 2],
	);

	// gitleaks failed on one repository, and another was not scanned at all.
	const failed = scan("2026-11-19T00:00:00.000Z", [{ path: "/p/api", findings: [advisory], errors: [{ tool: "gitleaks", message: "git could not read the history" }] }]);
	const change = compareScans(before, failed);
	assert.deepEqual([change.fixedCount, change.uncheckedCount], [0, 2]);

	// Nor is a finding new because the earlier scan could not look for it.
	const back = scan("2026-11-20T00:00:00.000Z", [
		{ path: "/p/api", findings: [secret, advisory], errors: [] },
		{ path: "/p/web", findings: [advisory], errors: [] },
	]);
	assert.equal(compareScans(offline, back).newCount, 0);
	assert.equal(compareScans(scan("2026-11-17T00:00:00.000Z", [{ path: "/p/api", findings: [], errors: [] }]), back).newCount, 2);
});

test("the summary says what could not be checked again", () => {
	assert.equal(
		changeSummary({ previousScannedAt: "", newCount: 0, fixedCount: 1, uncheckedCount: 2 }),
		"1 fixed since the previous scan. 2 findings of the previous scan could not be checked again, so they are not counted as fixed.",
	);
	assert.equal(changeSummary({ previousScannedAt: "", newCount: 0, fixedCount: 0 }), "Nothing new and nothing fixed since the previous scan.");
});
