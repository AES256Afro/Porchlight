import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { reposSbom } from "../src/main.ts";
import { buildSbom, packagesOf } from "../src/repos/sbom.ts";
import { fakeRunner, makeTree, tempDir } from "./helpers.ts";

const inventory = (components: unknown[]) => JSON.stringify({ bomFormat: "CycloneDX", specVersion: "1.5", components });

test("keeps only what a bill of materials needs: no file path from this computer, each package once", () => {
	const packages = packagesOf(
		`Scanning...\n${inventory([
			{ name: "minimist", version: "1.2.5", purl: "pkg:npm/minimist@1.2.5", evidence: { occurrences: [{ location: "/Users/someone/work/shop/package-lock.json" }] }, properties: [{ name: "x", value: "/home/someone" }] },
			{ name: "minimist", version: "1.2.5", purl: "pkg:npm/minimist@1.2.5" },
			{ name: "lodash", version: "4.17.21", purl: "pkg:npm/lodash@4.17.21", licenses: [{ license: { id: "MIT" } }, { license: { id: "not an id!" } }, { license: { name: "Custom licence" } }] },
			{ name: "", version: "1" },
			"not an object",
		])}`,
		"shop",
	);
	assert.deepEqual(packages, [
		{ "bom-ref": "shop:pkg:npm/lodash@4.17.21", type: "library", name: "lodash", version: "4.17.21", purl: "pkg:npm/lodash@4.17.21", licenses: [{ license: { id: "MIT" } }, { license: { name: "Custom licence" } }] },
		{ "bom-ref": "shop:pkg:npm/minimist@1.2.5", type: "library", name: "minimist", version: "1.2.5", purl: "pkg:npm/minimist@1.2.5" },
	]);
	assert.ok(!JSON.stringify(packages).includes("/Users/") && !JSON.stringify(packages).includes("/home/"));
});

test("reads every repository offline, with nothing matched against a database, and names one it could not read", async () => {
	const root = await tempDir();
	await makeTree(root, { "shop/.git/": "", "api/.git/": "", "broken/.git/": "" });
	const run = fakeRunner({
		"osv-scanner": (args) => {
			if (args[0] === "--version") return { stdout: "osv-scanner version: 2.7.1\n" };
			const repo = args.at(-1)!;
			if (repo.endsWith("broken")) return { code: 127, stderr: "scanning...\nError: could not read lockfile" };
			if (repo.endsWith("api")) return { code: 128, stderr: "No package sources found" };
			return { code: 0, stdout: inventory([{ name: "minimist", version: "1.2.5", purl: "pkg:npm/minimist@1.2.5" }]) };
		},
	});

	const sbom = await buildSbom({ root, depth: 2, run, now: () => new Date("2026-11-20T12:00:00Z") });

	for (const call of run.calls.filter((args) => args[1] === "scan")) {
		assert.ok(call.includes("--offline") && call.includes("--x-disable-plugins=vulnmatch/osvlocal") && call.includes("--all-packages"), call.join(" "));
	}
	assert.deepEqual([sbom.bomFormat, sbom.specVersion, sbom.metadata.timestamp], ["CycloneDX", "1.5", "2026-11-20T12:00:00.000Z"]);
	assert.deepEqual(sbom.components.map((repo) => [repo.name, repo.components.length]), [["api", 0], ["shop", 1]]);
	assert.deepEqual(sbom.metadata.properties, [{ name: "porchlight:not-covered", value: "broken: Error: could not read lockfile" }]);
	assert.ok(!JSON.stringify(sbom).includes(root), "the folder's path is not in it");

	// The command exits 1 when the SBOM is incomplete, and prints it all the same.
	let printed = "";
	assert.equal(await reposSbom([root, "--depth", "2"], { run, write: (text) => void (printed += text) }), 1);
	assert.equal(JSON.parse(printed).components.length, 2);
});

test("says so when osv-scanner is missing, or too old to list packages without a database", async () => {
	const root = await tempDir();
	await makeTree(root, { "shop/.git/": "" });
	await assert.rejects(buildSbom({ root, depth: 1, run: fakeRunner({ "osv-scanner": "missing" }) }), /osv-scanner is not installed/);
	const old = fakeRunner({ "osv-scanner": (args) => (args[0] === "--version" ? { stdout: "1.9.0\n" } : { code: 127, stderr: "flag provided but not defined: -x-disable-plugins" }) });
	await assert.rejects(buildSbom({ root, depth: 1, run: old }), /\(1\.9\.0\) cannot list packages without a vulnerability database/);
	const empty = join(root, "nothing-here");
	await makeTree(empty, { "notes.txt": "x" });
	await assert.rejects(buildSbom({ root: empty, depth: 2, run: fakeRunner({ "osv-scanner": () => ({ stdout: "2.7.1" }) }) }), /No git repositories/);
});
