import assert from "node:assert/strict";
import { readdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { assistantConfig } from "../src/assist/ollama.ts";
import {
	discussionTitle,
	DiscussionStore,
	exportDiscussion,
	followUpPrompt,
	MAX_DISCUSSIONS,
	newDiscussion,
	viewOf,
	type DiscussionTurn,
} from "../src/discussions/discussions.ts";
import { aboutLink, filterDiscussions, kindLabel } from "../ui/discussion-links.js";
import { tempDir } from "./helpers.ts";
import { estimateTokens } from "../src/assist/prompts.ts";

const config = assistantConfig({ PORCHLIGHT_LLM_URL: "http://ollama.test:11434", PORCHLIGHT_LLM_MODEL: "qwen-test:9b" });
const turn = (answer: string, question: string | null = null, at = "2026-11-19T10:00:00.000Z"): DiscussionTurn => ({ question, answer, model: "qwen-test:9b", at, seconds: 1 });

test("titles come from what was asked about, on one line, never from the model", () => {
	assert.equal(
		discussionTitle("finding", { title: "AWS access key", location: "api/config.ts:12", repo: "acme/api" }, null),
		"Explain: AWS access key in api/config.ts:12 (acme/api)",
	);
	assert.equal(discussionTitle("roadmap", {}, null), "What to fix first, and why");
	assert.equal(discussionTitle("domain", { domain: "example.com", takenAt: "2026-11-17T09:00:00Z" }, null), "Domain: example.com, scan of 2026-11-17");
	assert.equal(discussionTitle("send", { content: "findings", purpose: "repair", partial: "high severity only" }, null), "Repair plan of the findings (high severity only)");
	// A question is the owner's words, cut short; a finding title from a scan cannot break the line.
	assert.equal(discussionTitle("ask", {}, `Which repo${"?".repeat(80)}`).length, "Ask: ".length + 60);
	assert.equal(discussionTitle("finding", { title: "evil\n# heading\u0007", location: "a", repo: "b" }, null), "Explain: evil # heading in a (b)");
});

test("a follow-up sends the first prompt, the answers so far and the question, dropping the oldest answers when they do not fit", () => {
	const base = { messages: [{ role: "system" as const, content: "rules" }, { role: "user" as const, content: "task <<<DATA {} DATA>>>" }], cut: null };
	const turns = [turn("first answer"), turn("second answer", "why?"), turn("third answer", "and then?")];

	const all = followUpPrompt(base, turns, "last question", 10_000);
	assert.deepEqual(
		all.messages.map((message) => [message.role, message.content.split("\n").at(-1)]),
		[
			["system", "rules"],
			["user", "task <<<DATA {} DATA>>>"],
			["assistant", "first answer"],
			["user", "why?"],
			["assistant", "second answer"],
			["user", "and then?"],
			["assistant", "third answer"],
			["user", "last question"],
		],
	);
	assert.equal(all.note, null);

	// Room for the last two exchanges only: the rules and the data stay, the first answer goes, and both sides are told.
	// The cap is in estimated tokens (AI-B7).
	const tight = followUpPrompt(base, turns, "last question", ["second answer", "why?", "third answer", "and then?"].reduce((sum, text) => sum + estimateTokens(text), 0));
	assert.deepEqual(tight.messages.slice(0, 3).map((message) => message.content), ["rules", "task <<<DATA {} DATA>>>", "The owner's follow-up question:\nwhy?"]);
	assert.match(tight.messages.at(-1)!.content, /Your first answer was left out/);
	assert.equal(tight.note, "The model was not sent the first answer of this discussion, so the rest fit in what it can read.");

	const none = followUpPrompt(base, turns, "q", 0);
	assert.deepEqual(none.messages.map((message) => message.role), ["system", "user", "user"]);
	assert.match(none.note ?? "", /first 3 answers/);
});

test("keeps discussions owner-only, reads them by id alone, and keeps the most recent", async () => {
	const dir = join(await tempDir(), "discussions");
	const store = new DiscussionStore(dir);
	const first = newDiscussion({ kind: "roadmap", about: { scannedAt: "s" }, config, hosted: false, target: "startup", first: turn("Fix pkg first.") });
	await store.save(first);
	assert.equal((await stat(join(dir, `${first.id}.json`))).mode & 0o777, 0o600);
	assert.deepEqual(await store.read(first.id), first);
	for (const id of ["../x", "dsc_123", `${first.id}/..`, 7, null]) assert.equal(await store.read(id), null);
	// A file that is not a discussion, or one renamed to another id, is not read.
	await writeFile(join(dir, "dsc_aaaaaaaaaaaaaaaa.json"), JSON.stringify({ ...first, id: "dsc_bbbbbbbbbbbbbbbb" }));
	assert.equal(await store.read("dsc_aaaaaaaaaaaaaaaa"), null);
	assert.deepEqual((await store.list()).map((entry) => entry.id), [first.id]);

	// The page is never sent the model's address beyond its host.
	assert.ok(!("fingerprint" in viewOf(first)));

	for (let index = 0; index < MAX_DISCUSSIONS + 2; index++) {
		const minute = String(index % 60).padStart(2, "0");
		const hour = String(10 + Math.floor(index / 60)).padStart(2, "0");
		await store.save(newDiscussion({ kind: "roadmap", about: {}, config, hosted: false, target: "startup", first: turn("x", null, `2026-11-20T${hour}:${minute}:00.000Z`) }));
	}
	await store.prune();
	const kept = (await readdir(dir)).filter((name) => name.endsWith(".json"));
	assert.equal(kept.length, MAX_DISCUSSIONS + 1, "the oldest go, and a file that is not a discussion is left alone");
	assert.equal(await store.read(first.id), null, "the least recently added to went first");
	assert.equal(await store.remove("../escape"), false);
});

test("exports escape what the scan and the model wrote, under a fixed name", () => {
	const discussion = newDiscussion({
		kind: "finding",
		about: { repo: "acme/api", location: "[click](https://evil.example)", scannedAt: "2026-11-19T09:00:00.000Z" },
		config,
		hosted: false,
		target: "startup",
		first: turn("<img src=x onerror=alert(1)>\n- step one\n- step [two](javascript:alert(1))"),
	});
	discussion.turns.push(turn("Fine.", "Is it *real*?"));

	const md = exportDiscussion(discussion, "md");
	assert.equal(md.filename, "porchlight-discussion-2026-11-19.md");
	assert.ok(!/(?<!\\)</.test(md.body), "no HTML: every < is escaped");
	assert.match(md.body, /\\<img src=x onerror=alert\\\(1\\\)\\>/);
	assert.ok(!md.body.includes("](https://evil.example)") && !md.body.includes("](javascript:"), "no links");
	assert.match(md.body, /^- step one$/m, "a list stays a list");
	assert.match(md.body, /## You\n\nIs it \\\*real\\\*\?/);
	assert.match(md.body, /generated by a model/);

	const text = exportDiscussion({ ...discussion, turns: [turn("bell\u0007 and \u001b[31mred")] }, "txt");
	assert.equal(text.filename, "porchlight-discussion-2026-11-19.txt");
	assert.ok(!/[\u0007\u001b]/.test(text.body), "no control characters reach a terminal");
});

test("the Discussions page filters by kind, project and search, and links back to what each was about", () => {
	const summary = (fields: Record<string, unknown>) => ({ id: "dsc_0", kind: "finding", title: "", model: "m", host: "h", hosted: false, createdAt: "", updatedAt: "", answers: 1, ...fields }) as never;
	const list = [
		summary({ id: "a", title: "Explain: key in api.ts", repo: "acme/api", project: "prj_aaaaaaaaaaaaaaaa" }),
		summary({ id: "b", kind: "domain", title: "Domain: example.com", domain: "example.com" }),
	];
	assert.deepEqual(filterDiscussions(list, { kind: "domain" }).map((entry: { id: string }) => entry.id), ["b"]);
	assert.deepEqual(filterDiscussions(list, { q: "ACME" }).map((entry: { id: string }) => entry.id), ["a"]);
	assert.deepEqual(filterDiscussions(list, {}).length, 2);
	assert.deepEqual(filterDiscussions(list, { project: "prj_aaaaaaaaaaaaaaaa" }).map((entry: { id: string }) => entry.id), ["a"]);
	assert.deepEqual(filterDiscussions(list, { project: "none" }).map((entry: { id: string }) => entry.id), ["b"]);
	assert.equal(kindLabel("send"), "Sent to a model");

	const view = (kind: string, about: Record<string, unknown>) => ({ kind, about }) as never;
	assert.deepEqual(aboutLink(view("finding", { repo: "acme/api", location: "api.ts" })), { href: "#/findings?repo=acme%2Fapi&q=api.ts", label: "Open the finding" });
	assert.deepEqual(aboutLink(view("domain", { domain: "example.com" })), { href: "#/domains/example.com", label: "Open the domain" });
	assert.deepEqual(aboutLink(view("send", { content: "findings", filter: { severity: "critical" } })), { href: "#/findings?severity=critical", label: "Open the findings" });
	assert.equal(aboutLink(view("roadmap", {}))?.href, "#/roadmap");
});
