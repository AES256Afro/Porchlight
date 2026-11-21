/**
 * Daily use from the command line (M15): what changed after a saved scan (R6Q-5), the kept scans
 * (`repos history`), scanning one repository again (`repos scan --again`, R6Q-6), statuses
 * (`findings note`, `findings notes`, R6Q-7), and `forget` (R6F-4).
 *
 * Each reads and writes only Porchlight's own files: the report and its companions beside it, and the
 * data folder. A status never changes a finding, a severity, a count, the roadmap or an export
 * (invariant 17); `forget` removes only the files it names, after listing them, and never anything in
 * a project folder (invariant 23) or a scanned repository.
 */
import { lstat, readdir, readFile, rm, rmdir } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { locateFinding } from "./assist/prompts.ts";
import { History, mergeRescan, orphanNotes, readNotes, setNote, type LatestChange } from "./repos/history.ts";
import { parseScanReport, repoName } from "./repos/report.ts";
import { rescanRepo } from "./repos/scan.ts";
import type { Runner } from "./repos/exec.ts";
import type { ScanReport } from "./repos/types.ts";
import { readPrivateJson, writePrivate } from "./private-files.ts";
import { jsonText } from "./roadmap/escape.ts";
import { standardChoices } from "../ui/scan-choices.js";
import { changeSummary, findingKey, isDay, isStatus, MAX_NOTE, NOTE_SOURCES, rescanWords, STATUSES, statusLabel, acceptanceEnded } from "../ui/tracking.js";

/** Where the CLI writes its words: the report or list on the output stream, notes on the error stream. */
export interface Out {
	say: (text: string) => void;
	warn: (text: string) => void;
}

/** "2 new, 1 fixed since the previous scan." after `repos scan --save` (R6Q-5); or why it cannot be said. */
export function changeLine(latest: LatestChange): string {
	if (latest.state === "first") return "This is the first scan of these folders kept, so nothing is marked new or fixed yet.";
	if (latest.state === "unreadable") return `What changed since the previous scan cannot be said: ${latest.reason}`;
	return changeSummary(latest.change) ?? "";
}

/** `repos history [--json]`: the kept scans of the saved report, newest first, with new and fixed against the one before. */
export async function reposHistory(args: string[], reportDir: string, out: Out): Promise<number> {
	const { values } = parseArgs({ args, options: { json: { type: "boolean", default: false } } });
	const history = new History(reportDir);
	const scans = (await history.list()).reverse();
	if (values.json) {
		out.say(jsonText({ scans }).trimEnd());
		return 0;
	}
	if (scans.length === 0) {
		out.say("No scan is kept yet. Keep one with: porchlight repos scan <folder> --save");
		return 0;
	}
	const rows = scans.map((scan) => [
		scan.scannedAt.slice(0, 16).replace("T", " "),
		String(scan.repositories),
		String(scan.findings),
		String(scan.counts.critical ?? 0),
		String(scan.counts.high ?? 0),
		scan.newCount === undefined ? "-" : String(scan.newCount),
		scan.fixedCount === undefined ? "-" : String(scan.fixedCount),
		scan.root,
	]);
	const head = ["Scanned (UTC)", "Repos", "Findings", "Critical", "High", "New", "Fixed", "Folder"];
	const widths = head.map((title, index) => Math.max(title.length, ...rows.map((row) => row[index]!.length)));
	const line = (cells: string[]) => cells.map((cell, index) => (index === cells.length - 1 ? cell : index === 0 ? cell.padEnd(widths[index]!) : cell.padStart(widths[index]!))).join("  ");
	out.say([line(head), ...rows.map(line)].join("\n"));
	out.say(`\n${scans.length === 1 ? "1 scan" : `${scans.length} scans`} kept. New and fixed are counted against the scan of the same folders before each; "-" where there was none.`);
	return 0;
}

/** Reads the saved report, or says how to make one. */
async function savedReport(reportPath: string): Promise<ScanReport> {
	let text: string;
	try {
		text = await readFile(reportPath, "utf8");
	} catch {
		throw new Error(`No saved scan at ${reportPath}. Make one with: porchlight repos scan <folder> --save`);
	}
	return parseScanReport(text, reportPath);
}

/**
 * `repos scan --save --again <name>` (R6Q-6): scans one repository of the saved report again, by the
 * name the report gives it, never a path, and puts the result in its place as "Scan again" on the page
 * does. The report keeps its scan time, its history entry and a model's judgements.
 */
export async function scanAgain(name: string, reportPath: string, out: Out, deps: { run?: Runner; osvDatabase?: string } = {}): Promise<number> {
	const report = await savedReport(reportPath);
	const before = report.repos.find((repo) => repoName(report, repo) === name);
	if (!before) throw new Error(`${name} is not in the saved scan. Its repositories are: ${report.repos.map((repo) => repoName(report, repo)).slice(0, 20).join(", ")}`);
	const choices = { ...(report.choices ?? standardChoices()), analyse: false };
	out.warn(`Scanning ${name} again…`);
	const now = await rescanRepo(before.path, { choices, scanned: report.repos.map((repo) => repo.path), ...(deps.run ? { run: deps.run } : {}), ...(deps.osvDatabase ? { osvDatabase: deps.osvDatabase } : {}) });
	const { merged, change } = mergeRescan(name, before, now, choices);
	// Read again: another scan may have replaced the report meanwhile.
	const current = await savedReport(reportPath);
	if (current.scannedAt !== report.scannedAt) throw new Error("A new scan replaced the saved report while this repository was being scanned again. Nothing was changed.");
	await writePrivate(reportPath, jsonText({ ...current, repos: current.repos.map((repo) => (repo.path === before.path ? merged : repo)) }));
	out.say(rescanWords(change));
	return 0;
}

const NOTE_OPTIONS = {
	repo: { type: "string" },
	rule: { type: "string" },
	location: { type: "string" },
	detail: { type: "string" },
	status: { type: "string" },
	until: { type: "string" },
	note: { type: "string" },
	json: { type: "boolean", default: false },
} as const;

/**
 * `findings note` sets one finding's status and note; `findings notes` lists them (R6Q-7). The finding
 * is found in the saved report by repository, rule and place, as on the page. Recorded as set from the
 * command line, with the status it replaced (R6U-7).
 */
export async function findingsCommand(command: string | undefined, args: string[], reportPath: string, out: Out, now: Date = new Date()): Promise<number> {
	const notesPath = join(dirname(reportPath), "finding-notes.json");
	const { values } = parseArgs({ args, options: NOTE_OPTIONS });
	if (command === "notes") {
		const notes = await readNotes(notesPath);
		const report = await readFile(reportPath, "utf8").then((text) => parseScanReport(text, reportPath)).catch(() => null);
		const orphans = new Set(await orphanNotes(notes, new History(dirname(reportPath)), report));
		const entries = Object.entries(notes).map(([key, note]) => {
			const [repo = "", ruleId = "", location = "", detail = ""] = key.split("\n");
			return { repo, ruleId, location, detail, ...note, matchesNoKeptFinding: orphans.has(key) };
		});
		if (values.json) {
			out.say(jsonText({ notes: entries }).trimEnd());
			return 0;
		}
		if (entries.length === 0) out.say("No statuses or notes are set.");
		for (const entry of entries) {
			const ended = acceptanceEnded(entry, now) ? " (acceptance ended)" : entry.until ? ` until ${entry.until}` : "";
			const from = entry.by ? `, set ${NOTE_SOURCES[entry.by]}` : "";
			out.say(`${statusLabel(entry.status)}${ended}  ${entry.repo}  ${entry.ruleId}  ${entry.location}${entry.matchesNoKeptFinding ? "  [matches no kept finding]" : ""}`);
			out.say(`  ${entry.updatedAt.slice(0, 10)}${from}${entry.note ? `: ${entry.note}` : ""}`);
		}
		if (orphans.size > 0) out.say(`\n${orphans.size === 1 ? "1 note matches" : `${orphans.size} notes match`} no finding of any kept scan. Settings → Data on the page lists and removes them.`);
		return 0;
	}
	if (command !== "note") throw new Error("Usage: porchlight findings note --repo <name> --rule <id> --location <place> --status <status> [--until <day>] [--note <text>], or: porchlight findings notes");
	const { repo, rule, location, status } = values;
	if (!repo || !rule || !location || !status) throw new Error("findings note needs --repo, --rule, --location and --status");
	if (!isStatus(status)) throw new Error(`--status must be one of: ${STATUSES.map(([value]) => value).join(", ")}`);
	const note = values.note ?? "";
	if (note.length > MAX_NOTE) throw new Error(`Keep the note to ${MAX_NOTE} characters`);
	const until = values.until;
	if (until !== undefined) {
		if (status !== "accepted") throw new Error("Only an accepted risk has an end date (--until)");
		if (!isDay(until)) throw new Error("Give --until as a day, such as 2027-06-30");
		if (until < new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10)) throw new Error("Choose an --until day that has not passed");
	}
	const report = await savedReport(reportPath);
	const found = locateFinding(report, { repo, ruleId: rule, location, ...(values.detail !== undefined ? { detail: values.detail } : {}) });
	if (!found) throw new Error("That finding is not in the saved scan. `porchlight repos export --content findings --format csv` lists each one's repository, rule and place.");
	const same = found.repo.findings.filter((finding) => finding.ruleId === rule && finding.location === location);
	if (values.detail === undefined && same.length > 1) throw new Error(`${same.length} findings share that place; name one with --detail (${same.map((finding) => finding.detail).slice(0, 5).join(" | ")})`);
	if (status === "rotated" && found.finding.kind !== "secret") throw new Error("Only a secret can be marked rotated");
	const key = findingKey(repo, found.finding);
	const saved = await setNote(notesPath, key, status, note, now, until, "cli");
	out.say(saved ? `${statusLabel(saved.status)}: ${repo} ${rule} ${location}${saved.previous ? ` (was ${statusLabel(saved.previous.status)})` : ""}` : `Back to Open, with no note: ${repo} ${rule} ${location}`);
	return 0;
}

/**
 * What `forget` may remove: Porchlight's own files and folders, by name. Anything else in the data
 * folder is listed as not Porchlight's and left alone.
 */
const DATA_ENTRIES: Record<string, string> = {
	"repo-scan.json": "the latest scan report",
	"repo-scan.json.bak": "a copy of an earlier report",
	history: "kept scans",
	"finding-notes.json": "your statuses and notes",
	"repo-analysis.json": "a model's judgements",
	"repo-mural.json": "the export mural",
	"history-scans": "reused history scans",
	"ui-settings.json": "the page's look",
	"ui-view.json": "where the page was left",
	"model-settings.json": "the model chosen and its keys",
	"monitor-settings.json": "the monitor's address and admin token",
	"cloudflare-settings.json": "the Cloudflare token",
	"cloudflare-audit.json": "the latest Cloudflare audit",
	"cloudflare-audits": "earlier Cloudflare audits",
	"cloudflare-changes.json": "the record of Cloudflare changes sent",
	"host-check.json": "the latest check of this computer",
	"host-checks": "earlier checks of this computer",
	"investigate-domains.json": "domains and their ownership tokens for investigations",
	investigations: "investigation runs",
	discussions: "kept answers from models",
	github: "repositories fetched from GitHub, with their full history",
	"osv-db": "OSV's vulnerability databases",
	"access.json": "the access key for other devices",
	"projects.json": "the list of projects (their folders are kept)",
	"app.log": "the Mac app's log",
};
/** Beside a report kept elsewhere (`--report`), only its own companions. */
const REPORT_ENTRIES = ["history", "finding-notes.json", "repo-analysis.json", "repo-mural.json"];

interface Planned {
	path: string;
	what: string;
}

/** Whether `path` is `folder` or inside it. */
function within(path: string, folder: string): boolean {
	const rel = relative(folder, path);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/** The project folders Porchlight writes into, from projects.json: listed, never removed (invariant 23). */
async function projectFolders(dataDir: string): Promise<string[]> {
	const read = await readPrivateJson(join(dataDir, "projects.json"));
	// A list that cannot be read is said, never taken for none: forget then removes nothing (invariant 5).
	if (read.state === "unreadable") throw new Error(`The list of projects cannot be read (${read.reason}), so forget cannot tell which folders are yours. Nothing was removed.`);
	const parsed = (read.state === "read" ? read.value : {}) as { projects?: { folder?: unknown }[] } | null;
	return (parsed?.projects ?? []).map((project) => project.folder).filter((folder): folder is string => typeof folder === "string" && isAbsolute(folder));
}

/** Whether a folder, or one above it, is a git repository: a scanned repository is never touched. */
async function inGitRepository(folder: string): Promise<boolean> {
	for (let dir = resolve(folder); ; dir = dirname(dir)) {
		if (await lstat(join(dir, ".git")).then(() => true, () => false)) return true;
		if (dirname(dir) === dir) return false;
	}
}

/** Names of the hosted providers whose keys are saved, never a key: each should be revoked with its provider. */
async function savedProviderKeys(dataDir: string): Promise<string[]> {
	const read = await readPrivateJson(join(dataDir, "model-settings.json"));
	const parsed = (read.state === "read" ? read.value : null) as { keys?: Record<string, unknown> } | null;
	return Object.keys(parsed?.keys ?? {}).filter((name) => name !== "servers");
}

/**
 * `porchlight forget [--yes]` (R6F-4): lists, then removes, what Porchlight keeps on this computer, and
 * says what lives elsewhere. Without --yes nothing is removed. Only the names above are removed, links
 * are left alone, and a project folder or a git repository is never touched.
 */
export async function forget(args: string[], defaults: { dataDir: string }, out: Out): Promise<number> {
	const { values } = parseArgs({ args, options: { yes: { type: "boolean", default: false }, data: { type: "string" }, report: { type: "string" } } });
	const dataDir = resolve(values.data ?? defaults.dataDir);
	const projects = await projectFolders(dataDir);
	const remove: Planned[] = [];
	const kept: string[] = [];
	const refuse = (folder: string): string | null => {
		// A project folder inside the data folder (a service keeps them under projects/) is simply not on the list.
		const project = projects.find((candidate) => within(folder, candidate));
		return project ? `${folder} is inside a project folder (${project}), which Porchlight never removes from` : null;
	};
	const dataProblem = refuse(dataDir) ?? ((await inGitRepository(dataDir)) ? `${dataDir} is inside a git repository, so nothing there is removed` : null);
	if (dataProblem) throw new Error(dataProblem);
	const plan = async (folder: string, names: Record<string, string>) => {
		for (const name of await readdir(folder).catch(() => [] as string[])) {
			const path = join(folder, name);
			const info = await lstat(path).catch(() => null);
			if (!info) continue;
			if (info.isSymbolicLink()) {
				kept.push(`${path}: a link, left alone`);
				continue;
			}
			// Temporary files a crash left, written beside Porchlight's own files (writePrivate).
			const leftover = /^[\w.-]+\.\d+\.[0-9a-f]{12}\.tmp$/.test(name);
			const what = names[name] ?? (leftover ? "a temporary file a crash left" : undefined);
			if (what) remove.push({ path, what });
			else if (name === "projects") kept.push(`${path}: project folders, which are yours`);
			else if (name === "app.env") kept.push(`${path}: the Mac app's settings, which may hold tokens. Remove it yourself if you no longer use the app`);
			else kept.push(`${path}: not Porchlight's, left alone`);
		}
	};
	await plan(dataDir, DATA_ENTRIES);
	if (values.report) {
		const reportPath = resolve(values.report);
		const reportDir = dirname(reportPath);
		if (!within(reportDir, dataDir)) {
			const problem = refuse(reportDir) ?? ((await inGitRepository(reportDir)) ? `${reportDir} is inside a git repository, so nothing there is removed` : null);
			if (problem) throw new Error(problem);
			const names = Object.fromEntries(REPORT_ENTRIES.map((name) => [name, DATA_ENTRIES[name]!]));
			names[reportPath.slice(reportDir.length + sep.length)] = "the scan report";
			for (const name of Object.keys(names)) {
				const path = join(reportDir, name);
				const info = await lstat(path).catch(() => null);
				if (info && !info.isSymbolicLink()) remove.push({ path, what: names[name]! });
			}
		}
	}
	const changes = await readFile(join(dataDir, "cloudflare-changes.json"), "utf8").then((text) => (JSON.parse(text) as unknown[]).length, () => 0);
	const providers = await savedProviderKeys(dataDir);

	out.say(remove.length === 0 ? `Porchlight keeps nothing in ${dataDir}.` : `${values.yes ? "Removing" : "Would remove"}:`);
	for (const entry of remove) out.say(`  ${entry.path}  (${entry.what})`);
	if (kept.length > 0) out.say(`\nKept:\n${kept.map((line) => `  ${line}`).join("\n")}`);
	if (projects.length > 0) out.say(`\nProject folders are yours and are kept, with what Porchlight saved in them:\n${projects.map((folder) => `  ${folder}`).join("\n")}`);
	out.say(
		[
			"",
			"Kept elsewhere, which forget does not reach:",
			"  The monitor's domains and their history: remove each on the Domains page, or with porchlight domains remove <domain>",
			"  _porchlight-challenge TXT records you published in DNS",
			...(changes > 0 ? [`  ${changes === 1 ? "1 change" : `${changes} changes`} made to your Cloudflare account (listed in cloudflare-changes.json before it is removed)`] : []),
			...(providers.length > 0 ? [`  Keys saved for ${providers.join(", ")}: revoke them with each provider`] : []),
			"  Models Ollama downloaded: ollama list, then ollama rm <name>",
			"  Settings given to a service (BoxPilot) or in your shell's environment",
		].join("\n"),
	);
	if (!values.yes) {
		out.say("\nNothing was removed. Quit Porchlight, then run this again with --yes to remove the files listed above.");
		return 0;
	}
	let failed = 0;
	for (const entry of remove) {
		try {
			await rm(entry.path, { recursive: true, force: true });
		} catch (err) {
			failed++;
			out.warn(`porchlight: could not remove ${entry.path}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
	// The folder itself goes only when nothing is left in it.
	await rmdir(dataDir).catch(() => {});
	out.say(failed === 0 ? `\nRemoved ${remove.length === 1 ? "1 entry" : `${remove.length} entries`}.` : `\n${failed} could not be removed; see above.`);
	return failed === 0 ? 0 : 1;
}
