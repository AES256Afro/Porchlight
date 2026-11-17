/**
 * Version ordering that is good enough to pick a fixed release across
 * ecosystems (npm, PyPI, crates, Go, gems) without a parser for each: numeric
 * parts compare by value, and a pre-release sorts before its release.
 */
export function compareVersions(a: string, b: string): number {
	const partsA = parts(a);
	const partsB = parts(b);
	for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
		const order = comparePart(partsA[i], partsB[i]);
		if (order !== 0) return order;
	}
	return 0;
}

type Part = number | string | undefined;

function parts(version: string): (number | string)[] {
	const tokens = version.toLowerCase().replace(/^v/, "").match(/\d+|[a-z]+/g) ?? [];
	return tokens.map((token) => (/^\d+$/.test(token) ? Number(token) : token));
}

/** Words that mark a release as later than the plain version; every other word marks a pre-release. */
const AFTER_RELEASE = new Set(["post", "patch", "p", "sp", "final", "ga", "release"]);
const PRE_RELEASE_ORDER = ["dev", "snapshot", "alpha", "a", "beta", "b", "pre", "preview", "rc", "c"];

function comparePart(a: Part, b: Part): number {
	if (typeof a === "number" && typeof b === "number") return Math.sign(a - b);
	if (typeof a === "string" && typeof b === "string") {
		if (a === b) return 0;
		const [rankA, rankB] = [wordRank(a), wordRank(b)];
		return rankA !== rankB ? Math.sign(rankA - rankB) : a < b ? -1 : 1;
	}
	// A number against a word, or against nothing: "1.0.1" is after "1.0.rc1", and "1.0" equals "1.0.0".
	const value = (part: Part) => (typeof part === "number" ? part + 0.5 : part === undefined ? 0.5 : AFTER_RELEASE.has(part) ? 0.75 : 0);
	return Math.sign(value(a) - value(b));
}

function wordRank(word: string): number {
	if (AFTER_RELEASE.has(word)) return PRE_RELEASE_ORDER.length + 1;
	const index = PRE_RELEASE_ORDER.indexOf(word);
	return index === -1 ? PRE_RELEASE_ORDER.length : index;
}

/** How big a jump an upgrade is, judged by the first numeric part that differs. */
export function bumpKind(from: string, to: string): "major" | "minor" | "patch" {
	const numbers = (version: string) => parts(version).filter((part) => typeof part === "number");
	const [a, b] = [numbers(from), numbers(to)];
	if ((a[0] ?? 0) !== (b[0] ?? 0)) return "major";
	if ((a[1] ?? 0) !== (b[1] ?? 0)) return "minor";
	return "patch";
}

/** The highest of `versions`, or undefined for an empty list. */
export function highestVersion(versions: string[]): string | undefined {
	return versions.reduce<string | undefined>((best, version) => (best === undefined || compareVersions(version, best) > 0 ? version : best), undefined);
}
