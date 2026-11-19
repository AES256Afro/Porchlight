/**
 * Updates and built-in protection on a Mac, read from the tools macOS ships with. Every command
 * only reports: none of them changes a setting, and none needs administrator rights for this.
 * An answer that is not one of those described here is "unknown", never a pass.
 */
import { lastLine, ToolMissingError, type RunOptions, type Runner } from "../repos/exec.ts";
import type { Severity } from "../repos/types.ts";
import type { HostCheck } from "./types.ts";

const SOFTWARE_UPDATE_PREFS = "/Library/Preferences/com.apple.SoftwareUpdate";
const LOGIN_WINDOW_PREFS = "/Library/Preferences/com.apple.loginwindow";
const FIREWALL = "/usr/libexec/ApplicationFirewall/socketfilterfw";
/** How `defaults read` says a setting was never changed, which leaves macOS's default. */
const NOT_SET = /does not exist|Could not find key/i;
/** A screen that locks later than this is reported. */
const SCREEN_LOCK_MAX_SECONDS = 300;

/** A command's result, or null when the program is not installed. Output from both streams. */
export async function output(run: Runner, command: string, args: string[], options?: RunOptions): Promise<{ code: number; text: string; stdout: string } | null> {
	try {
		const result = await run(command, args, options);
		return { code: result.code, text: `${result.stdout}\n${result.stderr}`, stdout: result.stdout };
	} catch (err) {
		if (err instanceof ToolMissingError) return null;
		throw err;
	}
}

/** A check that could not run. */
export function unknown(base: Omit<HostCheck, "status" | "detail">, why: string): HostCheck {
	return { ...base, status: "unknown", detail: why };
}

function couldNotRead(command: string, result: { code: number; text: string } | null): string {
	if (!result) return `${command} is not on this computer`;
	const reason = lastLine(result.text);
	return result.code !== 0 ? `${command} failed${reason ? `: ${reason}` : ` with code ${result.code}`}` : `${command} gave an answer SecurityX does not recognise${reason ? `: ${reason}` : ""}`;
}

export function parseSwVers(text: string): { name: string; version: string; build: string } | null {
	const field = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, "m").exec(text)?.[1]?.trim();
	const name = field("ProductName");
	const version = field("ProductVersion");
	if (!name || !version) return null;
	return { name, version, build: field("BuildVersion") ?? "" };
}

export async function osVersion(run: Runner): Promise<{ name: string; version: string; build: string } | null> {
	const result = await output(run, "sw_vers", []).catch(() => null);
	return result && result.code === 0 ? parseSwVers(result.text) : null;
}

/** Pending updates as `softwareupdate --list` names them, or null when its answer is not recognised. */
export function parseSoftwareUpdate(text: string): { titles: string[] } | null {
	if (/No new software available/i.test(text)) return { titles: [] };
	const labels = [...text.matchAll(/^\s*\*\s*Label:\s*(.+)$/gm)].map((match) => match[1]!.trim());
	if (labels.length === 0) return null;
	const titles = [...text.matchAll(/^\s*Title:\s*([^,\n]+)/gm)].map((match) => match[1]!.trim());
	return { titles: titles.length === labels.length ? titles : labels };
}

/** An update to the system or the browser closes security holes; others may not. */
function updateSeverity(titles: string[]): Severity {
	return titles.some((title) => /macOS|Security|Safari|XProtect/i.test(title)) ? "high" : "medium";
}

export async function softwareUpdates(run: Runner, askApple: boolean): Promise<HostCheck> {
	const base = { id: "software-updates", area: "updates", title: "Software updates" } as const;
	// Asking Apple can take minutes on a slow connection; the cached answer is quick.
	const result = await output(run, "softwareupdate", ["--list", ...(askApple ? [] : ["--no-scan"])], { timeoutMs: askApple ? 5 * 60_000 : 60_000 });
	const parsed = result && result.code === 0 ? parseSoftwareUpdate(result.text) : null;
	if (!parsed) return unknown({ ...base, severity: "high" }, couldNotRead("softwareupdate", result));
	const when = askApple ? "Apple was asked just now." : "As of macOS's own last check.";
	if (parsed.titles.length === 0) return { ...base, severity: "high", status: "passed", detail: `Nothing is waiting to be installed. ${when}` };
	const count = parsed.titles.length;
	return {
		...base,
		severity: updateSeverity(parsed.titles),
		status: "failed",
		detail: `${count === 1 ? "1 update is" : `${count} updates are`} waiting to be installed. ${when}`,
		items: parsed.titles,
		fix: ["Install them in System Settings → General → Software Update.", "Or in Terminal: `softwareupdate --install --all`"],
		commands: [{ kind: "line", line: "softwareupdate --install --all" }],
	};
}

/** `defaults read` output as key and value; quoting and nesting are not needed for these keys. */
export function parseDefaults(text: string): Record<string, string> {
	return Object.fromEntries([...text.matchAll(/^\s*"?([A-Za-z]\w*)"?\s*=\s*"?([^";]*)"?;\s*$/gm)].map((match) => [match[1]!, match[2]!.trim()]));
}

/** The settings that keep security fixes coming without anyone asking. A missing key is macOS's default: on. */
const AUTOMATIC_SETTINGS: [key: string, words: string][] = [
	["AutomaticCheckEnabled", "Check for updates"],
	["CriticalUpdateInstall", "Install Security Responses and system files"],
	["ConfigDataInstall", "Install Security Responses and system files (XProtect)"],
];

export async function automaticUpdates(run: Runner): Promise<HostCheck> {
	const base = { id: "automatic-updates", area: "updates", title: "Security fixes install by themselves", severity: "medium" } as const;
	const result = await output(run, "defaults", ["read", SOFTWARE_UPDATE_PREFS]);
	if (!result) return unknown(base, couldNotRead("defaults", result));
	// No settings file at all: everything is at macOS's defaults, which are on.
	const settings = result.code === 0 ? parseDefaults(result.text) : NOT_SET.test(result.text) ? {} : null;
	if (!settings) return unknown(base, couldNotRead("defaults", result));
	const off = [...new Set(AUTOMATIC_SETTINGS.filter(([key]) => settings[key] === "0").map(([, words]) => words.replace(/ \(XProtect\)$/, "")))];
	if (off.length === 0) return { ...base, status: "passed", detail: "macOS checks for updates and installs Security Responses and system files without being asked." };
	return {
		...base,
		status: "failed",
		detail: `Turned off: ${off.join("; ")}. Security fixes then wait until someone installs them by hand.`,
		fix: ["Open System Settings → General → Software Update, click the ⓘ beside Automatic updates, and turn these on."],
	};
}

export function parseFileVault(text: string): "on" | "off" | null {
	if (/FileVault is On|Encryption in progress/i.test(text)) return "on";
	if (/FileVault is Off|Decryption in progress/i.test(text)) return "off";
	return null;
}

export async function fileVault(run: Runner): Promise<HostCheck> {
	const base = { id: "filevault", area: "protection", title: "FileVault disk encryption", severity: "high" } as const;
	const result = await output(run, "fdesetup", ["status"]);
	const state = result ? parseFileVault(result.text) : null;
	if (!state) return unknown(base, couldNotRead("fdesetup", result));
	if (state === "on") return { ...base, status: "passed", detail: "The disk is encrypted: someone who takes this Mac cannot read it without your password." };
	return {
		...base,
		status: "failed",
		detail: "The disk is not encrypted. Anyone who takes this Mac can read everything on it, your keys and code included.",
		fix: ["Turn it on in System Settings → Privacy & Security → FileVault, and keep the recovery key somewhere safe."],
	};
}

export function parseSip(text: string): "on" | "custom" | "off" | null {
	if (/Custom Configuration/i.test(text)) return "custom";
	if (/status:\s*disabled/i.test(text)) return "off";
	if (/status:\s*enabled/i.test(text)) return "on";
	return null;
}

export async function systemIntegrity(run: Runner): Promise<HostCheck> {
	const base = { id: "sip", area: "protection", title: "System Integrity Protection" } as const;
	const result = await output(run, "csrutil", ["status"]);
	const state = result ? parseSip(result.text) : null;
	if (!state) return unknown({ ...base, severity: "high" }, couldNotRead("csrutil", result));
	if (state === "on") return { ...base, severity: "high", status: "passed", detail: "On: even programs run as an administrator cannot change macOS's own files." };
	const fix = ["Start up in macOS Recovery, open Terminal from the Utilities menu, run `csrutil enable` and restart."];
	if (state === "custom") return { ...base, severity: "medium", status: "failed", detail: "On, but with some of its protections turned off (a custom configuration).", fix };
	return { ...base, severity: "high", status: "failed", detail: "Off: malware running as an administrator can change macOS itself.", fix };
}

export function parseGatekeeper(text: string): "on" | "off" | null {
	if (/assessments enabled/i.test(text)) return "on";
	if (/assessments disabled/i.test(text)) return "off";
	return null;
}

export async function gatekeeper(run: Runner): Promise<HostCheck> {
	const base = { id: "gatekeeper", area: "protection", title: "Gatekeeper", severity: "high" } as const;
	const result = await output(run, "spctl", ["--status"]);
	const state = result ? parseGatekeeper(result.text) : null;
	if (!state) return unknown(base, couldNotRead("spctl", result));
	if (state === "on") return { ...base, status: "passed", detail: "On: apps that are not signed and checked by Apple need your permission to open." };
	return {
		...base,
		status: "failed",
		detail: "Off: any downloaded app opens without a check.",
		fix: ["Turn it back on in Terminal: `sudo spctl --global-enable`, then choose who apps may come from in System Settings → Privacy & Security."],
		commands: [{ kind: "line", line: "sudo spctl --global-enable" }],
	};
}

export function parseFirewall(text: string): "on" | "off" | null {
	if (/disabled|State = 0/i.test(text)) return "off";
	if (/enabled|State = [12]/i.test(text)) return "on";
	return null;
}

export function parseStealth(text: string): "on" | "off" | null {
	if (/stealth mode (?:is )?(?:off|disabled)/i.test(text)) return "off";
	if (/stealth mode (?:is )?(?:on|enabled)/i.test(text)) return "on";
	return null;
}

/** The firewall's state, for the network check too. */
export async function firewall(run: Runner): Promise<{ checks: HostCheck[]; on: boolean | null }> {
	const base = { id: "firewall", area: "protection", title: "Firewall", severity: "medium" } as const;
	const global = await output(run, FIREWALL, ["--getglobalstate"]);
	const state = global ? parseFirewall(global.text) : null;
	const checks: HostCheck[] = [];
	if (!state) checks.push(unknown(base, couldNotRead("The firewall", global)));
	else if (state === "on") checks.push({ ...base, status: "passed", detail: "On: apps that are not allowed cannot accept connections from the network." });
	else
		checks.push({
			...base,
			status: "failed",
			detail: "Off: any app can accept connections from every network this Mac joins.",
			fix: ["Turn it on in System Settings → Network → Firewall.", `Or in Terminal: \`sudo ${FIREWALL} --setglobalstate on\``],
			commands: [{ kind: "line", line: `sudo ${FIREWALL} --setglobalstate on` }],
		});

	const stealthBase = { id: "stealth", area: "protection", title: "Firewall stealth mode", severity: "low" } as const;
	const stealth = await output(run, FIREWALL, ["--getstealthmode"]);
	const stealthState = stealth ? parseStealth(stealth.text) : null;
	if (!stealthState) checks.push(unknown(stealthBase, couldNotRead("The firewall", stealth)));
	else if (stealthState === "on") checks.push({ ...stealthBase, status: "passed", detail: "On: this Mac does not answer pings or probes of closed ports." });
	else
		checks.push({
			...stealthBase,
			status: "failed",
			detail: "Off: this Mac answers pings and probes, which tells others on the network it is there.",
			fix: ["Turn it on in System Settings → Network → Firewall → Options → Enable stealth mode.", `Or in Terminal: \`sudo ${FIREWALL} --setstealthmode on\``],
			commands: [{ kind: "line", line: `sudo ${FIREWALL} --setstealthmode on` }],
		});
	return { checks, on: state === null ? null : state === "on" };
}

export async function automaticLogin(run: Runner): Promise<HostCheck> {
	const base = { id: "auto-login", area: "protection", title: "Automatic login", severity: "medium" } as const;
	const result = await output(run, "defaults", ["read", LOGIN_WINDOW_PREFS, "autoLoginUser"]);
	if (!result) return unknown(base, couldNotRead("defaults", result));
	if (result.code !== 0 && NOT_SET.test(result.text)) return { ...base, status: "passed", detail: "Off: this Mac asks for a password when it starts." };
	// The account's name is not repeated: the report says only that one logs in by itself.
	if (result.code === 0 && result.stdout.trim() !== "")
		return {
			...base,
			status: "failed",
			detail: "On: an account logs in by itself when this Mac starts, so anyone who turns it on gets in.",
			fix: ["Turn it off in System Settings → Users & Groups → Automatically log in as: Off."],
		};
	return unknown(base, couldNotRead("defaults", result));
}

export async function guestAccount(run: Runner): Promise<HostCheck> {
	const base = { id: "guest", area: "protection", title: "Guest account", severity: "low" } as const;
	const result = await output(run, "defaults", ["read", LOGIN_WINDOW_PREFS, "GuestEnabled"]);
	if (!result) return unknown(base, couldNotRead("defaults", result));
	const value = result.code === 0 ? result.stdout.trim() : NOT_SET.test(result.text) ? "0" : null;
	if (value === "0") return { ...base, status: "passed", detail: "Off." };
	if (value === "1")
		return {
			...base,
			status: "failed",
			detail: "On: anyone can log in to this Mac as a guest without a password.",
			fix: ["Turn it off in System Settings → Users & Groups → Guest User."],
			commands: [{ kind: "line", line: `sudo defaults write ${LOGIN_WINDOW_PREFS} GuestEnabled -bool false` }],
		};
	return unknown(base, couldNotRead("defaults", result));
}

/** "off", or the delay in seconds (0 for immediately), or null when not recognised. */
export function parseScreenLock(text: string): "off" | number | null {
	if (/screenLock is off/i.test(text)) return "off";
	if (/screenLock delay is immediate/i.test(text)) return 0;
	const seconds = /screenLock delay is (\d+) seconds?/i.exec(text)?.[1];
	return seconds === undefined ? null : Number(seconds);
}

export async function screenLock(run: Runner): Promise<HostCheck> {
	const base = { id: "screen-lock", area: "protection", title: "Password after sleep or screen saver" } as const;
	const result = await output(run, "sysadminctl", ["-screenLock", "status"]);
	const state = result ? parseScreenLock(result.text) : null;
	if (state === null) return unknown({ ...base, severity: "medium" }, couldNotRead("sysadminctl", result));
	const fix = ["Set it in System Settings → Lock Screen → Require password after screen saver begins or display is turned off."];
	if (state === "off") return { ...base, severity: "medium", status: "failed", detail: "Off: anyone at this Mac while it sleeps or shows the screen saver can use it.", fix };
	if (state > SCREEN_LOCK_MAX_SECONDS)
		return { ...base, severity: "low", status: "failed", detail: `Asked ${duration(state)} after the screen saver starts, so this Mac stays open that long.`, fix };
	return { ...base, severity: "medium", status: "passed", detail: state === 0 ? "Asked for at once." : `Asked ${duration(state)} after the screen saver starts.` };
}

function duration(seconds: number): string {
	if (seconds < 60) return `${seconds} seconds`;
	const minutes = Math.round(seconds / 60);
	return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}
