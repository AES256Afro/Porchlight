import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";
import { assistantConfig, isHosted } from "./assist/ollama.ts";
import { callMonitor, monitorConfig } from "./monitor/client.ts";
import { describeDomain, describeHistory } from "./monitor/describe.ts";
import { formatFor, NOTIFY_FORMATS, notifyTarget, type NotifyFormat } from "./notify/format.ts";
import { exitCode, parseScanReport, renderMarkdown, renderSummary } from "./repos/report.ts";
import { History } from "./repos/history.ts";
import { buildSbom } from "./repos/sbom.ts";
import { scanRepos, type RepoDone } from "./repos/scan.ts";
import { SEVERITIES, type ScanChoices, type Severity } from "./repos/types.ts";
import { ChoiceError, isPreset, parseChoices, presetOf, PRESETS } from "../ui/scan-choices.js";
import type { MonitorReport } from "./roadmap/domains.ts";
import { CONTENTS, exportDomain, exportRepos, parseFilter, type ExportFile } from "./roadmap/export.ts";
import { FORMATS } from "./roadmap/render.ts";
import { tokenProblem } from "./github/github.ts";
import { checkHost } from "./host/check.ts";
import { renderHostText } from "./host/render.ts";
import { run, type Runner } from "./repos/exec.ts";
import { adoptOldSettings, dataFolder } from "./legacy.ts";
import { renderDoctor, runDoctor, type DoctorOptions } from "./doctor.ts";
import { asksForHelp, helpFor, usage } from "./help.ts";
import { startUiServer } from "./ui/server.ts";
import { auditCloudflare } from "./cloudflare/audit.ts";
import { tokenShapeProblem } from "./cloudflare/client.ts";
import { renderCloudflareText } from "./cloudflare/export.ts";
import { readSavedToken } from "./cloudflare/store.ts";
import { readDomains, writePrivate } from "./investigate/ownership.ts";
import { forTerminal, jsonText } from "./roadmap/escape.ts";

/** Returns the process exit code: 0 ok, 1 error or incomplete scan under --fail-on, 2 findings at or above --fail-on. */
/**
 * Everything the CLI prints goes through these. Names, paths and titles come
 * from scanned repositories, DNS and advisories, and can carry terminal escape
 * sequences, so control characters are replaced before they reach a terminal.
 */
function print(text: string): void {
	process.stdout.write(forTerminal(text));
}

function say(text: string): void {
	print(`${text}\n`);
}

function warn(text: string): void {
	process.stderr.write(`${forTerminal(text)}\n`);
}

export async function main(argv: string[]): Promise<number> {
	// Settings given under the earlier prefix still count (BoxPilot and older app.env files use it).
	adoptOldSettings(process.env);
	const [group, command, ...rest] = argv;
	if (group === "--version" || group === "-v" || group === "version") {
		say(`porchlight ${await installedVersion()}`);
		return 0;
	}
	// Help for the command that was typed, before it is run: `porchlight repos scan --help`, or `porchlight help repos scan`.
	if (asksForHelp(argv)) {
		say((helpFor(group === "help" ? argv.slice(1) : argv) ?? usage()).trimEnd());
		return 0;
	}
	try {
		if (group === "doctor") return await doctor(argv.slice(1));
		if (group === "repos" && command === "scan") return await reposScan(rest);
		if (group === "repos" && command === "export") return await reposExport(rest);
		if (group === "repos" && command === "sbom") return await reposSbom(rest);
		if (group === "domains" && command === "export") return await domainsExport(rest);
		if (group === "domains" && command) return await domains(command, rest);
		if (group === "host" && command === "check") return await hostCheck(rest);
		if (group === "cloudflare" && command === "audit") return await cloudflareAudit(rest);
		if (group === "ui") return await ui(argv.slice(1));
	} catch (err) {
		warn(`porchlight: ${err instanceof Error ? err.message : String(err)}`);
		return 1;
	}
	// Not a command: say so, then show the commands of the group that was meant, or all of them.
	warn(`porchlight: unknown command: ${argv.join(" ")}\n`);
	warn((helpFor(argv) ?? usage()).trimEnd());
	return 1;
}

/** The version in this copy's package.json, which the Mac app and the container image carry too. */
async function installedVersion(): Promise<string> {
	try {
		const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as { version?: unknown };
		return typeof manifest.version === "string" ? manifest.version : "unknown";
	} catch {
		return "unknown";
	}
}

/**
 * Checks that Porchlight has what it needs. `deps` lets tests pass a scripted runner and network.
 */
export async function doctor(args: string[], deps: Partial<DoctorOptions> & { write?: (text: string) => void } = {}): Promise<number> {
	const { values } = parseArgs({ args, options: { json: { type: "boolean", default: false }, offline: { type: "boolean", default: false } } });
	const checks = await runDoctor({
		run: deps.run ?? run,
		env: deps.env ?? process.env,
		// Looked at where it is: doctor moves and makes nothing.
		dataDir: deps.dataDir ?? join(homedir(), ".porchlight"),
		nodeVersion: deps.nodeVersion ?? process.versions.node,
		...(values.offline ? {} : { fetchFn: deps.fetchFn ?? fetch }),
	});
	(deps.write ?? print)(values.json ? jsonText({ checks }) : renderDoctor(checks));
	return checks.some((check) => check.status === "problem") ? 1 : 0;
}

/**
 * "[3/17] shop  1.2s  4 findings": how far the scan is, which repository just finished, how long
 * it took and what it found. A scanner that failed there is said too, as the report will say it.
 */
export function progressLine(done: RepoDone, root: string): string {
	const width = String(done.total).length;
	const name = done.path === root ? basename(root) : relative(root, done.path) || done.path;
	const seconds = done.ms < 10_000 ? (done.ms / 1000).toFixed(1) : String(Math.round(done.ms / 1000));
	const found = done.findings === 1 ? "1 finding" : `${done.findings} findings`;
	const failed = done.errors > 0 ? `, ${done.errors === 1 ? "1 scanner" : `${done.errors} scanners`} failed` : "";
	return `[${String(done.done).padStart(width)}/${done.total}] ${name}  ${seconds}s  ${found}${failed}`;
}

/**
 * A CycloneDX bill of materials for the repositories under a folder. `deps` lets tests pass a
 * scripted runner and catch what is written.
 */
export async function reposSbom(args: string[], deps: { run?: Runner; write?: (text: string) => void } = {}): Promise<number> {
	const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { depth: { type: "string", default: "3" }, out: { type: "string" } } });
	const depth = Number.parseInt(values.depth, 10);
	if (!Number.isInteger(depth) || depth < 0) throw new Error("--depth must be a whole number");
	if (positionals.length > 1) throw new Error("Give at most one path");
	const root = resolve(positionals[0] ?? ".");
	const sbom = await buildSbom({ root, depth, ...(deps.run ? { run: deps.run } : {}), onProgress: (done, total, repo) => warn(`[${done + 1}/${total}] ${repo}`) });
	const text = jsonText(sbom);
	const missed = sbom.metadata.properties?.length ?? 0;
	const packages = sbom.components.reduce((sum, repo) => sum + repo.components.length, 0);
	if (values.out) {
		await writePrivate(values.out, text);
		say(`${packages} packages in ${sbom.components.length} repositories, written to ${values.out}`);
	} else (deps.write ?? print)(text);
	if (missed > 0) warn(`porchlight: ${missed === 1 ? "1 repository" : `${missed} repositories`} could not be read, and the SBOM names ${missed === 1 ? "it" : "them"} as not covered`);
	return missed > 0 ? 1 : 0;
}

/**
 * The scan choices the flags ask for: a preset (standard when none is named), changed by any switch
 * given. The model's deeper analysis is the interface's alone, so `--preset deep` scans as Deep does
 * (private data included) without it, and keeps the name.
 */
export function choicesFromFlags(values: { preset?: string; checks?: string; history?: string; "local-files"?: boolean; skip?: string[] }): ScanChoices {
	const input: Record<string, unknown> = { analyse: false };
	if (values.preset !== undefined) {
		if (!isPreset(values.preset)) throw new Error(`--preset must be one of: ${PRESETS.map((preset) => preset.key).join(", ")}`);
		input.preset = values.preset;
	}
	if (values.checks !== undefined) {
		const checks = values.checks.split(",").map((check) => check.trim()).filter((check) => check !== "");
		const unknown = checks.filter((check) => check !== "secrets" && check !== "dependencies" && check !== "private-data");
		if (unknown.length > 0 || checks.length === 0) throw new Error("--checks takes secrets, dependencies and private-data, any of them separated by commas");
		input.secrets = checks.includes("secrets");
		input.dependencies = checks.includes("dependencies");
		input.privateData = checks.includes("private-data");
	}
	if (values.history !== undefined) input.history = values.history;
	if (values["local-files"]) input.localFiles = true;
	if (values.skip !== undefined) input.skip = values.skip.flatMap((names) => names.split(","));
	try {
		const choices = parseChoices(input);
		// Without the interface there is no model to hand over to; the preset's name stays, as chosen.
		return values.preset === "deep" && presetOf({ ...choices, analyse: true }) === "deep" ? { ...choices, preset: "deep" } : choices;
	} catch (err) {
		if (err instanceof ChoiceError) throw new Error(err.message.replace(/^History/, "--history").replace(/^Skip/, "--skip"));
		throw err;
	}
}

/** `deps` lets tests pass a scripted runner and their own folder. */
export async function reposScan(args: string[], deps: { run?: Runner; dataDir?: string } = {}): Promise<number> {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			depth: { type: "string", default: "3" },
			out: { type: "string" },
			json: { type: "boolean", default: false },
			save: { type: "boolean", default: false },
			"osv-db": { type: "string" },
			"fail-on": { type: "string" },
			preset: { type: "string" },
			checks: { type: "string" },
			history: { type: "string" },
			"local-files": { type: "boolean", default: false },
			skip: { type: "string", multiple: true },
		},
	});
	const depth = Number.parseInt(values.depth, 10);
	if (!Number.isInteger(depth) || depth < 0) throw new Error("--depth must be a whole number");
	const failOn = values["fail-on"];
	if (failOn !== undefined && !SEVERITIES.includes(failOn as Severity)) {
		throw new Error(`--fail-on must be one of: ${SEVERITIES.join(", ")}`);
	}
	if (positionals.length > 1) throw new Error("Give at most one path");
	const choices = choicesFromFlags(values);

	const scanRoot = resolve(positionals[0] ?? ".");
	const report = await scanRepos({
		...(deps.run ? { run: deps.run } : {}),
		root: scanRoot,
		choices,
		...(values["osv-db"] ? { osvDatabase: resolve(values["osv-db"]) } : {}),
		depth,
		// One line a repository as it finishes, on the error stream so the report itself can be piped.
		onRepoDone: (done) => warn(progressLine(done, scanRoot)),
	});
	if (report.repos.length === 0) throw new Error(`No git repositories found under ${report.root}`);
	if (report.tools.every((tool) => tool.status === "missing")) {
		throw new Error(`No scanner is installed. Install one: ${report.tools.map((tool) => tool.installHint).join("; ")}`);
	}

	const rendered = values.json ? jsonText(report) : renderMarkdown(report);
	if (values.out) {
		await writePrivate(values.out, rendered);
		say(renderSummary(report));
		say(`Report written to ${values.out}`);
	} else {
		print(rendered);
	}
	if (values.save) {
		// Where the interface reads it, and in its history, so `porchlight ui` shows this scan.
		const dir = deps.dataDir ?? (await dataFolder(homedir()));
		await writePrivate(join(dir, "repo-scan.json"), jsonText(report));
		await new History(dir).add(report);
		warn(`Saved for the interface: ${join(dir, "repo-scan.json")}`);
	}
	const code = exitCode(report, failOn as Severity | undefined);
	if (code === 1) warn("porchlight: the scan was incomplete (see \"Not covered\"), so --fail-on cannot pass");
	return code;
}

async function hostCheck(args: string[]): Promise<number> {
	const { values } = parseArgs({ args, options: { json: { type: "boolean", default: false }, offline: { type: "boolean", default: false } } });
	const report = await checkHost({
		run,
		askApple: !values.offline,
		lookUpPackages: !values.offline,
		onProgress: ({ done, total, current }) => {
			if (current) warn(`Checking ${done + 1} of ${total}: ${current}`);
		},
	});
	print(values.json ? jsonText(report) : renderHostText(report));
	return 0;
}

/**
 * Audits the owner's Cloudflare account and prints what the built-in rules found. Reads only: changes
 * are made from the interface, one at a time, after the owner approves the exact request.
 * `deps` lets tests pass a fake network and their own folder.
 */
export async function cloudflareAudit(args: string[], deps: { fetchFn?: typeof fetch; env?: NodeJS.ProcessEnv; dataDir?: string; write?: (text: string) => void } = {}): Promise<number> {
	const { values } = parseArgs({ args, options: { json: { type: "boolean", default: false }, "no-lookups": { type: "boolean", default: false } } });
	const env = deps.env ?? process.env;
	const dir = deps.dataDir ?? (await dataFolder(homedir()));
	// BoxPilot passes an optional setting left empty as an empty variable, so empty counts as not given.
	const token = env.PORCHLIGHT_CLOUDFLARE_TOKEN?.trim() || (await readSavedToken(join(dir, "cloudflare-settings.json")))?.token;
	if (!token) throw new Error("No Cloudflare API token. Save one under Settings → Cloudflare in the interface, or set PORCHLIGHT_CLOUDFLARE_TOKEN. It needs read permissions only; the README lists them.");
	const problem = tokenShapeProblem(token);
	if (problem) throw new Error(`PORCHLIGHT_CLOUDFLARE_TOKEN: ${problem}`);
	const domains = await readDomains(join(dir, "investigate-domains.json"));
	const report = await auditCloudflare({
		token,
		fetchFn: deps.fetchFn,
		lookups: !values["no-lookups"],
		ownershipTokens: Object.fromEntries(Object.entries(domains.domains).map(([name, entry]) => [name, entry.token])),
		onProgress: ({ done, total, current }) => {
			if (current) warn(`Reading ${Math.min(done + 1, total)} of ${total}: ${current}`);
		},
	});
	(deps.write ?? print)(values.json ? jsonText(report) : renderCloudflareText(report));
	return 0;
}

const EXPORT_OPTIONS = {
	content: { type: "string", default: "roadmap" },
	format: { type: "string", default: "md" },
	out: { type: "string" },
} as const;

async function reposExport(args: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: { ...EXPORT_OPTIONS, severity: { type: "string" }, kind: { type: "string" }, match: { type: "string" }, repo: { type: "string" } },
	});
	const [path, ...extra] = positionals;
	if (!path || extra.length > 0) throw new Error("Usage: porchlight repos export <report.json> [--content roadmap|findings] [--format md|html|csv|json]");
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch {
		throw new Error(`Cannot read ${path}. Make a report with: porchlight repos scan <folder> --json --out ${path}`);
	}
	const filter = parseFilter({ severity: values.severity, kind: values.kind, match: values.match, repo: values.repo });
	return deliver(exportRepos(parseScanReport(text, path), values, filter), values.out);
}

async function domainsExport(args: string[]): Promise<number> {
	const { values, positionals } = parseArgs({ args, allowPositionals: true, options: EXPORT_OPTIONS });
	const [domain, ...extra] = positionals;
	if (!domain || extra.length > 0) throw new Error(`Usage: porchlight domains export <domain> [--content ${CONTENTS.join("|")}] [--format ${FORMATS.join("|")}]`);
	const { status, body } = await callMonitor(monitorConfig(process.env), "GET", `/domains/${encodeURIComponent(domain)}`);
	if (status >= 400) throw new Error(body.error ?? `HTTP ${status}`);
	if (!body.report) throw new Error(`${domain} has not been scanned yet, so there is nothing to export`);
	return deliver(exportDomain(body.report as MonitorReport, values), values.out);
}

async function deliver(file: ExportFile, out: string | undefined): Promise<number> {
	if (!out) {
		print(file.body);
		return 0;
	}
	await writePrivate(out, file.body);
	say(`Written to ${out}`);
	return 0;
}

/** Starts the web interface. The process then stays up, serving it, until interrupted. */
async function ui(args: string[]): Promise<number> {
	const { values } = parseArgs({
		args,
		options: {
			host: { type: "string", default: "127.0.0.1" },
			port: { type: "string" },
			report: { type: "string" },
			root: { type: "string", default: "." },
		},
	});
	const port = Number.parseInt(values.port ?? String(DEFAULT_UI_PORT), 10);
	if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be a port number");
	// A port the user asked for is used or refused. The default on this
	// machine is only a starting point: if another copy already has it, take
	// the next free one. Elsewhere (a container) the port is part of the
	// deployment, so it is never moved.
	const mayMove = values.port === undefined && values.host === "127.0.0.1";
	const candidates = mayMove ? Array.from({ length: PORT_ATTEMPTS }, (_, i) => port + i) : [port];
	// A key from the environment is the owner's, so it is never printed.
	const fixedKey = process.env.PORCHLIGHT_UI_KEY || undefined;

	let monitor = null;
	let monitorError: string | undefined;
	try {
		monitor = monitorConfig(process.env);
	} catch (err) {
		monitorError = err instanceof Error ? err.message : String(err);
	}
	let assistant = null;
	let assistantError: string | undefined;
	try {
		assistant = assistantConfig(process.env);
	} catch (err) {
		assistantError = err instanceof Error ? err.message : String(err);
	}
	// BoxPilot passes an optional setting left empty as an empty variable, so empty counts as not given.
	const githubToken = process.env.PORCHLIGHT_GITHUB_TOKEN?.trim() || undefined;
	const githubError = githubToken ? (tokenProblem(githubToken) ?? undefined) : undefined;
	const cloudflareToken = process.env.PORCHLIGHT_CLOUDFLARE_TOKEN?.trim() || undefined;
	const cloudflareTokenError = cloudflareToken ? (tokenShapeProblem(cloudflareToken) ?? undefined) : undefined;
	const reportPath = resolve(values.report ?? join(await dataFolder(homedir()), "repo-scan.json"));
	const scanDepth = wholeNumberSetting("PORCHLIGHT_SCAN_DEPTH", 0, 6);
	const scanEveryHours = wholeNumberSetting("PORCHLIGHT_SCAN_EVERY_HOURS", 1, 720);
	const notify = notifySetting();
	const osvOffline = /^(1|true|yes)$/i.test(process.env.PORCHLIGHT_OSV_OFFLINE?.trim() ?? "");
	// The address is the switch: BoxPilot fills the model setting with a default, so a model alone turns nothing on.
	// Off, as opposed to a setting to correct: no provider chosen and no address given.
	const assistantUnset = !process.env.PORCHLIGHT_LLM_PROVIDER?.trim() && !process.env.PORCHLIGHT_LLM_URL?.trim();

	const server = await listenOnFirstFree(candidates, (candidate) =>
		startUiServer({
			port: candidate,
			host: values.host,
			sessionKey: fixedKey,
			reportPath,
			// Fetched repositories are kept beside the report: in a container, on its data volume.
			github: { dir: join(dirname(reportPath), "github"), ...(githubToken && !githubError ? { token: githubToken } : {}) },
			githubError,
			defaultRoot: resolve(values.root),
			...(scanDepth !== undefined ? { scanDepth } : {}),
			...(scanEveryHours !== undefined ? { scanEveryHours } : {}),
			...(notify ? { notify } : {}),
			...(osvOffline ? { osvOffline } : {}),
			monitor,
			monitorError,
			// BoxPilot passes an optional setting left empty as an empty variable, so empty counts as not given.
			monitorUnset: !process.env.PORCHLIGHT_MONITOR_URL && !process.env.PORCHLIGHT_ADMIN_TOKEN,
			assistant,
			assistantError,
			assistantUnset,
			...(cloudflareToken && !cloudflareTokenError ? { cloudflareToken } : {}),
			cloudflareTokenError,
		}),
	);
	if (server.port !== port && port !== 0) say(`Port ${port} is in use, so this copy is on ${server.port}.`);
	if (fixedKey) {
		say(`Porchlight is listening on ${values.host} port ${server.port}. Sign in with the key in PORCHLIGHT_UI_KEY.`);
	} else {
		say(`Porchlight is running. Open this link (it carries this session's key):\n\n  ${server.url}\n`);
	}
	say(monitor ? `Monitor: ${monitor.url.host}` : `Monitor: not connected (${monitorError})`);
	// A model chosen in Settings → Model replaces the one given here.
	const inUse = server.model();
	const from = inUse.source === "settings" ? ", chosen in Settings" : "";
	if (inUse.config) say(`Model: ${inUse.config.model} at ${inUse.config.url.host}${from}${isHosted(inUse.config) ? " (hosted: what the pages show is sent there when you ask)" : ""}`);
	else say(inUse.unset ? `Model: off${from} (choose one in Settings → Model)` : `Model: not connected${from} (${inUse.error})`);
	say(githubError ? `GitHub: token not used (${githubError})` : githubToken ? "GitHub: token set, private repositories can be fetched" : "GitHub: no token, public repositories only (set PORCHLIGHT_GITHUB_TOKEN for private ones)");
	if (scanEveryHours !== undefined) say(`Scans: ${resolve(values.root)} again every ${scanEveryHours === 1 ? "hour" : `${scanEveryHours} hours`}, ${scanDepth ?? 3} folder levels down`);
	// The address can carry a token (a Slack or Discord webhook is one), so only its host is printed.
	if (notify) say(`Notices: the outcome of each scheduled scan goes to ${notify.url.host} (${notify.format})${scanEveryHours === undefined ? ", but no schedule is set (PORCHLIGHT_SCAN_EVERY_HOURS)" : ""}`);
	say("Press Ctrl+C to stop.");
	return 0;
}

/**
 * Where scheduled scans report (PORCHLIGHT_NOTIFY_URL) and in which format (PORCHLIGHT_NOTIFY_FORMAT,
 * or the one the address shows). Undefined when not set; a setting that cannot be used stops
 * Porchlight with what to correct, without printing the address, which may hold a token.
 */
function notifySetting(): { url: URL; format: NotifyFormat } | undefined {
	const raw = process.env.PORCHLIGHT_NOTIFY_URL?.trim();
	if (!raw) return undefined;
	const url = notifyTarget(raw);
	if (!url) throw new Error("PORCHLIGHT_NOTIFY_URL must be an https address, or plain http on this machine or a private network, with no user name or password");
	const format = formatFor(url, process.env.PORCHLIGHT_NOTIFY_FORMAT);
	if (!format) throw new Error(`PORCHLIGHT_NOTIFY_FORMAT must be one of: ${NOTIFY_FORMATS.join(", ")}, or empty`);
	return { url, format };
}

/**
 * A whole number from the environment, or undefined when it is not set. BoxPilot passes an optional
 * setting left empty as an empty variable, so empty counts as not set. Anything else that is not a
 * number in range stops Porchlight with what to correct, rather than being quietly ignored.
 */
function wholeNumberSetting(name: string, least: number, most: number): number | undefined {
	const raw = process.env[name]?.trim();
	if (!raw) return undefined;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < least || value > most) throw new Error(`${name} must be a whole number from ${least} to ${most}, or empty`);
	return value;
}

const DEFAULT_UI_PORT = 4747;
const PORT_ATTEMPTS = 10;

/** Starts a server on the first of `ports` that is free. Any failure other than "in use" is raised at once. */
export async function listenOnFirstFree<T>(ports: number[], start: (port: number) => Promise<T>): Promise<T> {
	for (const port of ports) {
		try {
			return await start(port);
		} catch (err) {
			if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
		}
	}
	const range = ports.length > 1 ? `Ports ${ports[0]} to ${ports.at(-1)} are` : `Port ${ports[0]} is`;
	throw new Error(`${range} in use. Choose another with --port`);
}

async function domains(command: string, args: string[]): Promise<number> {
	const config = monitorConfig(process.env);
	const domain = args[0];
	const needsDomain = command !== "list";
	if (needsDomain && !domain) throw new Error(`Usage: porchlight domains ${command} <domain>`);
	const path = `/domains/${encodeURIComponent(domain ?? "")}`;

	const requests: Record<string, () => ReturnType<typeof callMonitor>> = {
		list: () => callMonitor(config, "GET", "/domains"),
		add: () => callMonitor(config, "POST", "/domains", { domain }),
		verify: () => callMonitor(config, "POST", `${path}/verify`),
		scan: () => callMonitor(config, "POST", `${path}/scan`),
		show: () => callMonitor(config, "GET", path),
		history: () => callMonitor(config, "GET", `${path}/history`),
		remove: () => callMonitor(config, "DELETE", path),
	};
	const request = requests[command];
	if (!request) throw new Error(`Unknown domains command: ${command}`);

	const { status, body } = await request();
	if (status >= 400) {
		warn(`porchlight: ${body.error ?? `HTTP ${status}`}`);
		if (body.challenge) warn(describeChallenge(body.challenge));
		return 1;
	}

	switch (command) {
		case "list":
			if (body.domains.length === 0) say("No domains registered.");
			for (const entry of body.domains) say(describeDomain(entry));
			break;
		case "add":
			say(`Registered ${body.domain.name}. Publish this DNS record, then run: porchlight domains verify ${body.domain.name}`);
			say(describeChallenge(body.domain.challenge));
			break;
		case "verify":
			say(`${body.domain.name} is verified. Keep the TXT record in place: it is re-checked before every scan.`);
			break;
		case "scan":
			say(body.text);
			break;
		case "show":
			say(describeDomain(body.domain));
			say(body.text ?? "No scan yet.");
			break;
		case "history":
			say(describeHistory(body.domain, body.history));
			break;
		case "remove":
			say(`Removed ${body.deleted} and its scan history.`);
			break;
	}
	return 0;
}

function describeChallenge(challenge: { type: string; name: string; value: string }): string {
	return `  Type:  ${challenge.type}\n  Name:  ${challenge.name}\n  Value: ${challenge.value}`;
}

