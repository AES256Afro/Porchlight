import assert from "node:assert/strict";
import { test } from "node:test";
import { pathContext, triageSecret } from "../src/repos/triage.ts";

test("a known key format in ordinary source stays high, with no caveat", () => {
	assert.deepEqual(triageSecret("aws-access-token", "config.ini"), { severity: "high" });
	assert.deepEqual(triageSecret("private-key", "deploy/id_rsa"), { severity: "high" });
	assert.deepEqual(triageSecret("jwt", "src/lib/cesium-config.ts"), { severity: "high" });
});

test("each signal lowers the rank one step and says why", () => {
	assert.deepEqual(triageSecret("generic-api-key", "src/worker.js"), {
		severity: "medium",
		note: "Ranked lower: generic pattern, not a known key format",
	});
	assert.deepEqual(triageSecret("private-key", "server/redaction.test.mjs"), {
		severity: "medium",
		note: "Ranked lower: in a test path",
	});
	assert.deepEqual(triageSecret("generic-api-key", "tests/terminal/test_launch.py"), {
		severity: "low",
		note: "Ranked lower: generic pattern, not a known key format; in a test path",
	});
	assert.equal(triageSecret("curl-auth-header", "docs/PLATFORM.md").severity, "low");
});

test("recognises test paths by directory and by file-name convention", () => {
	for (const file of [
		"tests/unit/auth.py",
		"src/__tests__/pipeline-e2e.test.ts",
		"server/ops/cloudflare.test.mjs",
		"pkg/auth/token_test.go",
		"tests/terminal/test_launch.py",
		"tests/ITBoss.Tests/DiagnosticTextTests.cs",
		"ITBoss.Tests/Helpers.cs",
		"src/test/java/FooTest.java",
		"test/fixtures/blocklists/easylist.txt",
		"app/spec/models/user_spec.rb",
		"conftest.py",
	]) {
		assert.equal(pathContext(file), "in a test path", file);
	}
});

test("does not mistake look-alike names for tests", () => {
	for (const file of [
		"src/contest/entry.ts",
		"src/latest.js",
		"lib/requests.py",
		"src/attestation.go",
		"app/protest/handler.rb",
		"src/manifests.json",
		"src/testimonials.tsx",
		"src/inspector.ts",
		"apps/web/src/lib/demoApi.ts",
		"src/worker.js",
		".env",
		"config/production.yml",
	]) {
		assert.equal(pathContext(file), null, file);
	}
});

test("recognises documentation, examples, generated files, benchmark output and data files", () => {
	const cases: [string, string][] = [
		["docs/admin/settings.rst", "in documentation or an example"],
		["README.md", "in documentation or an example"],
		["examples/quickstart/main.py", "in documentation or an example"],
		[".env.example", "in documentation or an example"],
		["config/settings.yml.sample", "in documentation or an example"],
		["package-lock.json", "in a generated or vendored file"],
		["Cargo.lock", "in a generated or vendored file"],
		["web/dist/assets/index.js", "in a generated or vendored file"],
		["public/app.min.js", "in a generated or vendored file"],
		["vendor/github.com/x/y/key.go", "in a generated or vendored file"],
		["bench/results/exchange-rotation-ab.json", "in benchmark output"],
		["searx/data/bangs.json", "in a data file"],
	];
	for (const [file, expected] of cases) assert.equal(pathContext(file), expected, file);

	// A settings file is not data just because it sits under data/.
	assert.equal(pathContext("data/settings.yml"), null);
	// A test path wins over the other reasons.
	assert.equal(pathContext("docs/tests/sample.md"), "in a test path");
});
