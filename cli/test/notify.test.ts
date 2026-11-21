import assert from "node:assert/strict";
import { test } from "node:test";
import { formatFor, noticeRequest, notifySetting, notifyTarget, type Notice } from "../src/notify/format.ts";
import { failedScanNotice, scanNotice } from "../src/notify/scan.ts";
import type { ScanReport } from "../src/repos/types.ts";

// What a hostile DNS record or file name could try: a mention, Slack markup, a fence that closes early, a control character.
const HOSTILE = "evil.example says <!channel> @everyone ``` <https://phish.example|click> \u001b[2J";
const notice: Notice = { title: "Porchlight: example.com: 1 new finding", lines: ["New findings", `  [high] ${HOSTILE}`], urgent: true, payload: { domain: "example.com" } };

test("picks the format from the address unless one is asked for", () => {
	assert.equal(formatFor(new URL("https://hooks.slack.com/services/T/B/x")), "slack");
	assert.equal(formatFor(new URL("https://discord.com/api/webhooks/1/abc")), "discord");
	assert.equal(formatFor(new URL("https://ntfy.sh/my-topic")), "ntfy");
	assert.equal(formatFor(new URL("https://hooks.example.com/alert")), "json");
	assert.equal(formatFor(new URL("https://push.example.com/topic"), "NTFY"), "ntfy");
	assert.equal(formatFor(new URL("https://hooks.example.com/alert"), "email"), null);
});

test("sends notices over https, and over plain http only within this machine or a private network", () => {
	assert.equal(notifyTarget("https://ntfy.sh/topic")?.host, "ntfy.sh");
	for (const local of ["http://localhost:8080/t", "http://192.168.1.5/t", "http://10.0.0.2/t", "http://host.docker.internal:2586/t", "http://box.tail1234.ts.net/t", "http://100.101.1.2/t"]) {
		assert.ok(notifyTarget(local), local);
	}
	for (const refused of ["http://ntfy.sh/topic", "http://8.8.8.8/t", "ftp://example.com/", "https://user:pass@example.com/", "not an address", "", undefined]) {
		assert.equal(notifyTarget(refused), null, String(refused));
	}
});

test("Slack: markup and mentions from the data stay text", () => {
	const { headers, body } = noticeRequest("slack", notice);
	const text = JSON.parse(body).text as string;
	assert.equal(headers["content-type"], "application/json");
	assert.ok(!text.includes("<!channel>") && text.includes("&lt;!channel&gt;"));
	assert.ok(!text.includes("<https://phish.example|click>"));
	assert.equal(text.match(/```/g)?.length, 2, "only the block's own fence closes it");
	assert.ok(!text.includes("\u001b"));
});

test("Discord: mentions are switched off and the data sits in a code block it cannot close", () => {
	const sent = JSON.parse(noticeRequest("discord", notice).body);
	assert.deepEqual(sent.allowed_mentions, { parse: [] });
	assert.equal(sent.content.match(/```/g)?.length, 2);
	assert.match(sent.content, /^\*\*Porchlight: example\.com: 1 new finding\*\*\n```\n/);
	assert.ok(sent.content.length <= 2000);
});

test("ntfy: plain text, a high priority for an urgent notice, and only safe characters in its headers", () => {
	const { headers, body } = noticeRequest("ntfy", { ...notice, title: "Porchlight: exämple.com\r\nX-Injected: 1" });
	assert.deepEqual([headers.priority, headers.tags], ["high", "rotating_light"]);
	assert.ok(/^[\x20-\x7e]*$/.test(headers.title!), headers.title);
	assert.ok(!body.includes("\u001b"));
	assert.equal(noticeRequest("ntfy", { ...notice, urgent: false }).headers.priority, "default");
});

test("JSON keeps the structured payload beside the text, and long notices are cut saying so", () => {
	const sent = JSON.parse(noticeRequest("json", notice).body);
	assert.equal(sent.domain, "example.com");
	assert.match(sent.text, /^Porchlight: example\.com: 1 new finding\n\nNew findings\n/);

	const long = noticeRequest("discord", { title: "t", lines: Array.from({ length: 400 }, (_, i) => `line ${i} ${"x".repeat(40)}`), urgent: false });
	const content = JSON.parse(long.body).content as string;
	assert.ok(content.length <= 2000);
	assert.match(content, /\.\.\. and \d+ more lines\n```$/);
});

test("a scan's notice counts, names what is new and fixed, and holds no secret or author", () => {
	const finding = (severity: "critical" | "high" | "low", ruleId: string) => ({ tool: "gitleaks" as const, kind: "secret" as const, severity, ruleId, title: `Title ${ruleId}`, location: `src/${ruleId}.ts:1`, detail: "commit abcdef12 on 2026-11-20" });
	const report: ScanReport = {
		root: "/work",
		scannedAt: "2026-11-20T12:00:00.000Z",
		tools: [{ tool: "gitleaks", status: "ok", installHint: "" }, { tool: "osv-scanner", status: "ok", installHint: "" }],
		repos: [{ path: "/work/shop", errors: [], findings: [finding("low", "a"), finding("critical", "b")] }],
	};
	const keyOf = (ruleId: string) => ["shop", ruleId, `src/${ruleId}.ts:1`, "commit abcdef12 on 2026-11-20"].join("\n");
	const change = { previousScannedAt: "2026-11-19T12:00:00.000Z", newCount: 2, fixedCount: 1, uncheckedCount: 0, newKeys: [keyOf("a"), keyOf("b")], fixed: [{ repo: "shop", severity: "high" as const, kind: "secret" as const, ruleId: "c", title: "Title c", location: "src/c.ts:1", detail: "" }] };

	const notice = scanNotice(report, change);
	assert.equal(notice.title, "Porchlight: 2 findings in 1 repository, 2 new and 1 fixed since the last scan");
	assert.ok(notice.urgent, "a new critical finding is urgent");
	assert.deepEqual(notice.lines.slice(0, 5), ["By severity: 1 critical, 0 high, 0 medium, 1 low.", "", "New:", "  [critical] shop: Title b (src/b.ts:1)", "  [low] shop: Title a (src/a.ts:1)"]);
	assert.ok(notice.lines.includes("  shop: Title c (src/c.ts:1)"));
	assert.equal(scanNotice(report, null).title, "Porchlight: 2 findings in 1 repository");
	assert.equal(scanNotice(report, { ...change, newKeys: [keyOf("a")], newCount: 1 }).urgent, false);
	assert.ok(failedScanNotice("/work", "gitleaks failed").urgent);
});

test("JSON text forms no mention, link, image or tag in a chat that renders it as Markdown (S52)", () => {
	const hostile: Notice = { title: "Porchlight: 1 finding", lines: ["  [high] shop: AWS key (@channel ![](https://x.example/p).env:1) <users/all> [here](https://x.example)"], urgent: true };
	const text = JSON.parse(noticeRequest("json", hostile).body).text as string;
	assert.doesNotMatch(text, /@channel|@all|@here/);
	assert.doesNotMatch(text, /\]\(/);
	assert.doesNotMatch(text, /<users/);
	assert.equal(text.replace(/​/g, ""), `Porchlight: 1 finding\n\n${hostile.lines[0]}`, "it reads as written");
});

test("a scheduled scan that checked nothing says so, urgently, and every scan notice says whether it was complete (B54)", () => {
	const base: ScanReport = { format: 2, root: "/p", scannedAt: "2026-11-20T09:00:00.000Z", tools: [{ tool: "gitleaks", status: "missing", installHint: "brew install gitleaks" }, { tool: "osv-scanner", status: "missing", installHint: "brew install osv-scanner" }], repos: [{ path: "/p/app", findings: [], errors: [] }] };
	const nothing = scanNotice(base, { newCount: 0, fixedCount: 0, newKeys: [], fixed: [], uncheckedCount: 0, previousScannedAt: "2026-11-19T09:00:00.000Z" } as never);
	assert.equal(nothing.title, "Porchlight: the scheduled scan checked nothing");
	assert.equal(nothing.urgent, true);
	assert.deepEqual([(nothing.payload as Record<string, unknown>).complete, (nothing.payload as Record<string, unknown>).checkedNothing], [false, true]);

	const failed = scanNotice({ ...base, tools: base.tools.map((tool) => ({ ...tool, status: "ok" as const })), repos: [{ path: "/p/app", findings: [], errors: [{ tool: "gitleaks", message: "x" }, { tool: "osv-scanner", message: "y" }] }] }, null);
	assert.equal(failed.title, "Porchlight: the scheduled scan checked nothing", "each scanner failed on every repository");

	const partial = scanNotice({ ...base, tools: [{ ...base.tools[0]!, status: "ok" }, base.tools[1]!] }, null);
	assert.equal(partial.title, "Porchlight: 0 findings in 1 repository (not everything was covered)");
	assert.equal(partial.urgent, false);
	assert.equal((partial.payload as Record<string, unknown>).complete, false);

	const whole = scanNotice({ ...base, tools: base.tools.map((tool) => ({ ...tool, status: "ok" as const })) }, null);
	assert.equal(whole.title, "Porchlight: 0 findings in 1 repository");
	assert.equal((whole.payload as Record<string, unknown>).complete, true);
});

test("nothing that leaves the computer names the scanned folder's path or the owner's home folder (S35)", async () => {
	const { homedir } = await import("node:os");
	const { coverageNotes } = await import("../src/repos/report.ts");
	const root = `${homedir()}/Projects`;
	const report: ScanReport = {
		format: 2,
		root,
		scannedAt: "2026-11-20T09:00:00.000Z",
		tools: [{ tool: "gitleaks", status: "ok", installHint: "" }],
		repos: [{ path: `${root}/shop`, findings: [], errors: [{ tool: "gitleaks", message: `[git] fatal: detected dubious ownership in repository at '${root}/shop'; see ${homedir()}/.gitconfig` }] }],
	};
	const notes = coverageNotes(report).join("\n");
	assert.ok(!notes.includes(homedir()), notes);
	assert.match(notes, /gitleaks failed on shop: \[git\] fatal: detected dubious ownership in repository at 'shop'; see ~\/\.gitconfig/);
	const failed = failedScanNotice(root, `No git repositories found under ${root}`);
	assert.deepEqual(failed.lines.slice(0, 2), ["Folder: Projects", "Why: No git repositories found under Projects"]);
});

test("line and paragraph separators and direction marks never reach a notice, an export or the log (S38)", async () => {
	const { stripControls, jsonText } = await import("../src/roadmap/escape.ts");
	const { oneLine } = await import("../src/projects/projects.ts");
	const hostile = "file\u2028X-Injected: 1 \u202Egnp.exe\u200F.txt";
	const acting = /[\u2028\u2029\u202A-\u202E\u2066-\u2069\u200E\u200F\u061C]/;
	for (const out of [stripControls(hostile), oneLine(hostile), JSON.parse(noticeRequest("json", { title: "t", lines: [hostile], urgent: false }).body).text as string]) {
		assert.doesNotMatch(out, acting, JSON.stringify(out));
	}
	assert.doesNotMatch(jsonText({ name: hostile }), acting, "escaped in JSON, so the data is unchanged");
});

test("a notice fits each service's limit after escaping, in the unit the service counts (B56)", () => {
	// A hostile repository's file names: runs of backticks, which the Discord and Slack escaping lengthen.
	const fences = Array.from({ length: 12 }, (_, i) => `  [high] shop: AWS key (${"`".repeat(120)}${i}.env:1)`);
	const discord = JSON.parse(noticeRequest("discord", { title: "Porchlight: 12 findings", lines: fences, urgent: true }).body).content as string;
	assert.ok(discord.length <= 2000, `${discord.length} characters`);
	assert.equal(discord.match(/```/g)?.length, 2, "the block still closes");
	assert.match(discord, /\.\.\. and \d+ more lines\n```$/);

	// 60 file names in Chinese: three bytes a character, which ntfy counts.
	const cjk = Array.from({ length: 60 }, (_, i) => `  [low] 店铺: 私钥 (源代码/配置文件/数据库连接设置${i}.env:1)`);
	const ntfy = noticeRequest("ntfy", { title: "Porchlight: 60 findings", lines: cjk, urgent: false }).body;
	assert.ok(new TextEncoder().encode(ntfy).length <= 4096, `${new TextEncoder().encode(ntfy).length} bytes`);
	assert.match(ntfy, /\.\.\. and \d+ more lines$/);

	// Slack's escaping turns one < into four characters.
	const angles = Array.from({ length: 40 }, () => `  [low] ${"<".repeat(200)}`);
	const slack = JSON.parse(noticeRequest("slack", { title: "t", lines: angles, urgent: false }).body).text as string;
	assert.ok(slack.length <= 3500, `${slack.length} characters`);

	// What fits is sent whole.
	const few = noticeRequest("ntfy", { title: "t", lines: ["  [low] 店铺: 私钥"], urgent: false }).body;
	assert.equal(few, "  [low] 店铺: 私钥");
});

test("accepts a plain http notice address on the owner's own network, by what it is rather than how it looks (B72)", () => {
	for (const own of ["http://nas:8080/hook", "http://[fd00::5]/", "http://[fe80::1]/t", "http://ntfy.lan/topic", "http://printer.home.arpa/t", "http://172.20.0.3/t", "http://127.0.0.1:2586/t"]) {
		assert.ok(notifyTarget(own), own);
	}
	// Names that only start like a private address are names, found in public DNS; and public or not-private IPv6.
	for (const across of ["http://10.example.com/t", "http://192.168.example.com/t", "http://127.example.com/t", "http://172.32.0.1/t", "http://[2001:db8::1]/t", "http://[fc::1]/t", "http://ntfy.example.lan.example.com/t"]) {
		assert.equal(notifyTarget(across), null, across);
	}
});

test("a notice address that cannot be used is a problem to show, never an exit, and never repeats the address (B72)", () => {
	assert.equal(notifySetting(undefined, undefined), undefined);
	assert.equal(notifySetting("  ", "slack"), undefined, "BoxPilot passes an empty setting as an empty variable");
	const refused = notifySetting("http://hooks.example.com/t0ps3cret", undefined);
	assert.ok(refused && "problem" in refused);
	assert.doesNotMatch(refused.problem, /t0ps3cret|hooks\.example/);
	const badFormat = notifySetting("https://hooks.example.com/t0ps3cret", "pager");
	assert.ok(badFormat && "problem" in badFormat && badFormat.problem.includes("PORCHLIGHT_NOTIFY_FORMAT"));
	const used = notifySetting("http://nas:8080/hook", "ntfy");
	assert.ok(used && "url" in used);
	assert.deepEqual([used.url.host, used.format], ["nas:8080", "ntfy"]);
});
