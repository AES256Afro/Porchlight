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
		summary: "Scan git repositories for committed secrets, vulnerable packages and private data",
		detail: `Usage: porchlight repos scan [path]

Scans every git repository under path (default: the current folder) with gitleaks and
osv-scanner, and prints one ranked report. Progress goes to the error stream, one line a repository.

  --depth <n>            Folder levels to search for repositories (default: 3)
  --preset <name>        What to look at (default: standard):
                           quick: secrets in the files as they are now, and dependencies; no history
                           standard: secrets in every commit on every branch, and dependencies
                           deep: as standard, plus private data; in the interface the model's deeper
                           analysis follows
  --checks <list>        Only these checks: secrets, dependencies, private-data, separated by commas.
                         Private data: contact details, ID and account numbers, locations, data
                         dumps and personal documents, counted per file and never shown
  --history <reach>      How much git history to read for secrets: all, none (the files as they are
                         now), or a number of the latest commits (with the files as they are now)
  --local-files          Also read files git does not track, such as .env, and changes not yet
                         committed. What is found there is reported as on this computer only, one
                         step lower
  --skip <name>          Leave out a repository, by the name the report gives it. Repeat, or separate
                         names with commas
  --out <file>           Write the report to a file instead of printing it
  --json                 Write the report as JSON, the form \`repos export\` and the interface read
  --format <form>        md (default), json (as --json) or sarif: SARIF 2.1.0 for code-scanning
                         tools, with what the scan did not cover in the run's properties
  --baseline <file>      A JSON report of an earlier scan: --fail-on then counts only findings it
                         does not hold. One it did not look for counts as not held
  --osv-db <folder>      Keep OSV's vulnerability databases in this folder and compare against them,
                         so package names are not sent to api.osv.dev (the first scan downloads them)
  --save                 Also keep the scan where the interface reads it (~/.porchlight), in its
                         history too, so \`porchlight ui\` shows it. Replaces the scan shown there,
                         and says what is new and fixed since the scan of the same folders before it
  --again <name>         With --save and no folder: scan one repository of the saved scan again, by
                         the name the report gives it, and say what that fixed. Where a scanner could
                         not look again, what it found before is kept
  --fail-on <severity>   Exit 2 if any finding is at or above: ${SEVERITIES.join(", ")}.
                         Exit 1 if a scanner was missing or failed, or the choices left something
                         out (a check, history, a repository), as they do for quick

Exit codes: without --fail-on, 0 once the scan has run, whatever it found. With it: 2 for a finding
at or above the severity, else 1 for an incomplete scan, else 0. An error exits 1.`,
	},
	{
		command: "repos history",
		summary: "List the kept scans, with what was new and fixed in each",
		detail: `Usage: porchlight repos history

Lists the scans kept with the saved scan (the last 50), newest first: when, how many repositories and
findings, and how many were new and fixed against the scan of the same folders before it.

  --json                 Print them as JSON`,
	},
	{
		command: "repos export",
		summary: "Turn a JSON report into a repair roadmap or a list of findings",
		detail: `Usage: porchlight repos export [report.json]

Without a path, exports the scan the interface shows (repo-scan.json in the data folder, kept by
\`repos scan --save\` and by the interface).

  --content <what>       roadmap: repairs in order (default); findings: every finding with its fix
  --format <format>      ${FORMATS.join(", ")} (default: md)
  --out <file>           Write to a file instead of printing it
  --severity <list>      Only these severities, comma-separated
  --kind <type>          Only secret, vulnerability or private-data findings
  --match <text>         Only findings mentioning this text
  --repo <name>          Only this repository`,
	},
	{
		command: "repos sbom",
		summary: "List every package the repositories use, as a CycloneDX SBOM",
		detail: `Usage: porchlight repos sbom [path]

Writes a software bill of materials (CycloneDX 1.5 JSON) of every package named in the lockfiles of
the git repositories under path, one component per repository. osv-scanner reads the lockfiles
offline: nothing is sent anywhere. It holds names, versions and package URLs, never a file path from
this computer. A repository that could not be read is named in metadata.properties, and the
command then exits 1.

Beside each package it notes, as advice and never as a finding: a licence to review
(porchlight:licence-risk: copyleft, network copyleft, source-available, non-commercial or not
recognised), a name one letter from a popular package's (porchlight:advice), and, on the repository,
its licence counts and dependency confusion read from its own .npmrc, package-lock.json and
requirements files. Nothing is looked up. The advice is also printed on the error stream; it never
changes the exit code.

  --depth <n>            Folder levels to search for repositories (default: 3)
  --out <file>           Write it to a file (readable only by you) instead of printing it`,
	},
	{
		command: "findings note",
		summary: "Set a finding's status and note, as on the Findings page",
		detail: `Usage: porchlight findings note --repo <name> --rule <id> --location <place> --status <status>

Sets your status and note for one finding of the saved scan. It never changes the finding, its
severity, the counts, the roadmap or an export.

  --status <status>      open, in-progress, fixed, rotated (a secret only), accepted, false-positive
  --detail <text>        Which one, when several findings share the place
  --until <day>          For accepted: the last day, such as 2027-06-30
  --note <text>          Your note (a ticket, who is on it, why the risk is accepted)`,
	},
	{
		command: "findings notes",
		summary: "List your statuses and notes",
		detail: `Usage: porchlight findings notes

Lists every status and note you set, with where it was set from, and marks the ones that match no
finding of any kept scan.

  --json                 Print them as JSON`,
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
  hosts <domain>         Every name the monitor knows under it, from the certificate log and DNS
                         (never guessed), with its addresses, HTTPS answer and open findings; takes
                         --format text, csv, md or json
  remove <domain> --yes  Stop watching it and delete its scan history
  export <domain>        Repair roadmap for a domain; takes --content, --format and --out

  --json                 Print the monitor's answer as JSON

Uses the monitor saved under Settings → Monitor in the interface, or PORCHLIGHT_MONITOR_URL (the
monitor's address) and PORCHLIGHT_ADMIN_TOKEN, which take its place when set.`,
	},
	{
		command: "host check",
		summary: "Check this computer: updates, protection, open services, credentials in files",
		detail: `Usage: porchlight host check

Checks this computer: updates, built-in protection, what accepts connections, credentials in
files, installed packages. It changes nothing. It contacts two services unless --offline is given:
Apple's update servers (macOS's own softwareupdate) and OSV.dev, which is sent the names and versions
of installed npm and Python packages.

  --json                 Print the result as JSON
  --offline              Do not ask Apple for updates or look packages up on OSV.dev
  --fail-on <severity>   Exit 2 if a failed check is at or above: ${SEVERITIES.join(", ")}.
                         Exit 1 if a check could not be made`,
	},
	{
		command: "cloudflare audit",
		summary: "Check every domain in your Cloudflare account against built-in rules",
		detail: `Usage: porchlight cloudflare audit

Checks SSL/TLS, DNS, email records, the firewall, members and tokens. It only reads.

  --json                 Print the result as JSON
  --no-lookups           Do not look up where CNAME records point, even for domains whose
                         Porchlight ownership record proves them
  --fail-on <severity>   Exit 2 if a failed check is at or above: ${SEVERITIES.join(", ")}.
                         Exit 1 if a check could not be made

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
  --report <file>        Scan report to show and update (default: repo-scan.json in the data folder).
                         Its history, notes and judgements are kept beside it
  --data <dir>           Where settings, keys, tokens and fetched repositories are kept
                         (default: ~/.porchlight). Ones an earlier version kept beside the report
                         are moved here
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
                                                    json, slack, discord or ntfy (default: by the address)
  PORCHLIGHT_NOTIFY_DIGEST=weekly                   also send a weekly digest there, after a
                                                    scheduled scan: counts, new and fixed, what is
                                                    overdue and accepted risks ending soon`,
	},
	{
		command: "doctor",
		summary: "Check that Porchlight has what it needs, and say what to fix",
		detail: `Usage: porchlight doctor

Checks Node, git and the two scanners, the folder Porchlight keeps its files in, and the settings
for the monitor, the model, GitHub and Cloudflare. It only reads, and prints no secret.

  --json                 Print the result as JSON
  --offline              Do not contact the monitor or the model to see whether they answer
  --self                 Check what Porchlight promises on this computer instead: file and folder
                         modes, the addresses it listens on, which keys are saved and where, which
                         gitleaks and osv-scanner run, and files a crash left behind

Exits 1 when something Porchlight cannot work without is missing.`,
	},
	{
		command: "forget",
		summary: "List, then remove, everything Porchlight keeps on this computer",
		detail: `Usage: porchlight forget

Lists what Porchlight keeps in its data folder (~/.porchlight): the scan and its history, your notes,
keys and tokens, fetched repositories, audits, investigations and discussions. With --yes it removes
them. It removes only those, by name: anything else there, a link, a project folder or a git repository
is left alone. It also says what lives elsewhere: the monitor's domains, DNS records, changes made to
Cloudflare and keys to revoke with each provider.

  --yes                  Remove what is listed. Without it nothing is removed
  --data <dir>           The data folder, when not ~/.porchlight
  --report <file>        Also remove a report kept elsewhere, and its history, notes and judgements`,
	},
	{
		command: "status",
		summary: "What Porchlight last found, from the files it keeps; contacts nothing",
		detail: `Usage: porchlight status

Counts, times and gaps of the latest repository scan, host check and Cloudflare audit, read from the
files Porchlight keeps, and whether a monitor is set. It contacts nothing and changes nothing, and
prints no finding's place, value, key or token.

  --json                 Print it as JSON, for a script or a status bar
  --data <dir>           The data folder, when not ~/.porchlight
  --report <file>        The scan report, when not repo-scan.json in the data folder

Exits 1 when a kept file is there but cannot be read.`,
	},
	{
		command: "hook",
		summary: "Check the staged files for secrets and private data before a commit",
		detail: `Usage: porchlight hook [print]

  (none)                 Check what is staged in the repository here, with Porchlight's own rules
                         (gitleaks' built-in ones and the private-data ones). Prints kind, rule, file
                         and line, never a value. Exits 1 when it finds something, or could not check
  print                  Print a pre-commit hook that runs this check, for you to install:
                           porchlight hook print > .git/hooks/pre-commit
                           chmod +x .git/hooks/pre-commit
                         Porchlight never writes into a repository itself

Needs gitleaks. To commit without the check once: git commit --no-verify`,
	},
	{
		command: "settings export",
		summary: "Write your settings to a file, to move them to another computer",
		detail: `Usage: porchlight settings export <file>

Writes the look, projects, your finding notes, due dates, the model chosen and the model for each
task to a new file, readable only by you. It never writes over a file that is there.

  --include-keys         Also the keys and tokens (model keys, the monitor's admin token, the
                         Cloudflare token, ownership tokens). The whole file is then encrypted with a
                         passphrase you type, or PORCHLIGHT_SETTINGS_PASSPHRASE: at least 12 characters
  --data <dir>           The data folder, when not ~/.porchlight
  --report <file>        The scan report whose notes to take, when not repo-scan.json there

Without --include-keys no key or token is in the file. The access key for other devices never moves.`,
	},
	{
		command: "settings import",
		summary: "Bring in settings written by settings export",
		detail: `Usage: porchlight settings import <file>

Reads the file (asking for its passphrase when it holds keys) and brings its settings in. Every file
it would change is read first: one that is there but cannot be read stops it before anything is
written. Notes and projects are merged, and yours win; each project's folder is checked again here.

  --replace              Replace a setting already here (the look, a model, a token) with the file's
  --data <dir>           The data folder, when not ~/.porchlight
  --report <file>        The scan report beside which notes are kept`,
	},
	{
		command: "schedule print",
		summary: "Print a launchd or systemd unit that scans a folder on a schedule",
		detail: `Usage: porchlight schedule print

Prints a launchd agent (macOS) or a systemd user service and timer (Linux) that runs a Standard
\`repos scan --save\` of one folder, so the interface shows the latest. It installs nothing: the
comment at its top says how. The scan's progress lines go to scheduled-scan.log in ~/.porchlight.

  --root <folder>        Folder to scan (default: the current folder)
  --every <hours>        How often, 1 to 720 (default: 24)
  --depth <n>            Folder levels to search for repositories, 0 to 6 (default: 3)
  --launchd, --systemd   Which to print (default: launchd on macOS, systemd elsewhere)`,
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
