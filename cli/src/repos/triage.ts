import type { Severity } from "./types.ts";

/**
 * Ranks a secret finding by how likely it is to be a live credential.
 *
 * Independent signals each lower the rank by one step from high, down to low:
 * the rule only matched a generic "looks like a key" pattern, the file is
 * somewhere real credentials rarely live, and the file has never been committed. Triage only re-ranks. It never
 * drops a finding, because a real key can sit in a test file too.
 */
export function triageSecret(ruleId: string, file: string, local = false): { severity: Severity; note?: string } {
	const reasons: string[] = [];
	if (GENERIC_RULES.has(ruleId)) reasons.push("generic pattern, not a known key format");
	const place = pathContext(file);
	if (place) reasons.push(place);
	// A key in a file git does not track has not left this computer: kept there, it is not a leak.
	if (local) reasons.push("on this computer only, never committed");

	const severity = (["high", "medium", "low"] as const)[Math.min(reasons.length, 2)]!;
	return reasons.length > 0 ? { severity, note: `Ranked lower: ${reasons.join("; ")}` } : { severity };
}

/** gitleaks rules that match on shape or entropy alone, rather than a provider's key format. */
const GENERIC_RULES = new Set(["generic-api-key", "curl-auth-header", "curl-auth-user"]);

const TEST_DIRS = new Set(["test", "tests", "__tests__", "spec", "specs", "fixtures", "fixture", "__fixtures__", "mocks", "__mocks__", "testdata", "testing", "e2e"]);
const DOC_DIRS = new Set(["docs", "doc", "documentation", "examples", "example", "samples", "sample", "tutorials"]);
const GENERATED_DIRS = new Set(["node_modules", "vendor", "vendored", "third_party", "third-party", "dist", "build", "out", "target", ".next"]);
const BENCHMARK_DIRS = new Set(["bench", "benchmark", "benchmarks"]);
const DATA_DIRS = new Set(["data", "dataset", "datasets"]);
const DATA_EXTENSIONS = new Set(["json", "jsonl", "ndjson", "csv", "tsv", "txt", "xml"]);
const LOCKFILES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock", "go.sum", "npm-shrinkwrap.json"]);

/**
 * Why a path is an unlikely home for a live credential, or null if it is not.
 * Matches whole path segments and file-name conventions, never substrings, so
 * `contest/` or `latest.js` are not mistaken for tests.
 */
export function pathContext(file: string): string | null {
	const segments = file.split("/");
	const name = segments.at(-1) ?? "";
	const dirs = segments.slice(0, -1).map((segment) => segment.toLowerCase());
	const lowerName = name.toLowerCase();
	const extension = lowerName.includes(".") ? lowerName.slice(lowerName.lastIndexOf(".") + 1) : "";

	const testDir = dirs.some((dir) => TEST_DIRS.has(dir) || /[._-]tests?$/.test(dir));
	const testName =
		/(^|[._-])(test|tests|spec|specs)[._-]/i.test(name) || // foo.test.ts, test_foo.py, foo_test.go
		/[a-z0-9](Test|Tests|Spec)\.[A-Za-z0-9]+$/.test(name) || // FooTests.cs, FooTest.java
		lowerName === "conftest.py";
	if (testDir || testName) return "in a test path";

	if (
		dirs.some((dir) => GENERATED_DIRS.has(dir)) ||
		LOCKFILES.has(lowerName) ||
		extension === "lock" ||
		extension === "map" ||
		/\.min\.(js|css)$/.test(lowerName)
	) {
		return "in a generated or vendored file";
	}

	if (
		dirs.some((dir) => DOC_DIRS.has(dir)) ||
		["md", "mdx", "rst", "adoc"].includes(extension) ||
		["example", "sample", "template"].includes(extension) || // .env.example, config.sample
		lowerName.startsWith("readme")
	) {
		return "in documentation or an example";
	}

	if (dirs.some((dir) => BENCHMARK_DIRS.has(dir))) return "in benchmark output";
	if (dirs.some((dir) => DATA_DIRS.has(dir)) && DATA_EXTENSIONS.has(extension)) return "in a data file";
	return null;
}
