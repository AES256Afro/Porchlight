import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { assistantConfig, isHosted } from "./assist/ollama.ts";
import { callMonitor, monitorConfig } from "./monitor/client.ts";
import { exitCode, parseScanReport, renderMarkdown, renderSummary } from "./repos/report.ts";
import { scanRepos } from "./repos/scan.ts";
import { SEVERITIES, type Severity } from "./repos/types.ts";
import type { MonitorReport } from "./roadmap/domains.ts";
import { CONTENTS, exportDomain, exportRepos, parseFilter, type ExportFile } from "./roadmap/export.ts";
import { FORMATS } from "./roadmap/render.ts";
import { tokenProblem } from "./github/github.ts";
import { startUiServer } from "./ui/server.ts";

const USAGE = `SecurityX

Usage:
  securityx repos scan [path]      Scan git repositories under path (default: .)
      --depth <n>                  Directory levels to search for repositories (default: 3)
      --out <file>                 Write the Markdown report to a file instead of stdout
      --json                       Print the report as JSON
      --fail-on <severity>         Exit 2 if any finding is at or above: ${SEVERITIES.join(", ")}
                                   Exit 1 if a scanner was missing or failed

  securityx repos export <report>  Turn a report written with --json into a repair roadmap
      --content <what>             roadmap: repairs in order (default); findings: every finding with its fix
      --format <format>            ${FORMATS.join(", ")} (default: md)
      --out <file>                 Write to a file instead of stdout
      --severity <list>            Only these severities, comma-separated
      --kind <type>                Only secret or vulnerability findings
      --match <text>               Only findings mentioning this text
      --repo <name>                Only this repository

  securityx domains list           Domains registered with the monitor
  securityx domains add <domain>   Register a domain and show its verification record
  securityx domains verify <domain>
  securityx domains scan <domain>  Scan now and print what changed
  securityx domains show <domain>  Latest report
  securityx domains remove <domain>
  securityx domains export <domain>  Repair roadmap for a domain; takes --content, --format and --out

  securityx ui                     Open the local web interface for both tools
      --port <n>                   Port to listen on (default: 4747, or the next free port)
      --host <address>             Address to listen on (default: 127.0.0.1). Any other
                                   address needs SECURITYX_UI_KEY, a key of 32+ characters
      --report <file>              Scan report to show and update (default: ~/.securityx/repo-scan.json)
      --root <dir>                 Folder offered in the scan form (default: .)

The domains commands, and the Domains page of the interface, need
SECURITYX_MONITOR_URL and SECURITYX_ADMIN_TOKEN.

The interface's Explain, Summarise and Ask buttons use a local model served by
Ollama, named by SECURITYX_LLM_URL (its address) and SECURITYX_LLM_MODEL.

Other models, chosen with SECURITYX_LLM_PROVIDER: "compatible" for a server
that speaks OpenAI's format at SECURITYX_LLM_URL (LM Studio, llama.cpp), or a
hosted one ("anthropic", "openai", "deepseek") with SECURITYX_LLM_API_KEY.

The interface can fetch repositories from GitHub to scan. Public ones need
nothing; private ones need SECURITYX_GITHUB_TOKEN, a token that can read them.
`;

/** Returns the process exit code: 0 ok, 1 error or incomplete scan under --fail-on, 2 findings at or above --fail-on. */
export async function main(argv: string[]): Promise<number> {
	const [group, command, ...rest] = argv;
	try {
		if (group === "repos" && command === "scan") return await reposScan(rest);
		if (group === "repos" && command === "export") return await reposExport(rest);
		if (group === "domains" && command === "export") return await domainsExport(rest);
		if (group === "domains" && command) return await domains(command, rest);
		if (group === "ui") return await ui(argv.slice(1));
	} catch (err) {
		console.error(`securityx: ${err instanceof Error ? err.message : String(err)}`);
		return 1;
	}
	const asksForHelp = group === undefined || group === "help" || group === "--help" || group === "-h";
	(asksForHelp ? console.log : console.error)(USAGE);
	return asksForHelp ? 0 : 1;
}

async function reposScan(args: string[]): Promise<number> {
	const { values, positionals } = parseArgs({
		args,
		allowPositionals: true,
		options: {
			depth: { type: "string", default: "3" },
			out: { type: "string" },
			json: { type: "boolean", default: false },
			"fail-on": { type: "string" },
		},
	});
	const depth = Number.parseInt(values.depth, 10);
	if (!Number.isInteger(depth) || depth < 0) throw new Error("--depth must be a whole number");
	const failOn = values["fail-on"];
	if (failOn !== undefined && !SEVERITIES.includes(failOn as Severity)) {
		throw new Error(`--fail-on must be one of: ${SEVERITIES.join(", ")}`);
	}
	if (positionals.length > 1) throw new Error("Give at most one path");

	const report = await scanRepos({
		root: positionals[0] ?? ".",
		depth,
		onProgress: ({ path }) => console.error(`Scanning ${path}`),
	});
	if (report.repos.length === 0) throw new Error(`No git repositories found under ${report.root}`);
	if (report.tools.every((tool) => tool.status === "missing")) {
		throw new Error(`No scanner is installed. Install one: ${report.tools.map((tool) => tool.installHint).join("; ")}`);
	}

	const rendered = values.json ? `${JSON.stringify(report, null, "\t")}\n` : renderMarkdown(report);
	if (values.out) {
		await writeFile(values.out, rendered);
		console.log(renderSummary(report));
		console.log(`Report written to ${values.out}`);
	} else {
		process.stdout.write(rendered);
	}
	const code = exitCode(report, failOn as Severity | undefined);
	if (code === 1) console.error("securityx: the scan was incomplete (see \"Not covered\"), so --fail-on cannot pass");
	return code;
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
	if (!path || extra.length > 0) throw new Error("Usage: securityx repos export <report.json> [--content roadmap|findings] [--format md|html|csv|json]");
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch {
		throw new Error(`Cannot read ${path}. Make a report with: securityx repos scan <folder> --json --out ${path}`);
	}
	const filter = parseFilter({ severity: values.severity, kind: values.kind, match: values.match, repo: values.repo });
	return deliver(exportRepos(parseScanReport(text, path), values, filter), values.out);
}

async function domainsExport(args: string[]): Promise<number> {
	const { values, positionals } = parseArgs({ args, allowPositionals: true, options: EXPORT_OPTIONS });
	const [domain, ...extra] = positionals;
	if (!domain || extra.length > 0) throw new Error(`Usage: securityx domains export <domain> [--content ${CONTENTS.join("|")}] [--format ${FORMATS.join("|")}]`);
	const { status, body } = await callMonitor(monitorConfig(process.env), "GET", `/domains/${encodeURIComponent(domain)}`);
	if (status >= 400) throw new Error(body.error ?? `HTTP ${status}`);
	if (!body.report) throw new Error(`${domain} has not been scanned yet, so there is nothing to export`);
	return deliver(exportDomain(body.report as MonitorReport, values), values.out);
}

async function deliver(file: ExportFile, out: string | undefined): Promise<number> {
	if (!out) {
		process.stdout.write(file.body);
		return 0;
	}
	await writeFile(out, file.body);
	console.log(`Written to ${out}`);
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
	const fixedKey = process.env.SECURITYX_UI_KEY || undefined;

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
	const githubToken = process.env.SECURITYX_GITHUB_TOKEN?.trim() || undefined;
	const githubError = githubToken ? (tokenProblem(githubToken) ?? undefined) : undefined;
	const reportPath = resolve(values.report ?? join(homedir(), ".securityx", "repo-scan.json"));
	// The address is the switch: BoxPilot fills the model setting with a default, so a model alone turns nothing on.
	// Off, as opposed to a setting to correct: no provider chosen and no address given.
	const assistantUnset = !process.env.SECURITYX_LLM_PROVIDER?.trim() && !process.env.SECURITYX_LLM_URL?.trim();

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
			monitor,
			monitorError,
			// BoxPilot passes an optional setting left empty as an empty variable, so empty counts as not given.
			monitorUnset: !process.env.SECURITYX_MONITOR_URL && !process.env.SECURITYX_ADMIN_TOKEN,
			assistant,
			assistantError,
			assistantUnset,
		}),
	);
	if (server.port !== port && port !== 0) console.log(`Port ${port} is in use, so this copy is on ${server.port}.`);
	if (fixedKey) {
		console.log(`SecurityX is listening on ${values.host} port ${server.port}. Sign in with the key in SECURITYX_UI_KEY.`);
	} else {
		console.log(`SecurityX is running. Open this link (it carries this session's key):\n\n  ${server.url}\n`);
	}
	console.log(monitor ? `Monitor: ${monitor.url.host}` : `Monitor: not connected (${monitorError})`);
	// A model chosen in Settings → Model replaces the one given here.
	const inUse = server.model();
	const from = inUse.source === "settings" ? ", chosen in Settings" : "";
	if (inUse.config) console.log(`Model: ${inUse.config.model} at ${inUse.config.url.host}${from}${isHosted(inUse.config) ? " (hosted: what the pages show is sent there when you ask)" : ""}`);
	else console.log(inUse.unset ? `Model: off${from} (choose one in Settings → Model)` : `Model: not connected${from} (${inUse.error})`);
	console.log(githubError ? `GitHub: token not used (${githubError})` : githubToken ? "GitHub: token set, private repositories can be fetched" : "GitHub: no token, public repositories only (set SECURITYX_GITHUB_TOKEN for private ones)");
	console.log("Press Ctrl+C to stop.");
	return 0;
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
	if (needsDomain && !domain) throw new Error(`Usage: securityx domains ${command} <domain>`);
	const path = `/domains/${encodeURIComponent(domain ?? "")}`;

	const requests: Record<string, () => ReturnType<typeof callMonitor>> = {
		list: () => callMonitor(config, "GET", "/domains"),
		add: () => callMonitor(config, "POST", "/domains", { domain }),
		verify: () => callMonitor(config, "POST", `${path}/verify`),
		scan: () => callMonitor(config, "POST", `${path}/scan`),
		show: () => callMonitor(config, "GET", path),
		remove: () => callMonitor(config, "DELETE", path),
	};
	const request = requests[command];
	if (!request) throw new Error(`Unknown domains command: ${command}`);

	const { status, body } = await request();
	if (status >= 400) {
		console.error(`securityx: ${body.error ?? `HTTP ${status}`}`);
		if (body.challenge) console.error(describeChallenge(body.challenge));
		return 1;
	}

	switch (command) {
		case "list":
			if (body.domains.length === 0) console.log("No domains registered.");
			for (const entry of body.domains) console.log(describeDomain(entry));
			break;
		case "add":
			console.log(`Registered ${body.domain.name}. Publish this DNS record, then run: securityx domains verify ${body.domain.name}`);
			console.log(describeChallenge(body.domain.challenge));
			break;
		case "verify":
			console.log(`${body.domain.name} is verified. Keep the TXT record in place: it is re-checked before every scan.`);
			break;
		case "scan":
			console.log(body.text);
			break;
		case "show":
			console.log(describeDomain(body.domain));
			console.log(body.text ?? "No scan yet.");
			break;
		case "remove":
			console.log(`Removed ${body.deleted} and its scan history.`);
			break;
	}
	return 0;
}

function describeChallenge(challenge: { type: string; name: string; value: string }): string {
	return `  Type:  ${challenge.type}\n  Name:  ${challenge.name}\n  Value: ${challenge.value}`;
}

function describeDomain(domain: { name: string; verified: boolean; lastScanAt: string | null; lastScanStatus: string | null }): string {
	const state = domain.verified ? "verified" : "not verified";
	const scan = domain.lastScanAt ? `last scan ${domain.lastScanAt} (${domain.lastScanStatus})` : "never scanned";
	return `${domain.name}: ${state}, ${scan}`;
}
