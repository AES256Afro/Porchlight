import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { assistantConfig, isHosted } from "./assist/ollama.ts";
import { tokenShapeProblem } from "./cloudflare/client.ts";
import { tokenProblem } from "./github/github.ts";
import { callMonitor, monitorConfig } from "./monitor/client.ts";
import { ToolMissingError, type Runner } from "./repos/exec.ts";

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
		return { name, status: "ok", detail: `${dir}, readable only by you.` };
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return { name, status: "note", detail: `${dir} does not exist yet. It is made the first time the interface saves something.` };
		return { name, status: "problem", detail: `${dir} cannot be read: ${err instanceof Error ? err.message : String(err)}` };
	}
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

async function monitorCheck({ env, fetchFn }: DoctorOptions): Promise<Check> {
	const name = "Monitor";
	if (!env.PORCHLIGHT_MONITOR_URL && !env.PORCHLIGHT_ADMIN_TOKEN) {
		return { name, status: "note", detail: "Not set here. The Domains page works once the monitor is connected under Settings → Monitor, or with PORCHLIGHT_MONITOR_URL and PORCHLIGHT_ADMIN_TOKEN." };
	}
	let config;
	try {
		config = monitorConfig(env);
	} catch (err) {
		return { name, status: "warning", detail: err instanceof Error ? err.message : String(err) };
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

/** One line a check, each led by a word, with what to do beneath it. */
export function renderDoctor(checks: Check[]): string {
	const width = Math.max(...checks.map((check) => check.name.length));
	const lines = checks.flatMap((check) => [
		`${WORDS[check.status].padEnd(5)}  ${check.name.padEnd(width)}  ${check.detail}`,
		...(check.fix ? [`${" ".repeat(7 + width + 2)}→ ${check.fix}`] : []),
	]);
	const problems = checks.filter((check) => check.status === "problem").length;
	const warnings = checks.filter((check) => check.status === "warning").length;
	const summary =
		problems > 0
			? `${problems === 1 ? "1 thing stops" : `${problems} things stop`} Porchlight from working. Fix what is marked FIX.`
			: warnings > 0
				? `Porchlight works. ${warnings === 1 ? "1 thing is" : `${warnings} things are`} worth a look.`
				: "Porchlight has what it needs.";
	return `${lines.join("\n")}\n\n${summary}\n`;
}
