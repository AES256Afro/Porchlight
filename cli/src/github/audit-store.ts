/**
 * `github-audit.json` in the data folder: the latest GitHub settings audit, readable by its owner alone
 * (0600, through `private-files.ts`). It names repositories, alert types, deploy key titles and webhook
 * hosts; never the token, a key, a secret or a webhook's address beyond its host (invariant 24).
 */
import { readPrivateJson, writePrivateJson } from "../private-files.ts";
import type { GhReport } from "./audit-types.ts";

export const AUDIT_FILE = "github-audit.json";

/** The kept audit: none yet, the audit, or why it could not be read (never taken for none, invariant 5). */
export type KeptAudit = { state: "missing" } | { state: "read"; report: GhReport } | { state: "unreadable"; reason: string };

export async function readGithubAudit(path: string): Promise<KeptAudit> {
	const read = await readPrivateJson(path);
	if (read.state !== "read") return read;
	const report = read.value as Partial<GhReport> | null;
	if (!report || typeof report.checkedAt !== "string" || !Array.isArray(report.repos) || !Array.isArray(report.notCovered) || !Array.isArray(report.permissions)) {
		return { state: "unreadable", reason: "it is not a GitHub audit Porchlight wrote" };
	}
	return { state: "read", report: report as GhReport };
}

export async function saveGithubAudit(path: string, report: GhReport): Promise<void> {
	await writePrivateJson(path, report);
}
