import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { main } from "../src/main.ts";
import { renderMarkdown } from "../src/repos/report.ts";
import type { ScanReport } from "../src/repos/types.ts";
import { csvCell, forTerminal, html, jsonText, mdBlock, mdCode, mdText } from "../src/roadmap/escape.ts";

// A file name or advisory text can carry terminal escape sequences: ESC (C0), CSI (C1), a bell,
// a bare carriage return that rewrites the line, and a right-to-left override that disguises a name.
const ESC = "\u001b";
const CSI = "\u009b";
const RLO = "‮";
const HOSTILE = `evil${ESC}]8;;https://x.example${ESC}\\${CSI}2J${RLO}gpj.exe\u0007\rok`;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f‪-‮⁦-⁩]/;

test("no output format passes on a control character from scanned data", () => {
	for (const [name, text] of [
		["terminal", forTerminal(HOSTILE)],
		["markdown text", mdText(HOSTILE)],
		["markdown code", mdCode(HOSTILE)],
		["markdown block", mdBlock(HOSTILE)],
		["csv", csvCell(HOSTILE)],
		["html", html(HOSTILE)],
		["json", jsonText({ name: HOSTILE })],
	] as const) {
		assert.ok(!CONTROL.test(text), `${name}: ${JSON.stringify(text)}`);
		assert.ok(!/\r(?!\n)/.test(text), `${name}: a bare carriage return`);
	}
	// What is not a control is kept, and the replacement shows where one was.
	assert.equal(forTerminal(`a\tb\nc\r\nd${ESC}[31m`), "a\tb\nc\r\nd�[31m");
});

test("JSON keeps the data while escaping what a terminal would act on", () => {
	const value = { name: HOSTILE, nested: [`${CSI}x`, RLO] };
	assert.deepEqual(JSON.parse(jsonText(value)), value);
	assert.ok(jsonText(value).includes("\\u009b") && jsonText(value).includes("\\u202e"));
});

test("Markdown text cannot become a link or a mention", () => {
	const text = mdText("See https://evil.example/login and WWW.evil.example, ask @octocat or @acme/admins, mail jo@mail.example");
	assert.ok(!/https?:\/\//i.test(text), text);
	assert.ok(!/(?<!\\)www\./i.test(text), text);
	assert.ok(text.includes("https\\://evil.example/login"), "the address is still readable");
	// GitHub links @name even when the @ is escaped, but leaves code spans alone.
	const outsideCode = text.replace(/(`+)[\s\S]*?\1/g, "");
	assert.ok(!/(^|[^\\\w])@\w/.test(outsideCode), text);
	assert.ok(text.includes("`@octocat`") && text.includes("`@acme/admins`"));
	assert.ok(text.includes("jo\\@mail.example"), "an email address is escaped, not turned into code");
});

function hostileReport(): ScanReport {
	return {
		root: "/work",
		scannedAt: "2026-11-20T12:00:00.000Z",
		tools: [{ tool: "gitleaks", status: "ok", version: "8.30.1", installHint: "brew install gitleaks" }],
		repos: [
			{
				path: "/work/shop|admin",
				errors: [],
				findings: [
					{
						tool: "gitleaks",
						kind: "secret",
						severity: "high",
						ruleId: "aws-access-token",
						title: `**Pwned** [click](https://evil.example) <img src=x> ${HOSTILE}`,
						location: `a\`b${ESC}[2K.js:1`,
						detail: "commit abcdef12 on 2026-11-20",
					},
				],
			},
		],
	};
}

test("the scan's own Markdown report escapes what it prints", () => {
	const markdown = renderMarkdown(hostileReport());

	assert.ok(!CONTROL.test(markdown), "no control character");
	const prose = markdown.replace(/(?<!\\)(`+)[\s\S]*?[^`]\1(?!`)/g, "");
	assert.ok(!/\]\(http|(?<!\\)<img|https?:\/\//i.test(prose), "no live link, image or address outside a code span");
	assert.ok(markdown.includes("\\*\\*Pwned\\*\\*"), "the title is still there, escaped");
	assert.ok(markdown.includes("shop\\|admin"), "a pipe in a name does not add a table column");
	assert.ok(markdown.includes("``a`b�[2K.js:1``"), "the location's code span cannot be closed early");
});

test("writes reports and exports readable only by their owner", async () => {
	const dir = await mkdtemp(join(tmpdir(), "porchlight-out-"));
	try {
		const reportPath = join(dir, "report.json");
		await writeFile(reportPath, JSON.stringify(hostileReport()));
		const out = join(dir, "roadmap.md");
		await writeFile(out, "an older export");
		await chmod(out, 0o644);

		assert.equal(await main(["repos", "export", reportPath, "--out", out]), 0);

		assert.equal((await stat(out)).mode & 0o777, 0o600);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
