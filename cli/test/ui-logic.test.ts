import assert from "node:assert/strict";
import { test } from "node:test";
import { describeFilter, isFiltering, matchesFilter, noFilter } from "../ui/filter.js";
import { generatedLabel, localModelSetup, MAX_QUESTION, paragraphs, questionProblem, SUGGESTED_MODEL, waitingLabel } from "../ui/generated.js";
import { domainFromInput, emptyScanHints, fetchByDefault, githubTokenSteps, monitorSetupSteps, previewAdvice } from "../ui/hints.js";
import { buildHash, filterFromParams, paginate, paramsFromFilter, parseHash, sortFindings } from "../ui/list.js";

const finding = { severity: "high", kind: "vulnerability", ruleId: "GHSA-x", location: "web/package-lock.json", detail: "pillow@12.3.0", title: "Heap overflow" };

test("the shared filter matches on severity, type, repository and text", () => {
	assert.equal(matchesFilter(finding, "shop", noFilter()), true);
	assert.equal(matchesFilter(finding, "shop", { ...noFilter(), severities: ["critical"] }), false);
	assert.equal(matchesFilter(finding, "shop", { ...noFilter(), kind: "secret" }), false);
	assert.equal(matchesFilter(finding, "shop", { ...noFilter(), repo: "other" }), false);
	assert.equal(matchesFilter(finding, "shop", { ...noFilter(), repo: "shop" }), true);
	for (const query of ["PILLOW", "ghsa-x", "package-lock", "heap", "sho", "  heap  "]) {
		assert.equal(matchesFilter(finding, "shop", { ...noFilter(), query }), true, query);
	}
	assert.equal(matchesFilter(finding, "shop", { ...noFilter(), query: "lodash" }), false);
});

test("says in words what a filter leaves out, and nothing when it leaves nothing out", () => {
	assert.equal(describeFilter(noFilter()), null);
	assert.equal(isFiltering(noFilter()), false);
	assert.equal(
		describeFilter({ severities: ["critical", "high"], kind: "secret", query: " key ", repo: "shop" }),
		'critical, high severity only; secrets only; in shop; matching "key"',
	);
	assert.equal(describeFilter({ ...noFilter(), severities: [] }), "no severity selected");
});

test("a filter survives a round trip through the address", () => {
	const filter = { severities: ["critical", "high"] as ("critical" | "high")[], kind: "secret" as const, query: "pillow & co", repo: "Kill the Camera" };
	const hash = buildHash(["findings"], { ...paramsFromFilter(filter), page: 3 });

	assert.equal(hash, "#/findings?severity=critical%2Chigh&kind=secret&q=pillow+%26+co&repo=Kill+the+Camera&page=3");
	const { path, params } = parseHash(hash);
	assert.deepEqual(path, ["findings"]);
	assert.deepEqual(filterFromParams(params), filter);
	assert.equal(params.get("page"), "3");

	assert.deepEqual(paramsFromFilter(noFilter()), {}, "no filtering leaves a clean address");
	assert.equal(buildHash(["findings", "by-repo"]), "#/findings/by-repo");
	assert.deepEqual(filterFromParams(new URLSearchParams(paramsFromFilter({ ...noFilter(), severities: [] }))).severities, []);
});

test("an address that is stale or edited by hand still opens", () => {
	assert.deepEqual(parseHash(""), { path: [], params: new URLSearchParams() });
	assert.deepEqual(parseHash("#/domains/example.com").path, ["domains", "example.com"]);
	assert.deepEqual(parseHash("#/domains/%E0%A4%A").path, ["domains", "%E0%A4%A"]);
	assert.deepEqual(filterFromParams(new URLSearchParams("severity=bogus&kind=nonsense&q=x")), { ...noFilter(), query: "x" });
});

test("pages a list and pulls an out-of-range page back in", () => {
	const items = Array.from({ length: 120 }, (_, i) => i);

	assert.deepEqual(paginate(items, 1, 50), { items: items.slice(0, 50), page: 1, pages: 3, from: 1, to: 50, total: 120 });
	assert.deepEqual(paginate(items, 3, 50), { items: items.slice(100), page: 3, pages: 3, from: 101, to: 120, total: 120 });
	assert.equal(paginate(items, 99, 50).page, 3);
	assert.equal(paginate(items, -4, 50).page, 1);
	assert.equal(paginate(items, Number.NaN, 50).page, 1);
	assert.deepEqual(paginate([], 1, 50), { items: [], page: 1, pages: 1, from: 0, to: 0, total: 0 });
});

test("sorts findings with a stable fallback", () => {
	const rows = [
		{ severity: "low", repo: "b", location: "z", title: "Zeta" },
		{ severity: "critical", repo: "b", location: "a", title: "Alpha" },
		{ severity: "critical", repo: "a", location: "m", title: "Mid" },
		{ severity: "high", repo: "a", location: "a", title: "Alpha" },
	];
	const order = (key: Parameters<typeof sortFindings>[1]) => sortFindings(rows, key).map((row) => `${row.severity[0]}${row.repo}${row.location}`);

	assert.deepEqual(order("severity"), ["cam", "cba", "haa", "lbz"]);
	assert.deepEqual(order("repo"), ["cam", "haa", "cba", "lbz"]);
	assert.deepEqual(order("title"), ["cba", "haa", "cam", "lbz"]);
	assert.equal(rows[0]!.severity, "low", "the input is not reordered");
});

test("an empty scan says where to look next, and names BoxPilot's setting only for its own folder", () => {
	const empty = { state: "failed" as const, root: "/repos", finishedAt: "2026-11-17T22:00:00Z", error: "No git repositories found under /repos", noRepositories: true, depth: 3 };
	const service = { service: true, defaultRoot: "/repos" };

	const [folder = "", depth = ""] = emptyScanHints(empty, service);
	assert.match(folder, /"Repositories to scan".*Apps → SecurityX → Settings/);
	assert.match(depth, /3 folder levels down: raise Depth/);

	// From a terminal, or a folder typed by hand, BoxPilot's setting is not what chose it.
	assert.equal(emptyScanHints(empty, { service: false, defaultRoot: "/repos" }).length, 1);
	assert.equal(emptyScanHints({ ...empty, root: "/srv/elsewhere" }, service).length, 1);
	assert.match(emptyScanHints({ ...empty, depth: 1 }, null)[0] ?? "", /1 folder level down/);
	assert.match(emptyScanHints({ ...empty, depth: 0 }, null)[0] ?? "", /Depth 0 looks only at the folder itself/);

	// A scanner failing is not an empty folder, and anything but a failure needs no help.
	assert.deepEqual(emptyScanHints({ ...empty, noRepositories: undefined, error: "gitleaks crashed" }, service), []);
	assert.deepEqual(emptyScanHints({ state: "idle" }, service), []);
});

test("generated text is split into paragraphs on blank lines, keeping single line breaks", () => {
	const text = "\n\nWhat it is: a key.\r\n\r\nHow to fix it:\n- Rotate it.\n- Move it to the environment.\n  \n\n\nDone.  \n";

	assert.deepEqual(paragraphs(text), ["What it is: a key.", "How to fix it:\n- Rotate it.\n- Move it to the environment.", "Done."]);
	assert.deepEqual(paragraphs("   \n\n  "), []);
	assert.deepEqual(paragraphs("<b>not markup</b>"), ["<b>not markup</b>"], "text stays text; the page never parses it");
});

test("generated text is labelled with the model that wrote it, and waiting says why it is slow", () => {
	assert.equal(generatedLabel("qwen-test:9b"), "Generated by qwen-test:9b. Check it against the findings.");
	assert.equal(waitingLabel("qwen-test:9b"), "Asking qwen-test:9b… this can take a few minutes without a graphics card.");
});

test("a question is checked before it is sent", () => {
	assert.equal(questionProblem("Which repository first?"), null);
	assert.equal(questionProblem("  \n "), "Write a question first.");
	assert.equal(questionProblem("x".repeat(MAX_QUESTION)), null);
	assert.equal(questionProblem("x".repeat(MAX_QUESTION + 1)), `Keep the question to ${MAX_QUESTION} characters. It has 501.`);
});

test("says how to connect a local model where SecurityX runs, quoting a setting only when it is wrong", () => {
	const off = { configured: false, error: "Set SECURITYX_LLM_URL to Ollama's address", unset: true };
	const wrong = { configured: false, error: "Set SECURITYX_LLM_MODEL to the model's name in Ollama", unset: false };

	const terminal = localModelSetup(off, false);
	assert.equal(terminal.reason, null);
	assert.match(terminal.commands ?? "", /^export SECURITYX_LLM_URL=http:\/\/localhost:11434\nexport SECURITYX_LLM_MODEL=hf\.co\/hauhaucs\/.*\nsecurityx ui$/);
	assert.equal(localModelSetup(wrong, false).reason, wrong.error);

	const service = localModelSetup(off, true);
	assert.equal(service.commands, null);
	assert.equal(service.reason, null);
	assert.ok(service.steps.some((step) => step.includes(`\`${SUGGESTED_MODEL}\``) && step.includes("Models tab")));
	assert.ok(service.steps.includes("In BoxPilot, open Apps → SecurityX → Settings and fill in Local model address and Local model."));
	assert.equal(localModelSetup(wrong, true).reason, wrong.error);
	assert.equal(localModelSetup(null, true).reason, null);
});

test("before a scan, says how many repositories it would cover, or how to get some there", () => {
	const found = previewAdvice({ root: "/home/me/Projects", exists: true, total: 2, repos: ["a", "b"], fetched: 0, depth: 3 }, { service: false });
	assert.equal(found.found, true);
	assert.equal(found.title, "2 repositories in /home/me/Projects");
	assert.equal(previewAdvice({ root: "/repos", exists: true, total: 1, repos: ["a"], fetched: 0, depth: 3 }, { service: true }).title, "1 repository on this server");

	// What was fetched from GitHub is counted with the folder, and said apart from it.
	assert.equal(previewAdvice({ root: "/p", exists: true, total: 5, repos: [], fetched: 2, depth: 3 }, { service: false }).title, "5 repositories: 3 in /p, 2 fetched from GitHub");
	assert.equal(previewAdvice({ root: "/repos", exists: true, total: 1, repos: [], fetched: 1, depth: 3 }, { service: true }).title, "1 repository fetched from GitHub");

	// On a server there are two ways to get repositories there, the easy one first.
	const server = previewAdvice({ root: "/repos", exists: true, total: 0, repos: [], fetched: 0, depth: 3 }, { service: true });
	assert.equal(server.found, false);
	assert.match(server.title, /no repositories on this server yet/);
	assert.match(server.lines[0] ?? "", /cannot see your laptop/);
	assert.equal(server.steps.length, 2);
	assert.match(server.steps[0] ?? "", /Fetch them from GitHub/);
	assert.match(server.steps[1] ?? "", /"Repositories to scan".*Apps → SecurityX → Settings/);

	// From a terminal the answer is another folder, or looking deeper; never BoxPilot.
	const local = previewAdvice({ root: "/usr/share", exists: true, total: 0, repos: [], fetched: 0, depth: 3 }, { service: false });
	assert.equal(local.title, "No git repositories in /usr/share");
	assert.deepEqual(local.steps, []);
	assert.match(local.lines.join(" "), /looked 3 folder levels down/);
	assert.doesNotMatch(local.lines.join(" "), /BoxPilot/);
	assert.equal(previewAdvice({ root: "/usr/share", exists: true, total: 0, repos: [], fetched: 0, depth: 6 }, null).lines.length, 1);
	assert.equal(previewAdvice({ root: "/nope", exists: false, total: 0, repos: [], fetched: 0, depth: 3 }, null).title, "/nope is not a folder");
});

test("setting up website checks is three steps, ending where the two values are entered", () => {
	const service = monitorSetupSteps(true);
	const local = monitorSetupSteps(false);
	assert.equal(service.length, 3);
	assert.equal(local.length, 3);
	assert.match(service[2] ?? "", /Apps → SecurityX → Settings.*"Monitor address".*"Monitor admin token"/);
	assert.doesNotMatch(local[2] ?? "", /BoxPilot/);
	assert.equal(service[0], local[0]);
});

test("a pasted web address is reduced to its domain name", () => {
	assert.equal(domainFromInput("  https://Example.com/shop?x=1#top "), "example.com");
	assert.equal(domainFromInput("http://user@example.com:8443/"), "example.com");
	assert.equal(domainFromInput("example.com."), "example.com");
	assert.equal(domainFromInput("shop.example.com"), "shop.example.com");
	// Anything else is left for the server to refuse, with its own message.
	assert.equal(domainFromInput("not a domain"), "not a domain");
});

test("adding a GitHub token is three steps, ending where it is entered, and asks for read access only", () => {
	const service = githubTokenSteps(true);
	const local = githubTokenSteps(false);
	assert.equal(service.length, 3);
	assert.match(service[1] ?? "", /"Contents" to Read-only/);
	assert.match(service[2] ?? "", /Apps → SecurityX → Settings.*"GitHub token"/);
	assert.match(local[2] ?? "", /SECURITYX_GITHUB_TOKEN/);
	assert.doesNotMatch(local[2] ?? "", /BoxPilot/);

	assert.equal(fetchByDefault({ fork: false, archived: false }), true);
	assert.equal(fetchByDefault({ fork: true, archived: false }), false);
	assert.equal(fetchByDefault({ fork: false, archived: true }), false);
});
