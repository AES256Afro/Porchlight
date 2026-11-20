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
	if (preview.total > 0) {
		const count = (/** @type {number} */ n) => `${n.toLocaleString()} ${n === 1 ? "repository" : "repositories"}`;
		const inFolder = preview.total - preview.fetched;
		const where = settings?.service ? "on this server" : `in ${preview.root}`;
		let title = `${count(preview.total)} ${where}`;
		if (preview.fetched > 0) title = inFolder > 0 ? `${count(preview.total)}: ${inFolder.toLocaleString()} ${where}, ${preview.fetched.toLocaleString()} fetched from GitHub` : `${count(preview.total)} fetched from GitHub`;
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
			text: "Open Terminal in the Porchlight project folder and sign in to Cloudflare. A browser window opens for you to allow it. The free plan is enough, and this is done once. If this computer has no copy of the project, get one first with the top command.",
			commands: ["git clone https://github.com/AES256Afro/Porchlight.git && cd Porchlight && npm install", "cd monitor", "npx cf auth login"],
		},
		{
			text: "Make the monitor's database. The command prints a database ID: copy it.",
			commands: ["npx cf d1 create --name porchlight-monitor"],
		},
		{
			text: "Open `monitor/cloudflare.config.ts` in an editor and put that ID in place of the value of `D1_DATABASE_ID`. Then prepare the database, with the same ID in place of `<DATABASE_ID>`.",
			commands: ["npx cf d1 migrations apply <DATABASE_ID>"],
		},
		{
			text: "Make the monitor's admin token and deploy. The first command writes a new random token into `.secrets.production`. The second prints the monitor's address when it finishes, which looks like `https://porchlight-monitor.your-name.workers.dev`.",
			commands: ["printf 'ADMIN_TOKEN=%s\\n' \"$(openssl rand -hex 32)\" > .secrets.production", "npx cf deploy --secrets-file .secrets.production"],
		},
		{
			text: "Show the admin token so you can copy it. It is the only secret here: anyone who has it can change which websites your monitor watches.",
			commands: ["sed -n 's/^ADMIN_TOKEN=//p' .secrets.production"],
		},
		{
			text: service
				? 'In BoxPilot, open Apps → Porchlight → Settings. Paste the address into "Monitor address" and the token into "Monitor admin token", then confirm. Porchlight restarts and this page becomes your list of websites.'
				: "Paste the address and the token in Settings → Monitor. Porchlight checks them with the monitor and this page becomes your list of websites. No restart is needed.",
		},
	];
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
	const pace = minGapMs === 1000 ? "one action a second" : `one action every ${(minGapMs / 1000).toLocaleString()} seconds`;
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
