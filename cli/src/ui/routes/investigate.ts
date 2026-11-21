// "Investigate with a model" (invariant 20): /api/investigate and beneath it. One run at a time, on a
// domain whose ownership record holds its token; a model proposes, plain code decides.
import { join } from "node:path";
import { sizedFor } from "../../assist/context.ts";
import { chat, isHosted, type AssistantConfig } from "../../assist/ollama.ts";
import { DEFAULT_GOAL, DEFAULT_MAX_TURNS, DEFAULT_MIN_GAP_MS, investigate, MAX_GOAL, MAX_TURNS_LIMIT, newRun, type ApprovalAnswer, type Run } from "../../investigate/engine.ts";
import { exportInvestigation, INVESTIGATION_FORMATS, type InvestigationFormat } from "../../investigate/export.ts";
import { challengeName, challengeValue, changeDomains, checkOwnership, newToken, readDomains, tokenFromChallenge } from "../../investigate/ownership.ts";
import { abortableSleep, parseDomain, RateLimiter } from "../../investigate/scope.ts";
import { isRunId, RunStore, settled } from "../../investigate/store.ts";
import { liveNet, TOOLS as INVESTIGATION_TOOLS, type Net } from "../../investigate/tools.ts";
import { callMonitor } from "../../monitor/client.ts";
import { FILE_TITLES } from "../../projects/projects.ts";
import { hostedName, type ServerContext } from "../context.ts";
import { onComputerPage, type Call, type Gate } from "../gate.ts";
import { bodyObject, HttpError, sendDownload, sendJson } from "../http.ts";
import { notFoundUnder, type Route } from "../router.ts";

/** One investigation turn: a short JSON answer, though a model on a processor still takes a while. */
const INVESTIGATE_TIMEOUT_MS = 300_000;
const INVESTIGATE_TOKENS = 1_500;

/** How long to wait before asking DNS a second time for an ownership record that was not found mid-run. */
const OWNERSHIP_RECHECK_MS = 2_000;

/** How a run ended, in the project log's words. */
const RUN_ENDINGS: Partial<Record<Run["status"], string>> = { done: "finished", stopped: "stopped", failed: "failed" };

interface InvestigationJob {
	run: Run;
	stop: AbortController;
	/** The action waiting for the owner, and how to answer it. */
	approval: { stepId: string; resolve: (answer: ApprovalAnswer) => void } | null;
}

export function createInvestigate(ctx: ServerContext) {
	const { options, dataDir, projects, log, note, saveExport, assistantSummary, confirmModel, modelWords } = ctx;
	// "Investigate with a model": one run at a time, on a domain whose ownership record holds its token.
	const investigateDir = join(dataDir, "investigations");
	const investigateDomainsPath = join(dataDir, "investigate-domains.json");
	const runStore = new RunStore(investigateDir);
	const investigateNet: Net = options.investigateNet ?? (options.fetchFn ? { ...liveNet, fetch: options.fetchFn } : liveNet);
	let investigation: InvestigationJob | null = null;
	/** An investigation is being started: ownership is being checked. See S24. */
	let investigationStarting = false;
	/** Saves run by run, in order, so a slow write never lands after a newer one. */
	let runSaves: Promise<void> = Promise.resolve();

	/** What a run sends to the model, in words, for the page to show before anything is sent. */
	function investigationDisclosure(config: AssistantConfig): string {
		const where = isHosted(config) ? `${hostedName(config)} (${config.url.host}), outside your machines` : `the model at ${config.url.host}`;
		// Short sentences, sends then never (RD-12): the page shows this above the start button.
		return `Each turn sends ${where}: the domain, your goal, the tool list and the findings so far. It also sends the latest tool results: your site's DNS records and HTTP responses, with headers and up to 1 500 characters of each body. Set-Cookie values are left out. It never sends the ownership token, your scans, keys or anything from this computer.`;
	}

	async function investigateDomains() {
		const file = await readDomains(investigateDomainsPath);
		return Object.entries(file.domains)
			.sort(([a], [b]) => a.localeCompare(b, "en"))
			.map(([name, entry]) => ({
				name,
				source: entry.source,
				...(entry.verifiedAt ? { verifiedAt: entry.verifiedAt } : {}),
				challenge: { type: "TXT", name: challengeName(name), value: challengeValue(entry.token) },
			}));
	}

	/** A domain from the request that the owner has added, with its token. */
	async function addedDomain(fields: Record<string, unknown>): Promise<{ name: string; token: string }> {
		const name = parseDomain(fields.domain);
		if (!name) throw new HttpError(400, "Type a domain such as example.com");
		const entry = (await readDomains(investigateDomainsPath)).domains[name];
		if (!entry) throw new HttpError(404, `Add ${name} first, and publish its TXT record`);
		return { name, token: entry.token };
	}

	/** True or false from DNS; a lookup that failed is an error, never "verified". */
	async function proveOwnership(name: string, token: string): Promise<boolean> {
		try {
			return await checkOwnership(name, token, options.fetchFn ?? fetch);
		} catch (err) {
			throw new HttpError(502, `Could not ask DNS for the TXT record: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async function currentRun(id: string): Promise<Run | null> {
		if (investigation?.run.id === id) return investigation.run;
		const stored = await runStore.read(id);
		return stored ? settled(stored) : null;
	}

	/** Stopping is always allowed; anything that adds a target or sends a request is for this computer's page only. */
	function changedHere(gate: Gate): void {
		if (!onComputerPage(gate)) throw new HttpError(403, "Investigations are run from the page on the computer that runs Porchlight");
	}

	function stopRoute({ res }: Call): void {
		investigation?.stop.abort();
		return sendJson(res, 200, { stopped: investigation !== null });
	}

	async function overview({ res, gate }: Call): Promise<void> {
		const here = onComputerPage(gate);
		const config = ctx.modelFor("investigate").config;
		return sendJson(res, 200, {
			canChange: here,
			domains: await investigateDomains(),
			runs: await runStore.list(),
			active: investigation ? investigation.run : null,
			assistant: assistantSummary("investigate"),
			...(config ? { disclosure: investigationDisclosure(config) } : {}),
			monitor: ctx.monitor() !== null,
			tools: INVESTIGATION_TOOLS,
			defaults: { goal: DEFAULT_GOAL, maxTurns: DEFAULT_MAX_TURNS, maxTurnsLimit: MAX_TURNS_LIMIT, minGapMs: options.investigateMinGapMs ?? DEFAULT_MIN_GAP_MS, maxGoal: MAX_GOAL },
		});
	}

	async function runRoute({ res, url }: Call): Promise<void> {
		const id = url.searchParams.get("id");
		const run = isRunId(id) ? await currentRun(id) : null;
		if (!run) throw new HttpError(404, "There is no such investigation");
		return sendJson(res, 200, { run });
	}

	async function exportRoute({ req, res, url }: Call): Promise<void> {
		const id = url.searchParams.get("id");
		const run = isRunId(id) ? await currentRun(id) : null;
		if (!run) throw new HttpError(404, "There is no such investigation");
		const format = url.searchParams.get("format") ?? "md";
		if (!(INVESTIGATION_FORMATS as readonly string[]).includes(format)) throw new HttpError(400, `Choose a format: ${INVESTIGATION_FORMATS.join(" or ")}`);
		const file = exportInvestigation(run, format as InvestigationFormat);
		if (req.method === "POST") return saveExport(res, file, "investigation");
		log(`Exported ${FILE_TITLES.investigation} (${format}) as a download`);
		return sendDownload(res, file);
	}

	async function addDomain({ res, body, gate }: Call): Promise<void> {
		changedHere(gate);
		const fields = bodyObject(body);
		const name = parseDomain(fields.domain);
		if (!name) throw new HttpError(400, "Type a domain such as example.com");
		if (!(await readDomains(investigateDomainsPath)).domains[name]) {
			// When the monitor already watches this domain, its record serves here too.
			let token: string | null = null;
			const monitor = ctx.monitor();
			if (monitor) {
				const answer = await callMonitor(monitor, "GET", `/domains/${encodeURIComponent(name)}`, undefined, options.fetchFn).catch(() => null);
				if (answer?.status === 200) token = tokenFromChallenge(answer.body?.domain?.challenge?.value);
			}
			// One change at a time, so two domains added together are both kept (B21).
			await changeDomains(investigateDomainsPath, (file) => {
				if (file.domains[name]) return false;
				file.domains[name] = { token: token ?? newToken(), addedAt: new Date().toISOString(), source: token ? "monitor" : "local" };
				return true;
			});
		}
		return sendJson(res, 200, { domains: await investigateDomains() });
	}

	async function removeDomain({ res, body, gate }: Call): Promise<void> {
		changedHere(gate);
		const fields = bodyObject(body);
		const name = parseDomain(fields.domain);
		if (!name) throw new HttpError(400, "Type a domain such as example.com");
		if (investigation?.run.domain === name) throw new HttpError(409, "Stop the investigation of this domain first");
		await changeDomains(investigateDomainsPath, (file) => delete file.domains[name]);
		return sendJson(res, 200, { domains: await investigateDomains() });
	}

	async function verifyDomain({ res, body, gate }: Call): Promise<void> {
		changedHere(gate);
		const fields = bodyObject(body);
		const { name, token } = await addedDomain(fields);
		const verified = await proveOwnership(name, token);
		if (verified) {
			await changeDomains(investigateDomainsPath, (file) => {
				const entry = file.domains[name];
				if (entry) entry.verifiedAt = new Date().toISOString();
				return entry !== undefined;
			});
		}
		return sendJson(res, 200, { verified, domains: await investigateDomains() });
	}

	function approve({ res, body, gate }: Call): void {
		changedHere(gate);
		const fields = bodyObject(body);
		const active = investigation;
		if (!active || active.run.id !== fields.run || !active.approval || active.approval.stepId !== fields.step) {
			throw new HttpError(409, "That action is no longer waiting for approval");
		}
		if (typeof fields.approve !== "boolean") throw new HttpError(400, "Say whether to approve");
		// "rest": this action and every later one of this run. It can only go with a yes.
		if (fields.rest !== undefined && typeof fields.rest !== "boolean") throw new HttpError(400, "Say whether to approve the rest of the run");
		const rest = fields.rest === true;
		if (rest && !fields.approve) throw new HttpError(400, "The rest of a run can be approved, not denied. Use Stop to end it");
		const { resolve: answer } = active.approval;
		active.approval = null;
		answer(rest ? "rest" : fields.approve);
		if (rest) log(`Investigation of ${active.run.domain}: you approved the rest of its requests at turn ${active.run.turns}`);
		return sendJson(res, 200, { approved: fields.approve, rest });
	}

	async function findingRoute({ res, body, gate }: Call): Promise<void> {
		changedHere(gate);
		const fields = bodyObject(body);
		if (!isRunId(fields.run)) throw new HttpError(400, "Name the investigation");
		const status = fields.status;
		if (status !== "open" && status !== "accepted" && status !== "dismissed") throw new HttpError(400, "Choose accepted, dismissed or open");
		const run = await currentRun(fields.run);
		const finding = run?.findings.find((item) => item.id === fields.finding);
		if (!run || !finding) throw new HttpError(404, "That finding is not in this investigation");
		finding.status = status;
		if (investigation?.run !== run) await runStore.save(run);
		else await saveActive(run);
		return sendJson(res, 200, { finding });
	}

	async function start({ res, body, gate }: Call): Promise<void> {
		changedHere(gate);
		const fields = bodyObject(body);

		const config = ctx.modelFor("investigate").config;
		if (!config) throw new HttpError(503, ctx.modelFor("investigate").error ?? "No model is connected. Choose one in Settings → Model");
		if (investigation) throw new HttpError(409, `An investigation of ${investigation.run.domain} is already running. Stop it first`);
		// A run is recorded only once ownership is proven, which takes a DNS lookup. Until then this flag
		// refuses a second start, so no run is ever started that Stop cannot reach (S24).
		if (investigationStarting) throw new HttpError(409, "An investigation is already starting");
		investigationStarting = true;
		const { name, token, goal, maxTurns, approveAll, hosted } = await (async () => {
			const { name, token } = await addedDomain(fields);
			const goal = fields.goal === undefined || fields.goal === "" ? DEFAULT_GOAL : fields.goal;
			if (typeof goal !== "string" || goal.trim() === "" || goal.length > MAX_GOAL) throw new HttpError(400, `Write a goal of 1 to ${MAX_GOAL} characters`);
			const maxTurns = fields.maxTurns ?? DEFAULT_MAX_TURNS;
			if (typeof maxTurns !== "number" || !Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > MAX_TURNS_LIMIT) throw new HttpError(400, `Choose 1 to ${MAX_TURNS_LIMIT} turns`);
			// Approving every request of the run at its start is the owner's choice, said plainly or not at all.
			if (fields.approveAll !== undefined && typeof fields.approveAll !== "boolean") throw new HttpError(400, "Say whether to approve the run's requests now");
			const approveAll = fields.approveAll === true;
			const hosted = isHosted(config);
			// The page shows what will be sent; a hosted model is used only once the owner has said yes to it.
			if (hosted && fields.sendsToHosted !== true) throw new HttpError(409, investigationDisclosure(config));
			confirmModel(fields, config);
			if (!(await proveOwnership(name, token))) {
				throw new HttpError(409, `The TXT record ${challengeName(name)} does not hold ${challengeValue(token)} yet. Publish it, wait a few minutes, and check again`);
			}
			return { name, token, goal, maxTurns, approveAll, hosted };
		})().finally(() => {
			investigationStarting = false;
		});

		const run = newRun({ domain: name, goal: goal.trim(), model: config.model, modelHost: config.url.host, hosted, maxTurns, minGapMs: options.investigateMinGapMs ?? DEFAULT_MIN_GAP_MS, approveAll });
		const stop = new AbortController();
		const stepsNoted = new Set<string>();
		const waitingNoted = new Set<string>();
		const active: InvestigationJob = { run, stop, approval: null };
		investigation = active;
		await saveActive(run);
		// The log goes to the project in use now, also for the line written when the run ends.
		const logTo = await projects.current();
		log(`Investigation of ${name} started: ${modelWords(config)}, at most ${maxTurns} turns, ${approveAll ? "every request approved at the start" : "each request waits for your approval"}`, logTo);
		// Not awaited: the run outlives this request and the page polls for progress.
		void investigate(run, {
			ask: async (system, user, signal) => {
				const local = !hosted;
				note(`Investigation of ${name}, turn ${run.turns}: asking ${modelWords(config)} for the next step`);
				// The owner's own model answers one request at a time; Explain and Ask wait their turn.
				while (local && ctx.modelBusy() && !signal.aborted) await abortableSleep(500, signal);
				if (local) ctx.setModelBusy(true);
				try {
					// A local model that reads less than the usual is asked for a shorter answer (R6F-8).
					const sized = sizedFor(config, { cap: 0, maxTokens: INVESTIGATE_TOKENS });
					return await chat(config, [{ role: "system", content: system }, { role: "user", content: user }], { fetchFn: options.fetchFn, signal, timeoutMs: INVESTIGATE_TIMEOUT_MS, maxTokens: sized.maxTokens ?? INVESTIGATE_TOKENS, ...(sized.contextLength !== null ? { contextLength: sized.contextLength } : {}), json: true });
				} finally {
					if (local) ctx.setModelBusy(false);
				}
			},
			net: investigateNet,
			verify: async (signal) => {
				// Read again each time: a domain removed from the list is no longer proven.
				const entry = (await readDomains(investigateDomainsPath)).domains[name];
				if (entry === undefined || entry.token !== token) return false;
				if (await checkOwnership(name, token, options.fetchFn ?? fetch, signal)) return true;
				// A resolver can miss a record that is there, just after it was published. Asked once more
				// before the run is stopped; the answer still has to be yes for anything to be sent.
				await abortableSleep(options.investigateMinGapMs === 0 ? 0 : OWNERSHIP_RECHECK_MS, signal);
				return !signal.aborted && (await checkOwnership(name, token, options.fetchFn ?? fetch, signal));
			},
			approve: (request, signal) =>
				new Promise<ApprovalAnswer>((resolveApproval) => {
					const done = (answer: ApprovalAnswer) => {
						signal.removeEventListener("abort", abort);
						if (active.approval?.stepId === request.stepId) active.approval = null;
						resolveApproval(answer);
					};
					const abort = () => done(false);
					if (signal.aborted) return done(false);
					signal.addEventListener("abort", abort, { once: true });
					active.approval = { stepId: request.stepId, resolve: done };
				}),
			limiter: new RateLimiter(run.minGapMs),
			hidden: [token],
			onChange: (changed) => {
				for (const step of changed.steps) {
					if (step.outcome === "waiting" && !waitingNoted.has(step.id)) {
						waitingNoted.add(step.id);
						note(`Investigation of ${name}, turn ${step.turn}: ${step.description ?? "an action"} is waiting for your approval`, "warning");
					}
					if (step.outcome === "waiting" || stepsNoted.has(step.id)) continue;
					// A step that ran under the run's approval is saved once more when it finishes; noted then.
					if (step.outcome === "refused" && step.reason === undefined) continue;
					stepsNoted.add(step.id);
					// The model's words never reach the Activity view: a tool it named that is not one is said in fixed words (S37).
					const what = step.description ?? (step.tool ? (INVESTIGATION_TOOLS.some((tool) => tool.name === step.tool) ? `${step.tool} (refused)` : "an action that is not one of the tools") : "no action");
					note(`Investigation of ${name}, turn ${step.turn}: ${what}: ${step.outcome}`, step.outcome === "ran" ? "good" : step.outcome === "no action" ? "info" : "warning");
				}
				return saveActive(changed);
			},
		}, stop.signal)
			.catch(() => {})
			.finally(async () => {
				await runSaves;
				if (investigation === active) investigation = null;
				const actions = run.evidence.length;
				const found = run.findings.length;
				log(`Investigation of ${name} ${RUN_ENDINGS[run.status] ?? "ended"}: ${actions} ${actions === 1 ? "action" : "actions"} run, ${found} ${found === 1 ? "finding" : "findings"} from the model`, logTo);
				await runStore.prune().catch(() => {});
			});
		return sendJson(res, 202, { run });
	}

	function saveActive(run: Run): Promise<void> {
		runSaves = runSaves.then(() => runStore.save(run)).catch((err) => console.error(`porchlight ui: could not save the investigation: ${err instanceof Error ? err.message : String(err)}`));
		return runSaves;
	}

	const routes: Route[] = [
		["POST /api/investigate/stop", stopRoute],
		["GET /api/investigate", overview],
		["GET /api/investigate/run", runRoute],
		["GET /api/investigate/export", exportRoute],
		["POST /api/investigate/export", exportRoute],
		["POST /api/investigate/domains", addDomain],
		["POST /api/investigate/domains/remove", removeDomain],
		["POST /api/investigate/verify", verifyDomain],
		["POST /api/investigate/approve", approve],
		["POST /api/investigate/finding", findingRoute],
		["POST /api/investigate/start", start],
		notFoundUnder("/api/investigate", "any", ({ body, gate }) => {
			changedHere(gate);
			bodyObject(body);
		}),
	];

	return { routes, investigation: () => investigation, domainsPath: investigateDomainsPath };
}
