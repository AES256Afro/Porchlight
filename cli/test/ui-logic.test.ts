import assert from "node:assert/strict";
import { test } from "node:test";
import { describeFilter, isFiltering, matchesFilter, noFilter } from "../ui/filter.js";
import { generatedLabel, localModelSetup, MAX_QUESTION, paragraphs, questionProblem, SUGGESTED_MODEL, waitingLabel } from "../ui/generated.js";
import { fixBrief, fixGroups, keyRejectedWords, offlineWords } from "../ui/hints.js";
import { approvalLine, domainFromInput, emptyScanHints, fetchByDefault, githubTokenSteps, monitorSetupSteps, ownershipSteps, permissionWords, previewAdvice, runLimits, tokenFixSteps } from "../ui/hints.js";
import { buildHash, filterFromParams, paginate, paramsFromFilter, parseHash, repoSortFromParams, repoSortParams, sortFindings } from "../ui/list.js";
import { KNOWN_PATHS, settingsAnchor, splitPaths } from "../ui/paths.js";

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

test("the By repository order survives a round trip through the address, and its default leaves it clean", () => {
	for (const sort of [
		{ key: "rank", descending: true },
		{ key: "name", descending: false },
		{ key: "name", descending: true },
		{ key: "critical", descending: true },
		{ key: "critical", descending: false },
		{ key: "secrets", descending: true },
	] as const) {
		const params = new URLSearchParams(Object.entries(repoSortParams(sort)).filter(([, value]) => value !== undefined) as [string, string][]);
		assert.deepEqual(repoSortFromParams(params), sort);
	}
	assert.deepEqual(repoSortParams({ key: "rank", descending: true }), {});
	assert.deepEqual(repoSortParams({ key: "critical", descending: true }), { sort: "critical", order: undefined });
	// Something unknown in the address falls back to worst first.
	assert.deepEqual(repoSortFromParams(new URLSearchParams("sort=password&order=sideways")), { key: "rank", descending: true });
});

test("says where to start Porchlight again, and why a key was refused, in the words for how it runs", () => {
	assert.match(offlineWords("terminal"), /porchlight ui/);
	assert.match(offlineWords("mac"), /Porchlight app/);
	assert.match(offlineWords("service"), /BoxPilot/);
	assert.doesNotMatch(offlineWords("service"), /porchlight ui/);
	assert.match(keyRejectedWords("pasted", "local"), /not accepted.*#k=/);
	assert.match(keyRejectedWords("stale", "local"), /started again/);
	assert.match(keyRejectedWords("pasted", "service"), /not accepted/);
	assert.doesNotMatch(keyRejectedWords("stale", "tailnet"), /printed/);
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
	assert.match(folder, /"Repositories to scan".*Apps → Porchlight → Settings/);
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

test("says how to connect a local model where Porchlight runs, quoting a setting only when it is wrong", () => {
	const off = { configured: false, error: "Set PORCHLIGHT_LLM_URL to Ollama's address", unset: true };
	const wrong = { configured: false, error: "Set PORCHLIGHT_LLM_MODEL to the model's name in Ollama", unset: false };

	const terminal = localModelSetup(off, false);
	assert.equal(terminal.reason, null);
	assert.equal(terminal.commands, null);
	assert.ok(terminal.steps.some((step) => step.includes("Settings → Model") && step.includes("Gemini")));
	assert.equal(localModelSetup(wrong, false).reason, wrong.error);

	const service = localModelSetup(off, true);
	assert.equal(service.commands, null);
	assert.equal(service.reason, null);
	assert.ok(service.steps.some((step) => step.includes(`\`${SUGGESTED_MODEL}\``) && step.includes("Models tab")));
	assert.ok(service.steps.includes("In BoxPilot, open Apps → Porchlight → Settings and fill in Local model address and Local model."));
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
	assert.match(server.steps[1] ?? "", /"Repositories to scan".*Apps → Porchlight → Settings/);

	// From a terminal the answer is another folder, or looking deeper; never BoxPilot.
	const local = previewAdvice({ root: "/usr/share", exists: true, total: 0, repos: [], fetched: 0, depth: 3 }, { service: false });
	assert.equal(local.title, "No git repositories in /usr/share");
	assert.deepEqual(local.steps, []);
	assert.match(local.lines.join(" "), /looked 3 folder levels down/);
	assert.doesNotMatch(local.lines.join(" "), /BoxPilot/);
	assert.equal(previewAdvice({ root: "/usr/share", exists: true, total: 0, repos: [], fetched: 0, depth: 6 }, null).lines.length, 1);
	assert.equal(previewAdvice({ root: "/nope", exists: false, total: 0, repos: [], fetched: 0, depth: 3 }, null).title, "/nope is not a folder");
});

test("setting up website checks gives every command to paste, and ends where the two values are entered", () => {
	const service = monitorSetupSteps(true);
	const local = monitorSetupSteps(false);
	assert.equal(service.length, local.length);
	// The same deploy either way; only where the address and token go differs.
	assert.deepEqual(service.slice(0, -1), local.slice(0, -1));
	assert.match(service.at(-1)?.text ?? "", /Apps → Porchlight → Settings.*"Monitor address".*"Monitor admin token"/);
	assert.match(local.at(-1)?.text ?? "", /Settings → Monitor.*No restart/);
	assert.doesNotMatch(local.at(-1)?.text ?? "", /BoxPilot/);
	// Every step before the last carries what to type, in the order the README gives it, so nobody is sent off to read it.
	const commands = local.flatMap((step) => step.commands ?? []);
	assert.ok(local.slice(0, -1).every((step) => (step.commands?.length ?? 0) > 0));
	assert.deepEqual(
		commands.filter((command) => command.startsWith("npx cf ")),
		["npx cf auth login", "npx cf d1 create --name porchlight-monitor", "npx cf d1 migrations apply <DATABASE_ID>", "npx cf deploy --secrets-file .secrets.production"],
	);
	assert.ok(commands.includes(`printf 'ADMIN_TOKEN=%s\\n' "$(openssl rand -hex 32)" > .secrets.production`));
	// A step never says to read instructions somewhere else, and no command changes anything but the monitor's own folder.
	assert.ok(local.every((step) => !/README|instructions/i.test(step.text)));
	assert.ok(commands.every((command) => !/sudo|rm |curl /.test(command)));
	assert.equal(settingsAnchor(["settings", "monitor"]), "settings-monitor");
});

test("what a run may send is listed from the server's tools, with its limits", async () => {
	const { TOOLS } = await import("../src/investigate/tools.ts");
	const lines = runLimits({ tools: TOOLS, domain: "example.com", maxTurns: 25, minGapMs: 1000 });
	// Only the tools that touch the site: a DNS lookup never needed approval.
	assert.equal(lines.length, 6);
	assert.match(lines[0] ?? "", /^Send one HTTP request .* Methods: GET, HEAD, OPTIONS\.$/);
	assert.match(lines[1] ?? "", /^Check whether one TCP port/);
	assert.ok(!lines.some((line) => /DNS-over-HTTPS/.test(line)));
	assert.match(lines[2] ?? "", /^Only to example\.com and its subdomains\./);
	assert.equal(lines[3], "At most 25 turns, and one action a second for each host.");
	assert.match(lines[4] ?? "", /ownership record is checked before every action/);
	assert.match(lines[5] ?? "", /Stop ends the run at once/);
	// Part-way through a run, what is left is what is said.
	assert.equal(runLimits({ tools: TOOLS, domain: "example.com", maxTurns: 25, minGapMs: 2500, turnsLeft: 1 })[3], "At most 1 more turn (25 in all), and one action every 2.5 seconds for each host.");

	assert.equal(approvalLine({}), "Each HTTP request and TCP connection waits for your approval.");
	assert.equal(approvalLine({ approvedRest: { turn: 0 } }), "You approved every request of this run when it started.");
	assert.equal(approvalLine({ approvedRest: { turn: 7 } }), "You approved every request of this run from turn 7 on.");
});

test("a refused permission comes with where to add it, in Cloudflare's own words", () => {
	assert.equal(permissionWords({ name: "Zone Settings Write" }), "Zone, Zone Settings, Edit");
	assert.equal(permissionWords({ name: "DNS Write", scope: "Zone" }), "Zone, DNS, Edit");
	assert.equal(permissionWords({ name: "Zone WAF Read", scope: "Zone" }), "Zone, Zone WAF, Read");
	assert.equal(permissionWords({ name: "API Tokens Read", scope: "User" }), "User, API Tokens, Read");
	assert.equal(permissionWords({ name: "Account Settings Read", scope: "Account" }), "Account, Account Settings, Read");
	assert.deepEqual(tokenFixSteps([], "change"), []);

	const change = tokenFixSteps([{ name: "Zone Settings Write" }, { name: "DNS Write" }], "change");
	assert.equal(change.length, 3);
	// The first step is a known path, so the page links each part of it to Cloudflare's dashboard.
	const path = splitPaths(change[0] ?? "").find((part) => typeof part !== "string");
	assert.ok(path && typeof path !== "string" && path.crumbs.at(-1)?.href === "https://dash.cloudflare.com/profile/api-tokens");
	assert.match(change[1] ?? "", /"Zone, Zone Settings, Edit" and "Zone, DNS, Edit"/);
	// Editing a token keeps it, so nobody is told to paste it again.
	assert.match(change[2] ?? "", /nothing to paste again.*Fix these again/);
	assert.match(tokenFixSteps([{ name: "Bot Management Read", scope: "Zone" }], "read")[2] ?? "", /Audit again/);
	// Only what is named, never everything; and the one permission Cloudflare may not offer is said to be optional.
	assert.match(change[1] ?? "", /Search for permission groups.*Tick only these/);
	assert.doesNotMatch(change[1] ?? "", /does not offer/);
	assert.match(tokenFixSteps([{ name: "API Tokens Read", scope: "User" }], "read")[1] ?? "", /"User, API Tokens, Read".*does not offer "API Tokens" to every token.*leave it/);

	const here = ownershipSteps({ domain: "example.com", onCloudflare: true });
	assert.match(here[0] ?? "", /copy the Name and the Value shown for example\.com/);
	assert.match(here[1] ?? "", /Cloudflare → DNS → Records.*Fix these includes the record once your token has DNS Edit/);
	assert.match(here[2] ?? "", /Check DNS record/);
	assert.doesNotMatch(ownershipSteps({ domain: "example.com", onCloudflare: false })[1] ?? "", /Cloudflare/);
});

test("what is left is gathered by fix, worst and most widespread first, and the brief carries only what the page shows", () => {
	const check = (id: string, severity: string, status = "failed", change?: string) => ({ id, title: `Title of ${id}`, severity, status, why: `Why ${id}`, fix: [`Do ${id}`], api: `PATCH ${id}`, ...(change ? { change } : {}) });
	const groups = fixGroups([
		{ name: "a.example", checks: [check("hsts", "medium"), check("spf", "low"), check("tls", "medium", "passed")] },
		{ name: "b.example", checks: [check("hsts", "medium"), check("origin", "high"), check("https", "medium", "failed", "always-use-https")] },
		{ name: "c.example", checks: [check("spf", "high"), check("waf", "low", "unknown")] },
	]);
	// A kind of problem is as bad as its worst case; passed and unknown checks are not problems.
	assert.deepEqual(
		groups.map((group) => [group.id, group.severity, group.zones, group.fixable]),
		[
			["spf", "high", ["a.example", "c.example"], 0],
			["origin", "high", ["b.example"], 0],
			["hsts", "medium", ["a.example", "b.example"], 0],
			["https", "medium", ["b.example"], 1],
		],
	);
	const brief = fixBrief(groups, "Nov 20, 2026");
	assert.match(brief, /^These are the problems Porchlight's audit of my Cloudflare account found/);
	assert.match(brief, /Before each change, tell me the exact change and wait for my yes/);
	assert.match(brief, /1\. Title of spf \(high\), 2 domains\n {3}Domains: a\.example, c\.example\n {3}Why it matters: Why spf\n {3}Fix: Do spf\n {3}Cloudflare API: PATCH spf/);
	assert.deepEqual(fixGroups([]), []);
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
	assert.match(service[2] ?? "", /Apps → Porchlight → Settings.*"GitHub token"/);
	assert.match(local[2] ?? "", /PORCHLIGHT_GITHUB_TOKEN/);
	// The Mac app reads its settings file, not the terminal's environment.
	assert.match(local[2] ?? "", /~\/\.porchlight\/app\.env/);
	assert.doesNotMatch(local[2] ?? "", /BoxPilot/);
	// The GitHub path is one known path, every step a link to github.com.
	const github = splitPaths(local[0] ?? "").find((part) => typeof part !== "string");
	assert.ok(github && typeof github !== "string");
	assert.equal(github.kind, "web");
	assert.ok(github.crumbs.every((crumb) => crumb.href?.startsWith("https://github.com/settings/")));

	assert.equal(fetchByDefault({ fork: false, archived: false }), true);
	assert.equal(fetchByDefault({ fork: true, archived: false }), false);
	assert.equal(fetchByDefault({ fork: false, archived: true }), false);
});

test("click paths become breadcrumbs; other arrows stay text", () => {
	const parts = splitPaths("Turn it on in System Settings → Network → Firewall → Options → Enable stealth mode.");
	assert.equal(parts.length, 3);
	assert.equal(parts[0], "Turn it on in ");
	const path = parts[1];
	assert.ok(path && typeof path !== "string");
	assert.equal(path.text, "System Settings → Network → Firewall → Options → Enable stealth mode");
	assert.equal(path.kind, "mac");
	assert.deepEqual(
		path.crumbs.map((crumb) => crumb.href !== null),
		[true, true, false, false, false],
	);
	assert.equal(parts[2], ".");

	// Versions and other arrows are left alone.
	assert.deepEqual(splitPaths("lodash 4.17.20 → 4.17.21"), ["lodash 4.17.20 → 4.17.21"]);
	// Porchlight's own Settings, by section.
	const model = splitPaths("Choose one in Settings → Model").at(-1);
	assert.ok(model && typeof model !== "string");
	assert.deepEqual(model.crumbs.map((crumb) => crumb.href), ["#/settings", "#/settings/model"]);
	assert.equal(settingsAnchor(["settings", "model"]), "settings-model");
	assert.equal(settingsAnchor(["settings", "nowhere"]), null);
	assert.equal(settingsAnchor(["findings", "model"]), null);
	// A path Porchlight has no address for is still breadcrumbs, with no links.
	const boxpilot = splitPaths("In BoxPilot, open Apps → Porchlight → Settings.")[1];
	assert.ok(boxpilot && typeof boxpilot !== "string");
	assert.ok(boxpilot.crumbs.every((crumb) => crumb.href === null));

	// Every address is fixed: Porchlight's own page, GitHub's settings, or a System Settings pane.
	for (const known of KNOWN_PATHS) {
		for (const crumb of known.crumbs) {
			if (crumb.href === null) continue;
			const allowed = {
				page: /^#\/settings(\/[a-z]+)?$/,
				web: /^https:\/\/(github\.com\/settings\/|dash\.cloudflare\.com\/(\?to=\/:account\/[a-z:/-]+|profile(\/api-tokens)?)?$)/,
				mac: /^x-apple\.systempreferences:(com\.apple\.[\w.-]+)?$/,
				plain: /^$/,
			}[known.kind];
			assert.match(crumb.href, allowed, `${known.text}: ${crumb.href}`);
		}
	}
});

test("every click path the page, the host check or the Cloudflare audit writes is a known path", async () => {
	const { readFile, readdir } = await import("node:fs/promises");
	const files = [
		...(await readdir(new URL("../ui/", import.meta.url))).filter((name) => name.endsWith(".js") && name !== "paths.js").map((name) => new URL(`../ui/${name}`, import.meta.url)),
		...(await readdir(new URL("../src/host/", import.meta.url))).filter((name) => name.endsWith(".ts")).map((name) => new URL(`../src/host/${name}`, import.meta.url)),
		...(await readdir(new URL("../src/cloudflare/", import.meta.url))).filter((name) => name.endsWith(".ts")).map((name) => new URL(`../src/cloudflare/${name}`, import.meta.url)),
	];
	const starts = /(?:System Settings|Settings|Apps|Cloudflare) → /g;
	for (const file of files) {
		const text = await readFile(file, "utf8");
		for (const line of text.split("\n")) {
			if (/^\s*(\/\/|\*|\/\*)/.test(line)) continue;
			for (const match of line.matchAll(starts)) {
				const rest = line.slice(match.index);
				if (/^(System )?Settings → \$\{/.test(rest)) continue; // filled in below
				if (match[0] === "Settings → " && line.slice(0, match.index).endsWith("System ")) continue;
				assert.ok(
					KNOWN_PATHS.some((known) => rest.startsWith(known.text)),
					`${file.pathname.split("/").slice(-2).join("/")}: no known path for "${rest.slice(0, 80)}"`,
				);
			}
		}
		// The Sharing services in network.ts are named as "System Settings → <setting>".
		for (const [, setting] of text.matchAll(/setting: "([^"]+)"/g)) {
			const parts = splitPaths(`System Settings → ${setting}.`);
			assert.ok(typeof parts[0] !== "string", `no known path for System Settings → ${setting}`);
		}
	}
});
