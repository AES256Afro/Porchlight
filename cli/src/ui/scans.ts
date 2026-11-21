// What a scan request asks for, what a scan would cover, and a finished scan in figures.
import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { ChoiceError, parseChoices } from "../../ui/scan-choices.js";
import { fetchedRepos } from "../github/github.ts";
import { discoverRepos } from "../repos/discover.ts";
import { nameUnder } from "../repos/report.ts";
import { SEVERITIES, type ScanChoices, type ScanReport, type Severity } from "../repos/types.ts";
import { HttpError } from "./http.ts";

export const MAX_DEPTH = 6;

/** Repositories named in a preview of what a scan would cover. The count is always the full one. */
export const PREVIEW_NAMES = 60;

/** A finished scan in figures, for a project's log: "3 repositories, 12 findings (1 critical, 4 high, 7 medium)". */
export function scanCounts(report: ScanReport): string {
	const counts = new Map<Severity, number>();
	let total = 0;
	for (const repo of report.repos) {
		for (const finding of repo.findings) {
			counts.set(finding.severity, (counts.get(finding.severity) ?? 0) + 1);
			total++;
		}
	}
	const repositories = `${report.repos.length} ${report.repos.length === 1 ? "repository" : "repositories"}`;
	const bySeverity = SEVERITIES.filter((severity) => counts.has(severity)).map((severity) => `${counts.get(severity)} ${severity}`);
	return `${repositories}, ${total} ${total === 1 ? "finding" : "findings"}${bySeverity.length > 0 ? ` (${bySeverity.join(", ")})` : ""}`;
}

/** What a scan of a folder would cover, found the way a scan finds it: nothing is run and nothing is read but folder names. */
export interface ScanPreview {
	root: string;
	/** Whether `root` is a folder this process can see. */
	exists: boolean;
	/** How many repositories a scan would cover. */
	total: number;
	/** The first of them, named as the report names them. */
	repos: string[];
	/** How many of them were fetched from GitHub rather than found in `root`. */
	fetched: number;
	depth: number;
	/** The folder is the home folder itself, which is not looked through unless asked (US-2): it would walk Desktop, Documents and Downloads. */
	isHome?: boolean;
	/** Whether git and each scanner is ready, with what to install when it is not (US-2). */
	tools?: { tool: string; ready: boolean; fix: string }[];
}

export async function previewScan(root: string, depthText: string | null, githubDir: string, wholeHome = false): Promise<ScanPreview> {
	const depth = depthText === null ? 3 : Number(depthText);
	if (!Number.isInteger(depth) || depth < 0 || depth > MAX_DEPTH) throw new HttpError(400, `Depth must be a whole number from 0 to ${MAX_DEPTH}`);
	if (root.trim() === "") throw new HttpError(400, "Choose a folder to scan");
	const absolute = resolve(root.trim().replace(/^~(?=$|\/)/, homedir()));
	const info = await stat(absolute).catch(() => null);
	if (!info?.isDirectory()) return { root: absolute, exists: false, total: 0, repos: [], fetched: 0, depth };
	// The whole home folder is looked through only when asked: macOS guards Desktop, Documents and Downloads (US-2).
	if (absolute === homedir() && !wholeHome) return { root: absolute, exists: true, total: 0, repos: [], fetched: 0, depth, isHome: true };
	const inFolder = await discoverRepos(absolute, depth);
	const fromGithub = (await fetchedRepos(githubDir)).map((name) => join(githubDir, ...name.split("/"))).filter((path) => !inFolder.includes(path));
	const names = [...inFolder, ...fromGithub].slice(0, PREVIEW_NAMES).map((path) => nameUnder(absolute, [githubDir], path));
	return { root: absolute, exists: true, total: inFolder.length + fromGithub.length, repos: names, fetched: fromGithub.length, depth };
}

export async function scanRequest(body: unknown, defaultDepth: number): Promise<{ root: string; depth: number; choices: ScanChoices; sendsToHosted: boolean; shown?: { model: string; host: string } }> {
	const { root, depth = defaultDepth, choices: asked, sendsToHosted, shown } = (body ?? {}) as { root?: unknown; depth?: unknown; choices?: unknown; sendsToHosted?: unknown; shown?: { model?: unknown; host?: unknown } };
	if (typeof root !== "string" || root.trim() === "") throw new HttpError(400, "Choose a folder to scan");
	if (typeof depth !== "number" || !Number.isInteger(depth) || depth < 0 || depth > MAX_DEPTH) {
		throw new HttpError(400, `Depth must be a whole number from 0 to ${MAX_DEPTH}`);
	}
	const expanded = root.trim().replace(/^~(?=$|\/)/, homedir());
	const absolute = resolve(expanded);
	const info = await stat(absolute).catch(() => null);
	if (!info?.isDirectory()) throw new HttpError(400, `Not a folder: ${absolute}`);
	if (asked !== undefined && (typeof asked !== "object" || asked === null || Array.isArray(asked))) throw new HttpError(400, "Choices must be an object");
	let choices: ScanChoices;
	try {
		choices = parseChoices((asked ?? {}) as Record<string, unknown>);
	} catch (err) {
		if (err instanceof ChoiceError) throw new HttpError(400, err.message);
		throw err;
	}
	const named = typeof shown?.model === "string" && typeof shown.host === "string" ? { shown: { model: shown.model, host: shown.host } } : {};
	return { root: absolute, depth, choices, sendsToHosted: sendsToHosted === true, ...named };
}

