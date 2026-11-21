// Files the server keeps for itself: the mural, the access key, the page's preferences and place, this
// computer's check and the report. Each is written through private-files.ts, readable only by its owner.
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_ANSWER_PLACE, DEFAULT_LOOK, isAnswerPlace, isLook } from "../../ui/looks.js";
import type { Mural } from "../assist/mural.ts";
import type { HostReport } from "../host/types.ts";
import { writePrivateJson } from "../private-files.ts";
import type { ScanReport } from "../repos/types.ts";
import { KEY_PATTERN, MIN_KEY_LENGTH } from "./gate.ts";

export type MuralJob =
	| { state: "idle" }
	| { state: "running"; key: string; startedAt: string }
	| { state: "done"; key: string; mural: Mural }
	| { state: "failed"; key: string; error: string };

export async function readMural(path: string): Promise<MuralJob | null> {
	try {
		const saved = JSON.parse(await readFile(path, "utf8")) as { key?: unknown; mural?: Mural };
		return typeof saved.key === "string" && saved.mural ? { state: "done", key: saved.key, mural: saved.mural } : null;
	} catch {
		return null;
	}
}

/** It names repositories and findings, like the report, so only its owner can read it. */
export async function saveMural(path: string, job: { key: string; mural: Mural }): Promise<void> {
	await writePrivateJson(path, { key: job.key, mural: job.mural });
}

export interface AccessFile {
	enabled: boolean;
	key: string;
}

/** Long enough to guard a page reachable from other machines, like PORCHLIGHT_UI_KEY. */
export function newAccessKey(): string {
	return randomBytes(32).toString("base64url");
}

export async function readAccess(path: string): Promise<AccessFile | null> {
	try {
		const saved = JSON.parse(await readFile(path, "utf8")) as Partial<AccessFile>;
		if (typeof saved.enabled !== "boolean" || typeof saved.key !== "string") return null;
		// A key too short to guard the page is replaced, never used.
		return { enabled: saved.enabled, key: saved.key.length >= MIN_KEY_LENGTH && KEY_PATTERN.test(saved.key) ? saved.key : newAccessKey() };
	} catch {
		return null;
	}
}

/**
 * What an earlier Porchlight kept beside the report and now keeps in the data folder (S34): settings,
 * keys and tokens, fetched repositories and the OSV databases, audits, investigations and discussions.
 */
export const DATA_FILES = [
	"model-settings.json",
	"monitor-settings.json",
	"cloudflare-settings.json",
	"cloudflare-audit.json",
	"cloudflare-changes.json",
	"access.json",
	"investigate-domains.json",
	"host-check.json",
	"projects.json",
	"ui-settings.json",
	"ui-view.json",
	"investigations",
	"discussions",
	"github",
	"osv-db",
];

/**
 * Moves each of DATA_FILES found beside the report into the data folder, where none of that name is yet,
 * so a key saved by an earlier version keeps working and no longer sits in the report's folder (which may
 * be a project's own). Says what it moved and what it could not; a name already in the data folder wins.
 */
export async function moveIntoDataFolder(reportDir: string, dataDir: string, say: (line: string) => void): Promise<void> {
	await mkdir(dataDir, { recursive: true, mode: 0o700 });
	for (const name of DATA_FILES) {
		const from = join(reportDir, name);
		const to = join(dataDir, name);
		if (!(await lstat(from).catch(() => null)) || (await lstat(to).catch(() => null))) continue;
		try {
			await rename(from, to);
			say(`moved ${name} from beside the report into ${dataDir}`);
		} catch (err) {
			say(`could not move ${name} into ${dataDir} (${(err as NodeJS.ErrnoException).code ?? String(err)}); move it there yourself`);
		}
	}
}

/** Holds the access key, so only its owner can read it. */
export async function saveAccess(path: string, access: AccessFile): Promise<void> {
	await writePrivateJson(path, access);
}

/** The interface's own preferences: the look, and where a model's answers appear. */
export interface UiSettings {
	appearance: string;
	answers: string;
}

/** The chosen look and answer place, each the default when none was saved or the file holds something else. */
export async function readUiSettings(path: string): Promise<UiSettings> {
	let saved: { appearance?: unknown; answers?: unknown } = {};
	try {
		saved = JSON.parse(await readFile(path, "utf8")) ?? {};
	} catch {
		// No file yet, or not JSON: the defaults.
	}
	return {
		appearance: isLook(saved.appearance) ? (saved.appearance as string) : DEFAULT_LOOK,
		answers: isAnswerPlace(saved.answers) ? (saved.answers as string) : DEFAULT_ANSWER_PLACE,
	};
}

export async function saveUiSettings(path: string, settings: UiSettings): Promise<void> {
	await writePrivateJson(path, settings);
}

/** The place in the page the owner was last at, or null. */
export async function readView(path: string): Promise<string | null> {
	try {
		const view = (JSON.parse(await readFile(path, "utf8")) as { view?: unknown }).view;
		return typeof view === "string" && view.startsWith("#/") ? view : null;
	} catch {
		return null;
	}
}

export async function saveView(path: string, view: string): Promise<void> {
	await writePrivateJson(path, { view });
}

/** Reports say where secrets were found, so a new one is readable only by its owner. */
export async function readHostReport(path: string): Promise<HostReport | null> {
	try {
		const report = JSON.parse(await readFile(path, "utf8")) as HostReport;
		return Array.isArray(report?.checks) ? report : null;
	} catch {
		return null;
	}
}

/** What this computer's check found says where it is weak, so only its owner can read it. */
export async function saveHostReport(path: string, report: HostReport): Promise<void> {
	await writePrivateJson(path, report);
}

export async function saveReport(path: string, report: ScanReport): Promise<void> {
	await writePrivateJson(path, report);
}
