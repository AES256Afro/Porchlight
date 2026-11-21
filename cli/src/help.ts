import { FORMATS } from "./roadmap/render.ts";
import { SEVERITIES } from "./repos/types.ts";

// What `porchlight help`, `porchlight <command> --help` and a mistyped command print. Each command
// has its own text, so asking about one does not print them all.

interface Topic {
	/** How it is typed, after "porchlight". */
	command: string;
	/** One line for the list of commands. */
	summary: string;
	/** Everything about it: usage, options, what it needs. */
	detail: string;
}

const TOPICS: Topic[] = [
	{
		command: "repos scan",
		summary: "Scan git repositories for committed secrets and vulnerable packages",
		detail: `Usage: porchlight repos scan [path]

Scans every git repository under path (default: the current folder) with gitleaks and
osv-scanner, and prints one ranked report. Progress goes to the error stream, one line a repository.

  --depth <n>            Folder levels to search for repositories (default: 3)
  --out <file>           Write the report to a file instead of printing it
  --json                 Write the report as JSON, the form \`repos export\` and the interface read
  --osv-db <folder>      Keep OSV's vulnerability databases in this folder and compare against them,
                         so package names are not sent to api.osv.dev (the first scan downloads them)
  --save                 Also keep the scan where the interface reads it (~/.porchlight), in its
                         history too, so \`porchlight ui\` shows it. Replaces the scan shown there
  --fail-on <severity>   Exit 2 if any finding is at or above: ${SEVERITIES.join(", ")}
                         Exit 1 if a scanner was missing or failed`,
	},
	{
		command: "repos export",
		summary: "Turn a JSON report into a repair roadmap or a list of findings",
		detail: `Usage: porchlight repos export <report.json>

  --content <what>       roadmap: repairs in order (default); findings: every finding with its fix
  --format <format>      ${FORMATS.join(", ")} (default: md)
  --out <file>           Write to a file instead of printing it
  --severity <list>      Only these severities, comma-separated
  --kind <type>          Only secret or vulnerability findings
  --match <text>         Only findings mentioning this text
  --repo <name>          Only this repository`,
	},
	{
		command: "domains",
		summary: "Register, verify and scan the domains your monitor watches",
		detail: `Usage: porchlight domains <command> [domain]

  list                   Domains registered with the monitor
  add <domain>           Register a domain and show its verification record
  verify <domain>        Check that the verification record is published
  scan <domain>          Scan now and print what changed
  show <domain>          Latest report
  history <domain>       Each kept scan, newest first, with what changed in it
  remove <domain>        Stop watching it and delete its scan history
  export <domain>        Repair roadmap for a domain; takes --content, --format and --out

Needs PORCHLIGHT_MONITOR_URL (the monitor's address) and PORCHLIGHT_ADMIN_TOKEN.`,
	},
	{
		command: "host check",
		summary: "Check this computer: updates, protection, open services, credentials in files",
		detail: `Usage: porchlight host check

Checks this computer: updates, built-in protection, what accepts connections, credentials in
files, installed packages. It only reads.

  --json                 Print the result as JSON
  --offline              Do not ask Apple for updates or look packages up on OSV.dev`,
	},
	{
		command: "cloudflare audit",
		summary: "Check every domain in your Cloudflare account against built-in rules",
		detail: `Usage: porchlight cloudflare audit

Checks SSL/TLS, DNS, email records, the firewall, members and tokens. It only reads.

  --json                 Print the result as JSON
  --no-lookups           Do not look up where CNAME records point, even for domains whose
                         Porchlight ownership record proves them

Uses the token saved under Settings → Cloudflare in the interface, or
PORCHLIGHT_CLOUDFLARE_TOKEN. It is sent only to Cloudflare's API.`,
	},
	{
		command: "ui",
		summary: "Open the local web interface",
		detail: `Usage: porchlight ui

  --port <n>             Port to listen on (default: 4747, or the next free port)
  --host <address>       Address to listen on (default: 127.0.0.1). Any other address needs
                         PORCHLIGHT_UI_KEY, a key of 32 or more characters
  --report <file>        Scan report to show and update (default: ~/.porchlight/repo-scan.json)
  --root <dir>           Folder offered in the scan form (default: the current folder)

Settings it reads when it starts (each can also be chosen in the interface's Settings):
  PORCHLIGHT_MONITOR_URL, PORCHLIGHT_ADMIN_TOKEN    the Domains page
  PORCHLIGHT_LLM_URL, PORCHLIGHT_LLM_MODEL          a local model served by Ollama
  PORCHLIGHT_LLM_PROVIDER                           "compatible" for a server that speaks OpenAI's
                                                    format, or a hosted one ("anthropic", "openai",
                                                    "gemini", "deepseek") with PORCHLIGHT_LLM_API_KEY
  PORCHLIGHT_GITHUB_TOKEN                           fetch private repositories to scan
  PORCHLIGHT_CLOUDFLARE_TOKEN                       the Cloudflare audit
  PORCHLIGHT_SCAN_DEPTH                             folder levels a scan looks through (0 to 6)
  PORCHLIGHT_SCAN_EVERY_HOURS                       scan --root again this often while it runs (1 to 720;
                                                    meant for a service, which is always running)
  PORCHLIGHT_OSV_OFFLINE=true                       keep OSV's databases beside the report and compare
                                                    against them, instead of sending package names
  PORCHLIGHT_NOTIFY_URL, PORCHLIGHT_NOTIFY_FORMAT   where a scheduled scan's outcome is sent, and as
                                                    json, slack, discord or ntfy (default: by the address)`,
	},
	{
		command: "doctor",
		summary: "Check that Porchlight has what it needs, and say what to fix",
		detail: `Usage: porchlight doctor

Checks Node, git and the two scanners, the folder Porchlight keeps its files in, and the settings
for the monitor, the model, GitHub and Cloudflare. It only reads, and prints no secret.

  --json                 Print the result as JSON
  --offline              Do not contact the monitor or the model to see whether they answer

Exits 1 when something Porchlight cannot work without is missing.`,
	},
];

/** The whole list: what each command is for, and how to ask about one. */
export function usage(): string {
	const width = Math.max(...TOPICS.map((topic) => topic.command.length));
	return [
		"Porchlight",
		"",
		"Usage: porchlight <command> [options]",
		"",
		...TOPICS.map((topic) => `  ${topic.command.padEnd(width)}  ${topic.summary}`),
		"",
		"  porchlight <command> --help   Options for one command",
		"  porchlight --version          The version installed",
		"",
	].join("\n");
}

/**
 * The help for what was typed, or null when it names no command. The longest match wins, so
 * "repos scan" has its own text and "repos" lists both of its commands.
 */
export function helpFor(words: string[]): string | null {
	const typed = words.filter((word) => !word.startsWith("-"));
	for (let length = Math.min(typed.length, 2); length > 0; length--) {
		const name = typed.slice(0, length).join(" ");
		const exact = TOPICS.find((topic) => topic.command === name);
		if (exact) return `${exact.detail}\n`;
		const group = TOPICS.filter((topic) => topic.command.startsWith(`${name} `));
		if (group.length > 0) return `${group.map((topic) => topic.detail).join("\n\n")}\n`;
	}
	return null;
}

/** Whether the arguments ask for help: a lone "help", or --help or -h anywhere before a "--". */
export function asksForHelp(argv: string[]): boolean {
	if (argv.length === 0 || argv[0] === "help") return true;
	const end = argv.indexOf("--");
	return (end === -1 ? argv : argv.slice(0, end)).some((word) => word === "--help" || word === "-h");
}
