/** The host check as text for a terminal. */
import { AREA_TITLES } from "../../ui/host-areas.js";
import type { HostReport } from "./types.ts";
import { hostCounts } from "./check.ts";

const STATUS_WORDS = { passed: "Passed", failed: "Problem", unknown: "Could not check" };
const SEVERITY_WORDS = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

/** Program names and paths come from the system; control characters never reach the terminal. */
function plain(text: string): string {
	return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "").replace(/`/g, "");
}

export function renderHostText(report: HostReport): string {
	const counts = hostCounts(report);
	const lines: string[] = [];
	const os = report.os ? `${report.os.name} ${report.os.version}${report.os.build ? ` (${report.os.build})` : ""}` : report.platform;
	lines.push(`This computer: ${plain(os)}, checked ${report.checkedAt}`);
	lines.push(`${counts.failed} problems, ${counts.unknown} could not be checked, ${counts.passed} passed`, "");
	for (const [area, title] of AREA_TITLES) {
		const checks = report.checks.filter((check) => check.area === area);
		if (checks.length === 0) continue;
		lines.push(`## ${title}`);
		for (const check of checks) {
			const mark = check.status === "failed" ? `${STATUS_WORDS.failed}, ${SEVERITY_WORDS[check.severity]}` : STATUS_WORDS[check.status];
			lines.push(`- [${mark}] ${plain(check.title)}`, `    ${plain(check.detail)}`);
			for (const item of check.items ?? []) lines.push(`      · ${plain(item)}`);
			if (check.status !== "passed") for (const step of check.fix ?? []) lines.push(`    Fix: ${plain(step)}`);
		}
		lines.push("");
	}
	lines.push("## Not covered", ...report.notCovered.map((line) => `- ${line}`), "");
	return lines.join("\n");
}
