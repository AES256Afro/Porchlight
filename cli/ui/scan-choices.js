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
	{ key: "deep", label: "Deep", words: "As Standard, then the model's deeper analysis of the critical and high findings starts on its own." },
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
		if (preset.secrets === choices.secrets && preset.dependencies === choices.dependencies && preset.history === choices.history && preset.analyse === choices.analyse) return key;
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
	if (!secrets && !dependencies) throw new ChoiceError("Choose at least one check: secrets or dependencies");
	const history = input.history === undefined ? base.history : parseHistory(input.history);
	if (history === null) throw new ChoiceError(`History must be all, none, or a number of commits from 1 to ${MAX_HISTORY_COMMITS.toLocaleString("en")}`);
	const skip = input.skip === undefined ? [] : parseSkip(input.skip);
	if (skip === null) throw new ChoiceError(`Skip names repositories: up to ${MAX_SKIPPED}, each a name as the page lists it`);
	const choices = { secrets, dependencies, history, localFiles: flag("localFiles", base.localFiles), skip, analyse: flag("analyse", base.analyse) };
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
	// An address that switches both checks off asks for nothing: both stay as the preset has them.
	if (secrets || dependencies) Object.assign(choices, { secrets, dependencies });
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
	if (choices.secrets && choices.localFiles) parts.push("files git does not track");
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
	if (choices.secrets && choices.history === "none") {
		gaps.push("Git history was not read for secrets, only the files as they are now: a secret removed in an earlier commit is still in history and was not looked for.");
	}
	if (choices.secrets && typeof choices.history === "number") {
		gaps.push(`Only the last ${choices.history === 1 ? "commit" : `${choices.history.toLocaleString("en")} commits`} and the files as they are now were read for secrets: older commits were not.`);
	}
	if (skipped.length > 0) gaps.push(`Not scanned, as chosen: ${skipped.join(", ")}.`);
	return gaps;
}

/**
 * Where a secret was found. Older reports read history alone and did not say.
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
	if (finding.kind !== "secret") return choices.dependencies;
	if (!choices.secrets) return false;
	const source = secretSource(finding);
	// A window of recent commits moves with every commit: a secret outside it now was not looked for.
	if (source === "history") return choices.history === "all";
	if (source === "files") return choices.history !== "all";
	return choices.localFiles;
}
