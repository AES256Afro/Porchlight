// Conventions every round of the audits found broken in new code, made into tests so they stay kept
// (docs/AUDIT-PLAN-2026-11-20.md, Stage 4 item 1, and M10's observation rule).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sources(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? sources(join(dir, entry.name)) : entry.name.endsWith(".ts") ? [join(dir, entry.name)] : []));
}

function count(pattern: RegExp): Record<string, number> {
	const found: Record<string, number> = {};
	for (const file of sources(SRC)) {
		const matches = readFileSync(file, "utf8").match(pattern)?.length ?? 0;
		if (matches > 0) found[relative(SRC, file)] = matches;
	}
	return found;
}

test("a kept file is read through readPrivateJson, which tells missing from unreadable: no new direct read (invariant 5)", () => {
	// The reads that came before the rule, each a file whose failure today reads as "nothing saved" on a
	// page and is never written back over (or is not a file Porchlight keeps). Lower a number when you
	// move one to readPrivateJson; never raise one.
	const before: Record<string, number> = {
		"analysis/analyse.ts": 1,
		"analysis/evidence.ts": 1, // a scanned repository's package.json, not a kept file
		"cloudflare/store.ts": 3,
		"discussions/discussions.ts": 1,
		"investigate/store.ts": 1,
		"main.ts": 1, // Porchlight's own package.json
		"monitor/settings.ts": 1,
		"projects/projects.ts": 1, // for reading only; changes go through readPrivateJson
		"ui/kept-files.ts": 5,
	};
	const now = count(/JSON\.parse\(await readFile\(/g);
	for (const [file, matches] of Object.entries(now)) {
		assert.ok(matches <= (before[file] ?? 0), `${file} reads a kept file directly ${matches} times (allowed ${before[file] ?? 0}): use readPrivateJson from private-files.ts, so a file that cannot be read is never taken for an empty one`);
	}
});

test("every private file is written through private-files.ts: no fixed temporary name (B21)", () => {
	const fixed = count(/\$\{process\.pid\}\.tmp/g);
	assert.deepEqual(fixed, {}, "a temporary name two writes can share loses one of them: use writePrivate or writePrivateJson");
	const writers = count(/await rename\(temporary/g);
	// github.ts moves a whole clone into place under a random name; projects.ts writes into a project
	// folder by its own rules (invariant 23). Everything else uses private-files.ts.
	assert.deepEqual(Object.keys(writers).sort(), ["github/github.ts", "private-files.ts", "projects/projects.ts"]);
});

test("the CLI and its page have no runtime dependencies: Node's own modules and their own files only (invariant 6)", () => {
	const manifest = JSON.parse(readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")) as { dependencies?: Record<string, string> };
	assert.deepEqual(Object.keys(manifest.dependencies ?? {}), [], "cli/package.json lists no dependencies");
	const roots = ["../src", "../ui", "../bin"].map((dir) => fileURLToPath(new URL(dir, import.meta.url)));
	const files = (dir: string): string[] =>
		readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? files(join(dir, entry.name)) : /\.(ts|js)$/.test(entry.name) ? [join(dir, entry.name)] : []));
	const outside: string[] = [];
	for (const file of roots.flatMap(files)) {
		const text = readFileSync(file, "utf8");
		for (const [, specifier] of text.matchAll(/^\s*(?:import|export)\b[^;'"]*?\bfrom\s+["']([^"']+)["']/gm)) {
			// A module of Node's, or a file of this package named with its extension (.ts runs through type stripping).
			if (!specifier!.startsWith("node:") && !(/^\.\.?\//.test(specifier!) && /\.(ts|js)$/.test(specifier!))) outside.push(`${relative(SRC, file)}: ${specifier}`);
		}
	}
	assert.deepEqual(outside, []);
});
