import { PORCHLIGHT_VERSION } from "../version.ts";
import { TOKENS_CSS } from "./tokens-css.ts";
import { PRESETS, presetOf, standardChoices } from "../../ui/scan-choices.js";
import type { ScanChoices } from "../repos/types.ts";

/**
 * The colour list the HTML exports share with the page (VS-11): cli/ui/tokens.css, read once and inlined,
 * so a saved report and the page use the same colours and cli/test/contrast.test.ts checks both. The
 * export still loads nothing and runs no script (invariant 11): the tokens are plain CSS in its <style>.
 */
const TOKENS = TOKENS_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

/** The declarations of the first rule for :root, the light set. */
function lightDeclarations(css: string): string {
	const start = css.indexOf("{", css.indexOf(":root"));
	const end = css.indexOf("}", start);
	return css
		.slice(start + 1, end)
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.startsWith("--") || line.startsWith("color-scheme"))
		.join(" ");
}

/**
 * Printed, an export is always light, whatever the browser's appearance (R6V-1): the light tokens are set
 * again for print, after the dark ones, and backgrounds are white.
 */
export const EXPORT_TOKENS = `${TOKENS.replace(/\s+/g, " ").trim()}
@media print { :root { ${lightDeclarations(TOKENS)} --page: #fff; --surface: #fff; } }`;

/** "2026-11-20 15:00 UTC": a time in words that do not depend on the reader's locale or zone. */
export function utcTime(iso: string): string {
	const time = new Date(iso);
	if (Number.isNaN(time.getTime())) return iso.slice(0, 16);
	return `${time.toISOString().slice(0, 10)} ${time.toISOString().slice(11, 16)} UTC`;
}

/**
 * The foot line of every export (R6V-2, R6Q-4): which Porchlight made it, what kind of scan, and when, with
 * its time zone. Porchlight's own words and figures only.
 */
export function footLine(scanKind: string, at: string): string {
	return `Porchlight ${PORCHLIGHT_VERSION} · ${scanKind} · scanned ${utcTime(at)}`;
}

/** "Standard scan", "Quick scan" or "Custom scan": what a report's choices were, for the foot line. A report without them was Standard. */
export function scanKindOf(report: { choices?: ScanChoices }): string {
	const preset = presetOf(report.choices ?? standardChoices());
	return `${PRESETS.find((candidate) => candidate.key === preset)?.label ?? "Custom"} scan`;
}
