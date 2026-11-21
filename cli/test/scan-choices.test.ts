import assert from "node:assert/strict";
import { test } from "node:test";
import { choicesFromFlags } from "../src/main.ts";
import { coverageNotes, exitCode } from "../src/repos/report.ts";
import type { ScanReport } from "../src/repos/types.ts";
import {
	ChoiceError,
	choiceGaps,
	choicesFromParams,
	choicesToParams,
	describeChoices,
	looksFor,
	parseChoices,
	presetChoices,
	presetOf,
	standardChoices,
} from "../ui/scan-choices.js";

test("each preset names exactly what it covers, and Standard covers what a scan always did", () => {
	assert.deepEqual(standardChoices(), { preset: "standard", secrets: true, dependencies: true, privateData: false, history: "all", localFiles: false, skip: [], analyse: false });
	assert.deepEqual(presetChoices("quick"), { ...standardChoices(), preset: "quick", history: "none" });
	assert.deepEqual(presetChoices("deep"), { ...standardChoices(), preset: "deep", privateData: true, analyse: true });

	assert.equal(describeChoices(presetChoices("quick")), "Quick: secrets in the files as they are now, no history, dependencies");
	assert.equal(describeChoices(standardChoices()), "Standard: secrets in every commit on every branch, dependencies");
	assert.equal(describeChoices(presetChoices("deep")), "Deep: secrets in every commit on every branch, dependencies, private data, then the model's deeper analysis");
	assert.equal(describeChoices(parseChoices({ preset: "quick", secrets: false, privateData: true })), "Custom: no secrets check, dependencies, private data in the files as they are now, no history");
	// A report from before there were choices reads as the Standard scan it was.
	assert.equal(describeChoices(undefined), describeChoices(standardChoices()));

	assert.deepEqual(choiceGaps(standardChoices()), []);
	assert.match(choiceGaps(presetChoices("quick")).join(" "), /Git history was not read for secrets/);
	assert.deepEqual(choiceGaps(presetChoices("deep")), []);
});

test("files git does not track and skipped repositories are said beside a preset, not instead of it", () => {
	const quick = { ...presetChoices("quick"), localFiles: true, skip: ["old-site"] };
	assert.equal(presetOf(quick), "quick");
	assert.equal(describeChoices(quick), "Quick: secrets in the files as they are now, no history, dependencies, files git does not track (not node_modules or virtual environments), 1 repository skipped");
	// Reading more is not a gap; leaving a repository out is.
	assert.deepEqual(choiceGaps({ ...standardChoices(), localFiles: true }), []);
	assert.deepEqual(choiceGaps(standardChoices(), ["old-site", "zz"]), ["Not scanned, as chosen: old-site, zz."]);
});

test("parses choices from a request strictly, starting from the named preset", () => {
	assert.deepEqual(parseChoices({}), standardChoices());
	assert.deepEqual(parseChoices({ preset: "quick", dependencies: false }), { ...presetChoices("quick"), preset: "custom", dependencies: false });
	assert.deepEqual(parseChoices({ history: 50 }).history, 50);
	assert.deepEqual(parseChoices({ history: "50" }).history, 50);
	assert.deepEqual(parseChoices({ skip: " a, b ,a,," }).skip, ["a", "b"]);
	assert.deepEqual(parseChoices({ skip: ["github/me/x"] }).skip, ["github/me/x"]);
	// Deep without its analysis still reads private data, so it is Custom; without both it is Standard again.
	assert.equal(parseChoices({ preset: "deep", analyse: false }).preset, "custom");
	assert.equal(parseChoices({ preset: "deep", analyse: false, privateData: false }).preset, "standard");
	assert.equal(parseChoices({ secrets: false, dependencies: false, privateData: true }).privateData, true);

	const refused: [Record<string, unknown>, RegExp][] = [
		[{ preset: "thorough" }, /Choose a preset/],
		[{ secrets: false, dependencies: false }, /at least one check/],
		[{ privateData: "yes" }, /true or false/],
		[{ secrets: "no" }, /true or false/],
		[{ history: 0 }, /History must be/],
		[{ history: 100_001 }, /History must be/],
		[{ history: "everything" }, /History must be/],
		[{ history: 1.5 }, /History must be/],
		[{ skip: 3 }, /Skip names/],
		[{ skip: ["a\nb"] }, /Skip names/],
		[{ skip: Array.from({ length: 201 }, (_, i) => `r${i}`) }, /Skip names/],
	];
	for (const [input, message] of refused) assert.throws(() => parseChoices(input), (err: unknown) => err instanceof ChoiceError && message.test(err.message), JSON.stringify(input));
});

test("the choices survive a reload: written to the address and read back the same", () => {
	const samples = [
		standardChoices(),
		presetChoices("quick"),
		presetChoices("deep"),
		{ ...standardChoices(), preset: "custom" as const, history: 200, dependencies: false, localFiles: true, skip: ["a", "github/me/b"] },
		{ ...standardChoices(), preset: "custom" as const, secrets: false, dependencies: false, privateData: true },
		{ ...presetChoices("quick"), skip: ["old"] },
	];
	for (const choices of samples) {
		const settings = choicesToParams(choices);
		const params = new URLSearchParams(Object.entries(settings).filter((entry): entry is [string, string] => entry[1] !== undefined));
		assert.deepEqual(choicesFromParams(params), choices, JSON.stringify(choices));
	}
	// Standard writes nothing, so a plain link is a Standard scan.
	assert.deepEqual(Object.values(choicesToParams(standardChoices())).filter((value) => value !== undefined), []);
	// A hand-edited or stale address still opens, with what it says that makes sense.
	assert.deepEqual(choicesFromParams(new URLSearchParams("preset=wild&history=-3&secrets=false&dependencies=false&local=yes")), standardChoices());
});

test("a finding is looked for again only where the choices reach it", () => {
	const history = { kind: "secret", source: "history" };
	const files = { kind: "secret", source: "files" };
	const local = { kind: "secret", source: "local" };
	const old = { kind: "secret" }; // a report from before sources: history alone
	const advisory = { kind: "vulnerability" };
	const quick = presetChoices("quick");
	const recent = { ...standardChoices(), history: 100 };

	assert.deepEqual([history, files, local, old, advisory].map((finding) => looksFor(standardChoices(), finding)), [true, false, false, true, true]);
	assert.deepEqual([history, files, local, old, advisory].map((finding) => looksFor(quick, finding)), [false, true, false, false, true]);
	// A window of recent commits moves with every commit, so a secret in history is never counted as gone.
	assert.deepEqual([history, files].map((finding) => looksFor(recent, finding)), [false, true]);
	assert.equal(looksFor({ ...quick, localFiles: true }, local), true);
	assert.equal(looksFor({ ...standardChoices(), secrets: false }, history), false);
	assert.equal(looksFor({ ...standardChoices(), dependencies: false }, advisory), false);
	assert.equal(looksFor(undefined, history), true);
});

test("a Quick scan is never a clean result: its report says so, and --fail-on cannot pass", () => {
	const report: ScanReport = {
		root: "/p",
		scannedAt: "2026-11-20T00:00:00.000Z",
		tools: [
			{ tool: "gitleaks", status: "ok", installHint: "" },
			{ tool: "osv-scanner", status: "missing", installHint: "brew install osv-scanner" },
		],
		repos: [{ path: "/p/app", findings: [], errors: [], unreadFiles: 2 }],
		choices: { ...presetChoices("quick"), dependencies: false },
		skipped: ["old"],
	};
	const notes = coverageNotes(report);
	assert.ok(notes.some((note) => note.startsWith("Git history was not read for secrets")));
	assert.ok(notes.includes("Not scanned, as chosen: old."));
	assert.ok(notes.includes("Dependencies were not checked: that check was switched off for this scan."));
	// The check was switched off, so osv-scanner's absence is not said a second time.
	assert.ok(!notes.some((note) => note.includes("osv-scanner is not installed")));
	assert.ok(notes.some((note) => /^2 tracked files in app were not read: larger than 50 MB/.test(note)));
	assert.equal(exitCode(report, "low"), 1);
	assert.equal(exitCode({ ...report, choices: standardChoices(), skipped: [], repos: [{ path: "/p/app", findings: [], errors: [] }], tools: report.tools.map((tool) => ({ ...tool, status: "ok" as const })) }, "low"), 0);
});

test("the command line takes the same choices, and refuses what it does not understand", () => {
	assert.deepEqual(choicesFromFlags({}), standardChoices());
	assert.deepEqual(choicesFromFlags({ preset: "quick" }), presetChoices("quick"));
	// Deep's analysis needs the interface; the scan itself is Deep's, private data included, and keeps the name.
	assert.deepEqual(choicesFromFlags({ preset: "deep" }), { ...presetChoices("deep"), analyse: false });
	assert.deepEqual(choicesFromFlags({ checks: "secrets,private-data" }), { ...standardChoices(), preset: "custom", dependencies: false, privateData: true });
	assert.deepEqual(choicesFromFlags({ checks: "dependencies", history: "20", "local-files": true, skip: ["a,b", "c"] }), {
		preset: "custom",
		secrets: false,
		dependencies: true,
		privateData: false,
		history: 20,
		localFiles: true,
		skip: ["a", "b", "c"],
		analyse: false,
	});
	assert.throws(() => choicesFromFlags({ preset: "max" }), /--preset must be one of: quick, standard, deep/);
	assert.throws(() => choicesFromFlags({ checks: "secrets,licences" }), /--checks takes secrets, dependencies and private-data/);
	assert.throws(() => choicesFromFlags({ checks: "" }), /--checks takes/);
	assert.throws(() => choicesFromFlags({ history: "lots" }), /^Error: --history must be/);
});

test("a repository with no findings is shown as clean only after a full Standard scan that left nothing out (B46)", async () => {
	const { repoIncomplete: incomplete } = await import("../ui/scan-choices.js");
	const repo = { path: "/p/app", name: "app", findings: [], errors: [] };
	const report = (choices: ScanReport["choices"], extra: object = {}) =>
		({ format: 2, root: "/p", scannedAt: "2026-11-20T00:00:00Z", tools: [{ tool: "gitleaks", status: "ok", installHint: "" }, { tool: "osv-scanner", status: "ok", installHint: "" }], repos: [{ ...repo, ...extra }], choices }) as ScanReport;
	const standard = presetChoices("standard");
	assert.equal(incomplete(report(standard) as never, repo as never), false, "Standard, nothing left out: clean");
	assert.equal(incomplete(report(presetChoices("quick")) as never, repo as never), true, "a Quick scan is never clean");
	assert.equal(incomplete(report({ ...standard, preset: "custom", history: 50 }) as never, repo as never), true, "nor one that read part of history");
	assert.equal(incomplete(report(standard) as never, { ...repo, unreadFiles: 2 } as never), true, "nor one with unread files");
	assert.equal(incomplete(report(standard) as never, { ...repo, notCovered: [{ tool: "gitleaks", message: "shallow" }] } as never), true);
	assert.equal(incomplete(report(standard) as never, { ...repo, errors: [{ tool: "osv-scanner", message: "failed" }] } as never), true);
});
