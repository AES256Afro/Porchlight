import assert from "node:assert/strict";
import { symlink } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { classifyExpression, classifyLicences, classifyOne, licenceCounts, licenceSummary } from "../src/repos/licences.ts";
import { confusionIn, imitates, lockedPackages, lookalikes, normalisePypi, oneEditApart, POPULAR_NPM, POPULAR_PYPI, privateScopes } from "../src/repos/lookalike.ts";
import { buildSbom, sbomAdvice, sbomLicenceReview } from "../src/repos/sbom.ts";
import { fakeRunner, makeTree, tempDir } from "./helpers.ts";

test("licences are classed from what the lockfile says, and an unstated one is never permissive (FT-6)", () => {
	assert.equal(classifyOne("MIT"), "permissive");
	assert.equal(classifyOne("Apache-2.0"), "permissive");
	assert.equal(classifyOne("BSL-1.0"), "permissive");
	assert.equal(classifyOne("BUSL-1.1"), "source-available");
	assert.equal(classifyOne("AGPL-3.0-only"), "network-copyleft");
	assert.equal(classifyOne("SSPL-1.0"), "network-copyleft");
	assert.equal(classifyOne("GPL-3.0-or-later"), "copyleft");
	assert.equal(classifyOne("LGPL-2.1"), "weak-copyleft");
	assert.equal(classifyOne("MPL-2.0"), "weak-copyleft");
	assert.equal(classifyOne("CC-BY-NC-SA-4.0"), "non-commercial");
	assert.equal(classifyOne("CC-BY-SA-4.0"), "copyleft");
	assert.equal(classifyOne("The MIT License"), "permissive");
	assert.equal(classifyOne("Some Custom Licence"), "unrecognised");
	assert.equal(classifyOne("NOASSERTION"), "not-stated");
	// A choice takes the least restrictive; both together, the most.
	assert.equal(classifyExpression("MIT OR GPL-3.0"), "permissive");
	assert.equal(classifyExpression("MIT AND GPL-3.0"), "copyleft");
	assert.equal(classifyExpression("GPL-2.0 WITH Classpath-exception-2.0"), "copyleft");
	assert.equal(classifyLicences(undefined), "not-stated");
	assert.equal(classifyLicences([{ license: { id: "MIT" } }, { license: { id: "AGPL-3.0" } }]), "network-copyleft");
	assert.equal(licenceSummary(licenceCounts(["permissive", "permissive", "copyleft", "not-stated"])), "2 permissive, 1 copyleft, 1 not stated");
});

test("names one letter from a popular package are flagged as advice, and popular names never are (FT-7)", () => {
	assert.equal(oneEditApart("express", "expres"), true);
	assert.equal(oneEditApart("express", "exrpess"), true);
	assert.equal(oneEditApart("express", "expresss"), true);
	assert.equal(oneEditApart("express", "express"), false);
	assert.equal(oneEditApart("express", "exprezz"), false);
	assert.equal(normalisePypi("Python_DateUtil"), "python-dateutil");
	assert.equal(imitates("npm", "expresss"), "express");
	assert.equal(imitates("npm", "lodahs"), "lodash");
	assert.equal(imitates("PyPI", "reqeusts"), "requests");
	// PyPI treats separators as one: the same package, not a lookalike.
	assert.equal(imitates("PyPI", "python_dateutil"), null);
	// Short names and scoped names are left alone.
	assert.equal(imitates("npm", "qs2"), null);
	assert.equal(imitates("npm", "@acme/expres"), null);
	for (const name of POPULAR_NPM) assert.equal(imitates("npm", name), null, name);
	for (const name of POPULAR_PYPI) assert.equal(imitates("PyPI", name), null, name);
	const advice = lookalikes([
		{ ecosystem: "npm", name: "expresss" },
		{ ecosystem: "npm", name: "expresss" },
		{ ecosystem: "npm", name: "express" },
	]);
	assert.equal(advice.length, 1);
	assert.equal(advice[0]!.level, "medium");
	assert.match(advice[0]!.reason, /one letter from express/);
});

test("dependency confusion is read from the repository's own files, never a registry, and no registry address is kept (FT-7)", async () => {
	const repo = await tempDir();
	const privateHost = ["npm", "secret-corp", "example"].join(".");
	await makeTree(repo, {
		".npmrc": `@acme:registry=https://${privateHost}/\n//${privateHost}/:_authToken=\${NPM_TOKEN}\n`,
		"package-lock.json": JSON.stringify({
			lockfileVersion: 3,
			packages: {
				"": { name: "shop" },
				"node_modules/@acme/billing": { resolved: "https://registry.npmjs.org/@acme/billing/-/billing-1.0.0.tgz" },
				"node_modules/@acme/ui": { resolved: `https://${privateHost}/@acme/ui/-/ui-1.0.0.tgz` },
				"node_modules/@corp-internal/auth": { resolved: "https://registry.npmjs.org/@corp-internal/auth/-/auth-2.0.0.tgz" },
				"node_modules/@types/node": { resolved: "https://registry.npmjs.org/@types/node/-/node-22.0.0.tgz" },
			},
		}),
		"requirements.txt": "--extra-index-url https://pypi.secret-corp.example/simple\nflask==3.0.0\n",
	});
	assert.deepEqual([...privateScopes(`@acme:registry=https://${privateHost}/\n@pub:registry=https://registry.npmjs.org/`)], ["@acme"]);
	assert.equal(lockedPackages("not json").length, 0);
	const { advice, unread } = await confusionIn(repo);
	assert.deepEqual(unread, []);
	assert.deepEqual(
		advice.map((item) => [item.level, item.name ?? "-"]),
		[
			["medium", "@acme/billing"],
			["low", "@corp-internal/auth"],
			["medium", "-"],
		],
	);
	const text = JSON.stringify(advice);
	assert.ok(!text.includes("secret-corp"), "no registry's address is kept");
	assert.ok(!text.includes("NPM_TOKEN"));
});

test("a link in place of a lockfile is not followed, and is said to be unread (invariant 14)", async () => {
	const repo = await tempDir();
	const outside = await tempDir();
	await makeTree(outside, { "lock.json": JSON.stringify({ packages: { "node_modules/@corp/x": { resolved: "https://registry.npmjs.org/x" } } }) });
	await symlink(join(outside, "lock.json"), join(repo, "package-lock.json"));
	const { advice, unread } = await confusionIn(repo);
	assert.deepEqual(advice, []);
	assert.deepEqual(unread, ["package-lock.json (not a plain file)"]);
});

test("the SBOM carries licence classes and advice beside the packages, and its exit code is unchanged by them", async () => {
	const root = await tempDir();
	await makeTree(root, { "shop/.git/": "", "shop/requirements.txt": "--extra-index-url https://example.invalid/simple\n" });
	const inventory = JSON.stringify({
		components: [
			{ name: "expresss", version: "1.0.0", purl: "pkg:npm/expresss@1.0.0", licenses: [{ license: { id: "MIT" } }] },
			{ name: "mongo-thing", version: "1.0.0", purl: "pkg:npm/mongo-thing@1.0.0", licenses: [{ license: { id: "SSPL-1.0" } }] },
			{ name: "plain", version: "1.0.0", purl: "pkg:npm/plain@1.0.0" },
		],
	});
	const run = fakeRunner({ "osv-scanner": (args) => (args[0] === "--version" ? { stdout: "osv-scanner version: 2.7.1\n" } : { code: 0, stdout: inventory }) });
	const sbom = await buildSbom({ root, depth: 2, run });
	const repo = sbom.components[0]!;
	assert.deepEqual(repo.properties?.find((property) => property.name === "porchlight:licences"), { name: "porchlight:licences", value: "1 permissive, 1 network copyleft, 1 not stated" });
	assert.match(repo.components.find((component) => component.name === "mongo-thing")!.properties![0]!.value, /^network-copyleft/);
	assert.match(repo.components.find((component) => component.name === "expresss")!.properties![0]!.value, /^medium: .*one letter from express/);
	assert.equal(repo.components.find((component) => component.name === "plain")!.properties, undefined);
	assert.deepEqual(sbomLicenceReview(sbom), { "network-copyleft": 1 });
	assert.deepEqual(
		sbomAdvice(sbom).map((item) => item.level),
		["medium", "medium"],
	);
	assert.equal(sbom.metadata.properties, undefined, "advice is not a gap in coverage");
});
