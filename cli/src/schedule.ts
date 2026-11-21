/**
 * `porchlight schedule print` (FT-18): a launchd agent (macOS) or a systemd user service and timer
 * (Linux) that runs a Standard scan of one folder on a schedule and keeps it for the interface. It is
 * printed for the owner to read and install: Porchlight never installs persistent configuration
 * itself. A scheduled scan is Standard and never starts a model; the units carry no key or token.
 */
import { delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { safePath } from "./repos/exec.ts";

export interface ScheduleOptions {
	kind: "launchd" | "systemd";
	/** Absolute paths: the Node that runs Porchlight, Porchlight's own entry point, the folder to scan, and where its progress lines go. */
	node: string;
	porchlight: string;
	root: string;
	log: string;
	everyHours: number;
	depth: number;
	/**
	 * The PATH the scan runs with, so it finds git, gitleaks and osv-scanner where this shell does
	 * (launchd's own PATH holds only the system's folders). Absolute folders only (safePath).
	 */
	path: string;
}

/** A name for the job: the same in both systems. */
export const JOB_LABEL = "local.porchlight.scan";

/** The command the unit runs, as separate words. */
export function scheduledCommand(options: ScheduleOptions): string[] {
	return [options.node, options.porchlight, "repos", "scan", options.root, "--save", "--preset", "standard", "--depth", String(options.depth)];
}

function checkPaths(options: ScheduleOptions): void {
	for (const [name, path] of [
		["Node", options.node],
		["Porchlight", options.porchlight],
		["the folder", options.root],
		["the log", options.log],
	] as const) {
		if (!isAbsolute(path)) throw new Error(`${name} must be an absolute path: ${path}`);
		// A control character could end a line of the unit and start a setting of its own.
		if (/[\x00-\x1f\x7f]/.test(path)) throw new Error(`${name}'s path holds a control character, which cannot be written into a unit`);
	}
	if (/[\x00-\x1f\x7f]/.test(options.path)) throw new Error("PATH holds a control character, which cannot be written into a unit");
	if (!Number.isInteger(options.everyHours) || options.everyHours < 1 || options.everyHours > 720) throw new Error("--every must be a whole number of hours from 1 to 720");
	if (!Number.isInteger(options.depth) || options.depth < 0 || options.depth > 6) throw new Error("--depth must be a whole number from 0 to 6");
}

/** Text as XML character data or an attribute value. */
function xml(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** A word as systemd's ExecStart reads it: in double quotes, with `\`, `"`, `%` and `$` kept literal. */
function systemdWord(word: string): string {
	return `"${word.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;
}

/** A path as a systemd setting's value (StandardError=append:…): `%` is a specifier there too. */
function systemdPath(path: string): string {
	return path.replace(/%/g, "%%");
}

export function launchdAgent(options: ScheduleOptions): string {
	checkPaths(options);
	const strings = (values: string[]) => values.map((value) => `\t\t<string>${xml(value)}</string>`).join("\n");
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!--
  Porchlight: a Standard scan of one folder every ${options.everyHours === 1 ? "hour" : `${options.everyHours} hours`}, kept for the interface.
  Porchlight printed this and installed nothing. To install it, save this output as
  ~/Library/LaunchAgents/${JOB_LABEL}.plist (the same command, with > and that file), then:
    launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/${JOB_LABEL}.plist
  To remove it:
    launchctl bootout gui/$(id -u)/${JOB_LABEL}
    rm ~/Library/LaunchAgents/${JOB_LABEL}.plist
-->
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${JOB_LABEL}</string>
	<key>ProgramArguments</key>
	<array>
${strings(scheduledCommand(options))}
	</array>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>${xml(options.path)}</string>
	</dict>
	<key>StartInterval</key>
	<integer>${options.everyHours * 3600}</integer>
	<key>RunAtLoad</key>
	<false/>
	<key>LowPriorityIO</key>
	<true/>
	<key>ProcessType</key>
	<string>Background</string>
	<key>StandardOutPath</key>
	<string>/dev/null</string>
	<key>StandardErrorPath</key>
	<string>${xml(options.log)}</string>
</dict>
</plist>
`;
}

export function systemdUnits(options: ScheduleOptions): string {
	checkPaths(options);
	return `# Porchlight: a Standard scan of one folder every ${options.everyHours === 1 ? "hour" : `${options.everyHours} hours`}, kept for the interface.
# Porchlight printed this and installed nothing. It is two files: save each part below under
# ~/.config/systemd/user/ with the name its header gives, then run:
#   systemctl --user daemon-reload
#   systemctl --user enable --now porchlight-scan.timer
# To remove it: systemctl --user disable --now porchlight-scan.timer, then delete both files.

# ---- porchlight-scan.service ----
[Unit]
Description=Porchlight: Standard scan of the repositories in one folder

[Service]
Type=oneshot
Environment=${systemdWord(`PATH=${options.path}`)}
ExecStart=${scheduledCommand(options).map(systemdWord).join(" ")}
StandardOutput=null
StandardError=append:${systemdPath(options.log)}
Nice=10
IOSchedulingClass=idle

# ---- porchlight-scan.timer ----
[Unit]
Description=Run the Porchlight scan every ${options.everyHours === 1 ? "hour" : `${options.everyHours} hours`}

[Timer]
OnBootSec=15min
OnUnitActiveSec=${options.everyHours}h

[Install]
WantedBy=timers.target
`;
}

export function scheduleText(options: ScheduleOptions): string {
	return options.kind === "launchd" ? launchdAgent(options) : systemdUnits(options);
}

/** The command: `porchlight schedule print [--launchd|--systemd] [--root <dir>] [--every <hours>] [--depth <n>]`. */
export function scheduleCommand(command: string | undefined, args: string[], io: { print: (text: string) => void; warn: (text: string) => void }, defaults: { dataDir: string; platform?: NodeJS.Platform; node?: string; porchlight?: string; cwd?: string; path?: string }): number {
	if (command !== "print") throw new Error("Usage: porchlight schedule print [--launchd | --systemd] [--root <folder>] [--every <hours>] [--depth <n>]");
	const { values } = parseArgs({
		args,
		options: {
			launchd: { type: "boolean", default: false },
			systemd: { type: "boolean", default: false },
			root: { type: "string" },
			every: { type: "string", default: "24" },
			depth: { type: "string", default: "3" },
		},
	});
	if (values.launchd && values.systemd) throw new Error("Choose one of --launchd and --systemd");
	const kind = values.launchd ? "launchd" : values.systemd ? "systemd" : (defaults.platform ?? process.platform) === "darwin" ? "launchd" : "systemd";
	const whole = (text: string) => (/^\d{1,4}$/.test(text) ? Number(text) : Number.NaN);
	const text = scheduleText({
		kind,
		node: defaults.node ?? process.execPath,
		porchlight: defaults.porchlight ?? fileURLToPath(new URL("../bin/porchlight.js", import.meta.url)),
		root: resolve(defaults.cwd ?? process.cwd(), values.root ?? "."),
		log: join(defaults.dataDir, "scheduled-scan.log"),
		everyHours: whole(values.every),
		depth: whole(values.depth),
		// Each folder once, in the order this shell looks.
		path: [...new Set(safePath(defaults.path ?? process.env.PATH).split(delimiter))].join(delimiter),
	});
	io.print(text);
	io.warn(`Printed a ${kind === "launchd" ? "launchd agent" : "systemd user service and timer"}; nothing was installed. The comment at its top says how to install it.`);
	return 0;
}
