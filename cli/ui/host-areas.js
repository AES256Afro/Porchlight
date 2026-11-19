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

/**
 * A word as a shell reads it: as it is when it holds only safe characters, otherwise in single
 * quotes. File names come from the computer, so one can hold anything.
 *
 * @param {string} word
 */
export function shellWord(word) {
	return /^[\w.@%+=:,\/-]+$/.test(word) ? word : `'${word.replace(/'/g, "'\\''")}'`;
}

/** An npm package and version or tag, as `npm install` takes it: nothing a shell would read. */
const NPM_SPEC = /^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*@[\w.+-]+$/i;
/** A Python requirement such as `requests>=2.31.0`, or a name alone. */
const PIP_SPEC = /^[\w.-]+(>=[\w.+!-]+)?$/;

/**
 * The repair commands of every problem, combined so they can be pasted into a terminal at once:
 * npm packages in one `npm install -g`, Python packages in one `pip install`, every other command
 * once. In the order the checks come in. A package name that is not one a shell would take as it
 * is never makes it into the list; its own check still says how to repair it.
 *
 * @param {HostCheck[]} checks
 * @returns {string[]}
 */
export function combinedCommands(checks) {
	/** @type {string[]} */
	const npm = [];
	/** @type {string[]} */
	const pip = [];
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
				if (!PIP_SPEC.test(command.spec)) continue;
				if (!pip.includes(command.spec)) pip.push(command.spec);
				if (!order.includes("\0pip")) order.push("\0pip");
			} else if (!order.includes(command.line)) {
				order.push(command.line);
			}
		}
	}
	return order.map((entry) =>
		entry === "\0npm" ? `npm install -g ${npm.join(" ")}` : entry === "\0pip" ? `python3 -m pip install --upgrade ${pip.map((spec) => `"${spec}"`).join(" ")}` : entry,
	);
}
