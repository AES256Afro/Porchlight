// @ts-check
// What a repository scan is asked to look at: the presets, the switches under them, and the words
// for each. Shared by the page, the server and the command line, so the scan form, the report, the
// "Not covered" notes and the comparison with an earlier scan all describe a scan the same way.
// No DOM here, so it is tested directly.

/** @typedef {import("../src/repos/types.ts").ScanChoices} ScanChoices */
/** @typedef {import("../src/repos/types.ts").HistoryReach} HistoryReach */
/** @typedef {"quick" | "standard" | "deep"} Preset */

/** The most commits "the last N commits" may name. */
export const MAX_HISTORY_COMMITS = 100_000;
/** The most repositories a scan may be told to skip. */
export const MAX_SKIPPED = 200;

/** @type {readonly { key: Preset, label: string, words: string }[]} */
export const PRESETS = [
	{
		key: "quick",
		label: "Quick",
		words: "Secrets in the files as they are now, and dependencies. Git history is not read, so a secret removed in an earlier commit is not looked for.",
	},
	{ key: "standard", label: "Standard", words: "Secrets in every commit on every branch, and dependencies." },
	{
		key: "deep",
		label: "Deep",
		words: "As Standard, plus private data committed to the repositories: contact details, ID and account numbers, locations, data dumps and personal documents. Then the model's deeper analysis of the critical and high findings starts on its own.",
	},
];

/** @param {unknown} value @returns {value is Preset} */
export function isPreset(value) {
	return PRESETS.some((preset) => preset.key === value);
}

/** The choices a preset stands for. Files git does not track and skipped repositories are separate switches, off in every preset. @param {Preset} preset @returns {ScanChoices} */
export function presetChoices(preset) {
	return {
		preset,
		secrets: true,
		dependencies: true,
		privateData: preset === "deep",
		history: preset === "quick" ? "none" : "all",
		localFiles: false,
		skip: [],
		analyse: preset === "deep",
	};
}

/** What a report without choices covered: everything a scan looked at before there were choices. */
export function standardChoices() {
	return presetChoices("standard");
}

/**
 * The preset these choices match, or "custom". Files git does not track and skipped repositories
 * are said separately, so they do not turn a preset into "custom".
 *
 * @param {Omit<ScanChoices, "preset">} choices
 * @returns {ScanChoices["preset"]}
 */
export function presetOf(choices) {
	for (const { key } of PRESETS) {
		const preset = presetChoices(key);
		if (
			preset.secrets === choices.secrets &&
			preset.dependencies === choices.dependencies &&
			preset.privateData === choices.privateData &&
			preset.history === choices.history &&
			preset.analyse === choices.analyse
		) {
			return key;
		}
	}
	return "custom";
}

export class ChoiceError extends Error {}

/**
 * Choices from a request or the command line: a preset to start from (standard when none is named),
 * and any switch given changes it. Anything not understood is refused, never guessed at.
 *
 * @param {Record<string, unknown>} input
 * @returns {ScanChoices}
 */
export function parseChoices(input) {
	const preset = input.preset ?? "standard";
	if (preset !== "custom" && !isPreset(preset)) throw new ChoiceError(`Choose a preset: ${PRESETS.map((entry) => entry.key).join(", ")}`);
	const base = presetChoices(preset === "custom" ? "standard" : preset);
	/** @param {string} name @param {boolean} fallback */
	const flag = (name, fallback) => {
		const value = input[name];
		if (value === undefined) return fallback;
		if (typeof value !== "boolean") throw new ChoiceError(`${name} must be true or false`);
		return value;
	};
	const secrets = flag("secrets", base.secrets);
	const dependencies = flag("dependencies", base.dependencies);
	const privateData = flag("privateData", base.privateData);
	if (!secrets && !dependencies && !privateData) throw new ChoiceError("Choose at least one check: secrets, dependencies or private data");
	const history = input.history === undefined ? base.history : parseHistory(input.history);
	if (history === null) throw new ChoiceError(`History must be all, none, or a number of commits from 1 to ${MAX_HISTORY_COMMITS.toLocaleString("en")}`);
	const skip = input.skip === undefined ? [] : parseSkip(input.skip);
	if (skip === null) throw new ChoiceError(`Skip names repositories: up to ${MAX_SKIPPED}, each a name as the page lists it`);
	const choices = { secrets, dependencies, privateData, history, localFiles: flag("localFiles", base.localFiles), skip, analyse: flag("analyse", base.analyse) };
	return { preset: presetOf(choices), ...choices };
}

/** @param {unknown} value @returns {HistoryReach | null} */
export function parseHistory(value) {
	if (value === "all" || value === "none") return value;
	const number = typeof value === "number" ? value : typeof value === "string" && /^\d{1,6}$/.test(value) ? Number(value) : NaN;
	return Number.isInteger(number) && number >= 1 && number <= MAX_HISTORY_COMMITS ? number : null;
}

/**
 * Repository names to skip: compared with the names a scan gives the repositories it finds, never
 * used as a path. A list, or one string with names separated by commas.
 *
 * @param {unknown} value
 * @returns {string[] | null}
 */
export function parseSkip(value) {
	const names = typeof value === "string" ? value.split(",") : Array.isArray(value) ? value : null;
	if (!names || !names.every((name) => typeof name === "string")) return null;
	const trimmed = [...new Set(names.map((name) => name.trim()).filter((name) => name !== ""))];
	// eslint-disable-next-line no-control-regex
	if (trimmed.length > MAX_SKIPPED || trimmed.some((name) => name.length > 300 || /[\u0000-\u001f\u007f]/.test(name))) return null;
	return trimmed;
}

/**
 * The choices as address settings, for `buildHash`. Only what differs from Standard is written, so
 * an address without settings is a Standard scan.
 *
 * @param {ScanChoices} choices
 * @returns {Record<string, string | undefined>}
 */
export function choicesToParams(choices) {
	const preset = presetOf(choices);
	const base = presetChoices(preset === "custom" ? "standard" : preset);
	return {
		preset: preset === "standard" ? undefined : preset,
		secrets: choices.secrets === base.secrets ? undefined : String(choices.secrets),
		dependencies: choices.dependencies === base.dependencies ? undefined : String(choices.dependencies),
		private: choices.privateData === base.privateData ? undefined : String(choices.privateData),
		history: choices.history === base.history ? undefined : String(choices.history),
		analyse: choices.analyse === base.analyse ? undefined : String(choices.analyse),
		local: choices.localFiles ? "true" : undefined,
		skip: choices.skip.length > 0 ? choices.skip.join(",") : undefined,
	};
}

/**
 * The choices an address describes. A setting that is not understood is left out rather than
 * refused, so a stale or hand-edited link still opens.
 *
 * @param {URLSearchParams} params
 * @returns {ScanChoices}
 */
export function choicesFromParams(params) {
	const preset = params.get("preset");
	const choices = presetChoices(isPreset(preset) ? preset : "standard");
	/** @param {string} name */
	const flag = (name) => (params.get(name) === "true" ? true : params.get(name) === "false" ? false : undefined);
	const secrets = flag("secrets") ?? choices.secrets;
	const dependencies = flag("dependencies") ?? choices.dependencies;
	const privateData = flag("private") ?? choices.privateData;
	// An address that switches every check off asks for nothing: they stay as the preset has them.
	if (secrets || dependencies || privateData) Object.assign(choices, { secrets, dependencies, privateData });
	const history = parseHistory(params.get("history"));
	if (history !== null) choices.history = history;
	const analyse = flag("analyse");
	if (analyse !== undefined) choices.analyse = analyse;
	choices.localFiles = flag("local") === true;
	choices.skip = parseSkip(params.get("skip") ?? "") ?? [];
	choices.preset = presetOf(choices);
	return choices;
}

/** "every commit", "the last 200 commits", "no history". @param {HistoryReach} history */
export function historyWords(history) {
	if (history === "all") return "every commit on every branch";
	if (history === "none") return "the files as they are now, no history";
	return `the last ${history === 1 ? "commit" : `${history.toLocaleString("en")} commits`} and the files as they are now`;
}

/**
 * One line on what a scan looked at, for the report, the Overview and the command line.
 *
 * @param {ScanChoices | undefined} choices
 */
export function describeChoices(choices = standardChoices()) {
	const label = choices.preset === "custom" ? "Custom" : (PRESETS.find((preset) => preset.key === choices.preset)?.label ?? "Custom");
	const parts = [choices.secrets ? `secrets in ${historyWords(choices.history)}` : "no secrets check", choices.dependencies ? "dependencies" : "no dependencies check"];
	if (choices.privateData) parts.push(choices.secrets ? "private data" : `private data in ${historyWords(choices.history)}`);
	// Third-party code a package manager installed is not read among them (cli/src/repos/rules.ts).
	if ((choices.secrets || choices.privateData) && choices.localFiles) parts.push("files git does not track (not node_modules or virtual environments)");
	if (choices.skip.length > 0) parts.push(`${choices.skip.length === 1 ? "1 repository" : `${choices.skip.length} repositories`} skipped`);
	if (choices.analyse) parts.push("then the model's deeper analysis");
	return `${label}: ${parts.join(", ")}`;
}

/**
 * What a scan with these choices did not cover, for the "Not covered" notes. Files git does not
 * track are not a gap: no preset reads them, and nothing found there has left this computer.
 *
 * @param {ScanChoices | undefined} choices
 * @param {string[]} [skipped] the repositories the scan found and left out
 * @returns {string[]}
 */
export function choiceGaps(choices = standardChoices(), skipped = []) {
	const gaps = [];
	if (!choices.secrets) gaps.push("Secrets were not checked: that check was switched off for this scan.");
	if (!choices.dependencies) gaps.push("Dependencies were not checked: that check was switched off for this scan.");
	const what = [choices.secrets ? "secrets" : null, choices.privateData ? "private data" : null].filter((part) => part !== null).join(" or ");
	if (what && choices.history === "none") {
		gaps.push(`Git history was not read for ${what}, only the files as they are now: anything removed in an earlier commit is still in history and was not looked for.`);
	}
	if (what && typeof choices.history === "number") {
		gaps.push(`Only the last ${choices.history === 1 ? "commit" : `${choices.history.toLocaleString("en")} commits`} and the files as they are now were read for ${what}: older commits were not.`);
	}
	if (skipped.length > 0) gaps.push(`Not scanned, as chosen: ${skipped.join(", ")}.`);
	return gaps;
}

/**
 * Whether anything was left out of a repository's scan: a scanner that failed on it or is not
 * installed, something a scanner could not cover, files not read, or a scan that chose to read less
 * than Standard. Such a repository with no findings is never shown as clean (B46).
 *
 * @param {{ tools?: { status: string }[], choices?: ScanChoices }} report
 * @param {{ errors: unknown[], notCovered?: unknown[], unreadFiles?: number }} repo
 */
export function repoIncomplete(report, repo) {
	return (
		repo.errors.length > 0 ||
		(report.tools ?? []).some((tool) => tool.status === "missing") ||
		(repo.notCovered?.length ?? 0) > 0 ||
		(repo.unreadFiles ?? 0) > 0 ||
		choiceGaps(report.choices).length > 0
	);
}

/**
 * Where a secret or private data was found. Older reports read history alone and did not say.
 *
 * @param {{ kind: string, source?: string }} finding
 * @returns {"history" | "files" | "local"}
 */
export function secretSource(finding) {
	return finding.source === "files" || finding.source === "local" ? finding.source : "history";
}

/**
 * Whether a scan with these choices looks for this finding at all, so that not finding it again
 * means something. A finding counts as fixed only where the later scan looked for it, and as new
 * only where the earlier one had (invariants 5 and 17).
 *
 * @param {ScanChoices | undefined} choices
 * @param {{ kind: string, source?: string }} finding
 */
export function looksFor(choices = standardChoices(), finding) {
	if (finding.kind === "vulnerability") return choices.dependencies;
	// Workflows are read as git's index holds them, in every scan that looks for secrets (FT-2).
	if (finding.kind === "workflow") return choices.secrets;
	// Reports from before private data was looked for have no such switch: off.
	if (!(finding.kind === "private-data" ? choices.privateData === true : choices.secrets)) return false;
	const source = secretSource(finding);
	// A window of recent commits moves with every commit: a secret outside it now was not looked for.
	if (source === "history") return choices.history === "all";
	if (source === "files") return choices.history !== "all";
	return choices.localFiles;
}

/** The settings of the scan form an address can carry. */
const CHOICE_PARAMS = ["preset", "secrets", "dependencies", "private", "history", "analyse", "local", "skip"];

/**
 * What the scan form starts with: the choices the address names, or, when it names none (the
 * sidebar's plain link), the ones the last scan used, so "Check again" checks what was checked before
 * rather than falling back to Standard (B42). A carried-over Deep keeps its analysis: the form then
 * opens its Options, where what that sends is said, before Check is pressed.
 *
 * @param {URLSearchParams} params
 * @param {ScanChoices | undefined} last the last report's choices, if it has any
 * @returns {ScanChoices}
 */
export function startingChoices(params, last) {
	if (!last || CHOICE_PARAMS.some((name) => params.has(name))) return choicesFromParams(params);
	return { ...last, skip: [...last.skip] };
}

/** The most folder levels a scan looks down (the server's MAX_DEPTH). */
export const MAX_DEPTH = 6;

/**
 * Folder levels to look through, from the box or the address. An empty box or anything that is not a
 * whole number from 0 to 6 means the fallback, the same for the preview and the scan (UI-B11).
 *
 * @param {string | null | undefined} value
 * @param {number} fallback
 */
export function depthOf(value, fallback) {
	const text = (value ?? "").trim();
	const depth = text === "" ? Number.NaN : Number(text);
	return Number.isInteger(depth) && depth >= 0 && depth <= MAX_DEPTH ? depth : fallback;
}

/** The depth a scan looked through before there was a record of it. */
export const OLDER_REPORT_DEPTH = 3;

/**
 * The folder levels a report's scan looked through, so "Check again" looks as deep again (B42). A report
 * from before the depth was kept says nothing, and is taken as the default of the time, 3.
 *
 * @param {{ depth?: unknown } | null | undefined} report
 */
export function reportDepth(report) {
	const depth = report?.depth;
	return typeof depth === "number" && Number.isInteger(depth) && depth >= 0 && depth <= MAX_DEPTH ? depth : OLDER_REPORT_DEPTH;
}
