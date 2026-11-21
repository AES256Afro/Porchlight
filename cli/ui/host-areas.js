// @ts-check
// The parts of the check of this computer, by the name the page and the terminal give them, and how
// a part's checks are split for showing. No DOM here: the server and the tests use it too.

/** @typedef {import("../src/host/types.ts").HostCheck} HostCheck */
/** @typedef {import("../src/host/types.ts").HostArea} HostArea */
/** @typedef {import("../src/host/types.ts").HostCommand} HostCommand */

/** @type {readonly (readonly [HostArea, string])[]} */
export const AREA_TITLES = [
	["updates", "Updates"],
	["protection", "Built-in protection"],
	["network", "Reachable from the network"],
	["credentials", "Credentials kept in files"],
	["packages", "Installed packages"],
];

/**
 * What the page and the sidebar call the computer Porchlight runs on: "This Mac" on a Mac, and
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

/**
 * A word as a shell reads it: as it is when it holds only safe characters, otherwise in single
 * quotes. File names come from the computer, so one can hold anything.
 *
 * @param {string} word
 */
export function shellWord(word) {
	return /^[\w.@%+=:,\/-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

/**
 * An npm package at a version number, as `npm install` takes it: nothing a shell would read, and no tag
 * such as `latest`, which can cross a major version.
 */
const NPM_SPEC = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*@\d[\w.+-]*$/i;

/**
 * The repair commands of every problem, combined so they can be pasted into a terminal at once:
 * npm packages in one `npm install -g`, every other command once. In the order the checks come in.
 * Only commands safe to paste without a decision belong here (invariant 19): a package name or version
 * a shell would not take as it is, a tag that can cross a major version, and pip upgrades (which a Python
 * another tool manages refuses) never make it in; each check's own fix still says how to repair it.
 *
 * @param {HostCheck[]} checks
 * @returns {string[]}
 */
export function combinedCommands(checks) {
	/** @type {string[]} */
	const npm = [];
	/** @type {string[]} */
	const order = [];
	for (const check of checks) {
		if (check.status !== "failed") continue;
		for (const command of check.commands ?? []) {
			if (command.kind === "npm-global") {
				if (!NPM_SPEC.test(command.spec)) continue;
				if (!npm.includes(command.spec)) npm.push(command.spec);
				if (!order.includes("\0npm")) order.push("\0npm");
			} else if (command.kind === "pip") {
				// Never combined: pip refuses to change a Python another tool manages (PEP 668), so the
				// check's own fix says how to upgrade it.
				continue;
			} else if (!order.includes(command.line)) {
				order.push(command.line);
			}
		}
	}
	return order.map((entry) =>
		entry === "\0npm" ? `npm install -g ${npm.join(" ")}` : entry,
	);
}
