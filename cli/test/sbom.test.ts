import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { reposSbom } from "../src/main.ts";
import { buildSbom, packagesOf } from "../src/repos/sbom.ts";
import { run as realRun } from "../src/repos/exec.ts";
import { excludeArgs, outsidePlan, readsOutside } from "../src/repos/includes.ts";
import { fakeRunner, installed, makeTree, tempDir } from "./helpers.ts";

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
	// Fixed words and the exit code: osv-scanner's own last line can quote a token or a path (S49).
	assert.deepEqual(sbom.metadata.properties, [{ name: "porchlight:not-covered", value: "broken: osv-scanner could not read its lockfiles (exit code 127)" }]);
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

test("a package named by a path on this computer is left out of the SBOM (S49)", () => {
	const output = JSON.stringify({
		components: [
			{ name: "/Users/someone/src/lib", version: "0.0.0", purl: "pkg:golang//Users/someone/src/lib@0.0.0" },
			{ name: "example.com/lib", version: "1.0.0", purl: `pkg:golang/${encodeURIComponent("/home/someone/lib")}@1.0.0` },
			{ name: "github.com/home/tool", version: "2.0.0", purl: "pkg:golang/github.com/home/tool@2.0.0" },
		],
	});
	assert.deepEqual(packagesOf(output, "app").map((component) => component.name), ["github.com/home/tool"]);
});

test("a repository whose manifests would read a file outside it is not given to osv-scanner, in a scan or the SBOM (S56)", async () => {
	const root = await tempDir();
	await makeTree(root, {
		"outside/.env": "secret-token==s3cr3tvalue\n",
		"outside/pom.xml": "<project><dependencies/></project>",
		"repos/req/.git/": "",
		"repos/req/requirements.txt": "-r base.txt\nrequests==2.0.0\n",
		"repos/req/base.txt": "--requirement=../../outside/.env  # shared settings\n",
		"repos/pom/.git/": "",
		"repos/pom/pom.xml": "<project><parent><relativePath>../../outside</relativePath></parent></project>",
		"repos/ok/.git/": "",
		"repos/ok/requirements.txt": "-r sub/more.txt\n-r https://example.com/r.txt\n",
		"repos/ok/sub/more.txt": "flask==3.0.0\n",
		"repos/ok/pom.xml": "<project><parent><groupId>g</groupId></parent></project>",
	});
	const { scanDependencies } = await import("../src/repos/osv.ts");
	const asked: string[] = [];
	const run = fakeRunner({ "osv-scanner": (args) => (asked.push(args.at(-1)!), args[0] === "--version" ? { stdout: "2.7.1\n" } : { code: 128 }), git: () => ({ code: 0 }) });
	const req = await scanDependencies(join(root, "repos/req"), run);
	assert.deepEqual(req.notCovered.map((note) => note.message), [
		"dependencies were not checked, because requirements.txt would have osv-scanner read a file outside the repository (it includes ../../outside/.env, a file outside the repository): what that file holds would be sent to OSV.dev as package names",
	]);
	const pom = await scanDependencies(join(root, "repos/pom"), run);
	assert.match(pom.notCovered[0]!.message, /pom\.xml would have osv-scanner read a file outside the repository \(its parent is \.\.\/\.\.\/outside/);
	const ok = await scanDependencies(join(root, "repos/ok"), run);
	assert.deepEqual(ok.notCovered, [], "includes inside the repository, an address, and Maven's default parent are followed as before");
	assert.deepEqual(asked, [join(root, "repos/ok")], "osv-scanner was run on the repository that reads nothing outside it, and only on it");

	const sbom = await buildSbom({ root: join(root, "repos"), depth: 1, run, now: () => new Date("2026-11-20T00:00:00Z") });
	assert.deepEqual(
		sbom.metadata.properties?.map((property) => property.value.split(":")[0]),
		["pom", "req"],
	);
	assert.ok(!JSON.stringify(sbom).includes("s3cr3tvalue"));
});

test("a manifest in a subfolder that would read outside leaves out that folder alone; one at the top still skips the repository (M11)", async () => {
	const root = await tempDir();
	await makeTree(root, {
		"outside/.env": "secret-token==s3cr3tvalue\n",
		"repos/mixed/.git/": "",
		"repos/mixed/requirements.txt": "flask==3.0.0\n",
		"repos/mixed/tools/requirements.txt": "-r ../../../outside/.env\n",
		"repos/mixed/tools/deep/package-lock.json": "{}",
		// The first file reaches the second, which reaches outside: both folders are named, not only the first.
		"repos/mixed/web/a/requirements.txt": "-r ../b/requirements.txt\n",
		"repos/mixed/web/b/requirements.txt": "-r ../../../../outside/.env\n",
		"repos/mixed/other/tools/requirements.txt": "rich==13.0.0\n",
	});
	const repo = join(root, "repos/mixed");
	const outside = await readsOutside(repo);
	assert.deepEqual(outside.found.map((entry) => entry.file), ["tools/requirements.txt", "web/a/requirements.txt", "web/b/requirements.txt"]);
	assert.deepEqual(outsidePlan(outside.found), { skip: false, folders: ["tools", "web/a", "web/b"] });
	assert.deepEqual(outsidePlan([{ file: "a/requirements.txt", reason: "x" }, { file: "a/b/requirements.txt", reason: "x" }]), { skip: false, folders: ["a"] }, "a folder inside one left out goes with it");
	assert.deepEqual(outsidePlan([{ file: "a/requirements.txt", reason: "x" }, { file: "requirements.txt", reason: "x" }]), { skip: true, folders: [] });

	const { scanDependencies } = await import("../src/repos/osv.ts");
	const run = fakeRunner({
		"osv-scanner": (args) => (args[0] === "--version" ? { stdout: "2.7.1\n" } : { code: 128 }),
		git: (args) => (args.includes("ls-files") ? { stdout: ["requirements.txt", "tools/requirements.txt", "tools/deep/package-lock.json"].join("\0") } : { code: 0 }),
	});
	const result = await scanDependencies(repo, run);
	const scan = run.calls.find((call) => call[0] === "osv-scanner")!;
	assert.equal(scan.at(-1), repo, "the repository itself is scanned");
	assert.deepEqual(scan.filter((arg) => arg.startsWith("--x-exclude")), excludeArgs(repo, ["tools", "web/a", "web/b"]));
	assert.equal(result.notCovered.length, 3, result.notCovered.map((note) => note.message).join("\n"));
	assert.match(result.notCovered[1]!.message, /^a lockfile git tracks was not read \(requirements\.txt\)/, "only the lockfile outside the folders left out");
	assert.match(result.notCovered[0]!.message, /^dependencies in the folders tools, web\/a, web\/b were not checked, because tools\/requirements\.txt would have osv-scanner read a file outside the repository .*as would 2 more.*The rest of the repository was checked$/);
	assert.doesNotMatch(JSON.stringify(result.notCovered), /deep\/package-lock|s3cr3tvalue/, "a lockfile in a folder left out is not said to be hidden by .gitignore");

	const sbomRun = fakeRunner({ "osv-scanner": (args) => (args[0] === "--version" ? { stdout: "2.7.1\n" } : { code: 128 }), git: () => ({ code: 0 }) });
	const sbom = await buildSbom({ root: join(root, "repos"), depth: 1, run: sbomRun, now: () => new Date("2026-11-20T00:00:00Z") });
	assert.match(sbom.metadata.properties?.[0]?.value ?? "", /^mixed: dependencies in the folders tools, web\/a, web\/b were not checked/);
	assert.ok(sbomRun.calls.some((call) => call[1] === "scan" && call.at(-1) === repo && call.some((arg) => arg.startsWith("--x-exclude="))), "the SBOM still lists the rest");
	assert.ok(!JSON.stringify(sbom).includes("s3cr3tvalue"));
});

test("osv-scanner itself leaves out exactly the folder named, and a folder of the same name elsewhere is still read", async (t) => {
	if (!(await installed("osv-scanner"))) return t.skip("osv-scanner is not installed");
	const root = await tempDir();
	await makeTree(root, {
		"a/b (1)/requirements.txt": "requests==2.0.0\n",
		"z/a/b (1)/requirements.txt": "rich==13.0.0\n",
		"c/requirements.txt": "flask==3.0.0\n",
	});
	const { stderr } = await realRun("osv-scanner", ["scan", "source", "--recursive", "--offline", "--all-packages", "--x-disable-plugins=vulnmatch/osvlocal", "--no-resolve", ...excludeArgs(root, ["a/b (1)"]), "--format", "json", root]);
	const read = [...stderr.matchAll(/^Scanned (.+) file and found/gm)].map((match) => match[1]!.slice(root.length + 1)).sort();
	assert.deepEqual(read, ["c/requirements.txt", "z/a/b (1)/requirements.txt"]);
});
