// @ts-check
// The parts of the check of this computer, by the name the page and the terminal give them, and how
// a part's checks are split for showing. No DOM here: the server and the tests use it too.

/** @typedef {import("../src/host/types.ts").HostCheck} HostCheck */
/** @typedef {import("../src/host/types.ts").HostArea} HostArea */

/** @type {readonly (readonly [HostArea, string])[]} */
export const AREA_TITLES = [
	["updates", "Updates"],
	["protection", "Built-in protection"],
	["network", "Reachable from the network"],
	["credentials", "Credentials kept in files"],
	["packages", "Installed packages"],
];

/**
 * What the page and the sidebar call the computer SecurityX runs on: "This Mac" on a Mac, and
 * before the server has said what it runs on; "This computer" anywhere else.
 *
 * @param {string | undefined} platform Node's name for the system, such as "darwin" or "linux"
 */
export function hostName(platform) {
	return !platform || platform === "darwin" ? "This Mac" : "This computer";
}

/**
 * What needs attention (problems, then what could not be checked) and what passed. A check that
 * could not run is never counted as passed.
 *
 * @param {HostCheck[]} checks
 */
export function splitChecks(checks) {
	return {
		attention: checks.filter((check) => check.status !== "passed"),
		passed: checks.filter((check) => check.status === "passed"),
	};
}
