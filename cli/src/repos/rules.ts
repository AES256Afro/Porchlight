/**
 * The config gitleaks runs with, composed from files shipped with Porchlight and handed to gitleaks with
 * --config, so a scanned repository's own .gitleaks.toml is never loaded and cannot switch detection off
 * (invariant 14).
 *
 * - gitleaks.toml: gitleaks' built-in rules, with its global path allowlist reduced to `.git`
 *   (scripts/vendor-gitleaks-rules.mjs). Nothing a repository holds is skipped by its name (S53).
 * - gitleaks-private.toml: Porchlight's private-data rules, added when a scan looks for private data (M7).
 * - THIRD_PARTY: added only when gitleaks reads files git does not track, which include whatever a
 *   package manager installed beside the project. That code is not the repository's own, and reading
 *   all of it would take long and bury the owner's own files; describeChoices says it is left out.
 *
 * gitleaks resolves an extended config's path against the folder it runs in, so each config is written
 * out whole, into a folder only this user can open.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeTempSync } from "./temp.ts";

export const RULES_FILE = fileURLToPath(new URL("./gitleaks.toml", import.meta.url));
export const PRIVATE_RULES_FILE = fileURLToPath(new URL("./gitleaks-private.toml", import.meta.url));

/** Folders a package manager installs third-party code into, as gitleaks' own defaults name them. */
export const THIRD_PARTY = `
[[allowlists]]
description = "Third-party code installed beside a project, among files git does not track"
paths = [
    '''(?:^|/)node_modules(?:/.*)?$''',
    '''(?:^|/)bower_components(?:/.*)?$''',
    '''(?i)(?:^|/)\\.?(?:v?env|virtualenv)/lib(?:64)?(?:/.*)?$''',
    '''(?i)(?:^|/)[a-z0-9_.]+-[0-9.]+\\.dist-info(?:/.+)?$''',
    '''(?:^|/)vendor/(?:bundle|ruby)(?:/.*?)?$''',
]
`;

export interface ConfigChoice {
	/** Add Porchlight's private-data rules. */
	privateData?: boolean;
	/** Skip third-party code installed beside the project: only for files git does not track. */
	thirdParty?: boolean;
}

let folder: string | undefined;
const written = new Map<string, string>();

/** The path of a config file for this choice, written on first use (and again if a clean-up removed it). */
export function gitleaksConfig(choice: ConfigChoice = {}): string {
	const text = [readFileSync(RULES_FILE, "utf8"), choice.privateData ? readFileSync(PRIVATE_RULES_FILE, "utf8") : "", choice.thirdParty ? THIRD_PARTY : ""].join("\n");
	const name = `${createHash("sha256").update(text).digest("hex").slice(0, 16)}.toml`;
	const known = written.get(name);
	if (known !== undefined && existsSync(known)) return known;
	if (folder === undefined || !existsSync(folder)) folder = makeTempSync("rules");
	const path = join(folder, name);
	writeFileSync(path, text, { mode: 0o600 });
	written.set(name, path);
	return path;
}
