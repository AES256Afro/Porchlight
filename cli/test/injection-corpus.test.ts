// The prompt-injection corpus (R6F-11): hostile titles, file names, DNS values, tool outputs and model
// answers, each checked to reach a prompt only inside its framed data block (invariant 13) or its fenced
// tool output (invariant 20), and to change nothing Porchlight decides: not a severity, a verdict, an
// action or a finding. It runs with scripted inputs only; nothing here asks a real model.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { parseJudgement } from "../src/analysis/analyse.ts";
import { askPrompt, DATA_END, DATA_START, domainPrompt, findingPrompt, frameJson, type Prompt } from "../src/assist/prompts.ts";
import { MuralError, parseMural } from "../src/assist/mural.ts";
import { buildPrompt, fence, newRun, parsePlan, recordFindings } from "../src/investigate/engine.ts";
import { Scope } from "../src/investigate/scope.ts";
import { parseAction } from "../src/investigate/tools.ts";
import { triageSecret } from "../src/repos/triage.ts";
import type { Finding, ScanReport } from "../src/repos/types.ts";

interface Corpus {
	canary: string;
	titles: string[];
	files: string[];
	dns: string[];
	toolOutputs: string[];
	modelAnswers: string[];
}

const corpus = JSON.parse(await readFile(new URL("./fixtures/injection-corpus.json", import.meta.url), "utf8")) as Corpus;

/** The user message split at the markers: what is before the data, the data, and what is after. */
function parts(prompt: Prompt): { system: string; before: string; data: string; after: string } {
	const system = prompt.messages.find((message) => message.role === "system")?.content ?? "";
	const user = prompt.messages.find((message) => message.role === "user")?.content ?? "";
	const start = user.indexOf(`\n${DATA_START}\n`);
	const end = user.lastIndexOf(`\n${DATA_END}`);
	assert.ok(start >= 0 && end > start, "the data block is framed");
	return { system, before: user.slice(0, start), data: user.slice(start + DATA_START.length + 2, end), after: user.slice(end + DATA_END.length + 1) };
}

/** Every hostile text lands inside the data, as JSON, and nowhere else; the frame cannot be closed from inside. */
function assertFramed(prompt: Prompt, hostile: string[]): void {
	const { system, before, data, after } = parts(prompt);
	// The data block is one JSON value: what it holds is a string, never a marker or a tag.
	JSON.parse(data);
	assert.ok(!data.includes(DATA_END) && !data.includes(DATA_START), "no marker inside the data");
	assert.ok(!/[<>]/.test(data), "no tag inside the data");
	for (const text of hostile) {
		assert.ok(data.includes(frameJson(text).slice(1, -1).slice(0, 40)), `the hostile text is in the data: ${text.slice(0, 30)}`);
		for (const outside of [system, before, after]) assert.ok(!outside.includes(text.slice(0, 30)), `and nowhere outside it: ${text.slice(0, 30)}`);
	}
	assert.ok(!system.includes(corpus.canary) && !before.includes(corpus.canary) && !after.includes(corpus.canary));
}

function hostileReport(): ScanReport {
	const findings: Finding[] = corpus.titles.map((title, index) => ({
		tool: "osv-scanner",
		kind: "vulnerability",
		severity: "high",
		ruleId: `GHSA-test-${index}`,
		title,
		location: corpus.files[index % corpus.files.length]!,
		detail: `pkg-${index}@1.0.0`,
	}));
	return {
		root: "/work",
		scannedAt: "2026-11-21T00:00:00.000Z",
		tools: [
			{ tool: "gitleaks", status: "ok", installHint: "" },
			{ tool: "osv-scanner", status: "ok", installHint: "" },
		],
		repos: [{ path: "/work/shop", findings, errors: [] }],
	};
}

test("hostile titles and file names reach Explain only inside the framed data block", () => {
	const report = hostileReport();
	const repo = report.repos[0]!;
	for (const finding of repo.findings) assertFramed(findingPrompt(report, repo, finding), [finding.title]);
});

test("hostile titles reach Ask inside the data, and the owner's question stays outside it", () => {
	const report = hostileReport();
	const prompt = askPrompt(report, "Which repository is worst?");
	assertFramed(prompt, corpus.titles.slice(0, 2));
	assert.match(parts(prompt).after, /^\n+The owner's question:\nWhich repository is worst\?$/);
});

test("hostile DNS values and hosts reach a domain's summary only inside the data", () => {
	const findings = corpus.dns.map((value, index) => ({ id: `f${index}`, host: "www.example.com", severity: "medium" as const, title: value, category: "dns", detail: value }));
	const prompt = domainPrompt({ domain: "example.com", takenAt: "2026-11-21T00:00:00Z", findings, newFindings: [], resolvedFindings: [], changes: [], notes: corpus.dns } as never);
	assertFramed(prompt, corpus.dns);
});

test("hostile tool output stays inside its own fence, with forged tags broken and cookie values left out", () => {
	const scope = new Scope("example.com");
	const run = newRun({ domain: "example.com", goal: "Map it", model: "m", modelHost: "localhost:11434", hosted: false });
	run.turns = 2;
	corpus.toolOutputs.forEach((response, index) => {
		run.evidence.push({ id: `ev_${index}`, tool: "http_request", args: { url: "https://example.com/" }, request: "GET /", response, ok: true, at: "2026-11-21T00:00:00Z" });
		run.steps.push({ id: `st_${index}`, turn: index + 1, at: "2026-11-21T00:00:00Z", tool: "http_request", outcome: "ran", description: "http_request GET https://example.com/", evidenceId: `ev_${index}` });
	});
	const prompt = buildPrompt(run, scope);
	// One opening and one closing tag per output: none can be closed early or forged.
	assert.equal((prompt.match(/<tool_output /g) ?? []).length, corpus.toolOutputs.length);
	assert.equal((prompt.match(/<\/tool_output>/g) ?? []).length, corpus.toolOutputs.length);
	assert.ok(!/<\/?\s*tool_output\b(?!_)/i.test(fence(corpus.toolOutputs[0]!)));
	assert.ok(!prompt.includes("abcdef0123456789"), "a cookie's value is never sent");
	// The canary is in the output, inside its fence, never before the first tool output.
	assert.ok(prompt.indexOf(corpus.canary) > prompt.indexOf("<tool_output "));
});

test("a model's answer that follows an injection decides nothing: no verdict, no action out of scope, no finding without evidence", () => {
	// An answer that is not the JSON asked for is "unclear", whatever it says.
	for (const answer of corpus.modelAnswers) {
		const judged = parseJudgement(answer);
		assert.equal(judged.verdict, "unclear", answer);
		assert.throws(() => parseMural(answer), MuralError);
	}
	// An action the model proposes is checked by plain code: out of scope, not a tool, or to an address, it is refused.
	const scope = new Scope("example.com");
	for (const answer of corpus.modelAnswers.slice(1)) {
		const plan = parsePlan(answer);
		assert.ok(plan);
		assert.throws(() => parseAction(plan.tool, plan.args, scope), answer);
	}
	// A finding citing evidence this run never captured is not kept.
	const run = newRun({ domain: "example.com", goal: "Map it", model: "m", modelHost: "localhost:11434", hosted: false });
	recordFindings(run, [{ title: corpus.titles[0], severity: "critical", evidence_ids: ["ev_forged"] }], 1);
	assert.deepEqual([run.findings.length, run.discarded], [0, 1]);
});

test("a hostile title or file name changes no severity: triage reads the rule and the path's shape only", () => {
	for (const file of corpus.files) {
		const ranked = triageSecret("aws-access-token", file);
		assert.ok(["critical", "high", "medium", "low"].includes(ranked.severity));
		// The same rule in an ordinary file of the same depth ranks as it would without the hostile words.
		assert.equal(ranked.severity, triageSecret("aws-access-token", file.replace(/[^/]+$/, "x.js")).severity, file);
	}
});
