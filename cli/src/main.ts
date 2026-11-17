import { writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { callMonitor, monitorConfig } from "./monitor/client.ts";
import { exitCode, renderMarkdown, renderSummary } from "./repos/report.ts";
import { scanRepos } from "./repos/scan.ts";
import { SEVERITIES, type Severity } from "./repos/types.ts";
import { startUiServer } from "./ui/server.ts";

const USAGE = `SecurityX

Usage:
  securityx repos scan [path]      Scan git repositories under path (default: .)
      --depth <n>                  Directory levels to search for repositories (default: 3)
      --out <file>                 Write the Markdown report to a file instead of stdout
      --json                       Print the report as JSON
      --fail-on <severity>         Exit 2 if any finding is at or above: ${SEVERITIES.join(", ")}
                                   Exit 1 if a scanner was missing or failed

  securityx domains list           Domains registered with the monitor
  securityx domains add <domain>   Register a domain and show its verification record
  securityx domains verify <domain>
  securityx domains scan <domain>  Scan now and print what changed
  securityx domains show <domain>  Latest report
  securityx domains remove <domain>

  securityx ui                     Open the local web interface for both tools
      --port <n>                   Port to listen on (default: 4747)
      --host <address>             Address to listen on (default: 127.0.0.1). Any other
                                   address needs SECURITYX_UI_KEY, a key of 32+ characters
      --report <file>              Scan report to show and update (default: ~/.securityx/repo-scan.json)
      --root <dir>                 Folder offered in the scan form (default: .)

The domains commands, and the Domains page of the interface, need
SECURITYX_MONITOR_URL and SECURITYX_ADMIN_TOKEN.
`;

/** Returns the process exit code: 0 ok, 1 error or incomplete scan under --fail-on, 2 findings at or above --fail-on. */
export async function main(argv: string[]): Promise<number> {
	const [group, command, ...rest] = argv;
	try {
		if (group === "repos" && command === "scan") return await reposScan(rest);
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

/** Starts the web interface. The process then stays up, serving it, until interrupted. */
async function ui(args: string[]): Promise<number> {
	const { values } = parseArgs({
		args,
		options: {
			host: { type: "string", default: "127.0.0.1" },
			port: { type: "string", default: "4747" },
			report: { type: "string" },
			root: { type: "string", default: "." },
		},
	});
	const port = Number.parseInt(values.port, 10);
	if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be a port number");
	// A key from the environment is the owner's, so it is never printed.
	const fixedKey = process.env.SECURITYX_UI_KEY || undefined;

	let monitor = null;
	let monitorError: string | undefined;
	try {
		monitor = monitorConfig(process.env);
	} catch (err) {
		monitorError = err instanceof Error ? err.message : String(err);
	}

	let server;
	try {
		server = await startUiServer({
			port,
			host: values.host,
			sessionKey: fixedKey,
			reportPath: resolve(values.report ?? join(homedir(), ".securityx", "repo-scan.json")),
			defaultRoot: resolve(values.root),
			monitor,
			monitorError,
		});
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
			throw new Error(`Port ${port} is in use. Choose another with --port`);
		}
		throw err;
	}
	if (fixedKey) {
		console.log(`SecurityX is listening on ${values.host} port ${server.port}. Sign in with the key in SECURITYX_UI_KEY.`);
	} else {
		console.log(`SecurityX is running. Open this link (it carries this session's key):\n\n  ${server.url}\n`);
	}
	console.log(monitor ? `Monitor: ${monitor.url.host}` : `Monitor: not connected (${monitorError})`);
	console.log("Press Ctrl+C to stop.");
	return 0;
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
