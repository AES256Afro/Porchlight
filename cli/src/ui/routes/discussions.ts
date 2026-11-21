// Discussions (invariant 22): every answer a model gives on a page, kept so it can be read again and
// followed up. The list, one in full, a file of one, deleting one, saving it to a project, and a
// follow-up question, which goes only to the model the discussion began with.
import { join } from "node:path";
import { askPrompt, cloudflarePrompt, DATA_CAP, domainPrompt, findingPrompt, HOSTED_DATA_CAP, locateFinding, roadmapPrompt, sendPrompt, type Prompt } from "../../assist/prompts.ts";
import { AssistantError, chat, isHosted, type AssistantConfig } from "../../assist/ollama.ts";
import type { SendTarget } from "../../assist/settings.ts";
import { sizedFor } from "../../assist/context.ts";
import { readAudit } from "../../cloudflare/store.ts";
import {
	DISCUSSION_FORMATS,
	DiscussionStore,
	exportDiscussion,
	fingerprintOf,
	followUpPrompt,
	HOSTED_HISTORY_CAP,
	KIND_WORDS,
	LOCAL_HISTORY_CAP,
	MAX_TURNS,
	newDiscussion,
	viewOf,
	type Discussion,
	type DiscussionAbout,
	type DiscussionFormat,
	type DiscussionKind,
	type DiscussionTurn,
} from "../../discussions/discussions.ts";
import { OWN_FOLDER, rewriteFile, saveFile, type Project, type Saved } from "../../projects/projects.ts";
import { reportStamp } from "../../repos/report.ts";
import type { ScanReport } from "../../repos/types.ts";
import { parseFilter } from "../../roadmap/export.ts";
import type { MonitorReport } from "../../roadmap/domains.ts";
import { MAX_QUESTION } from "../../../ui/generated.js";
import type { ServerContext } from "../context.ts";
import type { Call } from "../gate.ts";
import { bodyObject, HttpError, sendDownload, sendJson } from "../http.ts";
import { readReport } from "../report-cache.ts";
import { notFoundUnder, type Route } from "../router.ts";
import { SEND_TIMEOUT_MS, SEND_TOKENS } from "./assist.ts";

const NEWER_SCAN = "A newer scan has replaced the one this discussion is about. Ask again from the page to start a new discussion about it.";
const NEWER_AUDIT = "A newer Cloudflare audit has replaced the one this discussion is about. Ask again from the Cloudflare page to start a new discussion about it.";

/**
 * Whether a discussion is about this report as it is now: by its content stamp, which scanning one
 * repository again changes (B38). A discussion kept before there were stamps has its scan time alone,
 * which is compared as before, so it does not all turn stale at once.
 */
export function sameScan(report: ScanReport, about: DiscussionAbout): boolean {
	return about.stamp !== undefined ? about.stamp === reportStamp(report) : about.scannedAt === report.scannedAt;
}

/** What a discussion needs from the areas it reads: a domain's latest scan, and the Cloudflare audit. */
export interface DiscussionSources {
	latestDomainReport(domain: string): Promise<MonitorReport & Record<string, unknown>>;
	auditPath: string;
}

export function createDiscussions(ctx: ServerContext, sources: DiscussionSources) {
	const { options, dataDir, projects, log, modelWords } = ctx;
	const discussionStore = new DiscussionStore(join(dataDir, "discussions"));
	/** Discussions waiting for a follow-up answer: one question at a time each. */
	const answering = new Set<string>();

	/** Writes a discussion's transcript into a project as a new file, and records where. */
	async function newTranscript(discussion: Discussion, project: Project): Promise<Saved> {
		const saved = await saveFile(project, "Discussions", `discussion-${discussion.kind}`, "md", exportDiscussion(discussion, "md").body);
		discussion.saved = { project: project.id, name: saved.name };
		await discussionStore.save(discussion);
		return saved;
	}

	/** Writes a kept transcript again after a new answer, in the project it is kept in, if that is still listed. */
	async function updateTranscript(discussion: Discussion): Promise<Saved | null> {
		if (!discussion.saved) return null;
		const project = await projects.get(discussion.saved.project);
		if (!project) return null;
		return rewriteFile(project, "Discussions", discussion.saved.name, exportDiscussion(discussion, "md").body);
	}

	/** The transcript is a copy: one that cannot be written is said in the server's output, never at the cost of the answer. */
	function transcriptFailed(err: unknown): null {
		console.error(`porchlight ui: could not save the discussion to the project: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}

	/**
	 * Keeps a model's first answer as a discussion. Not keeping it never costs the owner the answer:
	 * the page still shows it, only without a follow-up box.
	 */
	async function recordDiscussion(
		kind: DiscussionKind,
		about: DiscussionAbout,
		config: AssistantConfig,
		targetId: string | null,
		cut: string | null,
		first: DiscussionTurn,
	): Promise<{ id: string; title: string } | undefined> {
		try {
			const target = targetId ?? ctx.targets().find((candidate) => fingerprintOf(candidate.config) === fingerprintOf(config))?.id ?? "";
			const discussion = newDiscussion({ kind, about, config, hosted: isHosted(config), target, cut, first });
			await discussionStore.save(discussion);
			await discussionStore.prune().catch(() => {});
			// Begun while a project is in use: its transcript is kept there too, and written again after each answer.
			const project = await projects.current();
			if (project) await newTranscript(discussion, project).catch(transcriptFailed);
			log(`Asked ${modelWords(config)}: ${KIND_WORDS[kind]}, answered in ${first.seconds} s`, project);
			return { id: discussion.id, title: discussion.title };
		} catch (err) {
			console.error(`porchlight ui: could not keep the discussion: ${err instanceof Error ? err.message : String(err)}`);
			return undefined;
		}
	}

	/**
	 * Whether a discussion can take a follow-up now, and the model it goes to: the same one it began
	 * with, never one swapped in since, and the same scan, never a newer one the model has not read.
	 */
	async function followUpState(discussion: Discussion): Promise<{ ok: true; target: SendTarget } | { ok: false; reason: string }> {
		if (discussion.turns.length >= MAX_TURNS) {
			return { ok: false, reason: `This discussion has ${MAX_TURNS} answers, the most one can hold. Ask again from the page to start a new one.` };
		}
		const target = ctx.targets().find((candidate) => candidate.id === discussion.target);
		if (!target || fingerprintOf(target.config) !== discussion.fingerprint) {
			return {
				ok: false,
				reason: `${discussion.model} at ${discussion.host}, the model this discussion used, is no longer set up. Set it up again under Settings → Model, or ask again from the page to start a new discussion.`,
			};
		}
		if (discussion.kind === "cloudflare") {
			const audit = await readAudit(sources.auditPath).catch(() => null);
			if (!audit || audit.checkedAt !== discussion.about.checkedAt) return { ok: false, reason: NEWER_AUDIT };
		} else if (discussion.kind === "domain") {
			// A domain's discussion is offered a follow-up only while the monitor's latest scan of it is the
			// one it read (AI-B10); a monitor that cannot be asked is said, and offers none.
			const domain = discussion.about.domain ?? "";
			const latest = await sources.latestDomainReport(domain).then(
				(report) => String(report.takenAt),
				(err: unknown) => (err instanceof Error ? err : new Error(String(err))),
			);
			if (latest instanceof Error) return { ok: false, reason: `The monitor could not be asked whether ${domain} has been scanned since: ${latest.message}` };
			if (latest !== discussion.about.takenAt) return { ok: false, reason: `A newer scan of ${domain} has replaced the one this discussion is about. Ask again from the Domains page to start a new discussion about it.` };
		} else {
			const report = await readReport(options.reportPath).catch(() => null);
			if (!report || !sameScan(report, discussion.about)) return { ok: false, reason: NEWER_SCAN };
		}
		return { ok: true, target };
	}

	/** The first prompt of a discussion, built again from this server's own data, exactly as it was sent (invariant 13). */
	async function rebuildPrompt(discussion: Discussion, target: SendTarget, cap: number): Promise<Prompt> {
		const about = discussion.about;
		if (discussion.kind === "domain") {
			const report = await sources.latestDomainReport(about.domain ?? "");
			if (String(report.takenAt) !== about.takenAt) {
				throw new HttpError(409, `A newer scan of ${about.domain} has replaced the one this discussion is about. Ask again from the Domains page to start a new discussion about it.`);
			}
			return domainPrompt(report, cap);
		}
		if (discussion.kind === "cloudflare") {
			const audit = await readAudit(sources.auditPath);
			if (!audit || audit.checkedAt !== about.checkedAt) throw new HttpError(409, NEWER_AUDIT);
			return cloudflarePrompt(audit, cap);
		}
		const report = await ctx.storedReport();
		if (!sameScan(report, about)) throw new HttpError(409, NEWER_SCAN);
		if (discussion.kind === "finding") {
			const found = locateFinding(report, { repo: about.repo ?? "", ruleId: about.ruleId ?? "", location: about.location ?? "", detail: about.detail });
			if (!found) throw new HttpError(409, NEWER_SCAN);
			return findingPrompt(report, found.repo, found.finding);
		}
		if (discussion.kind === "roadmap") return roadmapPrompt(report, cap);
		if (discussion.kind === "ask") return askPrompt(report, discussion.turns[0]?.question ?? "", cap);
		const filter = parseFilter({ severity: about.filter?.severity, kind: about.filter?.kind, match: about.filter?.q, repo: about.filter?.repo, new: about.filter?.new }, await ctx.newKeysOf(report));
		return sendPrompt(report, {
			content: about.content === "findings" ? "findings" : "roadmap",
			purpose: about.purpose === "repair" ? "repair" : "analyse",
			filter,
			cap,
		});
	}

	async function list({ res }: Call): Promise<void> {
		return sendJson(res, 200, { discussions: await discussionStore.list(), maxTurns: MAX_TURNS });
	}

	async function one({ res, url }: Call): Promise<void> {
		const discussion = await discussionStore.read(url.searchParams.get("id"));
		if (!discussion) throw new HttpError(404, "There is no such discussion");
		const state = await followUpState(discussion);
		// `stale`: a newer scan or audit replaced what it was about, so the page offers to ask again about the latest (H-Q3).
		const stale = !state.ok && (state.reason === NEWER_SCAN || state.reason === NEWER_AUDIT || state.reason.startsWith("A newer scan of "));
		return sendJson(res, 200, { discussion: viewOf(discussion), followUp: state.ok ? { ok: true } : { ok: false, reason: state.reason, ...(stale ? { stale: true } : {}) } });
	}

	async function exportRoute({ res, url }: Call): Promise<void> {
		const discussion = await discussionStore.read(url.searchParams.get("id"));
		if (!discussion) throw new HttpError(404, "There is no such discussion");
		const format = url.searchParams.get("format") ?? "md";
		if (!(DISCUSSION_FORMATS as readonly string[]).includes(format)) throw new HttpError(400, `Choose a format: ${DISCUSSION_FORMATS.join(" or ")}`);
		return sendDownload(res, exportDiscussion(discussion, format as DiscussionFormat));
	}

	/** A copy of the transcript in the project in use: written again there after each answer from now on. */
	async function save({ res, body }: Call): Promise<void> {
		const fields = bodyObject(body);
		const discussion = await discussionStore.read(fields.id);
		if (!discussion) throw new HttpError(404, "There is no such discussion");
		const project = await projects.current();
		if (!project) throw new HttpError(409, "Choose a project first, under Settings → Projects.");
		const saved = discussion.saved?.project === project.id ? await updateTranscript(discussion) : await newTranscript(discussion, project);
		if (saved) log(`Saved a discussion (${KIND_WORDS[discussion.kind]}) to ${OWN_FOLDER}/Discussions/${saved.name}`, project);
		return sendJson(res, 200, { discussion: viewOf(discussion), saved: saved ? { ...saved, projectName: project.name } : null });
	}

	async function remove({ res, body }: Call): Promise<void> {
		const fields = bodyObject(body);
		if (typeof fields.id === "string" && answering.has(fields.id)) throw new HttpError(409, "This discussion is waiting for an answer. Delete it when the answer has come");
		if (!(await discussionStore.remove(fields.id))) throw new HttpError(404, "There is no such discussion");
		return sendJson(res, 200, { deleted: fields.id });
	}

	/**
	 * A follow-up sends the first prompt as built from this server's data, the conversation so far and
	 * the owner's question, to the model the discussion began with. The answer is text for the page.
	 */
	async function ask({ res, body }: Call): Promise<void> {
		const fields = bodyObject(body);
		const question = fields.question;
		if (typeof question !== "string" || question.trim() === "" || question.length > MAX_QUESTION) throw new HttpError(400, `Ask a question of 1 to ${MAX_QUESTION} characters`);
		const discussion = await discussionStore.read(fields.id);
		if (!discussion) throw new HttpError(404, "There is no such discussion");
		if (answering.has(discussion.id)) throw new HttpError(409, "This discussion is still waiting for an answer to the last question");
		const state = await followUpState(discussion);
		if (!state.ok) throw new HttpError(409, state.reason);
		const target = state.target;
		const long = discussion.kind === "send";
		// Sized as the first answer was: from the model's own context length when Ollama says it (R6F-8).
		const sized = sizedFor(target.config, { cap: target.hosted && long ? HOSTED_DATA_CAP : DATA_CAP, ...(long ? { maxTokens: SEND_TOKENS } : {}) });
		const prompt = await rebuildPrompt(discussion, target, sized.cap);
		const { messages, note } = followUpPrompt(prompt, discussion.turns, question.trim(), target.hosted ? HOSTED_HISTORY_CAP : LOCAL_HISTORY_CAP);

		// As for "Send to a model": the owner's own model answers one request at a time, a hosted one many.
		const local = !target.hosted;
		if (local && ctx.modelBusy()) throw new HttpError(409, "The model is still answering another request. Try again when it has finished.");
		if (local) ctx.setModelBusy(true);
		answering.add(discussion.id);
		ctx.sending(1);
		const cancel = new AbortController();
		const onClose = () => {
			if (!res.writableFinished) cancel.abort();
		};
		res.once("close", onClose);
		const started = Date.now();
		try {
			const answer = await chat(target.config, messages, {
				fetchFn: options.fetchFn,
				signal: cancel.signal,
				...(long ? { timeoutMs: SEND_TIMEOUT_MS, maxTokens: SEND_TOKENS } : {}),
				...(sized.contextLength !== null ? { contextLength: sized.contextLength, maxTokens: sized.maxTokens } : {}),
			});
			const turn: DiscussionTurn = {
				question: question.trim(),
				answer,
				model: target.config.model,
				at: new Date().toISOString(),
				seconds: Math.round((Date.now() - started) / 100) / 10,
				...(note ? { note } : {}),
			};
			discussion.turns.push(turn);
			discussion.updatedAt = turn.at;
			await discussionStore.save(discussion);
			const kept = await updateTranscript(discussion).catch(transcriptFailed);
			log(`Follow-up question to ${modelWords(target.config)}: ${KIND_WORDS[discussion.kind]}, answered in ${turn.seconds} s`, kept ? await projects.get(kept.project) : undefined);
			sendJson(res, 200, { discussion: viewOf(discussion), turn });
		} catch (err) {
			if (err instanceof AssistantError) throw new HttpError(err.status, err.message);
			throw err;
		} finally {
			res.off("close", onClose);
			answering.delete(discussion.id);
			ctx.sending(-1);
			if (local) ctx.setModelBusy(false);
		}
	}

	const routes: Route[] = [
		["GET /api/discussions", list],
		["GET /api/discussions/one", one],
		["GET /api/discussions/export", exportRoute],
		["POST /api/discussions/save", save],
		["POST /api/discussions/delete", remove],
		["POST /api/discussions/ask", ask],
		notFoundUnder("/api/discussions", "any", ({ body }) => {
			bodyObject(body);
		}),
	];

	return { recordDiscussion, routes };
}
