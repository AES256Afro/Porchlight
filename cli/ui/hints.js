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
			`In BoxPilot, ${scan.root} is the server folder chosen as "Repositories to scan". To scan the folder that holds your git checkouts, change it in Apps → SecurityX → Settings.`,
		);
	}
	const levels = scan.depth ?? 0;
	hints.push(
		levels === 0
			? "Depth 0 looks only at the folder itself: raise Depth to look in the folders inside it."
			: `It looked ${levels} folder ${levels === 1 ? "level" : "levels"} down: raise Depth for repositories further in. Folders SecurityX cannot read are skipped.`,
	);
	return hints;
}
