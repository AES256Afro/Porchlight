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

/**
 * How to connect the monitor that checks websites, as numbered steps. As a service the two values
 * go into BoxPilot's settings; from a terminal they are set before starting Porchlight.
 *
 * @param {boolean} service
 * @returns {string[]}
 */
export function monitorSetupSteps(service) {
	const deploy = 'Put the monitor on your Cloudflare account. This is done once, from a computer that has this project: its README has the commands under "Monitor domains". The free plan is enough.';
	const values = "Keep two things from that step: the monitor's address, which looks like `https://porchlight-monitor.your-name.workers.dev`, and the admin token you made for it.";
	return service
		? [deploy, values, 'In BoxPilot, open Apps → Porchlight → Settings. Paste them into "Monitor address" and "Monitor admin token", then confirm. Porchlight restarts and this page becomes your list of websites.']
		: [deploy, values, "Stop Porchlight, set both values, and start it again:"];
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
