/**
 * What on this computer accepts connections from other machines, read from `netstat` and `ps`.
 * Nothing is sent anywhere and no other machine is contacted: this lists this computer's own
 * listening sockets, the way Activity Monitor would.
 */
import type { Runner } from "../repos/exec.ts";
import type { Severity } from "../repos/types.ts";
import { output, unknown } from "./macos.ts";
import type { HostCheck } from "./types.ts";

export interface Listener {
	address: string;
	port: number;
	/** The name netstat shows, which it cuts short. */
	process: string;
	pid: number;
}

/** How far an address reaches. */
export type Scope = "loopback" | "tailnet" | "local" | "all";

/** TCP sockets in the LISTEN state from `netstat -anv -p tcp` (macOS 13 and later, and the older layout). */
export function parseNetstat(text: string): Listener[] {
	const listeners: Listener[] = [];
	for (const line of text.split("\n")) {
		const match = /^tcp[46]*\s+\d+\s+\d+\s+(\S+)\s+\S+\s+LISTEN\b(.*)$/.exec(line);
		if (!match) continue;
		const local = match[1]!;
		const dot = local.lastIndexOf(".");
		const port = Number(local.slice(dot + 1));
		if (dot <= 0 || !Number.isInteger(port)) continue;
		// The process column ("name:pid") follows four counters; a name may hold spaces.
		const named = /^\s*\d+\s+\d+\s+\d+\s+\d+\s+(.+?):(\d+)\s+[0-9a-f]{5}\s/.exec(match[2]!);
		const older = /^\s*\d+\s+\d+\s+(\d+)\s+\d+\s/.exec(match[2]!);
		listeners.push({
			address: local.slice(0, dot),
			port,
			process: named?.[1]?.trim() ?? "",
			pid: Number(named?.[2] ?? older?.[1] ?? 0),
		});
	}
	return listeners;
}

/** `ps -axo pid=,comm=`: each process's executable. */
export function parseProcesses(text: string): Map<number, string> {
	const paths = new Map<number, string>();
	for (const line of text.split("\n")) {
		const match = /^\s*(\d+)\s+(.+)$/.exec(line);
		if (match) paths.set(Number(match[1]), match[2]!.trim());
	}
	return paths;
}

export function addressScope(address: string): Scope {
	const plain = address.replace(/%.*$/, "").toLowerCase();
	if (plain === "*" || plain === "0.0.0.0" || plain === "::") return "all";
	if (plain === "::1" || plain === "localhost" || /^127\./.test(plain)) return "loopback";
	const v4 = /^(\d+)\.(\d+)\.\d+\.\d+$/.exec(plain);
	// Tailscale's ranges: 100.64.0.0/10 and fd7a:115c:a1e0::/48.
	if (v4 && Number(v4[1]) === 100 && Number(v4[2]) >= 64 && Number(v4[2]) <= 127) return "tailnet";
	if (plain.startsWith("fd7a:115c:a1e0:")) return "tailnet";
	return "local";
}

const SCOPE_ORDER: Scope[] = ["loopback", "tailnet", "local", "all"];

/** Programs that are part of macOS. Anything else was installed by someone. */
export function isSystemProgram(path: string): boolean {
	return /^\/(System|usr\/libexec|usr\/sbin|sbin|usr\/bin|Library\/Apple)\//.test(path) || path === "launchd";
}

/** Sharing services macOS turns on from System Settings, by the port it opens. */
const SHARING: Record<number, { name: string; severity: Severity; setting: string; ifUsed: string }> = {
	22: { name: "Remote Login (SSH)", severity: "medium", setting: "General → Sharing → Remote Login", ifUsed: "If you do, allow only the accounts that need it, and sign in with a key rather than a password." },
	5900: { name: "Screen Sharing", severity: "medium", setting: "General → Sharing → Screen Sharing", ifUsed: "If you do, allow only the accounts that need it, and use strong passwords." },
	3283: { name: "Remote Management", severity: "medium", setting: "General → Sharing → Remote Management", ifUsed: "If you do, allow only the accounts that need it, and use strong passwords." },
	3031: { name: "Remote Apple Events", severity: "medium", setting: "General → Sharing → Remote Application Scripting", ifUsed: "If you do, allow only the accounts that need it." },
	445: { name: "File Sharing", severity: "medium", setting: "General → Sharing → File Sharing", ifUsed: "If you do, share only the folders that need it, with only the accounts that need them." },
	548: { name: "File Sharing", severity: "medium", setting: "General → Sharing → File Sharing", ifUsed: "If you do, share only the folders that need it, with only the accounts that need them." },
	631: { name: "Printer Sharing", severity: "low", setting: "General → Sharing → Printer Sharing", ifUsed: "If you do, share only the printers that need it." },
	5000: { name: "AirPlay Receiver", severity: "low", setting: "General → AirDrop & Handoff → AirPlay Receiver", ifUsed: "If you do, set Allow AirPlay for to Current User." },
	7000: { name: "AirPlay Receiver", severity: "low", setting: "General → AirDrop & Handoff → AirPlay Receiver", ifUsed: "If you do, set Allow AirPlay for to Current User." },
};

function reach(scope: Scope, addresses: string[]): string {
	if (scope === "all") return "every network this computer joins";
	if (scope === "tailnet") return "your tailnet only";
	return `your local network (${addresses.filter((address) => addressScope(address) === "local").join(", ")})`;
}

/**
 * One check per program and port that answers more than this computer, or one passed check when
 * nothing does. `firewallOn` lowers what an installed app's listening means: the firewall asks
 * before letting it accept connections, unless it was allowed.
 */
export function classifyListeners(listeners: Listener[], processes: Map<number, string>, firewallOn: boolean | null, mac: boolean): HostCheck[] {
	const groups = new Map<string, { port: number; pid: number; name: string; path: string; addresses: string[]; scope: Scope }>();
	for (const listener of listeners) {
		const scope = addressScope(listener.address);
		if (scope === "loopback") continue;
		const key = `${listener.pid}:${listener.port}`;
		const path = processes.get(listener.pid) ?? listener.process;
		const group = groups.get(key) ?? { port: listener.port, pid: listener.pid, name: listener.process || path.split("/").pop() || "unknown program", path, addresses: [], scope };
		if (!group.addresses.includes(listener.address)) group.addresses.push(listener.address);
		if (SCOPE_ORDER.indexOf(scope) > SCOPE_ORDER.indexOf(group.scope)) group.scope = scope;
		groups.set(key, group);
	}
	if (groups.size === 0) {
		return [{ id: "listeners", area: "network", title: "Nothing accepts connections from the network", severity: "medium", status: "passed", detail: "Every program that listens does so on this computer only (localhost)." }];
	}

	const checks: HostCheck[] = [];
	for (const group of [...groups.values()].sort((a, b) => a.port - b.port)) {
		const system = mac && isSystemProgram(group.path);
		const where = reach(group.scope, group.addresses);
		const sharing = system ? SHARING[group.port] : undefined;
		if (sharing) {
			// One service can open several ports (AirPlay: 5000 and 7000): it is one thing to turn off.
			const id = `service:${sharing.name}`;
			const same = checks.find((check) => check.id === id);
			if (same) {
				same.detail = same.detail.replace(/^Ports? ([\d, ]+) answers?/, (_, ports: string) => `Ports ${ports}, ${group.port} answer`);
				if (group.scope !== "tailnet") same.status = "failed";
				continue;
			}
			checks.push({
				id,
				area: "network",
				title: `${sharing.name} is on`,
				severity: sharing.severity,
				status: group.scope === "tailnet" ? "passed" : "failed",
				detail: `Port ${group.port} answers on ${where}. The firewall lets services turned on in Sharing through.`,
				fix: [`If you do not use it, turn it off in System Settings → ${sharing.setting}.`, sharing.ifUsed],
			});
		} else if (system) {
			checks.push({
				id: `service:${group.port}:${group.name}`,
				area: "network",
				title: `${group.name}, part of macOS, on port ${group.port}`,
				severity: "low",
				status: "passed",
				detail: `Built into macOS (${group.path}). It answers on ${where}.`,
			});
		} else if (group.scope === "tailnet") {
			checks.push({
				id: `service:${group.port}:${group.name}`,
				area: "network",
				title: `${group.name} on port ${group.port}`,
				severity: "low",
				status: "passed",
				detail: `Only devices on your tailnet can reach it. Program: ${group.path || group.name}.`,
			});
		} else {
			checks.push({
				id: `service:${group.port}:${group.name}`,
				area: "network",
				title: `${group.name} accepts connections on port ${group.port}`,
				severity: firewallOn ? "low" : "medium",
				status: "failed",
				detail: `It answers on ${where}. Program: ${group.path || group.name}.${firewallOn ? " The firewall asks before letting it accept connections, unless it was allowed." : ""}`,
				fix: [
					"If only this computer needs it, make it listen on 127.0.0.1 (localhost) instead.",
					"If nothing needs it, quit it or stop it starting by itself.",
					...(firewallOn === false ? ["Turn on the firewall in System Settings → Network → Firewall."] : []),
				],
			});
		}
	}
	return checks;
}

export async function listeningServices(run: Runner, firewallOn: boolean | null, mac: boolean): Promise<HostCheck[]> {
	const base = { id: "listeners", area: "network", title: "What accepts connections from the network", severity: "medium" } as const;
	const netstat = await output(run, "netstat", ["-anv", "-p", "tcp"]);
	if (!netstat || netstat.code !== 0) return [unknown(base, netstat ? `netstat failed with code ${netstat.code}` : "netstat is not on this computer")];
	if (!/Local Address/i.test(netstat.text)) return [unknown(base, "netstat gave an answer Porchlight does not recognise")];
	const ps = await output(run, "ps", ["-axo", "pid=,comm="]);
	const processes = ps && ps.code === 0 ? parseProcesses(ps.stdout) : new Map<number, string>();
	return classifyListeners(parseNetstat(netstat.stdout), processes, firewallOn, mac);
}
