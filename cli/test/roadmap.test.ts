import assert from "node:assert/strict";
import { test } from "node:test";
import type { Finding, ScanReport } from "../src/repos/types.ts";
import { buildDomainRoadmap } from "../src/roadmap/domains.ts";
import { csvCell, html, mdCode, mdText } from "../src/roadmap/escape.ts";
import { exportRepos, parseFilter } from "../src/roadmap/export.ts";
import { fileStem, renderFindings, renderRoadmap } from "../src/roadmap/render.ts";
import { buildRepoRoadmap, listRepoFindings } from "../src/roadmap/repos.ts";
import { noFilter } from "../ui/filter.js";

const vuln = (id: string, severity: Finding["severity"], detail: string, fixedIn?: string, location = "package-lock.json"): Finding => ({
	tool: "osv-scanner",
	kind: "vulnerability",
	severity,
	ruleId: id,
	title: `Problem ${id}`,
	location,
	detail,
	...(fixedIn ? { fixedIn } : {}),
});

const secret = (severity: Finding["severity"], location: string, ruleId = "generic-api-key", note?: string): Finding => ({
	tool: "gitleaks",
	kind: "secret",
	severity,
	ruleId,
	title: "Detected a key",
	location,
	detail: "commit abcdef12 on 2026-03-24",
	...(note ? { note } : {}),
});

const GENERIC = "Ranked lower: generic pattern, not a known key format";

function sampleReport(): ScanReport {
	return {
		root: "/work",
		scannedAt: "2026-11-17T12:00:00.000Z",
		tools: [
			{ tool: "gitleaks", status: "ok", version: "8.30.1", installHint: "brew install gitleaks" },
			{ tool: "osv-scanner", status: "ok", version: "2.7.1", installHint: "brew install osv-scanner" },
		],
		repos: [
			{ path: "/work/clean", findings: [], errors: [] },
			{
				path: "/work/shop",
				errors: [],
				findings: [
					vuln("GHSA-a", "medium", "lodash@4.17.20", "4.17.21"),
					vuln("GHSA-b", "high", "lodash@4.17.20", "4.17.21"),
					vuln("GHSA-c", "high", "lodash@4.17.20", "4.18.0"),
					vuln("GHSA-d", "critical", "next@15.2.6", "16.0.1"),
					vuln("GHSA-e", "low", "leftpad@1.0.0"),
					vuln("GHSA-f", "high", "pillow@12.3.0", "12.4.1", "api/requirements.txt"),
					vuln("GHSA-g", "medium", "pillow@12.3.0", undefined, "api/requirements.txt"),
					secret("high", "src/lib/config.ts:1", "jwt"),
					secret("medium", "src/worker.js:59", "generic-api-key", GENERIC),
					secret("medium", "src/worker.js:1037", "generic-api-key", GENERIC),
					secret("low", "tests/test_auth.py:5", "generic-api-key", `${GENERIC}; in a test path`),
				],
			},
		],
	};
}

const titles = (roadmap: ReturnType<typeof buildRepoRoadmap>) =>
	roadmap.phases.map((phase) => [phase.key, phase.groups.flatMap((group) => group.actions.map((action) => action.title))]);

test("collapses findings into one action per package and credential, in order of urgency", () => {
	const roadmap = buildRepoRoadmap(sampleReport());

	assert.deepEqual(titles(roadmap), [
		["now", ["Rotate the credential in src/lib/config.ts:1", "Upgrade next from 15.2.6 to 16.0.1 or later"]],
		["next", ["Upgrade lodash from 4.17.20 to 4.18.0 or later", "Upgrade pillow from 12.3.0 to 12.4.1 or later"]],
		["schedule", ["Check 2 possible secrets (generic pattern, not a known key format)"]],
		["later", ["Check 1 possible secret (generic pattern, not a known key format; in a test path)", "Replace or mitigate leftpad 1.0.0: no fixed release is published"]],
	]);
	assert.deepEqual(roadmap.totals, { actions: 7, findings: 11, groups: 1 });
	assert.deepEqual([roadmap.scope, roadmap.caveats], [null, []]);
});

test("an upgrade targets the version that clears every advisory, and says what it clears and how", () => {
	const actions = buildRepoRoadmap(sampleReport()).phases.flatMap((phase) => phase.groups.flatMap((group) => group.actions));
	const find = (start: string) => actions.find((action) => action.title.startsWith(start))!;

	const lodash = find("Upgrade lodash");
	assert.deepEqual([lodash.priority, lodash.where, lodash.clears, lodash.counts], ["high", "package-lock.json", ["GHSA-a", "GHSA-b", "GHSA-c"], { critical: 0, high: 2, medium: 1, low: 0 }]);
	assert.deepEqual(lodash.how, ["Run `npm update lodash`. If it stays below 4.18.0, it is pulled in by another package: `npm ls lodash` shows which one to upgrade."]);

	assert.match(find("Upgrade next").how[1]!, /major version change/);

	const pillow = find("Upgrade pillow");
	assert.equal(pillow.how[0], "Change the pin to `pillow>=12.4.1` and reinstall.");
	assert.equal(pillow.how[1], "1 of these have no fixed release yet and will remain: GHSA-g.");

	const rotate = find("Rotate");
	assert.deepEqual([rotate.kind, rotate.priority, rotate.clears], ["rotate", "high", ["jwt (commit abcdef12 on 2026-03-24)"]]);
	assert.match(rotate.how[0]!, /in git history, so deleting the line does not make it safe/);

	assert.equal(find("Check 2").where, "src/worker.js:59, src/worker.js:1037");
});

test("a filtered roadmap covers only what matches and says so", () => {
	const roadmap = buildRepoRoadmap(sampleReport(), { ...noFilter(), severities: ["critical", "high"], kind: "vulnerability" });

	assert.equal(roadmap.scope, "critical, high severity only; vulnerabilities only");
	assert.deepEqual(titles(roadmap), [
		["now", ["Upgrade next from 15.2.6 to 16.0.1 or later"]],
		// lodash's medium advisory is filtered out, so 4.17.21 no longer needs covering... but GHSA-c still needs 4.18.0.
		["next", ["Upgrade lodash from 4.17.20 to 4.18.0 or later", "Upgrade pillow from 12.3.0 to 12.4.1 or later"]],
		["schedule", []],
		["later", []],
	]);
	assert.equal(buildRepoRoadmap(sampleReport(), { ...noFilter(), query: "PILLOW" }).totals.actions, 1);
});

test("a filter never shrinks a fix: the upgrade shown clears the advisories the filter hides too", () => {
	const report: ScanReport = {
		root: "/work",
		scannedAt: "2026-11-17T12:00:00.000Z",
		tools: [],
		repos: [
			{
				path: "/work/app",
				errors: [],
				// The critical advisory is fixed early; the high one that the filter hides needs a later release.
				findings: [vuln("GHSA-crit", "critical", "lodash@4.17.0", "4.17.12"), vuln("GHSA-high", "high", "lodash@4.17.0", "4.18.0")],
			},
		],
	};
	const upgrades = (filter: Parameters<typeof buildRepoRoadmap>[1]) =>
		buildRepoRoadmap(report, filter).phases.flatMap((phase) => phase.groups.flatMap((group) => group.actions.map((action) => action.title)));
	const expected = ["Upgrade lodash from 4.17.0 to 4.18.0 or later"];

	assert.deepEqual(upgrades({ ...noFilter(), severities: ["critical"] }), expected);
	assert.deepEqual(upgrades({ ...noFilter(), query: "GHSA-crit" }), expected);
	assert.deepEqual(upgrades({ ...noFilter(), severities: ["low"] }), [], "a repair is listed only when it clears something the filter lets through");
	assert.equal(listRepoFindings(report, { ...noFilter(), severities: ["critical"] }).rows[0]!.suggestion, expected[0], "the roadmap and the findings list agree");
});

test("a folder that is itself a repository is named the same way by the roadmap, the list and the filters", () => {
	const report: ScanReport = {
		root: "/work/shop",
		scannedAt: "2026-11-17T12:00:00.000Z",
		tools: [],
		repos: [{ path: "/work/shop", errors: [], findings: [vuln("GHSA-x", "high", "pkg@1.0.0", "1.0.1")] }],
	};
	const filter = { ...noFilter(), repo: "shop" };

	assert.equal(buildRepoRoadmap(report, filter).totals.actions, 1);
	assert.equal(listRepoFindings(report, filter).rows[0]!.place, "shop");
	assert.equal(buildRepoRoadmap(report, { ...noFilter(), repo: "." }).totals.actions, 0);
});

test("carries the scan's gaps into the roadmap", () => {
	const report = sampleReport();
	report.tools[1] = { tool: "osv-scanner", status: "missing", installHint: "brew install osv-scanner" };
	report.repos[0]!.errors.push({ tool: "gitleaks", message: "fatal: bad object HEAD" });

	const roadmap = buildRepoRoadmap(report);

	assert.deepEqual(roadmap.caveats, [
		"Dependencies were not checked: osv-scanner is not installed (brew install osv-scanner).",
		"gitleaks failed on clean: fatal: bad object HEAD",
	]);
	for (const format of ["md", "html"] as const) {
		assert.match(renderRoadmap(roadmap, format).body, /The scan was incomplete, so this roadmap is too/);
	}
});

test("renders a Markdown checklist", () => {
	const { body, contentType, extension } = renderRoadmap(buildRepoRoadmap(sampleReport()), "md");

	assert.deepEqual([contentType, extension], ["text/markdown; charset=utf-8", "md"]);
	assert.ok(body.startsWith("# Repair roadmap\n\nSource: `/work`, scanned 2026-11-17.\n\n7 actions clear 11 findings across 1 place."));
	assert.ok(body.includes("| 1. Fix now | 2 | 2 |\n| 2. Fix next | 2 | 5 |\n| 3. Schedule | 1 | 2 |\n| 4. When convenient | 2 | 2 |"));
	assert.ok(
		body.includes(
			[
				"## 2. Fix next",
				"",
				"High-severity vulnerabilities.",
				"",
				"### shop",
				"",
				"- [ ] **Upgrade lodash from 4.17.20 to 4.18.0 or later**",
				"  - Where: `package-lock.json`",
				"  - Clears 3 findings (2 high, 1 medium): GHSA-a, GHSA-b, GHSA-c",
				"  - Run `npm update lodash`. If it stays below 4.18.0, it is pulled in by another package: `npm ls lodash` shows which one to upgrade.",
			].join("\n"),
		),
	);
});

test("renders one CSV row per action, with a column to tick off", () => {
	const { body } = renderRoadmap(buildRepoRoadmap(sampleReport()), "csv");
	const rows = body.trimEnd().split("\r\n");

	assert.equal(rows[0], "Phase,Priority,Place,Action,Where,Findings cleared,Critical,High,Medium,Low,Clears,How,Done");
	assert.equal(rows.length, 8);
	assert.equal(
		rows[3],
		'2. Fix next,high,shop,Upgrade lodash from 4.17.20 to 4.18.0 or later,package-lock.json,3,0,2,1,0,GHSA-a GHSA-b GHSA-c,"Run npm update lodash. If it stays below 4.18.0, it is pulled in by another package: npm ls lodash shows which one to upgrade.",',
	);
});

test("renders JSON that reads back as the roadmap", () => {
	const roadmap = buildRepoRoadmap(sampleReport());
	assert.deepEqual(JSON.parse(renderRoadmap(roadmap, "json").body), roadmap);
});

test("renders a self-contained page with no script", () => {
	const { body } = renderRoadmap(buildRepoRoadmap(sampleReport()), "html");

	assert.match(body, /^<!doctype html>/);
	assert.ok(body.includes(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`));
	assert.ok(body.includes('<span class="title">Upgrade lodash from 4.17.20 to 4.18.0 or later</span>'));
	assert.ok(body.includes("<li>Run <code>npm update lodash</code>. If it stays below 4.18.0"));
	assert.ok(!/<script|<link|<img|src=|href=|url\(|@import/i.test(body), "nothing is loaded and nothing runs");
});

test("hostile text in a scan cannot become markup, a link or a formula in any format", () => {
	const report = sampleReport();
	const evil = '<script>alert(1)</script>![x](http://evil.example/p.png)`"';
	report.repos[1]!.path = "/work/<img src=x onerror=alert(1)>";
	report.repos[1]!.findings = [
		vuln("=HYPERLINK(\"http://evil.example\")", "critical", `${evil}@1.0.0`, "2.0.0", `=cmd|' /C calc'!A0`),
		secret("high", `+${evil}:1`, "@SUM(1+1)"),
		secret("medium", `-${evil}:2`, "generic-api-key", GENERIC),
	];
	const roadmap = buildRepoRoadmap(report);

	const page = renderRoadmap(roadmap, "html").body;
	// The page itself contains no script, image or link element, so any that appears came from the data.
	assert.ok(!/<script|<img|<a\s|<iframe|<svg/i.test(page), "no tag survives in the page");
	assert.ok(page.includes("&#60;script&#62;alert(1)&#60;/script&#62;"));

	// Take out the code spans (a fence of backticks up to the same fence); what is left is rendered as Markdown.
	// An escaped backtick (\`) is text, not a fence.
	const prose = renderRoadmap(roadmap, "md").body.replace(/(?<!\\)(`+)[\s\S]*?[^`]\1(?!`)/g, "");
	assert.ok(!prose.includes("![x](http") && !/\]\(http/.test(prose), "no live image or link outside a code span");
	assert.ok(!/(?<!\\)<(script|img)/.test(prose), "no raw HTML outside a code span");
	assert.ok(prose.includes("\\!\\[x\\]\\(http\\://evil.example/p.png\\)"), "the text is still there, escaped");

	const cells = renderRoadmap(roadmap, "csv").body.split("\r\n").slice(1).join("\n");
	assert.ok(!/(^|,)"?[=+\-@]/m.test(cells), "no cell starts with a formula character");
	assert.ok(cells.includes(`'=cmd|' /C calc'!A0`) && cells.includes(`'=HYPERLINK`));

	assert.doesNotThrow(() => JSON.parse(renderRoadmap(roadmap, "json").body));
});

test("an upgrade before 1.0 that may break says so", () => {
	const report = sampleReport();
	report.repos[1]!.findings.push(vuln("GHSA-z", "high", "tinyorm@0.4.1", "0.5.0"));
	const actions = buildRepoRoadmap(report).phases.flatMap((phase) => phase.groups.flatMap((group) => group.actions));
	const tinyorm = actions.find((action) => action.title.startsWith("Upgrade tinyorm"))!;
	assert.match(tinyorm.how.join(" "), /Before version 1\.0, this change can break things like a major version/);
});

test("the page's \"no severity\" filter can be exported", () => {
	const filter = parseFilter({ severity: "none" });
	assert.deepEqual(filter.severities, []);
	const file = exportRepos(sampleReport(), { content: "findings", format: "md" }, filter);
	assert.match(file.body, /no severity selected/);
	assert.throws(() => parseFilter({ severity: "none,high" }), /Unknown severity "none"/);
});

test("escaping helpers", () => {
	assert.equal(html(`<a href="x">&'`), "&#60;a href=&#34;x&#34;&#62;&#38;&#39;");
	assert.deepEqual(["=1+1", "+1", "-1", "@x", "\tx", "plain", 'say "hi"', "a,b", 12].map(csvCell), ["'=1+1", "'+1", "'-1", "'@x", "'\tx", "plain", '"say ""hi"""', '"a,b"', "12"]);
	assert.equal(mdText("[x](y) *b* <i> a|b\n# h"), "\\[x\\]\\(y\\) \\*b\\* \\<i\\> a\\|b \\# h");
	assert.deepEqual([mdCode("plain"), mdCode("a`b"), mdCode("``x`"), mdCode("line\nbreak")], ["`plain`", "``a`b``", "``` ``x` ```", "`line break`"]);
});

test("names export files safely", () => {
	const when = "2026-11-17T12:00:00.000Z";
	assert.equal(fileStem("roadmap", when), "porchlight-roadmap-2026-11-17");
	assert.equal(fileStem("findings", when, "Example.com"), "porchlight-findings-example.com-2026-11-17");
	assert.equal(fileStem("roadmap", when, '../../etc/passwd"\r\nX: y'), "porchlight-roadmap-etc-passwd-x-y-2026-11-17");
	assert.equal(fileStem("roadmap", '"\r\nX: y'), "porchlight-roadmap");
});

test("lists every finding with the repair that clears it, most severe first", () => {
	const list = listRepoFindings(sampleReport());

	assert.equal(list.rows.length, 11);
	assert.deepEqual(
		list.rows.slice(0, 5).map((row) => [row.severity, row.type, row.id, row.suggestion, row.phase]),
		[
			["critical", "Vulnerability", "GHSA-d", "Upgrade next from 15.2.6 to 16.0.1 or later", "now"],
			["high", "Secret", "jwt", "Rotate the credential in src/lib/config.ts:1", "now"],
			["high", "Vulnerability", "GHSA-f", "Upgrade pillow from 12.3.0 to 12.4.1 or later", "next"],
			["high", "Vulnerability", "GHSA-b", "Upgrade lodash from 4.17.20 to 4.18.0 or later", "next"],
			["high", "Vulnerability", "GHSA-c", "Upgrade lodash from 4.17.20 to 4.18.0 or later", "next"],
		],
	);
	// A medium advisory against lodash is cleared by the same upgrade, so it carries that upgrade's phase.
	const mediumLodash = list.rows.find((row) => row.id === "GHSA-a")!;
	assert.deepEqual([mediumLodash.severity, mediumLodash.phase, mediumLodash.suggestion], ["medium", "next", "Upgrade lodash from 4.17.20 to 4.18.0 or later"]);
	assert.equal(list.rows.find((row) => row.id === "GHSA-e")!.suggestion, "Replace or mitigate leftpad 1.0.0: no fixed release is published");
});

test("a filtered findings list still names the complete repair", () => {
	// Only the medium lodash advisory is on show, yet the fix named is the one that clears all three.
	const list = listRepoFindings(sampleReport(), { ...noFilter(), severities: ["medium"], kind: "vulnerability", query: "lodash" });

	assert.equal(list.scope, 'medium severity only; vulnerabilities only; matching "lodash"');
	assert.deepEqual(
		list.rows.map((row) => [row.id, row.suggestion]),
		[["GHSA-a", "Upgrade lodash from 4.17.20 to 4.18.0 or later"]],
	);
});

test("renders the findings list in every format", () => {
	const list = listRepoFindings(sampleReport());

	const markdown = renderFindings(list, "md").body;
	assert.ok(markdown.startsWith("# Findings and suggested fixes\n\nSource: `/work`, scanned 2026-11-17.\n\n11 findings (1 critical, 4 high, 4 medium, 2 low) across 1 place, most severe first."));
	assert.ok(markdown.includes("| critical | GHSA-d: Problem GHSA-d \\(next\\@15.2.6\\) | package-lock.json | Upgrade next from 15.2.6 to 16.0.1 or later | Fix now |"));

	const rows = renderFindings(list, "csv").body.trimEnd().split("\r\n");
	assert.equal(rows[0], "Severity,Type,Place,ID,Finding,Where,Detail,When,Suggested fix,How,Note");
	assert.equal(rows.length, 12);
	assert.equal(rows[2], 'high,Secret,shop,jwt,Detected a key,src/lib/config.ts:1,commit abcdef12 on 2026-03-24,Fix now,Rotate the credential in src/lib/config.ts:1,"Revoke or rotate it with the service that issued it. It is in git history, so deleting the line does not make it safe. Load the new value from the environment or a secret store, not from a committed file. If the value turns out to be public by design, record it in .gitleaksignore so it stops being reported.",');

	assert.deepEqual(JSON.parse(renderFindings(list, "json").body), list);

	const page = renderFindings(list, "html").body;
	assert.ok(page.includes("<strong>Problem GHSA-d</strong><br><code>GHSA-d</code> next@15.2.6"));
	assert.ok(!/<script|<link|<img|src=|href=|url\(|@import/i.test(page));
});

test("hostile text cannot break a findings table in any format", () => {
	const report = sampleReport();
	report.repos[1]!.findings = [vuln("=1+1", "high", "a|b<script>x</script>@1.0.0", "2.0.0", "path|with|pipes`and`ticks")];
	const list = listRepoFindings(report);

	const row = renderFindings(list, "md").body.split("\n").find((line) => line.startsWith("| high"))!;
	assert.equal(row.replace(/\\\|/g, "").split("|").length, 7, "escaped pipes do not add columns");
	assert.ok(!/(?<!\\)<script/.test(row));
	assert.ok(!/<script/.test(renderFindings(list, "html").body));
	assert.ok(renderFindings(list, "csv").body.includes("'=1+1"));
});

test("turns a monitor report into repairs grouped by host", () => {
	const roadmap = buildDomainRoadmap({
		domain: "example.com",
		takenAt: "2026-11-17T09:00:00.000Z",
		notes: ["2 known hosts were not probed because MAX_HOSTS is 12."],
		findings: [
			{ id: "dangling-cname:shop.example.com", severity: "high", host: "shop.example.com", title: "CNAME target old.vendor.example does not resolve; check for subdomain takeover" },
			{ id: "cert-expiring:api.example.com", severity: "medium", host: "api.example.com", title: "Latest certificate in CT logs expires 2026-11-27; no renewal logged yet" },
			{ id: "missing-header:www.example.com:content-security-policy", severity: "medium", host: "www.example.com", title: "Missing content-security-policy header" },
			{ id: "missing-header:www.example.com:referrer-policy", severity: "low", host: "www.example.com", title: "Missing referrer-policy header" },
			{ id: "missing-header:blog.example.com:permissions-policy", severity: "low", host: "blog.example.com", title: "Missing permissions-policy header" },
			{ id: "no-caa:example.com", severity: "low", host: "example.com", title: "No CAA record: any certificate authority may issue for this domain" },
			{ id: "something-new:example.com", severity: "low", host: "example.com", title: "A finding kind from a newer monitor" },
		],
	});

	assert.equal(roadmap.title, "Repair roadmap for example.com");
	assert.deepEqual(roadmap.caveats, ["2 known hosts were not probed because MAX_HOSTS is 12."]);
	assert.deepEqual(
		roadmap.phases.map((phase) => [phase.key, phase.groups.map((group) => [group.name, group.actions.map((action) => action.title)])]),
		[
			["now", [["shop.example.com", ["Remove or repoint the DNS record for shop.example.com"]]]],
			[
				"next",
				[
					// The host with more to fix comes first.
					["www.example.com", ["Add 2 security headers to responses from www.example.com"]],
					["api.example.com", ["Renew the certificate for api.example.com before it expires"]],
				],
			],
			["schedule", []],
			[
				"later",
				[
					["example.com", ["A finding kind from a newer monitor", "Add a CAA record for example.com"]],
					["blog.example.com", ["Add 1 security header to responses from blog.example.com"]],
				],
			],
		],
	);
	const headers = roadmap.phases[1]!.groups[0]!.actions[0]!;
	assert.deepEqual(headers.clears, ["content-security-policy", "referrer-policy"]);
	assert.match(headers.how[0]!, /^`Content-Security-Policy: default-src 'self'`\. Start with `Content-Security-Policy-Report-Only`/);
	assert.match(renderRoadmap(roadmap, "md").body, /- \[ \] \*\*Remove or repoint the DNS record for shop\.example\.com\*\*/);
});
