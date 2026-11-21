import assert from "node:assert/strict";
import { test } from "node:test";
import { compareScans } from "../src/repos/history.ts";
import type { Finding, ScanReport } from "../src/repos/types.ts";
import { presetChoices } from "../ui/scan-choices.js";
import { acceptanceEnded, changeSummary, isDay, statusesFor } from "../ui/tracking.js";

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

test("an accepted risk ends the day after the one it was accepted until", () => {
	const noon = (day: string) => new Date(`${day}T12:00:00`);
	const accepted = { status: "accepted", until: "2027-06-30" };
	assert.equal(acceptanceEnded(accepted, noon("2027-06-30")), false);
	assert.equal(acceptanceEnded(accepted, noon("2027-07-01")), true);
	// No end date never ends, and no other status has one.
	assert.equal(acceptanceEnded({ status: "accepted" }, noon("2099-01-01")), false);
	assert.equal(acceptanceEnded({ status: "fixed", until: "2020-01-01" }, noon("2027-07-01")), false);
	assert.equal(acceptanceEnded(null), false);

	assert.deepEqual(["2027-06-30", "2027-02-30", "2027-6-30", "soon", 20270630].map(isDay), [true, false, false, false, false]);
	assert.ok(statusesFor("secret").some(([status]) => status === "rotated"));
	assert.ok(!statusesFor("vulnerability").some(([status]) => status === "rotated"));
});

test("a scan that did not read history, or a check switched off, never makes a finding look fixed or new", () => {
	const inHistory: Finding = { ...secret, source: "history" };
	const inFiles: Finding = { ...secret, detail: "current files", source: "files" };
	const standard = { ...scan("2026-11-18T00:00:00.000Z", [{ path: "/p/api", findings: [inHistory, advisory], errors: [] }]), choices: presetChoices("standard") };
	// Quick reads the files as they are now: the secret is still there, found under another detail.
	const quick = { ...scan("2026-11-19T00:00:00.000Z", [{ path: "/p/api", findings: [inFiles], errors: [] }]), choices: { ...presetChoices("quick"), dependencies: false } };

	const change = compareScans(standard, quick);
	// The history finding was not looked for, nor the advisory (dependencies were off); the files finding was not looked for before.
	assert.deepEqual([change.fixedCount, change.newCount, change.uncheckedCount], [0, 0, 2]);

	// Back to Standard: the files finding was not looked for this time either, so it is not fixed.
	const again = compareScans(quick, { ...standard, scannedAt: "2026-11-20T00:00:00.000Z" });
	assert.deepEqual([again.fixedCount, again.newCount, again.uncheckedCount], [0, 0, 1]);

	// Two Quick scans compare their files findings as any two scans do.
	const fixed = compareScans(quick, { ...quick, scannedAt: "2026-11-20T00:00:00.000Z", repos: [{ path: "/p/api", findings: [], errors: [] }] });
	assert.deepEqual([fixed.fixedCount, fixed.uncheckedCount], [1, 0]);

	// A skipped repository was not looked at, so its findings are not fixed.
	const skipped = compareScans(standard, { ...standard, scannedAt: "2026-11-20T00:00:00.000Z", repos: [], skipped: ["api"] });
	assert.deepEqual([skipped.fixedCount, skipped.uncheckedCount], [0, 2]);
});

test("private data counts as new or fixed only between two scans that both looked for it", () => {
	const dump: Finding = { tool: "gitleaks", kind: "private-data", severity: "high", ruleId: "private-data-dump", title: "Possible data dump", location: "people.csv:2", detail: "commit abc", source: "history" };
	const deep = { ...scan("2026-11-18T00:00:00.000Z", [{ path: "/p/api", findings: [dump], errors: [] }]), choices: { ...presetChoices("deep"), analyse: false } };
	const standard = { ...scan("2026-11-19T00:00:00.000Z", [{ path: "/p/api", findings: [], errors: [] }]), choices: presetChoices("standard") };
	assert.deepEqual([compareScans(deep, standard).fixedCount, compareScans(deep, standard).uncheckedCount], [0, 1]);
	assert.equal(compareScans(standard, { ...deep, scannedAt: "2026-11-20T00:00:00.000Z" }).newCount, 0);
	assert.equal(compareScans(deep, { ...deep, scannedAt: "2026-11-20T00:00:00.000Z", repos: [{ path: "/p/api", findings: [], errors: [] }] }).fixedCount, 1);
});
