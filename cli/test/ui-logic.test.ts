import assert from "node:assert/strict";
import { test } from "node:test";
import { describeFilter, isFiltering, matchesFilter, noFilter } from "../ui/filter.js";
import { emptyScanHints } from "../ui/hints.js";
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
