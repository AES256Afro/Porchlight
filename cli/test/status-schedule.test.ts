// FT-16 (`porchlight status`), FT-18 (`porchlight schedule print`) and the monitor's subdomain
// inventory on the command line (R6F-5).
import assert from "node:assert/strict";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import type { HostsPage } from "../../monitor/src/types.ts";
import { helpFor } from "../src/help.ts";
import { domainsHosts, fetchHosts, hostsCsv, hostsMarkdown, renderHosts } from "../src/monitor/hosts.ts";
import { REPORT_FORMAT, type ScanReport } from "../src/repos/types.ts";
import { launchdAgent, scheduleCommand, systemdUnits, type ScheduleOptions } from "../src/schedule.ts";
import { readStatus, renderStatus, statusCommand, statusExit } from "../src/status.ts";
import { tempDir } from "./helpers.ts";

const SCAN: ScanReport = {
	format: REPORT_FORMAT,
	root: "/home/someone/code",
	scannedAt: "2026-11-21T10:00:00.000Z",
	tools: [
		{ tool: "gitleaks", status: "ok", installHint: "" },
		{ tool: "osv-scanner", status: "missing", installHint: "brew install osv-scanner" },
	],
	repos: [
		{
			path: "/home/someone/code/shop",
			errors: [],
			findings: [{ tool: "gitleaks", kind: "secret", severity: "high", ruleId: "aws-access-token", title: "AWS key", location: "secret/place.ts:3", detail: "commit 1111111" }],
		},
	],
};

test("status reads the kept files, contacts nothing, and prints no finding's place, path or token", async () => {
	const dir = await tempDir();
	const nothing = await readStatus(dir, join(dir, "repo-scan.json"), {});
	assert.deepEqual([nothing.repos.state, nothing.host.state, nothing.cloudflare.state, nothing.monitor.connected], ["none", "none", "none", false]);
	assert.match(renderStatus(nothing), /Repositories: not scanned yet/);

	await writeFile(join(dir, "repo-scan.json"), JSON.stringify(SCAN));
	await writeFile(join(dir, "host-check.json"), JSON.stringify({ checkedAt: "2026-11-20T08:00:00.000Z", checks: [{ status: "failed", severity: "high" }, { status: "unknown", severity: "low" }, { status: "passed", severity: "low" }] }));
	await writeFile(join(dir, "cloudflare-audit.json"), "{ not json");
	// Assembled at run time, so this repository's own secret scan has nothing to find.
	const token = ["test", "value", "0123456789abcdef".repeat(2)].join("-");
	await writeFile(join(dir, "monitor-settings.json"), JSON.stringify({ url: "https://monitor.example.test", token }));

	const lines: string[] = [];
	const code = await statusCommand(["--json", "--data", dir], (text) => lines.push(text), { dataDir: "/nowhere", env: {} });
	const status = JSON.parse(lines[0]!);
	assert.equal(code, 1, "a kept file that cannot be read is not all clear");
	assert.equal(status.repos.findings, 1);
	assert.deepEqual(status.repos.bySeverity, { critical: 0, high: 1, medium: 0, low: 0 });
	assert.equal(status.repos.complete, false);
	assert.match(status.repos.notCovered[0], /osv-scanner is not installed/);
	assert.equal(status.repos.keptScans, 0);
	assert.deepEqual([status.host.failed, status.host.couldNotCheck], [1, 1]);
	assert.equal(status.cloudflare.state, "unreadable");
	assert.deepEqual(status.monitor, { connected: true, host: "monitor.example.test" });
	for (const text of [lines[0]!, renderStatus(status)]) {
		assert.ok(!text.includes(token));
		assert.ok(!text.includes("secret/place.ts"));
		assert.ok(!text.includes("/home/someone"));
	}
	assert.equal(statusExit({ ...status, cloudflare: { state: "none" } }), 0);
	assert.match(renderStatus(status), /Cloudflare: the kept file could not be read/);
});

const OPTIONS: ScheduleOptions = {
	kind: "launchd",
	node: "/opt/homebrew/bin/node",
	porchlight: "/Applications/Porchlight & Co.app/cli/bin/porchlight.js",
	root: "/Users/someone/code <main>",
	log: "/Users/someone/.porchlight/scheduled-scan.log",
	everyHours: 12,
	depth: 3,
	path: "/opt/homebrew/bin:/usr/bin:/bin",
};

test("schedule print gives a launchd agent with every value escaped, running a Standard scan", () => {
	const plist = launchdAgent(OPTIONS);
	assert.match(plist, /<string>\/Applications\/Porchlight &amp; Co\.app\/cli\/bin\/porchlight\.js<\/string>/);
	assert.match(plist, /<string>\/Users\/someone\/code &lt;main&gt;<\/string>/);
	assert.match(plist, /<string>--save<\/string>\s*<string>--preset<\/string>\s*<string>standard<\/string>/);
	assert.match(plist, /<key>StartInterval<\/key>\s*<integer>43200<\/integer>/);
	assert.match(plist, /<key>PATH<\/key>\s*<string>\/opt\/homebrew\/bin:\/usr\/bin:\/bin<\/string>/);
	// An XML comment may not hold "--", which would end the file's parse early.
	const comment = /<!--([\s\S]*?)-->/.exec(plist)![1]!;
	assert.ok(!comment.includes("--"));
	assert.throws(() => launchdAgent({ ...OPTIONS, root: "relative/folder" }), /absolute path/);
	assert.throws(() => launchdAgent({ ...OPTIONS, root: "/a\n</string>" }), /control character/);
	assert.throws(() => launchdAgent({ ...OPTIONS, everyHours: 0 }), /--every/);
});

test("schedule print gives a systemd service and timer, quoted for ExecStart", () => {
	const units = systemdUnits({ ...OPTIONS, kind: "systemd", root: '/home/someone/my "code" 100% $HOME' });
	assert.match(units, /ExecStart="\/opt\/homebrew\/bin\/node" "\/Applications\/Porchlight & Co\.app\/cli\/bin\/porchlight\.js" "repos" "scan" "\/home\/someone\/my \\"code\\" 100%% \$\$HOME" "--save" "--preset" "standard" "--depth" "3"/);
	assert.match(units, /OnUnitActiveSec=12h/);
	assert.match(units, /Environment="PATH=\/opt\/homebrew\/bin:\/usr\/bin:\/bin"/);
	assert.match(units, /installed nothing/);
});

test("the schedule command picks the unit for the platform and installs nothing", async () => {
	const dir = await tempDir();
	const out: string[] = [];
	const err: string[] = [];
	const io = { print: (text: string) => out.push(text), warn: (text: string) => err.push(text) };
	assert.equal(scheduleCommand("print", ["--every", "6"], io, { dataDir: dir, platform: "linux", cwd: "/srv/code", node: "/usr/bin/node", porchlight: "/opt/porchlight/bin/porchlight.js", path: "/usr/bin:relative:/bin" }), 0);
	assert.match(out[0]!, /\[Timer\]/);
	assert.match(out[0]!, /"\/srv\/code"/);
	assert.match(out[0]!, /Environment="PATH=\/usr\/bin:\/bin"/, "only absolute folders go into PATH");
	assert.match(err[0]!, /nothing was installed/);
	assert.match(scheduleCommandText(["--launchd"], dir), /<plist version="1.0">/);
	assert.throws(() => scheduleCommand("install", [], io, { dataDir: dir }), /Usage: porchlight schedule print/);
	assert.throws(() => scheduleCommand("print", ["--launchd", "--systemd"], io, { dataDir: dir }), /Choose one/);
	assert.throws(() => scheduleCommand("print", ["--every", "1.5"], io, { dataDir: dir }), /--every/);
	assert.deepEqual(await readdir(dir), []);
});

function scheduleCommandText(args: string[], dataDir: string): string {
	const out: string[] = [];
	scheduleCommand("print", args, { print: (text) => out.push(text), warn: () => {} }, { dataDir, platform: "linux", node: "/usr/bin/node", porchlight: "/p.js", cwd: "/" });
	return out[0]!;
}

const PAGE: HostsPage = {
	domain: "example.test",
	takenAt: "2026-11-21T10:00:00.000Z",
	total: 3,
	page: 1,
	pageSize: 2,
	hosts: [
		{ name: "=cmd.example.test", probed: true, checkedAt: "2026-11-21T10:00:00.000Z", dns: { a: ["203.0.113.1"], aaaa: [], cname: [] }, cert: { notBefore: "2026-10-01T00:00:00.000Z", notAfter: "2026-12-30T00:00:00.000Z" }, https: { ok: true, status: 200 }, findings: 2 },
		{ name: "shop.example.test", probed: true, checkedAt: null, dns: { a: [], aaaa: [], cname: ["gone.vendor.example"] }, cert: null, https: null, findings: 1 },
	],
	gone: [{ name: "old.example.test", since: "2026-11-01T00:00:00.000Z" }],
};

test("domains hosts asks for every page, and writes the inventory escaped for each format", async () => {
	const asked: string[] = [];
	const inventory = await fetchHosts("example.test", async (path) => {
		asked.push(path);
		return path.endsWith("?page=2")
			? { status: 200, body: { ...PAGE, page: 2, hosts: [{ ...PAGE.hosts[1]!, name: "www.example.test", probed: false, dns: null }], gone: [] } }
			: { status: 200, body: PAGE };
	});
	assert.deepEqual(asked, ["/domains/example.test/hosts", "/domains/example.test/hosts?page=2"]);
	assert.equal(inventory.hosts.length, 3);
	const text = renderHosts(inventory);
	assert.match(text, /example\.test: 3 names/);
	assert.match(text, /shop\.example\.test +no address +→ gone\.vendor\.example +1 finding/);
	assert.match(text, /www\.example\.test +not checked +not checked/);
	assert.match(text, /Gone .*\n {2}old\.example\.test {2}since 2026-11-01/);
	assert.match(hostsCsv(inventory), /\n'=cmd\.example\.test,HTTP 200,/);
	assert.match(hostsMarkdown(inventory), /\| =cmd\.example\.test \| HTTP 200 \|/);
	await assert.rejects(fetchHosts("example.test", async () => ({ status: 404, body: { error: "example.test has not been scanned yet" } })), /has not been scanned yet/);

	const printed: string[] = [];
	await domainsHosts(["example.test", "--format", "csv"], async () => ({ status: 200, body: { ...PAGE, total: 2 } }), (out) => printed.push(out));
	assert.match(printed[0]!, /^Name,HTTPS,DNS/);
	await assert.rejects(domainsHosts(["example.test", "--format", "xml"], async () => ({ status: 200, body: PAGE }), () => {}), /--format/);
});

test("each new command has its own help", () => {
	assert.match(helpFor(["status"]) ?? "", /contacts nothing/);
	assert.match(helpFor(["hook"]) ?? "", /never writes into a repository/);
	assert.match(helpFor(["schedule", "print"]) ?? "", /installs nothing/);
	assert.match(helpFor(["schedule"]) ?? "", /Usage: porchlight schedule print/);
	assert.match(helpFor(["domains", "hosts"]) ?? "", /hosts <domain>/);
	assert.match(helpFor(["repos", "scan"]) ?? "", /--baseline <file>/);
	assert.match(helpFor(["repos", "scan"]) ?? "", /--format <form>/);
});

