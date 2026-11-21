/**
 * Licence risk in the SBOM (FT-6), from the licences osv-scanner already reports for each package.
 * Nothing is asked of a registry or deps.dev: a package whose lockfile names no licence is "not
 * stated", never taken for permissive (invariant 5).
 *
 * A class is a description, not a severity: whether a copyleft licence matters depends on how the
 * project is shipped, which Porchlight cannot know. So it is shown beside the package and counted for
 * each repository, and never becomes a finding, a count of findings or an exit code.
 */

export const LICENCE_CLASSES = ["permissive", "weak-copyleft", "copyleft", "network-copyleft", "source-available", "non-commercial", "unrecognised", "not-stated"] as const;
export type LicenceClass = (typeof LICENCE_CLASSES)[number];

/** In words, for the SBOM and the command line. */
export const LICENCE_WORDS: Record<LicenceClass, string> = {
	permissive: "permissive",
	"weak-copyleft": "weak copyleft (changes to the package itself are shared)",
	copyleft: "copyleft (a program that includes it is shared under the same licence)",
	"network-copyleft": "network copyleft (also applies to a service others use over a network)",
	"source-available": "source-available, not open source (limits on use)",
	"non-commercial": "non-commercial use only",
	unrecognised: "a licence Porchlight does not recognise",
	"not-stated": "not stated in the lockfile",
};

/** The classes worth a look: everything but permissive and not stated. */
export const REVIEW_CLASSES: readonly LicenceClass[] = ["weak-copyleft", "copyleft", "network-copyleft", "source-available", "non-commercial", "unrecognised"];

/** How restrictive each class is, for choosing within an expression: higher is more restrictive. */
const RANK: Record<LicenceClass, number> = {
	permissive: 0,
	"weak-copyleft": 1,
	unrecognised: 2,
	copyleft: 3,
	"network-copyleft": 4,
	"source-available": 5,
	"non-commercial": 6,
	"not-stated": -1,
};

const RULES: [RegExp, LicenceClass][] = [
	[/^(?:AGPL|SSPL|RPL|OSL)\b/i, "network-copyleft"],
	[/^(?:BUSL|BSL-1\.1|Elastic|Commons-Clause|Confluent|PolyForm-(?:Shield|Perimeter|Internal|Strict|Small-Business))/i, "source-available"],
	[/(?:-NC\b|NonCommercial|PolyForm-Noncommercial)/i, "non-commercial"],
	[/^(?:LGPL|MPL|EPL|CDDL|CPL|EUPL-1\.[01]|MS-RL|APSL|Artistic-1)/i, "weak-copyleft"],
	[/^(?:GPL|EUPL|CC-BY-SA|CECILL(?!-[BC])|Sleepycat|QPL)/i, "copyleft"],
	[
		/^(?:MIT|MIT-0|ISC|BSD|0BSD|Apache|Unlicense|CC0|Zlib|BlueOak|Python-2|PSF|BSL-1\.0|Boost|X11|NCSA|PostgreSQL|WTFPL|Artistic-2|CC-BY-[0-9]|OpenSSL|Ruby|Unicode|W3C|AFL|ZPL|curl|HPND|libpng|MIT-CMU|CECILL-[BC]|BlueOak)/i,
		"permissive",
	],
];

/** One licence id or name, as a class. */
export function classifyOne(licence: string): LicenceClass {
	const text = licence.trim().replace(/^\(+|\)+$/g, "").replace(/\+$/, "");
	if (text === "" || /^(?:NOASSERTION|NONE|UNKNOWN|SEE LICEN[CS]E IN)/i.test(text)) return "not-stated";
	// Spelled-out names, as some lockfiles give them.
	const name = text
		.replace(/^The /i, "")
		.replace(/^MIT License$/i, "MIT")
		.replace(/^Apache License,? Version 2\.0$/i, "Apache-2.0")
		.replace(/^(?:GNU )?Affero General Public License.*$/i, "AGPL")
		.replace(/^(?:GNU )?Lesser General Public License.*$/i, "LGPL")
		.replace(/^(?:GNU )?General Public License.*$/i, "GPL")
		.replace(/^Mozilla Public License.*$/i, "MPL")
		.replace(/^BSD.*License$/i, "BSD")
		.replace(/^ISC License$/i, "ISC");
	for (const [pattern, kind] of RULES) if (pattern.test(name)) return kind;
	return "unrecognised";
}

/**
 * An SPDX expression as one class: for "A OR B" the owner may choose, so the least restrictive counts;
 * for "A AND B" both apply, so the most restrictive does. "WITH" exceptions are read as their licence.
 */
export function classifyExpression(expression: string): LicenceClass {
	const ors = expression.split(/\s+OR\s+|\s*\/\s*/i).map((part) => part.trim()).filter(Boolean);
	if (ors.length === 0) return "not-stated";
	const choices = ors.map((choice) => {
		const parts = choice.split(/\s+AND\s+/i).map((part) => classifyOne(part.split(/\s+WITH\s+/i)[0]!));
		return parts.reduce((worst, kind) => (RANK[kind] > RANK[worst] ? kind : worst), parts[0]!);
	});
	return choices.reduce((best, kind) => (RANK[kind] < RANK[best] && kind !== "not-stated" ? kind : best), choices[0]!);
}

/** A package's class from its CycloneDX licences: several entries all apply, so the most restrictive counts. */
export function classifyLicences(licences: { license: { id?: string; name?: string } }[] | undefined): LicenceClass {
	if (!licences || licences.length === 0) return "not-stated";
	const kinds = licences.map((entry) => classifyExpression(entry.license.id ?? entry.license.name ?? ""));
	const stated = kinds.filter((kind) => kind !== "not-stated");
	if (stated.length === 0) return "not-stated";
	return stated.reduce((worst, kind) => (RANK[kind] > RANK[worst] ? kind : worst), stated[0]!);
}

/** How many packages of each class, in LICENCE_CLASSES order, leaving out the classes with none. */
export function licenceCounts(kinds: LicenceClass[]): Partial<Record<LicenceClass, number>> {
	const counts: Partial<Record<LicenceClass, number>> = {};
	for (const kind of LICENCE_CLASSES) {
		const count = kinds.filter((item) => item === kind).length;
		if (count > 0) counts[kind] = count;
	}
	return counts;
}

/** "12 permissive, 1 copyleft, 30 not stated". */
export function licenceSummary(counts: Partial<Record<LicenceClass, number>>): string {
	const parts = LICENCE_CLASSES.filter((kind) => counts[kind]).map((kind) => `${counts[kind]} ${kind.replace(/-/g, " ")}`);
	return parts.length > 0 ? parts.join(", ") : "no packages";
}
