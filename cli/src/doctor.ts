import { constants } from "node:fs";
import { access, lstat, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { assistantConfig, isHosted } from "./assist/ollama.ts";
import { tokenShapeProblem } from "./cloudflare/client.ts";
import { tokenProblem } from "./github/github.ts";
import { callMonitor, monitorConfig } from "./monitor/client.ts";
import { readSavedMonitor } from "./monitor/settings.ts";
import { safePath, ToolMissingError, type Runner } from "./repos/exec.ts";
import { STALE_AFTER_MS } from "./repos/temp.ts";
import { wrapWords } from "./columns.ts";

// `porchlight doctor`: whether Porchlight has what it needs, and what to do about what it lacks.
// It only reads: programs are asked their version, files are looked at, and (unless --offline) the
// monitor and a local model are asked whether they answer. No secret is printed or kept: a token
// is reported as set or not, and as the right shape or not.

/** ok: works. note: optional and not set up. warning: works, with something worth fixing. problem: Porchlight cannot do its job. */
export type CheckStatus = "ok" | "note" | "warning" | "problem";

export interface Check {
	name: string;
	status: CheckStatus;
	/** What was found, in a sentence. */
	detail: string;
	/** What to do about it, when there is something to do. */
	fix?: string;
}

export interface DoctorOptions {
	run: Runner;
	env: Record<string, string | undefined>;
	/** Where Porchlight keeps its files (~/.porchlight). */
	dataDir: string;
	nodeVersion: string;
	/** Absent: nothing on the network is contacted. */
	fetchFn?: typeof fetch;
}

const MIN_NODE = [22, 18] as const;

export async function runDoctor(options: DoctorOptions): Promise<Check[]> {
	const scanners = await Promise.all([
		program(options.run, "gitleaks", ["version"], "brew install gitleaks", "Committed secrets are not checked without it."),
		program(options.run, "osv-scanner", ["--version"], "brew install osv-scanner", "Vulnerable packages are not checked without it."),
	]);
	// One scanner missing leaves a scan incomplete; both missing leaves nothing to scan with.
	if (scanners.every((check) => check.status !== "ok")) for (const check of scanners) check.status = "problem";
	return [
		nodeCheck(options.nodeVersion),
		await program(options.run, "git", ["--version"], "xcode-select --install", "gitleaks reads each repository's history through git.", "problem"),
		...scanners,
		await dataFolderCheck(options.dataDir),
		await reportCheck(options.dataDir),
		await monitorCheck(options),
		await modelCheck(options),
		githubCheck(options.env),
		await cloudflareCheck(options),
	];
}

function nodeCheck(version: string): Check {
	const [major = 0, minor = 0] = version.split(".").map(Number);
	const enough = major > MIN_NODE[0] || (major === MIN_NODE[0] && minor >= MIN_NODE[1]);
	if (enough) return { name: "Node.js", status: "ok", detail: `Version ${version}.` };
	return { name: "Node.js", status: "problem", detail: `Version ${version}; Porchlight needs ${MIN_NODE.join(".")} or later to run its TypeScript directly.`, fix: "brew upgrade node" };
}

async function program(run: Runner, name: string, args: string[], install: string, without: string, missing: CheckStatus = "warning"): Promise<Check> {
	try {
		const { stdout, stderr } = await run(name, args, { timeoutMs: 10_000 });
		const version = `${stdout}\n${stderr}`.match(/\d+\.\d+(?:\.\d+)?/)?.[0];
		return { name, status: "ok", detail: version ? `Version ${version}.` : "Installed." };
	} catch (err) {
		if (err instanceof ToolMissingError) return { name, status: missing, detail: `Not installed. ${without}`, fix: install };
		return { name, status: missing, detail: `Could not be run: ${err instanceof Error ? err.message : String(err)}`, fix: install };
	}
}

async function dataFolderCheck(dir: string): Promise<Check> {
	const name = "Porchlight's folder";
	try {
		const info = await stat(dir);
		if (!info.isDirectory()) return { name, status: "problem", detail: `${dir} is not a folder.`, fix: `Move it aside: mv ${dir} ${dir}.old` };
		// Scan reports name the files where secrets were found, so the folder is the owner's alone.
		if ((info.mode & 0o077) !== 0) return { name, status: "warning", detail: `${dir} can be read by other users of this computer.`, fix: `chmod 700 ${dir}` };
		// How much room it takes: fetched repositories and kept scans grow it, and nothing else says so (R6O-2).
		const size = await folderSize(dir);
		return { name, status: "ok", detail: `${dir}, readable only by you${size === null ? "" : `, ${sizeWords(size)}`}.` };
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return { name, status: "note", detail: `${dir} does not exist yet. It is made the first time the interface saves something.` };
		return { name, status: "problem", detail: `${dir} cannot be read: ${err instanceof Error ? err.message : String(err)}` };
	}
}

/** The bytes of the files in a folder and below it, links not followed; null past 200,000 entries. */
async function folderSize(dir: string): Promise<number | null> {
	let total = 0;
	let entries = 0;
	const folders = [dir];
	while (folders.length > 0) {
		const folder = folders.pop()!;
		for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
			if (++entries > 200_000) return null;
			const path = join(folder, entry.name);
			if (entry.isDirectory()) folders.push(path);
			else if (entry.isFile()) total += (await lstat(path).catch(() => null))?.size ?? 0;
		}
	}
	return total;
}

function sizeWords(bytes: number): string {
	if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB in all`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB in all`;
	return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB in all (fetched repositories and kept scans: remove ones you no longer need)`;
}

async function reportCheck(dir: string): Promise<Check> {
	const name = "Last scan";
	const path = join(dir, "repo-scan.json");
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch (err) {
		// Only a file that is not there means no scan is kept; one that cannot be read is said as that (B62).
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return { name, status: "note", detail: "No scan is kept yet.", fix: "porchlight ui   (then choose Check your code), or: porchlight repos scan <folder> --save" };
		return { name, status: "problem", detail: `${path} cannot be read: ${err instanceof Error ? err.message : String(err)}`, fix: `Check who owns it and its permissions: ls -l ${path}` };
	}
	try {
		const report = JSON.parse(text) as { scannedAt?: unknown; repos?: unknown };
		if (typeof report.scannedAt !== "string" || !Array.isArray(report.repos)) throw new Error("not a scan report");
		const count = report.repos.length;
		return { name, status: "ok", detail: `${count === 1 ? "1 repository" : `${count} repositories`}, scanned ${report.scannedAt.slice(0, 10)}.` };
	} catch {
		return { name, status: "warning", detail: `${path} is not a Porchlight scan report, so the interface cannot show it.`, fix: "Scan again from the interface; the new scan replaces the file." };
	}
}

async function monitorCheck({ env, fetchFn, dataDir }: DoctorOptions): Promise<Check> {
	const name = "Monitor";
	let config;
	if (!env.PORCHLIGHT_MONITOR_URL && !env.PORCHLIGHT_ADMIN_TOKEN) {
		// The one saved under Settings → Monitor, as the page and the command line use it (J-Q2).
		config = (await readSavedMonitor(join(dataDir, "monitor-settings.json")))?.config;
		if (!config) return { name, status: "note", detail: "Not connected. The Domains page works once the monitor is connected under Settings → Monitor, or with PORCHLIGHT_MONITOR_URL and PORCHLIGHT_ADMIN_TOKEN." };
	} else {
		try {
			config = monitorConfig(env);
		} catch (err) {
			return { name, status: "warning", detail: err instanceof Error ? err.message : String(err) };
		}
	}
	if (!fetchFn) return { name, status: "ok", detail: `Set to ${config.url.host}. Not contacted.` };
	try {
		const { status, body } = await callMonitor(config, "GET", "/domains", undefined, fetchFn);
		if (status === 200) {
			const count = Array.isArray(body.domains) ? body.domains.length : 0;
			return { name, status: "ok", detail: `${config.url.host} answers, with ${count === 1 ? "1 domain" : `${count} domains`}.` };
		}
		if (status === 401) return { name, status: "warning", detail: `${config.url.host} refused the admin token.`, fix: "Use the ADMIN_TOKEN line of the file the monitor was deployed with (monitor/.secrets.production)." };
		return { name, status: "warning", detail: `${config.url.host} answered ${status}: ${String(body.error ?? "no reason given").slice(0, 200)}` };
	} catch (err) {
		return { name, status: "warning", detail: `${config.url.host} could not be reached: ${err instanceof Error ? err.message : String(err)}` };
	}
}

async function modelCheck({ env, fetchFn, dataDir }: DoctorOptions): Promise<Check> {
	const name = "Model";
	const chosen = await stat(join(dataDir, "model-settings.json")).then(
		() => true,
		() => false,
	);
	// A model chosen in the interface replaces one set here.
	const saved = chosen ? " The interface uses the one chosen under Settings → Model instead." : "";
	if (!env.PORCHLIGHT_LLM_PROVIDER?.trim() && !env.PORCHLIGHT_LLM_URL?.trim()) {
		return chosen
			? { name, status: "ok", detail: "Chosen under Settings → Model in the interface. Not contacted." }
			: { name, status: "note", detail: "Off. Optional: choose one under Settings → Model to have findings explained." };
	}
	let config;
	try {
		config = assistantConfig(env);
	} catch (err) {
		return { name, status: "warning", detail: `${err instanceof Error ? err.message : String(err)}.${saved}` };
	}
	// A hosted provider is not contacted: asking would send the key, and costs nothing to skip.
	if (isHosted(config)) return { name, status: "ok", detail: `${config.model} at ${config.url.host} (hosted: what the pages show is sent there when you ask). Not contacted.${saved}` };
	if (!fetchFn || config.provider === "compatible") return { name, status: "ok", detail: `${config.model} at ${config.url.host}. Not contacted.${saved}` };
	try {
		const response = await fetchFn(new URL("/api/tags", config.url), { signal: AbortSignal.timeout(5_000) });
		const tags = (await response.json()) as { models?: { name?: string }[] };
		const names = (tags.models ?? []).map((model) => model.name);
		if (names.includes(config.model) || names.includes(`${config.model}:latest`)) return { name, status: "ok", detail: `${config.model} is ready at ${config.url.host}.${saved}` };
		return { name, status: "warning", detail: `Ollama at ${config.url.host} answers, but has no model named ${config.model}.${saved}`, fix: `ollama pull ${config.model}` };
	} catch (err) {
		return { name, status: "warning", detail: `Ollama at ${config.url.host} could not be reached: ${err instanceof Error ? err.message : String(err)}.${saved}`, fix: "ollama serve" };
	}
}

function githubCheck(env: Record<string, string | undefined>): Check {
	const name = "GitHub";
	const token = env.PORCHLIGHT_GITHUB_TOKEN?.trim();
	if (!token) return { name, status: "note", detail: "No token: public repositories can be fetched, private ones cannot. Optional." };
	const problem = tokenProblem(token);
	return problem ? { name, status: "warning", detail: problem } : { name, status: "ok", detail: "A token is set, so private repositories can be fetched." };
}

async function cloudflareCheck({ env, dataDir }: DoctorOptions): Promise<Check> {
	const name = "Cloudflare";
	const token = env.PORCHLIGHT_CLOUDFLARE_TOKEN?.trim();
	if (token) {
		const problem = tokenShapeProblem(token);
		return problem ? { name, status: "warning", detail: `PORCHLIGHT_CLOUDFLARE_TOKEN: ${problem}` } : { name, status: "ok", detail: "A token is set for the account audit. Not contacted." };
	}
	const saved = await stat(join(dataDir, "cloudflare-settings.json")).then(
		() => true,
		() => false,
	);
	return saved
		? { name, status: "ok", detail: "A token is saved under Settings → Cloudflare. Not contacted." }
		: { name, status: "note", detail: "No token. Optional: paste a read-only one under Settings → Cloudflare to audit your account." };
}

const WORDS: Record<CheckStatus, string> = { ok: "ok", note: "note", warning: "check", problem: "FIX" };

/**
 * One line a check, each led by a word, with what to do beneath it. `columns`: the terminal's width, to
 * which each detail is wrapped under its own column (R6V-3); unlimited when not given.
 */
export function renderDoctor(checks: Check[], columns = Number.POSITIVE_INFINITY): string {
	const width = Math.max(...checks.map((check) => check.name.length));
	const hang = " ".repeat(7 + width + 2);
	// A detail column too narrow to read is moved under the name instead.
	const under = columns - hang.length < 30;
	const fit = (first: string, rest: string, text: string) => (Number.isFinite(columns) ? wrapWords(text, columns, first, rest) : [first + text]);
	const lines = checks.flatMap((check) => {
		const head = `${WORDS[check.status].padEnd(5)}  ${check.name.padEnd(width)}  `;
		return [
			...(under ? [head.trimEnd(), ...fit("       ", "       ", check.detail)] : fit(head, hang, check.detail)),
			...(check.fix ? fit(under ? "       → " : `${hang}→ `, under ? "         " : `${hang}  `, check.fix) : []),
		];
	});
	const problems = checks.filter((check) => check.status === "problem").length;
	const warnings = checks.filter((check) => check.status === "warning").length;
	const summary =
		problems > 0
			? `${problems === 1 ? "1 thing stops" : `${problems} things stop`} Porchlight from working. Fix what is marked FIX.`
			: warnings > 0
				? `Porchlight works. ${warnings === 1 ? "1 thing is" : `${warnings} things are`} worth a look.`
				: "Porchlight has what it needs.";
	return `${lines.join("\n")}\n\n${fit("", "", summary).join("\n")}\n`;
}

// `porchlight doctor --self` (R6F-1): a read-only check of what Porchlight promises on this computer,
// the parts that depend on the machine rather than the code. It reads modes and names, never a file's
// contents beyond the names of the settings it holds, and prints no key.

/** Folders whose own files Porchlight writes one by one, each 0600. */
const OWN_FOLDERS = ["history", "investigations", "discussions", "host-checks", "cloudflare-audits"];
/** Folders of others' files (git clones, databases): the folder's own mode keeps them private. */
const SEALED_FOLDERS = ["github", "osv-db", "history-scans", "projects"];

export async function runSelfCheck(options: DoctorOptions): Promise<Check[]> {
	return [await modesCheck(options.dataDir), await listeningCheck(options), await keysCheck(options), await cloudflareWriteCheck(options.dataDir), ...(await scannerPaths(options)), await leftoversCheck(options.dataDir)];
}

async function modesCheck(dir: string): Promise<Check> {
	const name = "File modes";
	const top = await stat(dir).catch(() => null);
	if (!top) return { name, status: "note", detail: `${dir} does not exist yet.` };
	const loose: string[] = [];
	const looseFolders: string[] = [];
	if ((top.mode & 0o077) !== 0) looseFolders.push(dir);
	const look = async (folder: string, files: boolean) => {
		for (const entry of await readdir(folder, { withFileTypes: true }).catch(() => [])) {
			const path = join(folder, entry.name);
			const info = await lstat(path).catch(() => null);
			if (!info || info.isSymbolicLink()) continue;
			if (info.isDirectory()) {
				if ((info.mode & 0o077) !== 0) looseFolders.push(path);
				if (folder === dir && OWN_FOLDERS.includes(entry.name)) await look(path, true);
			} else if (files && info.isFile() && (info.mode & 0o077) !== 0) loose.push(path);
		}
	};
	await look(dir, true);
	if (loose.length === 0 && looseFolders.length === 0) return { name, status: "ok", detail: `${dir} and every folder in it are 0700, and Porchlight's own files are 0600.` };
	const listed = [...looseFolders, ...loose];
	return {
		name,
		status: "warning",
		detail: `${listed.length === 1 ? "1 entry" : `${listed.length} entries`} can be read by other users of this computer: ${listed.slice(0, 5).join(", ")}${listed.length > 5 ? ", …" : ""}. Reports name the files where secrets were found, and these folders hold keys.`,
		fix: [looseFolders.length > 0 ? `chmod 700 ${looseFolders.slice(0, 5).map(quote).join(" ")}` : "", loose.length > 0 ? `chmod 600 ${loose.slice(0, 5).map(quote).join(" ")}` : ""].filter(Boolean).join("; "),
	};
}

function quote(path: string): string {
	return /^[\w./~-]+$/.test(path) ? path : `'${path.replace(/'/g, "'\\''")}'`;
}

async function listeningCheck({ run, env, dataDir }: DoctorOptions): Promise<Check> {
	const name = "Listening";
	const access = await readFile(join(dataDir, "access.json"), "utf8").then((text) => (JSON.parse(text) as { enabled?: unknown }).enabled === true, () => false);
	const tailnet = access ? " Access from other devices is on, so a second listener answers on this computer's tailnet address." : "";
	let output: string;
	try {
		output = (await run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"], { timeoutMs: 10_000 })).stdout;
	} catch {
		return { name, status: "note", detail: `Could not check which addresses Porchlight listens on (lsof did not run).${tailnet}` };
	}
	const lines = output.split("\n").filter((line) => /^node\b/i.test(line) && /:47(4[7-9]|5\d)\b/.test(line));
	const addresses = [...new Set(lines.map((line) => line.trim().split(/\s+/).at(-2) ?? "").filter(Boolean))];
	if (addresses.length === 0) return { name, status: "ok", detail: `No Porchlight page is listening now.${tailnet}` };
	const open = addresses.filter((address) => /^(\*|0\.0\.0\.0|\[::\]):/.test(address));
	if (open.length > 0 && !env.PORCHLIGHT_UI_KEY) return { name, status: "warning", detail: `Listening on every address: ${open.join(", ")}.${tailnet}`, fix: "Start the page on 127.0.0.1 (the default), or use Settings → Access from other devices" };
	return { name, status: "ok", detail: `Listening on ${addresses.join(", ")}.${tailnet}` };
}

/** Names of the settings in app.env that hold a token or key, never their values. */
async function appEnvKeys(dataDir: string): Promise<string[]> {
	const text = await readFile(join(dataDir, "app.env"), "utf8").catch(() => "");
	return text
		.split("\n")
		.map((line) => /^\s*(?:export\s+)?(PORCHLIGHT_[A-Z_]*(?:TOKEN|KEY))\s*=\s*\S/.exec(line)?.[1])
		.filter((key): key is string => Boolean(key));
}

async function keysCheck({ env, dataDir }: DoctorOptions): Promise<Check> {
	const name = "Saved keys";
	const where: string[] = [];
	let unused: string[] = [];
	const model = await readFile(join(dataDir, "model-settings.json"), "utf8").then((text) => JSON.parse(text) as { choice?: unknown; keys?: Record<string, unknown> }, () => null);
	if (model?.keys) {
		const providers = Object.keys(model.keys).filter((key) => key !== "servers");
		const servers = Object.keys((model.keys.servers as Record<string, unknown> | undefined) ?? {});
		if (providers.length > 0) where.push(`model keys for ${providers.join(", ")} (model-settings.json)`);
		if (servers.length > 0) where.push(`${servers.length === 1 ? "a key" : `${servers.length} keys`} for your own model servers (model-settings.json)`);
		unused = providers.filter((provider) => provider !== model.choice);
	}
	for (const [file, what] of [
		["monitor-settings.json", "the monitor's admin token"],
		["cloudflare-settings.json", "a Cloudflare token"],
		["access.json", "the access key for other devices"],
		["investigate-domains.json", "ownership tokens for investigated domains"],
	] as const) {
		if (await stat(join(dataDir, file)).then(() => true, () => false)) where.push(`${what} (${file})`);
	}
	const fromAppEnv = await appEnvKeys(dataDir);
	if (fromAppEnv.length > 0) where.push(`${fromAppEnv.join(", ")} (app.env)`);
	const fromEnv = Object.keys(env).filter((key) => /^PORCHLIGHT_[A-Z_]*(TOKEN|KEY)$/.test(key) && env[key]?.trim());
	if (fromEnv.length > 0) where.push(`${fromEnv.join(", ")} (this shell's environment)`);
	if (where.length === 0) return { name, status: "ok", detail: "No key or token is saved." };
	const detail = `Saved in ${dataDir}: ${where.join("; ")}.`;
	if (unused.length > 0) return { name, status: "warning", detail: `${detail} Keys for ${unused.join(", ")} are kept although another model is chosen.`, fix: "Remove a key you no longer use under Settings → Model, and revoke it with its provider" };
	return { name, status: "ok", detail };
}

async function cloudflareWriteCheck(dataDir: string): Promise<Check> {
	const name = "Cloudflare token";
	if (!(await stat(join(dataDir, "cloudflare-settings.json")).then(() => true, () => false))) return { name, status: "note", detail: "None saved." };
	const changes = await readFile(join(dataDir, "cloudflare-changes.json"), "utf8").then((text) => JSON.parse(text) as { ok?: unknown }[], () => []);
	const made = Array.isArray(changes) ? changes.filter((change) => change?.ok === true).length : 0;
	if (made > 0) return { name, status: "note", detail: `The saved token has made ${made === 1 ? "1 change" : `${made} changes`}, so it can write. An audit needs read permissions only.`, fix: "Once your changes are made, replace it under Settings → Cloudflare with a token that only reads" };
	return { name, status: "ok", detail: "A token is saved and has made no change. Settings → Cloudflare names the permissions it holds." };
}

/** Which gitleaks and osv-scanner run: the first in PATH's absolute folders, as Porchlight finds them. */
async function scannerPaths({ run, env }: DoctorOptions): Promise<Check[]> {
	const folders = safePath(env.PATH).split(delimiter).filter(Boolean);
	const checks: Check[] = [];
	for (const [program, args] of [
		["gitleaks", ["version"]],
		["osv-scanner", ["--version"]],
	] as const) {
		let found: string | null = null;
		for (const folder of folders) {
			const path = join(folder, program);
			if (await access(path, constants.X_OK).then(() => true, () => false)) {
				found = path;
				break;
			}
		}
		if (!found) {
			checks.push({ name: program, status: "warning", detail: "Not found in PATH.", fix: `brew install ${program}` });
			continue;
		}
		const version = await run(found, [...args], { timeoutMs: 10_000 })
			.then(({ stdout, stderr }) => `${stdout}\n${stderr}`.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? null)
			.catch(() => null);
		checks.push({ name: program, status: version ? "ok" : "warning", detail: version ? `${found}, version ${version}.` : `${found} did not say its version.` });
	}
	return checks;
}

async function leftoversCheck(dataDir: string): Promise<Check> {
	const name = "Leftovers";
	const tmpFiles: string[] = [];
	for (const folder of [dataDir, ...OWN_FOLDERS.map((sub) => join(dataDir, sub))]) {
		for (const entry of await readdir(folder).catch(() => [] as string[])) if (/\.tmp$/.test(entry)) tmpFiles.push(join(folder, entry));
	}
	const now = Date.now();
	const stale: string[] = [];
	for (const entry of await readdir(tmpdir()).catch(() => [] as string[])) {
		if (!/^porchlight-[a-z]+-[A-Za-z0-9]{6}$/.test(entry)) continue;
		const info = await stat(join(tmpdir(), entry)).catch(() => null);
		if (info && now - info.mtimeMs > STALE_AFTER_MS) stale.push(join(tmpdir(), entry));
	}
	if (tmpFiles.length === 0 && stale.length === 0) return { name, status: "ok", detail: "No temporary files or folders were left behind." };
	return {
		name,
		status: "warning",
		detail: `${tmpFiles.length > 0 ? `${tmpFiles.length === 1 ? "1 temporary file" : `${tmpFiles.length} temporary files`} in ${dataDir}` : ""}${tmpFiles.length > 0 && stale.length > 0 ? " and " : ""}${stale.length > 0 ? `${stale.length === 1 ? "1 temporary folder" : `${stale.length} temporary folders`} older than six hours in ${tmpdir()}` : ""}, left by a crash. They may hold copies of repositories' files.`,
		fix: stale.length > 0 ? "The next porchlight ui or repos scan removes the folders; remove the files with rm" : `rm ${tmpFiles.slice(0, 5).map(quote).join(" ")}`,
	};
}
