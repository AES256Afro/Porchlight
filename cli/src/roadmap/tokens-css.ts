import { readFileSync } from "node:fs";

/**
 * cli/ui/tokens.css as text, for the HTML exports (style.ts). Read from disk here; the demo's Worker has no
 * disk, so its build puts demo/src/tokens-css.ts, which bundles the same file, in this module's place.
 */
export const TOKENS_CSS = readFileSync(new URL("../../ui/tokens.css", import.meta.url), "utf8");
