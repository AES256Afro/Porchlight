// FT-2: risks in GitHub Actions workflows, read from git's index as text, with no YAML library.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { run } from "../src/repos/exec.ts";
import { scanRepos } from "../src/repos/scan.ts";
import { workflowFindings, scanWorkflows } from "../src/repos/workflows.ts";
import { buildRepoRoadmap } from "../src/roadmap/repos.ts";
import { looksFor, presetChoices } from "../ui/scan-choices.js";
import { git, installed, makeTree, tempDir } from "./helpers.ts";

const NOW = () => new Date("2026-11-21T12:00:00.000Z");
const SHA = "a".repeat(40);

const PWN = `name: PR
on:
  pull_request_target:
    types: [opened]
permissions: write-all
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - uses: someone/setup-thing@v2
      - uses: someone/pinned@${SHA}
      - uses: ./local-action
      - name: Greet
        run: |
          echo "Thanks"
          echo "\${{ github.event.pull_request.title }}"
      - run: echo \${{ github.head_ref }}
      - run: echo "\${{ github.sha }} \${{ secrets.TOKEN }}"
`;

test("flags each risk where it is, and leaves pinned, local, first-party and trusted values alone (FT-2)", () => {
	const found = workflowFindings(".github/workflows/pr.yml", PWN);
	assert.deepEqual(
		found.map((finding) => [finding.ruleId, finding.location, finding.severity]),
		[
			["workflow-write-all", ".github/workflows/pr.yml:5", "medium"],
			["workflow-pr-target-checkout", ".github/workflows/pr.yml:10", "critical"],
			["workflow-unpinned-action", ".github/workflows/pr.yml:13", "medium"],
			["workflow-script-injection", ".github/workflows/pr.yml:19", "high"],
			["workflow-script-injection", ".github/workflows/pr.yml:20", "high"],
		],
	);
	assert.ok(found.every((finding) => finding.kind === "workflow" && finding.source === "files"));
	assert.equal(found.find((finding) => finding.ruleId === "workflow-unpinned-action")?.detail, "someone/setup-thing@v2");
});

test("a pull_request workflow, a checkout of the base branch, and text passed through env are not flagged (FT-2)", () => {
	const safe = `on:
  pull_request_target: # labelling only
jobs:
  label:
    permissions:
      pull-requests: write
    steps:
      - uses: actions/checkout@v4
      - uses: actions/labeler@v5
      - env:
          TITLE: \${{ github.event.pull_request.title }}
        run: echo "$TITLE"
`;
	assert.deepEqual(workflowFindings(".github/workflows/label.yml", safe), []);
	const plainPr = `on: pull_request
jobs:
  t:
    steps:
      - uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
`;
	assert.deepEqual(workflowFindings(".github/workflows/ci.yml", plainPr), [], "pull_request runs without the repository's secrets");
});

test("workflows are read from git's index, and the scan reports them with the secrets pass (FT-2)", async (t) => {
	if (!(await installed("git"))) return t.skip("git is not installed");
	const root = await tempDir();
	const repo = join(root, "app");
	await makeTree(repo, { "README.md": "app\n" });
	await mkdir(join(repo, ".github", "workflows"), { recursive: true });
	await writeFile(join(repo, ".github", "workflows", "pr.yml"), PWN);
	await writeFile(join(repo, ".github", "workflows", "notes.txt"), "permissions: write-all\n");
	await git(repo, "init", "-q");
	await git(repo, "add", "-A");
	await git(repo, "commit", "-q", "-m", "one");

	const direct = await scanWorkflows(repo, run);
	assert.equal(direct.findings.length, 5);
	assert.equal(direct.unread, 0);
	assert.ok(direct.findings.every((finding) => !finding.location.includes("notes.txt")), "only .yml and .yaml files are workflows");

	if (!(await installed("gitleaks"))) return;
	const report = await scanRepos({ root, depth: 1, now: NOW, settingFiles: async () => [], choices: { ...presetChoices("standard"), dependencies: false } });
	const workflow = report.repos[0]!.findings.filter((finding) => finding.kind === "workflow");
	assert.equal(workflow.length, 5);
	assert.equal(looksFor(report.choices, workflow[0]!), true, "a later Standard scan looks again, so a fixed workflow counts as fixed");
	assert.equal(looksFor({ ...presetChoices("standard"), secrets: false }, workflow[0]!), false);

	const roadmap = buildRepoRoadmap(report);
	const action = roadmap.phases.flatMap((phase) => phase.groups.flatMap((group) => group.actions)).find((candidate) => candidate.kind === "workflow");
	assert.equal(action?.title, "Fix the workflow .github/workflows/pr.yml");
	assert.equal(action?.priority, "critical");
	assert.equal(action?.clears.length, 5, "one repair clears every risk in the file");
	assert.ok(action?.how.some((step) => step.includes("pull_request_target")));
});
