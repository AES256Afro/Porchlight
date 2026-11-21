/**
 * Three more things the host check reads (FT-8), each read-only (invariant 19):
 *
 * - SSH settings: `~/.ssh/config` (and the files it includes) forwarding the agent to every host, or
 *   switching off the check of a server's key. Only the settings are read; no key is opened.
 * - Programs that start by themselves from a folder anyone, or any program, can change: LaunchAgents
 *   and LaunchDaemons on a Mac (read with `plutil`, which only prints), systemd user units and
 *   autostart entries on Linux.
 * - Browser extensions that can read and change every site: Chrome, Brave, Edge, Chromium, Vivaldi
 *   and Firefox. Each extension's name and the permission are kept, nothing else.
 *
 * What could not be read makes a check "unknown" ("Could not check") when nothing else was found,
 * and is said in the detail when something was: never a pass (invariant 5). Nothing here contacts
 * another machine or needs more privilege than the person running it has.
 */
import { lstat, readdir, readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import type { Runner } from "../repos/exec.ts";
import { output } from "./macos.ts";
import type { HostCheck } from "./types.ts";

const MAX_READ = 1024 * 1024;
/** Plists and manifests looked at per folder before the rest are counted as not read. */
const MAX_FILES = 500;
const MAX_INCLUDE_DEPTH = 5;

type Text = { text: string } | "missing" | "unreadable";

async function readText(path: string): Promise<Text> {
	try {
		const info = await stat(path);
		if (!info.isFile()) return "missing";
		if (info.size > MAX_READ) return "unreadable";
		return { text: await readFile(path, "utf8") };
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreadable";
	}
}

async function list(dir: string): Promise<string[] | "missing" | "unreadable"> {
	try {
		return (await readdir(dir)).sort();
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		return code === "ENOENT" || code === "ENOTDIR" ? "missing" : "unreadable";
	}
}

/** A path as the page shows it: the home folder as "~". */
function shown(path: string, home: string): string {
	return path === home ? "~" : path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/** Text from a file on this computer, made safe to show on one line: no control characters, cut short. */
function clean(text: string, max = 120): string {
	const line = text.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, " ").trim();
	return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

// ---------------------------------------------------------------- SSH settings

interface SshSetting {
	keyword: string;
	value: string;
	/** "every" when it applies to every host (before any Host line, or under `Host *`); otherwise the block's patterns. */
	scope: "every" | string;
}

/** Each setting of an SSH config, with the hosts it applies to. `Include` lines are returned for the caller to follow. */
export function parseSshConfig(text: string, scope: "every" | string = "every"): { settings: SshSetting[]; includes: { pattern: string; scope: "every" | string }[] } {
	const settings: SshSetting[] = [];
	const includes: { pattern: string; scope: "every" | string }[] = [];
	let current = scope;
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.replace(/#.*/, "").trim();
		if (!line) continue;
		const match = /^(\S+?)(?:\s*=\s*|\s+)(.*)$/.exec(line);
		if (!match) continue;
		const keyword = match[1]!.toLowerCase();
		const value = match[2]!.trim().replace(/^"(.*)"$/, "$1");
		if (keyword === "host") {
			const patterns = value.split(/\s+/);
			current = patterns.length === 1 && patterns[0] === "*" ? "every" : `Host ${value}`;
			continue;
		}
		if (keyword === "match") {
			current = /^all$/i.test(value) ? "every" : `Match ${value}`;
			continue;
		}
		if (keyword === "include") {
			for (const pattern of value.split(/\s+/)) includes.push({ pattern, scope: current });
			continue;
		}
		settings.push({ keyword, value, scope: current });
	}
	return { settings, includes };
}

/** The files an Include pattern names: relative to ~/.ssh, "~" for the home folder, and "*" in the last part only. */
async function includedFiles(pattern: string, home: string): Promise<string[] | "unreadable"> {
	const path = pattern.startsWith("~/") ? join(home, pattern.slice(2)) : isAbsolute(pattern) ? pattern : join(home, ".ssh", pattern);
	const folder = dirname(path);
	const last = path.slice(folder.length + 1);
	if (/[*?]/.test(folder)) return "unreadable";
	if (!/[*?]/.test(last)) return [path];
	const names = await list(folder);
	if (names === "missing") return [];
	if (names === "unreadable") return "unreadable";
	const matcher = new RegExp(`^${last.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
	return names.filter((name) => matcher.test(name)).map((name) => join(folder, name));
}

export async function sshConfigChecks(home: string): Promise<HostCheck[]> {
	const base = { area: "credentials" as const };
	const settings: SshSetting[] = [];
	let unread = 0;
	let anyFile = false;
	const visit = async (path: string, scope: "every" | string, depth: number): Promise<void> => {
		const file = await readText(path);
		if (file === "missing") return;
		anyFile = true;
		if (file === "unreadable" || depth > MAX_INCLUDE_DEPTH) {
			unread++;
			return;
		}
		const parsed = parseSshConfig(file.text, scope);
		settings.push(...parsed.settings);
		for (const include of parsed.includes) {
			const files = await includedFiles(include.pattern, home);
			if (files === "unreadable") {
				unread++;
				continue;
			}
			for (const included of files) await visit(included, include.scope, depth + 1);
		}
	};
	await visit(join(home, ".ssh", "config"), "every", 0);
	if (!anyFile) return [];
	const partly = unread > 0 ? ` ${unread === 1 ? "One file it includes" : `${unread} files it includes`} could not be read, so this may not be all.` : "";
	const yes = (value: string) => /^(?:yes|true)$/i.test(value);
	const checks: HostCheck[] = [];

	// ssh takes the first value it meets for each host, so a "no" for one host before `Host *` keeps that host safe; every other host still forwards.
	const forwardEvery = settings.find((setting) => setting.keyword === "forwardagent" && setting.scope === "every");
	if (forwardEvery && yes(forwardEvery.value)) {
		checks.push({
			...base,
			id: "ssh-forward-agent",
			title: "SSH forwards your agent to every server",
			severity: "medium",
			status: "failed",
			detail: `~/.ssh/config sets ForwardAgent yes for every host. Anyone with root on any server you connect to can use your keys while you are connected.${partly}`,
			fix: ["Remove `ForwardAgent yes` from the `Host *` part of ~/.ssh/config, and add it only under the hosts that need it, or use `ssh -J` (ProxyJump) instead."],
		});
	} else if (unread > 0) {
		checks.push({ ...base, id: "ssh-forward-agent", title: "SSH agent forwarding", severity: "medium", status: "unknown", detail: `ForwardAgent is not set for every host in what could be read.${partly}` });
	} else {
		checks.push({ ...base, id: "ssh-forward-agent", title: "SSH does not forward your agent to every server", severity: "medium", status: "passed", detail: "ForwardAgent is not set for every host in ~/.ssh/config." });
	}

	const offFor = settings.filter((setting) => setting.keyword === "stricthostkeychecking" && /^(?:no|off)$/i.test(setting.value));
	const everyOff = offFor.some((setting) => setting.scope === "every");
	const someOff = [...new Set(offFor.filter((setting) => setting.scope !== "every").map((setting) => clean(setting.scope, 80)))];
	if (everyOff || someOff.length > 0) {
		checks.push({
			...base,
			id: "ssh-host-keys",
			title: everyOff ? "SSH does not check any server's key" : "SSH does not check some servers' keys",
			severity: everyOff ? "medium" : "low",
			status: "failed",
			detail: `StrictHostKeyChecking no means a server pretending to be yours is not noticed, and what you type and send goes to it.${partly}`,
			...(someOff.length > 0 && !everyOff ? { items: someOff } : {}),
			fix: ["Remove `StrictHostKeyChecking no` from ~/.ssh/config. For servers that are rebuilt often, `StrictHostKeyChecking accept-new` still notices a changed key."],
		});
	} else if (unread > 0) {
		checks.push({ ...base, id: "ssh-host-keys", title: "SSH checks servers' keys", severity: "medium", status: "unknown", detail: `StrictHostKeyChecking is not switched off in what could be read.${partly}` });
	} else {
		checks.push({ ...base, id: "ssh-host-keys", title: "SSH checks servers' keys", severity: "medium", status: "passed", detail: "StrictHostKeyChecking is not switched off in ~/.ssh/config." });
	}
	return checks;
}

// ---------------------------------------------------------------- Programs that start by themselves

/** Folders anyone, or anything run from a download, can write to. */
const TEMPORARY = [/^\/tmp\//, /^\/private\/tmp\//, /^\/var\/tmp\//, /^\/private\/var\/tmp\//, /^\/Users\/Shared\//, /^\/var\/folders\//, /^\/private\/var\/folders\//, /^\/dev\/shm\//];

/** Why a program that starts by itself is in a place it should not be, or null. `systemWide`: it starts for every user, or as root. */
export async function riskyPlace(program: string, home: string, systemWide: boolean): Promise<string | null> {
	if (!isAbsolute(program)) return null;
	if (systemWide && (program.startsWith(`${home}/`) || /^\/Users\/[^/]+\//.test(program) || /^\/home\/[^/]+\//.test(program))) return "it starts for every user from a folder one account can change";
	if (TEMPORARY.some((pattern) => pattern.test(program)) || program.startsWith(`${home}/Downloads/`)) return "it is in a temporary or shared folder";
	for (const path of [program, dirname(program)]) {
		try {
			const info = await lstat(path);
			if ((info.mode & 0o002) !== 0 && !(info.isDirectory() && (info.mode & 0o1000) !== 0)) return "other users of this computer can change it";
		} catch {
			// A program that is not there starts nothing.
			return null;
		}
	}
	return null;
}

/** The program a launchd job runs, from `plutil -convert json` output. */
export function launchdProgram(json: string): { label: string; program: string } | null {
	try {
		const job = JSON.parse(json) as { Label?: unknown; Program?: unknown; ProgramArguments?: unknown };
		const program = typeof job.Program === "string" ? job.Program : Array.isArray(job.ProgramArguments) && typeof job.ProgramArguments[0] === "string" ? job.ProgramArguments[0] : null;
		if (!program) return null;
		return { label: typeof job.Label === "string" ? job.Label : "", program };
	} catch {
		return null;
	}
}

/** The program a systemd unit's ExecStart= or a desktop entry's Exec= runs: its first word, without systemd's prefixes. */
export function execProgram(text: string, key: "ExecStart" | "Exec"): string | null {
	const line = new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m").exec(text)?.[1];
	if (!line) return null;
	const first = line.trim().replace(/^[-@:+!]+/, "").match(/^"([^"]+)"|^(\S+)/);
	return first ? (first[1] ?? first[2] ?? null) : null;
}

interface StartItem {
	where: string;
	label: string;
	program: string;
	systemWide: boolean;
}

export async function startupChecks(run: Runner, home: string, mac: boolean, systemRoot = ""): Promise<HostCheck[]> {
	const items: StartItem[] = [];
	let unread = 0;
	let anyFolder = false;
	const folders = mac
		? [
				{ dir: join(home, "Library/LaunchAgents"), systemWide: false },
				{ dir: join(systemRoot || "/", "Library/LaunchAgents"), systemWide: true },
				{ dir: join(systemRoot || "/", "Library/LaunchDaemons"), systemWide: true },
			]
		: [
				{ dir: join(home, ".config/systemd/user"), systemWide: false },
				{ dir: join(home, ".config/autostart"), systemWide: false },
			];
	for (const { dir, systemWide } of folders) {
		const names = await list(dir);
		if (names === "missing") continue;
		anyFolder = true;
		if (names === "unreadable") {
			unread++;
			continue;
		}
		const wanted = names.filter((name) => (mac ? name.endsWith(".plist") : name.endsWith(".service") || name.endsWith(".desktop")));
		unread += Math.max(0, wanted.length - MAX_FILES);
		for (const name of wanted.slice(0, MAX_FILES)) {
			const path = join(dir, name);
			if (mac) {
				// plutil only prints the job as JSON: binary plists are as common as XML ones.
				const result = await output(run, "plutil", ["-convert", "json", "-o", "-", "--", path]).catch(() => null);
				const job = result && result.code === 0 ? launchdProgram(result.stdout) : null;
				if (!job) {
					// A job with no program of its own (one that only names a bundle) is not unreadable; one plutil could not read is.
					if (!result || result.code !== 0) unread++;
					continue;
				}
				items.push({ where: shown(dir, home), label: job.label || name, program: job.program, systemWide });
			} else {
				const file = await readText(path);
				if (file === "missing") continue;
				if (file === "unreadable") {
					unread++;
					continue;
				}
				const program = execProgram(file.text, name.endsWith(".service") ? "ExecStart" : "Exec");
				if (program) items.push({ where: shown(dir, home), label: name, program, systemWide });
			}
		}
	}
	if (!anyFolder) return [];
	const risky: string[] = [];
	for (const item of items) {
		const why = await riskyPlace(item.program, home, item.systemWide);
		if (why) risky.push(`${clean(item.label, 80)} runs ${clean(shown(item.program, home))} (${why}), from ${item.where}`);
	}
	const base = { id: "startup-items", area: "startup" as const, severity: "high" as const };
	const partly = unread > 0 ? ` ${unread === 1 ? "One item" : `${unread} items`} could not be read.` : "";
	const named = mac ? "LaunchAgents and LaunchDaemons" : "systemd user units and autostart entries";
	if (risky.length > 0) {
		return [
			{
				...base,
				title: `${risky.length === 1 ? "A program that starts by itself is" : `${risky.length} programs that start by themselves are`} in a folder others can change`,
				status: "failed",
				detail: `Whoever can change the program can run anything each time it starts${risky.some((line) => /every user/.test(line)) ? ", for every user or as root" : ""}.${partly}`,
				items: risky,
				fix: [
					"If you do not know the item, remove it from the folder named, and look for what installed it.",
					"If you need it, install the program somewhere only an administrator can change, such as /Applications or /usr/local, and point the item there.",
				],
			},
		];
	}
	if (unread > 0) return [{ ...base, title: named, status: "unknown", detail: `None of the ${named} read starts a program from a folder others can change.${partly}` }];
	return [{ ...base, title: `${named} start programs from safe folders`, status: "passed", detail: `${items.length === 1 ? "1 item" : `${items.length} items`} read; none starts a program from a temporary, shared or writable folder.` }];
}

// ---------------------------------------------------------------- Browser extensions

const CHROMIUM_MAC: [string, string][] = [
	["Chrome", "Library/Application Support/Google/Chrome"],
	["Chrome Beta", "Library/Application Support/Google/Chrome Beta"],
	["Chromium", "Library/Application Support/Chromium"],
	["Brave", "Library/Application Support/BraveSoftware/Brave-Browser"],
	["Edge", "Library/Application Support/Microsoft Edge"],
	["Vivaldi", "Library/Application Support/Vivaldi"],
	["Arc", "Library/Application Support/Arc/User Data"],
];
const CHROMIUM_LINUX: [string, string][] = [
	["Chrome", ".config/google-chrome"],
	["Chromium", ".config/chromium"],
	["Brave", ".config/BraveSoftware/Brave-Browser"],
	["Edge", ".config/microsoft-edge"],
	["Vivaldi", ".config/vivaldi"],
];
const FIREFOX_MAC = "Library/Application Support/Firefox/Profiles";
const FIREFOX_LINUX = ".mozilla/firefox";

/** A match pattern that reaches every site. */
export function everySite(pattern: unknown): boolean {
	return typeof pattern === "string" && (pattern === "<all_urls>" || /^(?:\*|https?):\/\/\*\/\*?$/.test(pattern));
}

/** Whether a Chromium manifest asks for every site, through its permissions or its content scripts. */
export function manifestReachesEverySite(manifest: Record<string, unknown>): boolean {
	const lists = [manifest.permissions, manifest.host_permissions, ...(Array.isArray(manifest.content_scripts) ? manifest.content_scripts.map((script) => (script as { matches?: unknown } | null)?.matches) : [])];
	return lists.some((value) => Array.isArray(value) && value.some(everySite));
}

async function extensionName(folder: string, manifest: Record<string, unknown>): Promise<string> {
	const raw = typeof manifest.name === "string" ? manifest.name : "";
	const message = /^__MSG_(\w+)__$/.exec(raw)?.[1];
	if (!message) return clean(raw || "an extension with no name", 80);
	const locale = typeof manifest.default_locale === "string" && /^[\w-]{1,20}$/.test(manifest.default_locale) ? manifest.default_locale : "en";
	const file = await readText(join(folder, "_locales", locale, "messages.json"));
	if (typeof file === "object") {
		try {
			const messages = JSON.parse(file.text) as Record<string, { message?: unknown }>;
			const entry = Object.entries(messages).find(([key]) => key.toLowerCase() === message.toLowerCase())?.[1];
			if (typeof entry?.message === "string") return clean(entry.message, 80);
		} catch {
			// Its own name stands.
		}
	}
	return clean(raw, 80);
}

async function chromiumExtensions(base: string): Promise<{ found: string[]; unread: number } | null> {
	const profiles = await list(base);
	if (profiles === "missing") return null;
	if (profiles === "unreadable") return { found: [], unread: 1 };
	const found = new Set<string>();
	let unread = 0;
	let looked = 0;
	for (const profile of profiles) {
		const extensions = await list(join(base, profile, "Extensions"));
		if (extensions === "missing") continue;
		if (extensions === "unreadable") {
			unread++;
			continue;
		}
		for (const id of extensions) {
			if (!/^[a-p]{32}$/.test(id)) continue;
			if (++looked > MAX_FILES) {
				unread++;
				continue;
			}
			const versions = await list(join(base, profile, "Extensions", id));
			if (!Array.isArray(versions) || versions.length === 0) {
				if (versions === "unreadable") unread++;
				continue;
			}
			// The newest version Chrome kept: the last by name, in version order.
			const version = versions.sort((a, b) => a.localeCompare(b, "en", { numeric: true })).at(-1)!;
			const folder = join(base, profile, "Extensions", id, version);
			const file = await readText(join(folder, "manifest.json"));
			if (file === "missing") continue;
			if (file === "unreadable") {
				unread++;
				continue;
			}
			try {
				const manifest = JSON.parse(file.text) as Record<string, unknown>;
				if (manifestReachesEverySite(manifest)) found.add(`${await extensionName(folder, manifest)} (can read and change every site)`);
			} catch {
				unread++;
			}
		}
	}
	return { found: [...found].sort(), unread };
}

async function firefoxExtensions(base: string): Promise<{ found: string[]; unread: number } | null> {
	const profiles = await list(base);
	if (profiles === "missing") return null;
	if (profiles === "unreadable") return { found: [], unread: 1 };
	const found = new Set<string>();
	let unread = 0;
	let any = false;
	for (const profile of profiles) {
		const file = await readText(join(base, profile, "extensions.json"));
		if (file === "missing") continue;
		any = true;
		if (file === "unreadable") {
			unread++;
			continue;
		}
		try {
			const addons = (JSON.parse(file.text) as { addons?: unknown }).addons;
			for (const addon of Array.isArray(addons) ? addons : []) {
				const entry = addon as { type?: unknown; location?: unknown; userPermissions?: { origins?: unknown } | null; defaultLocale?: { name?: unknown } | null };
				// Firefox's own built-in add-ons are not the owner's choice.
				if (entry.type !== "extension" || (typeof entry.location === "string" && /^app-(?:builtin|system)/.test(entry.location))) continue;
				const origins = entry.userPermissions?.origins;
				if (Array.isArray(origins) && origins.some(everySite)) found.add(`${clean(typeof entry.defaultLocale?.name === "string" ? entry.defaultLocale.name : "an extension with no name", 80)} (can read and change every site)`);
			}
		} catch {
			unread++;
		}
	}
	return any || unread > 0 ? { found: [...found].sort(), unread } : null;
}

export async function browserExtensionChecks(home: string, mac: boolean): Promise<HostCheck[]> {
	const browsers: [string, Promise<{ found: string[]; unread: number } | null>][] = [
		...(mac ? CHROMIUM_MAC : CHROMIUM_LINUX).map(([name, path]): [string, Promise<{ found: string[]; unread: number } | null>] => [name, chromiumExtensions(join(home, path))]),
		["Firefox", firefoxExtensions(join(home, mac ? FIREFOX_MAC : FIREFOX_LINUX))],
	];
	const checks: HostCheck[] = [];
	for (const [browser, pending] of browsers) {
		const result = await pending;
		if (!result) continue;
		const base = { id: `extensions:${browser.toLowerCase().replace(/\s+/g, "-")}`, area: "startup" as const, severity: "low" as const };
		const partly = result.unread > 0 ? ` ${result.unread === 1 ? "One extension or profile" : `${result.unread} extensions or profiles`} could not be read.` : "";
		if (result.found.length > 0) {
			checks.push({
				...base,
				title: `${browser}: ${result.found.length === 1 ? "1 extension can" : `${result.found.length} extensions can`} read every site`,
				status: "failed",
				detail: `An extension that can read and change every site sees every page you open, passwords typed into them included. Keep only the ones you use and trust.${partly}`,
				items: result.found,
				fix: [`Open ${browser}'s extensions page, remove the ones you do not use, and set the others to run on click or on chosen sites only.`],
			});
		} else if (result.unread > 0) {
			checks.push({ ...base, title: `${browser} extensions`, status: "unknown", detail: `No extension read can reach every site.${partly}` });
		} else {
			checks.push({ ...base, title: `${browser}: no extension reads every site`, status: "passed", detail: "No installed extension asks to read and change every site." });
		}
	}
	return checks;
}
