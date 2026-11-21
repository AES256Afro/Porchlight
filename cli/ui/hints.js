// @ts-check
// Plain-language help the pages add to a result, decided here without the DOM so it can be tested.

/** @typedef {import("../src/ui/server.ts").ScanStatus} ScanStatus */

/**
 * What to try after a scan that found no repository. As a service (a container, under BoxPilot) the
 * scanned folder is the one mounted from the server, chosen in the app's settings, so that is said
 * when the scan looked there.
 *
 * @param {ScanStatus} scan
 * @param {{ service?: boolean, defaultRoot?: string } | null | undefined} settings
 * @returns {string[]}
 */
export function emptyScanHints(scan, settings) {
	if (scan.state !== "failed" || !scan.noRepositories) return [];
	const hints = [];
	if (settings?.service && scan.root === settings.defaultRoot) {
		hints.push(
			`In BoxPilot, ${scan.root} is the server folder chosen as "Repositories to scan". To scan the folder that holds your git checkouts, change it in Apps → Porchlight → Settings.`,
		);
	}
	const levels = scan.depth ?? 0;
	hints.push(
		levels === 0
			? "Depth 0 looks only at the folder itself: raise Depth to look in the folders inside it."
			: `It looked ${levels} folder ${levels === 1 ? "level" : "levels"} down: raise Depth for repositories further in. Folders Porchlight cannot read are skipped.`,
	);
	return hints;
}

/** @typedef {import("../src/ui/server.ts").ScanPreview} ScanPreview */

/**
 * The words that say data leaves the owner's machines (RD-11), the same wherever invariants 13 and 20
 * need them said. A test fails on any other wording of it.
 */
export const OUTSIDE = "outside your machines";
/** @typedef {{ found: boolean, title: string, lines: string[], steps: string[] }} PreviewAdvice */

/**
 * What to say about a folder before it is scanned: how many repositories are there, or, when there
 * are none, what to do about it. As a service the folder is the one mounted from the server, so the
 * steps are BoxPilot's; from a terminal they are about choosing another folder.
 *
 * @param {ScanPreview} preview
 * @param {{ service?: boolean } | null | undefined} settings
 * @returns {PreviewAdvice}
 */
export function previewAdvice(preview, settings) {
	if (preview.isHome) {
		return {
			found: false,
			title: `${preview.root} is your whole home folder`,
			lines: ["Looking through it would go into Desktop, Documents and Downloads, and macOS asks before each. Type the folder that holds your projects, such as `~/Projects`, or look through the home folder anyway."],
			steps: [],
		};
	}
	if (preview.total > 0) {
		const count = (/** @type {number} */ n) => `${n.toLocaleString("en-GB")} ${n === 1 ? "repository" : "repositories"}`;
		const inFolder = preview.total - preview.fetched;
		const where = settings?.service ? "on this server" : `in ${preview.root}`;
		let title = `${count(preview.total)} ${where}`;
		if (preview.fetched > 0) title = inFolder > 0 ? `${count(preview.total)}: ${inFolder.toLocaleString("en-GB")} ${where}, ${preview.fetched.toLocaleString("en-GB")} fetched from GitHub` : `${count(preview.total)} fetched from GitHub`;
		return { found: true, title, lines: [], steps: [] };
	}
	if (settings?.service) {
		return {
			found: false,
			title: "There are no repositories on this server yet",
			lines: ["This copy of Porchlight runs on your server, so it checks repositories that are on the server. It cannot see your laptop. There are two ways to get them there."],
			steps: [
				"Fetch them from GitHub, in the section below. This is the easy way.",
				'Or put them on the server yourself: clone them into one folder (BoxPilot starts with `/srv/projects`), point "Repositories to scan" at that folder in BoxPilot under Apps → Porchlight → Settings, then choose Look again.',
			],
		};
	}
	if (!preview.exists) {
		return { found: false, title: `${preview.root} is not a folder`, lines: ["Type the folder that holds your projects, such as `~/Projects`."], steps: [] };
	}
	const lines = ["A git repository is a project folder with a `.git` folder inside it. Choose the folder that holds your projects, such as `~/Projects`, or fetch repositories from GitHub below."];
	if (preview.depth < 6) lines.push(`Porchlight looked ${preview.depth} folder ${preview.depth === 1 ? "level" : "levels"} down. Under Options you can make it look further.`);
	return { found: false, title: `No git repositories in ${preview.root}`, lines, steps: [] };
}

/**
 * What a scan would lack before it runs (US-2): git, or a scanner, with the command that installs it.
 * Empty when all are ready.
 *
 * @param {ScanPreview} preview
 * @returns {string[]}
 */
export function toolAdvice(preview) {
	return (preview.tools ?? [])
		.filter((tool) => !tool.ready)
		.map((tool) =>
			tool.tool === "git"
				? `git is not ready, so no repository's history can be read. Install it first: \`${tool.fix}\``
				: `${tool.tool} is not installed, so ${tool.tool === "gitleaks" ? "secrets are not looked for" : "packages are not checked for known holes"}. Install it: \`${tool.fix}\``,
		);
}

/**
 * How old OSV's databases are, where they are kept beside the data (PORCHLIGHT_OSV_OFFLINE): packages are
 * compared against them, so an old copy misses newer advisories. Null where osv-scanner asks OSV at each
 * scan. A scan brings a copy a day old or more up to date first (OP-4).
 *
 * @param {{ offline: boolean, refreshedAt: string | null }} database
 * @param {(iso: string) => string} when how the page writes a time
 * @param {Date} [now]
 * @returns {{ old: boolean, words: string } | null}
 */
export function osvAgeWords(database, when, now = new Date()) {
	if (!database.offline) return null;
	if (!database.refreshedAt) return { old: true, words: "OSV's databases have not been downloaded yet: the next scan downloads them before it compares packages." };
	const age = now.getTime() - new Date(database.refreshedAt).getTime();
	const days = Math.floor(age / 86_400_000);
	if (Number.isNaN(age) || age < 0) return { old: true, words: "OSV's databases carry a date in the future, so they are downloaded again at the next scan." };
	if (days < 1) return { old: false, words: `OSV's databases were brought up to date ${when(database.refreshedAt)}.` };
	return { old: true, words: `OSV's databases are ${days === 1 ? "a day" : `${days.toLocaleString("en-GB")} days`} old (${when(database.refreshedAt)}): the next scan brings them up to date first.` };
}

/**
 * How to let Porchlight fetch private repositories: make a token that can only read, and give it
 * to Porchlight where its settings are kept.
 *
 * @param {boolean} service
 * @returns {string[]}
 */
export function githubTokenSteps(service) {
	return [
		"On GitHub, open Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token.",
		'Give it access to the repositories you want checked, and under Repository permissions set "Contents" to Read-only. It needs nothing else. For an organisation\'s repositories, choose the organisation as Resource owner; it may have to approve the token.',
		service
			? 'Copy the token. In BoxPilot, open Apps → Porchlight → Settings, paste it into "GitHub token" and confirm. Porchlight restarts with it.'
			: "Copy the token. In the Mac app, add the line `PORCHLIGHT_GITHUB_TOKEN=<the token>` to `~/.porchlight/app.env`, then quit Porchlight and open it again. If you start it in a terminal with `porchlight ui`, run `export PORCHLIGHT_GITHUB_TOKEN=<the token>` before starting it instead.",
	];
}

/**
 * Which repositories start ticked in the list to fetch: the ones that are someone's own live work.
 * Forks and archived repositories can still be ticked by hand.
 *
 * @param {{ fork: boolean, archived: boolean }} repo
 */
export function fetchByDefault(repo) {
	return !repo.fork && !repo.archived;
}

/** @typedef {{ text: string, commands?: string[] }} SetupStep */

/**
 * How to set up the monitor that checks websites, as numbered steps, each with the commands to
 * paste into Terminal. Everything needed is here, so nobody is sent off to read instructions
 * elsewhere. The last step is where the address and the token go: Settings → Monitor on this
 * computer, or BoxPilot's settings for a service.
 *
 * @param {boolean} service
 * @returns {SetupStep[]}
 */
export function monitorSetupSteps(service) {
	return [
		{
			text: "This needs Node.js and the Porchlight project on this computer (the Mac app alone is not enough). Open Terminal, get the project if you have no copy, and run the setup script from its folder. It installs the monitor's tools in its `monitor` folder, signs you in to Cloudflare (a browser window opens, once; the free plan is enough), makes the monitor's database, prepares it, makes the admin token and deploys. At the end it prints the monitor's address, which looks like `https://porchlight-monitor.your-name.workers.dev`, and the admin token. Anyone who has the token can change which domains your monitor watches. The database's ID and the token stay in two files in `monitor` that git ignores, so running the script again deploys again. To be sent alerts, add a line `ALERT_WEBHOOK_URL=` with a Slack or Discord webhook or an ntfy topic to `monitor/.secrets.production` and run it again; without it, alerts go only to the Worker's log, where nobody sees them.",
			commands: ["git clone https://github.com/AES256Afro/Porchlight.git && cd Porchlight", "sh scripts/setup-monitor.sh"],
		},
		{
			text: service
				? 'In BoxPilot, open Apps → Porchlight → Settings. Paste the address into "Monitor address" and the token into "Monitor admin token", then confirm. Porchlight restarts and this page becomes your list of domains.'
				: "Paste the address and the token in Settings → Monitor. Porchlight checks them with the monitor and this page becomes your list of domains. No restart is needed.",
		},
	];
}

/**
 * What this computer can run, in a sentence, for the model search.
 *
 * @param {{ memoryGb: number, chip: string, appleSilicon: boolean, fitsUpTo: number }} machine
 */
export function machineLine(machine) {
	const chip = machine.chip ? `${machine.chip}, ` : "";
	const mlx = machine.appleSilicon ? " It is Apple silicon, so MLX models run on it too." : " MLX models need Apple silicon, so choose GGUF here.";
	return `This computer: ${chip}${machine.memoryGb} GB of memory. Models up to about ${machine.fitsUpTo}B should run comfortably; larger ones run slowly or not at all.${mlx}`;
}

/** A size in bytes, in the unit a person would say. @param {number} bytes */
export function formatBytes(bytes) {
	if (!Number.isFinite(bytes) || bytes <= 0) return "size not given";
	const units = ["bytes", "KB", "MB", "GB", "TB"];
	let value = bytes;
	let unit = 0;
	while (value >= 1000 && unit < units.length - 1) {
		value /= 1000;
		unit += 1;
	}
	return `${unit === 0 ? value : value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/**
 * One line for a download in progress: the model, how far, and what Ollama says it is doing.
 *
 * @param {{ name: string, step: string, total: number, completed: number }} download
 */
export function downloadLine(download) {
	if (download.total <= 0) return `${download.name}: ${download.step || "starting"}`;
	const percent = Math.min(100, Math.floor((download.completed / download.total) * 100));
	return `${download.name}: ${percent}% of ${formatBytes(download.total)} (${download.step})`;
}

/**
 * @typedef {{ id: string, title: string, severity: string, why: string, fix: string[], api?: string, zones: string[], fixable: number }} FixGroup
 */

const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

/**
 * The audit's problems gathered by what fixes them: one entry per kind of problem, with the domains
 * it affects, worst and most widespread first. `fixable`: how many of them Porchlight can change itself.
 *
 * @param {readonly { name: string, checks: readonly { id: string, title: string, severity: string, status: string, why: string, fix?: string[], api?: string, change?: string }[] }[]} zones
 * @returns {FixGroup[]}
 */
export function fixGroups(zones) {
	/** @type {Map<string, FixGroup>} */
	const groups = new Map();
	for (const zone of zones) {
		for (const check of zone.checks) {
			if (check.status !== "failed") continue;
			const group = groups.get(check.id) ?? { id: check.id, title: check.title, severity: check.severity, why: check.why, fix: check.fix ?? [], ...(check.api ? { api: check.api } : {}), zones: [], fixable: 0 };
			// A kind of problem is as bad as its worst case.
			if (SEVERITY_ORDER.indexOf(check.severity) < SEVERITY_ORDER.indexOf(group.severity)) group.severity = check.severity;
			group.zones.push(zone.name);
			if (check.change) group.fixable += 1;
			groups.set(check.id, group);
		}
	}
	return [...groups.values()].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || b.zones.length - a.zones.length || a.title.localeCompare(b.title));
}

/**
 * The problems that are left, as plain text to paste into a model that can act on the account: what
 * is wrong, on which domains, and the fix. Only what the page shows about zones: no token, no member,
 * no record value. It asks to be shown each change before it is made.
 *
 * @param {FixGroup[]} groups
 * @param {string} checkedAt when the audit was made, as the page words it
 */
export function fixBrief(groups, checkedAt) {
	const lines = [
		"These are the problems Porchlight's audit of my Cloudflare account found and could not fix itself.",
		`The audit was made ${checkedAt}. Work through them worst first. Before each change, tell me the exact change and wait for my yes. Some need work on my servers, not only in Cloudflare: say so instead of guessing.`,
		"",
	];
	groups.forEach((group, index) => {
		lines.push(`${index + 1}. ${group.title} (${group.severity}), ${group.zones.length} ${group.zones.length === 1 ? "domain" : "domains"}`);
		lines.push(`   Domains: ${group.zones.join(", ")}`);
		lines.push(`   Why it matters: ${group.why}`);
		group.fix.forEach((step) => lines.push(`   Fix: ${step}`));
		if (group.api) lines.push(`   Cloudflare API: ${group.api}`);
		lines.push("");
	});
	return lines.join("\n");
}

/**
 * A Cloudflare permission as its token page words it: where it is, what it is called, and the level.
 * "Zone Settings Write" on a zone is "Zone, Zone Settings, Edit".
 *
 * @param {{ name: string, scope?: string }} permission
 */
export function permissionWords(permission) {
	const level = /\bWrite$/.test(permission.name) ? "Edit" : "Read";
	const what = permission.name.replace(/\s+(Read|Write)$/, "");
	const scope = permission.scope ?? (what === "API Tokens" ? "User" : what.startsWith("Account") ? "Account" : "Zone");
	return `${scope}, ${what.replace(/^Zone WAF$/, "Zone WAF")}, ${level}`;
}

/**
 * What to do when the token lacks permissions, as steps. Editing a token on Cloudflare keeps the
 * token itself, so nothing has to be pasted again.
 *
 * @param {{ name: string, scope?: string }[]} permissions
 * @param {"change" | "read"} purpose what was refused: a change, or part of the audit
 * @returns {string[]}
 */
export function tokenFixSteps(permissions, purpose) {
	if (permissions.length === 0) return [];
	const list = permissions.map((permission) => `"${permissionWords(permission)}"`).join(" and ");
	// Cloudflare's editor lists permissions in groups with a search box; some accounts still see three menus a row.
	const add = `Add ${list}: type the name into "Search for permission groups", open the group it is in, and tick it at that level. Tick only these. Selecting everything gives the token far more than Porchlight uses.`;
	// Seen on a real account: a token with every permission ticked still could not list the owner's tokens.
	const tokens = permissions.some((permission) => permission.name === "API Tokens Read")
		? ' Cloudflare does not offer "API Tokens" to every token. If the search does not find it, leave it: only the check of your own tokens stays Could not check, and nothing else is affected.'
		: "";
	return [
		"Open Cloudflare → My Profile → API Tokens. Find the token you gave Porchlight, open the menu at the end of its row and choose Edit.",
		`${add}${tokens}`,
		purpose === "change"
			? "Continue to summary and save. The token itself stays the same, so there is nothing to paste again. Come back here and choose Fix these again."
			: "Continue to summary and save. The token itself stays the same, so there is nothing to paste again. Come back here and choose Audit again.",
	];
}

/**
 * What to do when a domain's ownership record is missing or no longer found, as steps.
 *
 * @param {{ domain: string, onCloudflare: boolean }} options `onCloudflare`: the latest Cloudflare audit lists the domain
 * @returns {string[]}
 */
export function ownershipSteps({ domain, onCloudflare }) {
	return [
		`Under Your domains on this page, copy the Name and the Value shown for ${domain}.`,
		onCloudflare
			? "Add them as a TXT record in Cloudflare → DNS → Records. Or let Porchlight add it: on the Cloudflare page, this domain's Fix these includes the record once your token has DNS Edit."
			: `Add them as a TXT record where ${domain}'s DNS is managed.`,
		"Wait a minute or two, choose Check DNS record, and start the investigation again once it says the record is in place.",
	];
}

/**
 * What an investigation may send to the owner's site, as a list to read before approving a whole
 * run at once. The model chooses each step as it goes, so no list of requests exists in advance:
 * these are the limits every step is held to, and the tools come from the server's own list.
 *
 * @param {{ tools: readonly { description: string, needsApproval: boolean, args: Record<string, string> }[], domain: string, maxTurns: number, minGapMs: number, turnsLeft?: number }} run
 * @returns {string[]}
 */
export function runLimits({ tools, domain, maxTurns, minGapMs, turnsLeft }) {
	const pace = minGapMs === 1000 ? "one action a second" : `one action every ${(minGapMs / 1000).toLocaleString("en-GB")} seconds`;
	const turns = turnsLeft === undefined ? `At most ${maxTurns} ${maxTurns === 1 ? "turn" : "turns"}` : `At most ${turnsLeft} more ${turnsLeft === 1 ? "turn" : "turns"} (${maxTurns} in all)`;
	return [
		...tools.filter((tool) => tool.needsApproval).map((tool) => (tool.args.method ? `${tool.description} Methods: ${tool.args.method.split("|").join(", ")}.` : tool.description)),
		`Only to ${domain} and its subdomains. Any other host is refused, and so is a private or internal address.`,
		`${turns}, and ${pace} for each host.`,
		"The ownership record is checked before every action. If it is gone or cannot be checked, the run stops.",
		"Every action is listed with what was sent and what came back. Stop ends the run at once.",
	];
}

/**
 * How a run's HTTP requests and TCP connections are approved, in one line for the page.
 *
 * @param {{ approvedRest?: { turn: number } }} run
 */
export function approvalLine(run) {
	if (!run.approvedRest) return "Each HTTP request and TCP connection waits for your approval.";
	return run.approvedRest.turn === 0 ? "You approved every request of this run when it started." : `You approved every request of this run from turn ${run.approvedRest.turn} on.`;
}

/**
 * What someone typed for a website, reduced to the domain name the monitor wants: no scheme, path,
 * port or surrounding space. `https://Example.com/shop` becomes `example.com`.
 *
 * @param {string} text
 */
export function domainFromInput(text) {
	return text
		.trim()
		.toLowerCase()
		.replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
		.replace(/[/?#].*$/, "")
		.replace(/^[^@]*@/, "")
		.replace(/:\d+$/, "")
		.replace(/\.$/, "");
}

/**
 * What to say when Porchlight does not answer at all, by how it was started: from a terminal, as the
 * Mac app, or as a service under BoxPilot. Each says where to start it again.
 *
 * @param {"terminal" | "mac" | "service"} startedFrom
 */
export function offlineWords(startedFrom) {
	if (startedFrom === "service") return "Porchlight is not answering. In BoxPilot, check that the Porchlight app is running, then reload this page.";
	if (startedFrom === "mac") return "Porchlight is not answering. Quit the Porchlight app and open it again.";
	return "Porchlight is not answering. Start it again with: porchlight ui";
}

/**
 * Why a key was refused, said above the box to paste it in. "pasted": the key just pasted was wrong.
 * "stale": the tab's key stopped working, which on this computer means Porchlight was started again
 * (each start makes a new key), and elsewhere that the access key was replaced.
 *
 * @param {"pasted" | "stale"} why
 * @param {"local" | "service" | "tailnet"} where
 */
export function keyRejectedWords(why, where) {
	if (why === "pasted") {
		return where === "local"
			? "That key was not accepted. Copy the whole link Porchlight printed when it started, or the part after #k=."
			: "That key was not accepted. Copy it again in full; it is case-sensitive.";
	}
	if (where === "local") return "Porchlight has started again since this tab opened, so its old key no longer works. Open the new link it printed.";
	return "This tab's key no longer works: it may have been replaced. Paste the current one.";
}

/**
 * How often a service scans by itself, in words for the Overview, or "" when it scans only when asked.
 *
 * @param {number} hours
 */
export function scheduleWords(hours) {
	if (!hours || hours <= 0) return "";
	if (hours === 24) return "It is scanned again every day.";
	if (hours % 24 === 0) return `It is scanned again every ${hours / 24} days.`;
	return hours === 1 ? "It is scanned again every hour." : `It is scanned again every ${hours} hours.`;
}

/**
 * The schedule in one line (QL-5): when it last ran and how that went, when it runs next, whether the
 * last notice was delivered, and a token that ends within two weeks. Empty without a schedule.
 *
 * @param {import("../src/ui/server.ts").ScheduleState | null | undefined} schedule
 * @param {{ cloudflareEnds?: string }} tokens
 * @param {(iso: string) => string} when how a time is written ("2 hours ago", "in 3 hours")
 * @param {Date} [now]
 * @returns {string[]}
 */
export function scheduleLines(schedule, tokens, when, now = new Date()) {
	const lines = [];
	if (schedule) {
		const every = schedule.everyHours === 1 ? "every hour" : schedule.everyHours % 24 === 0 ? (schedule.everyHours === 24 ? "every day" : `every ${schedule.everyHours / 24} days`) : `every ${schedule.everyHours} hours`;
		const last = schedule.lastRun ? ` Last run ${when(schedule.lastRun.at)}: ${schedule.lastRun.ok ? schedule.lastRun.summary : `failed, ${schedule.lastRun.summary}`}.` : " It has not run since Porchlight started.";
		const next = Date.parse(schedule.nextRun) <= now.getTime() ? " Next run: within a minute." : ` Next run ${when(schedule.nextRun)}.`;
		lines.push(`Scheduled scan of ${schedule.root} ${every}.${last}${next}`);
		if (schedule.notify) lines.push(schedule.notify.last ? `The last notice was ${schedule.notify.last.delivered ? "delivered" : "not delivered"}: ${schedule.notify.last.detail}, ${when(schedule.notify.last.at)}.` : `Notices go to ${schedule.notify.host}; none has been sent since Porchlight started.`);
	}
	if (tokens.cloudflareEnds) {
		const days = Math.ceil((Date.parse(tokens.cloudflareEnds) - now.getTime()) / 86_400_000);
		if (days <= 14) lines.push(days <= 0 ? "Your Cloudflare token has ended. Make a new one under Settings → Cloudflare." : `Your Cloudflare token ends in ${days === 1 ? "1 day" : `${days} days`}. Make a new one under Settings → Cloudflare before then.`);
	}
	return lines;
}

/**
 * What changed since the check or audit before (G-Q1, F-Q3), in one line. A check that failed before
 * and could not be made this time is said apart: not checked is not fixed (invariant 5).
 *
 * @param {import("../src/kept-checks.ts").CheckComparison | null} change
 * @param {"check" | "audit"} what
 * @returns {string | null} null when there is nothing earlier to compare with
 */
export function checkChangeWords(change, what) {
	if (!change) return null;
	const parts = [];
	if (change.fixedCount > 0) parts.push(`${change.fixedCount.toLocaleString("en-GB")} fixed`);
	if (change.newCount > 0) parts.push(`${change.newCount.toLocaleString("en-GB")} new`);
	const head = parts.length > 0 ? `${parts.join(", ")} since the ${what} before.` : `Nothing fixed and nothing new since the ${what} before.`;
	const caveat = change.uncheckedCount > 0 ? ` ${change.uncheckedCount.toLocaleString("en-GB")} could not be checked again, so ${change.uncheckedCount === 1 ? "it is" : "they are"} not counted as fixed.` : "";
	return `${head}${caveat}`;
}

/**
 * The "Not covered" lines of one cause together (US-9): a scanner that failed the same way on 120
 * repositories is one line naming them, with what to do and the repositories to scan again.
 *
 * @param {{ repos: { name: string, errors: { tool: string, message: string }[], notCovered?: { tool: string, message: string }[] }[] }} report
 * @returns {{ title: string, repos: string[], fix: string }[]}
 */
export function coverageGroups(report) {
	/** @type {Map<string, { title: string, repos: string[], fix: string }>} */
	const groups = new Map();
	const add = (/** @type {string} */ title, /** @type {string} */ fix, /** @type {string} */ repo) => {
		const group = groups.get(title) ?? { title, repos: [], fix };
		if (!group.repos.includes(repo)) group.repos.push(repo);
		groups.set(title, group);
	};
	for (const repo of report.repos) {
		for (const error of repo.errors) add(`${error.tool} failed: ${error.message.split("\n")[0]?.slice(0, 300) ?? ""}`, "Scan them again. If it fails the same way, run `porchlight doctor`: it says what this computer lacks.", repo.name);
		for (const note of repo.notCovered ?? []) add(`${note.tool}: ${note.message.slice(0, 300)}`, "This is how the repository is, not a failure: the line says what was left out.", repo.name);
	}
	return [...groups.values()].sort((a, b) => b.repos.length - a.repos.length);
}

/** How many domains the monitor scans in a day: one every 10 minutes. */
export const MONITOR_SCANS_A_DAY = 144;

/**
 * Verified domains whose last scan is more than a day and two hours old (QL-8): past 144 domains the
 * monitor falls behind, and nothing else says so.
 *
 * @param {{ verified: boolean, lastScanAt: string | null, verifiedAt?: string | null }[]} domains
 * @param {Date} [now]
 * @returns {{ overdue: number, words: string } | null}
 */
export function overdueDomains(domains, now = new Date()) {
	const limit = now.getTime() - 26 * 3_600_000;
	const overdue = domains.filter((domain) => domain.verified && Date.parse(domain.lastScanAt ?? domain.verifiedAt ?? "") < limit).length;
	if (overdue === 0) return null;
	const behind = domains.filter((domain) => domain.verified).length > MONITOR_SCANS_A_DAY;
	return {
		overdue,
		words: `${overdue === 1 ? "1 domain is" : `${overdue.toLocaleString("en-GB")} domains are`} overdue: not scanned for more than a day.${behind ? ` The monitor scans ${MONITOR_SCANS_A_DAY} domains a day, and you have more, so each waits longer than a day.` : " The Domains page says why for each."}`,
	};
}

/**
 * What wants another look (QL-3): accepted risks whose end day has passed, ones that end within two
 * weeks, and findings you marked Fixed that the latest scan still reports. Counts and the findings
 * themselves; it hides and recounts nothing (invariant 17).
 *
 * @template {{ repo: string, ruleId: string, location: string, detail: string }} F
 * @param {F[]} rows the latest scan's findings
 * @param {(row: F) => { status: string, until?: string } | null} noteOf
 * @param {Date} [now]
 */
export function reviewQueue(rows, noteOf, now = new Date()) {
	const pad = (/** @type {number} */ n) => String(n).padStart(2, "0");
	const day = (/** @type {Date} */ date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
	const today = day(now);
	const soon = day(new Date(now.getTime() + 14 * 86_400_000));
	/** @type {{ ended: F[], ending: F[], stillReported: F[] }} */
	const queue = { ended: [], ending: [], stillReported: [] };
	for (const row of rows) {
		const note = noteOf(row);
		if (!note) continue;
		if (note.status === "accepted" && note.until && note.until < today) queue.ended.push(row);
		else if (note.status === "accepted" && note.until && note.until <= soon) queue.ending.push(row);
		else if (note.status === "fixed") queue.stillReported.push(row);
	}
	return queue;
}

/**
 * Which parts of the Overview a change in the shared store redraws (B41). Only what shows that data:
 * a host check redraws the glance strip alone and a project switch nothing, so the folder being typed
 * and the cards being read stay as they are.
 *
 * @param {"report" | "scan" | "settings" | "notes" | "host" | "cloudflare" | "projects"} change
 * @returns {("summary" | "scan" | "cloudflare" | "monitor" | "assistant" | "analysis" | "glance" | "review")[]}
 */
export function overviewRedraws(change) {
	if (change === "report") return ["summary", "assistant", "analysis", "glance"];
	if (change === "scan") return ["scan", "glance"];
	if (change === "settings") return ["monitor", "assistant", "analysis", "cloudflare", "glance"];
	if (change === "cloudflare") return ["cloudflare", "glance"];
	if (change === "host") return ["glance"];
	if (change === "notes") return ["review"];
	return [];
}

/**
 * Whether a project folder can be added now (S30, invariant 23): only once the page has shown the
 * check of exactly the folder in the box, and, when that check warned, after a second press.
 * "look": check the folder first; "refused": the check said it cannot be used; "confirm": show the
 * warning and ask again; "add": send it.
 *
 * @param {{ warnings: string[], error?: string } | null} check the check on show
 * @param {string} checkedFor the folder, as typed, that check is about
 * @param {string} typed the folder in the box now
 * @param {string | null} warnedFor the folder whose warning the owner has already been shown at Add
 * @returns {"look" | "refused" | "confirm" | "add"}
 */
export function readyToAdd(check, checkedFor, typed, warnedFor) {
	const folder = typed.trim();
	if (!check || folder === "" || checkedFor !== folder) return "look";
	if (check.error) return "refused";
	if (check.warnings.length > 0 && warnedFor !== folder) return "confirm";
	return "add";
}

/**
 * A network failure said in the page's words (R6U-10): Node's bare "fetch failed" and a DNS answer's
 * status number mean nothing to the owner. The rest of the message is kept as it was.
 *
 * @param {string} message
 */
export function plainError(message) {
	return message
		.replace(/\bno answer \(DNS status 2\)/g, "the domain's DNS answered with an error (SERVFAIL), often a DNSSEC problem")
		.replace(/\bno answer \(DNS status 3\)/g, "the name does not exist in DNS")
		.replace(/\bDNS status 2\b/g, "a DNS error (SERVFAIL), often a DNSSEC problem")
		.replace(/:\s*fetch failed\.?$/i, ": no connection could be made (the address could not be found, or nothing answered)")
		.replace(/^fetch failed\.?$/i, "No connection could be made: the address could not be found, or nothing answered.");
}

/**
 * How an investigation ended, in a word: a run that used up its turns is not "Finished" (B49, E-F5).
 *
 * @param {{ status: "running" | "waiting" | "done" | "stopped" | "failed", ended?: string }} run
 */
export function runStatusWord(run) {
	if (run.status === "done" && /turn budget/i.test(run.ended ?? "")) return "Turn budget used up";
	return { running: "Running", waiting: "Waiting for you", done: "Finished", stopped: "Stopped", failed: "Failed" }[run.status];
}

/** @typedef {{ at: string, error: string }} MonitorProblem */
/**
 * The monitor's own state as `GET /domains` gives it beside the list (monitor/src/types.ts,
 * `MonitorStatus`). Missing from a monitor deployed before it was added.
 *
 * @typedef {{
 *   alerts: { to: "webhook" | "log", host?: string, format?: string, problem?: string, delivery: { lastDeliveredAt: string | null, lastError: MonitorProblem | null } | null },
 *   schedule: { lastError: MonitorProblem | null } | null,
 * }} MonitorStatus
 */

/**
 * Where the monitor's alerts go and what last went wrong with them or with its daily run, in the
 * page's words. Null for a monitor too old to say. A record the monitor could not read is said as not
 * known, never as "nothing went wrong" (invariant 5).
 *
 * @param {MonitorStatus | null | undefined} status
 * @param {(iso: string) => string} when how a time is written
 * @returns {{ alerts: string, good: boolean, problems: string[], unknown: string[] } | null}
 */
export function monitorStatusWords(status, when) {
	if (!status || typeof status !== "object" || !status.alerts) return null;
	const { alerts, schedule } = status;
	const delivered = alerts.delivery?.lastDeliveredAt ? ` The last one was delivered ${when(alerts.delivery.lastDeliveredAt)}.` : "";
	const line =
		alerts.to === "webhook"
			? `Alerts go to ${alerts.host ?? "a webhook"}${alerts.format ? ` (${alerts.format})` : ""}.${delivered}`
			: alerts.problem
				? `Alerts go only to the monitor's own log: the webhook it was given is not used. ${alerts.problem}`
				: "Alerts go only to the monitor's own log, so nobody is told when something changes. Set a webhook where the monitor is deployed to be told.";
	/** @type {string[]} */
	const problems = [];
	if (alerts.delivery?.lastError) problems.push(`The last alert could not be delivered (${when(alerts.delivery.lastError.at)}): ${alerts.delivery.lastError.error}`);
	if (schedule?.lastError) problems.push(`The monitor's daily run failed (${when(schedule.lastError.at)}): ${schedule.lastError.error}`);
	/** @type {string[]} */
	const unknown = [];
	if (alerts.delivery === null || schedule === null) unknown.push("Whether alerts were delivered and the daily run worked is not known: the monitor could not read its record of them. Apply its database migrations (0004) and deploy it again.");
	return { alerts: line, good: alerts.to === "webhook" && problems.length === 0, problems, unknown };
}
