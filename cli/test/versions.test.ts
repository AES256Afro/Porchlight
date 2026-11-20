import assert from "node:assert/strict";
import { test } from "node:test";
import { bumpKind, compareVersions, highestVersion, mayBreak } from "../src/roadmap/versions.ts";

test("orders releases numerically, not as text", () => {
	const ordered = ["0.2.4", "1.2.5", "1.2.6", "1.2.10", "1.10.0", "4.17.21", "4.18.0", "12.3.0", "12.4.1"];
	for (let i = 0; i < ordered.length - 1; i++) {
		assert.equal(compareVersions(ordered[i]!, ordered[i + 1]!), -1, `${ordered[i]} < ${ordered[i + 1]}`);
		assert.equal(compareVersions(ordered[i + 1]!, ordered[i]!), 1);
	}
});

test("treats missing parts as zero and ignores a leading v", () => {
	assert.equal(compareVersions("1.0", "1.0.0"), 0);
	assert.equal(compareVersions("v2.1.3", "2.1.3"), 0);
	assert.equal(compareVersions("1.0", "1.0.1"), -1);
});

test("puts a pre-release before its release and a post-release after", () => {
	const ordered = ["2.0.0.dev1", "2.0.0a1", "2.0.0-beta.2", "2.0.0rc1", "2.0.0-rc.2", "2.0.0", "2.0.0.post1", "2.0.1"];
	for (let i = 0; i < ordered.length - 1; i++) {
		assert.equal(compareVersions(ordered[i]!, ordered[i + 1]!), -1, `${ordered[i]} < ${ordered[i + 1]}`);
	}
});

test("names the size of an upgrade", () => {
	assert.equal(bumpKind("4.17.20", "4.17.21"), "patch");
	assert.equal(bumpKind("4.17.20", "4.18.0"), "minor");
	assert.equal(bumpKind("15.2.6", "16.0.1"), "major");
	assert.equal(bumpKind("1.2", "1.2.6"), "patch");
});

test("counts a change before 1.0 as one that may break, as npm and Cargo do", () => {
	assert.equal(mayBreak("0.4.1", "0.5.0"), true);
	assert.equal(mayBreak("0.4.1", "0.4.2"), false);
	assert.equal(mayBreak("0.0.3", "0.0.4"), true);
	assert.equal(mayBreak("0.9.0", "1.0.0"), true);
	assert.equal(mayBreak("v0.4.1", "v0.5.0"), true);
	assert.equal(mayBreak("1.2.3", "1.3.0"), false);
	assert.equal(mayBreak("1.2.3", "2.0.0"), true);
});

test("finds the highest of several versions", () => {
	assert.equal(highestVersion(["4.17.21", "4.18.0", "4.17.23"]), "4.18.0");
	assert.equal(highestVersion([]), undefined);
});
