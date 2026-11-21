import { readFileSync } from "node:fs";

/**
 * This copy's version, from its package.json, which the Mac app and the container image carry too
 * (R6Q-4). Read once, when first imported; "unknown" when the file cannot be read.
 */
export const PORCHLIGHT_VERSION: string = (() => {
	try {
		const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown }).version;
		return typeof version === "string" ? version : "unknown";
	} catch {
		return "unknown";
	}
})();
