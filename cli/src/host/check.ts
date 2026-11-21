/**
 * Checks the computer Porchlight runs on, reading only (CLAUDE.md invariant 19). Each step runs on
 * its own: one that fails becomes "unknown" for what it covers and the others still run.
 */
import { homedir } from "node:os";
import type { Runner } from "../repos/exec.ts";
import { severityRank } from "../repos/types.ts";
import { credentialChecks } from "./credentials.ts";
import { browserExtensionChecks, sshConfigChecks, startupChecks } from "./extras.ts";
import { automaticLogin, automaticUpdates, fileVault, firewall, gatekeeper, guestAccount, osVersion, screenLock, softwareUpdates, systemIntegrity } from "./macos.ts";
import { listeningServices } from "./network.ts";
import { packageChecksFor } from "./packages.ts";
import { HOST_AREAS, type HostArea, type HostCheck, type HostProgress, type HostReport } from "./types.ts";

export interface HostCheckOptions {
	run: Runner;
	/** Ask Apple's servers for updates now (default). Off: macOS's own last check is used. */
	askApple?: boolean;
	/** Look installed npm and Python packages up on OSV.dev (default). */
	lookUpPackages?: boolean;
	/** Tests pass their own. */
	home?: string;
	platform?: NodeJS.Platform;
	pathEnv?: string;
	/** Where /Library is looked for on a Mac (default the system's own). Tests pass a folder of their own. */
	systemRoot?: string;
	now?: () => Date;
	onProgress?: (progress: HostProgress) => void;
}

interface Step {
	label: string;
	area: HostArea;
	run: () => Promise<HostCheck[]>;
}

/** A tool that stops answering becomes "could not check" for its part, not a check that never ends. */
const COMMAND_TIMEOUT_MS = 2 * 60_000;

export async function checkHost(options: HostCheckOptions): Promise<HostReport> {
	const run: Runner = (command, args, runOptions) => options.run(command, args, { timeoutMs: COMMAND_TIMEOUT_MS, ...runOptions });
	const platform = options.platform ?? process.platform;
	const mac = platform === "darwin";
	const askApple = options.askApple ?? true;
	const lookUp = options.lookUpPackages ?? true;
	const home = options.home ?? homedir();
	const now = options.now ?? (() => new Date());
	let firewallOn: boolean | null = null;

	const macSteps: Step[] = [
		{ label: "Software updates", area: "updates", run: async () => [await softwareUpdates(run, askApple)] },
		{ label: "Automatic updates", area: "updates", run: async () => [await automaticUpdates(run)] },
		{ label: "FileVault", area: "protection", run: async () => [await fileVault(run)] },
		{ label: "System Integrity Protection", area: "protection", run: async () => [await systemIntegrity(run)] },
		{ label: "Gatekeeper", area: "protection", run: async () => [await gatekeeper(run)] },
		{
			label: "Firewall",
			area: "protection",
			run: async () => {
				const result = await firewall(run);
				firewallOn = result.on;
				return result.checks;
			},
		},
		{ label: "Login", area: "protection", run: async () => [await automaticLogin(run), await guestAccount(run), await screenLock(run)] },
		{ label: "Network services", area: "network", run: () => listeningServices(run, firewallOn, true) },
	];
	const steps: Step[] = [
		...(mac ? macSteps : []),
		{ label: "Credentials in files", area: "credentials", run: () => credentialChecks(home, mac) },
		{ label: "SSH settings", area: "credentials", run: () => sshConfigChecks(home) },
		...(mac || platform === "linux" ? [{ label: "Programs that start by themselves", area: "startup" as const, run: () => startupChecks(run, home, mac, options.systemRoot) }] : []),
		{ label: "Browser extensions", area: "startup", run: () => browserExtensionChecks(home, mac) },
		{ label: "Installed packages", area: "packages", run: () => packageChecksFor({ run, lookUp, pathEnv: options.pathEnv ?? process.env.PATH, mac }) },
	];

	const checks: HostCheck[] = [];
	for (const [index, step] of steps.entries()) {
		options.onProgress?.({ done: index, total: steps.length, current: step.label });
		try {
			checks.push(...(await step.run()));
		} catch (err) {
			checks.push({
				id: `step:${step.label}`,
				area: step.area,
				title: step.label,
				severity: "medium",
				status: "unknown",
				detail: `This check failed: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}
	options.onProgress?.({ done: steps.length, total: steps.length, current: "" });

	return {
		checkedAt: now().toISOString(),
		platform,
		os: mac ? await osVersion(run) : null,
		checks: sortChecks(checks),
		notCovered: notCovered(mac, askApple, lookUp),
		lookups: { apple: mac && askApple, packages: lookUp },
	};
}

/** By area, then problems first, most severe first; the order each check was found in otherwise. */
export function sortChecks(checks: HostCheck[]): HostCheck[] {
	const statusOrder = { failed: 0, unknown: 1, passed: 2 };
	return checks
		.map((check, index) => ({ check, index }))
		.sort(
			(a, b) =>
				HOST_AREAS.indexOf(a.check.area) - HOST_AREAS.indexOf(b.check.area) ||
				statusOrder[a.check.status] - statusOrder[b.check.status] ||
				(a.check.status === "passed" ? 0 : severityRank(a.check.severity) - severityRank(b.check.severity)) ||
				a.index - b.index,
		)
		.map(({ check }) => check);
}

export function notCovered(mac: boolean, askApple: boolean, lookUp: boolean): string[] {
	return [
		...(mac ? [] : ["Updates, built-in protection and network services are checked on a Mac only."]),
		...(mac && !askApple ? ["Apple was not asked for updates: the list is from macOS's own last check."] : []),
		...(lookUp ? [] : ["Installed npm and Python packages were not looked up on OSV.dev."]),
		"Apps in /Applications and from the App Store are not checked against advisories. Keep them updated.",
		"Ruby gems, Go and Rust tools, and Python environments other than the python3 on PATH are not checked.",
		"Services that use UDP are not listed under Reachable from the network.",
	];
}

/** Counts for a summary: problems, could not check, passed. */
export function hostCounts(report: HostReport): { failed: number; unknown: number; passed: number } {
	return {
		failed: report.checks.filter((check) => check.status === "failed").length,
		unknown: report.checks.filter((check) => check.status === "unknown").length,
		passed: report.checks.filter((check) => check.status === "passed").length,
	};
}
