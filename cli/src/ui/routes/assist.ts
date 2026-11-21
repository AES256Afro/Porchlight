// Asking a model about what the page shows (invariant 13): Explain, Summarise, Ask, a domain's scan
// and the Cloudflare audit (/api/assist/<kind>), and "Send to a model" (/api/repos/send, invariant 18).
// The data comes from this server's own copy, never from the request: the page names what to explain
// and cannot supply what the model reads. Each answer is kept as a discussion (invariant 22).
import { AssistantError, chat } from "../../assist/ollama.ts";
import { askPrompt, cloudflarePrompt, DATA_CAP, domainPrompt, findingPrompt, HOSTED_DATA_CAP, locateFinding, roadmapPrompt, SEND_CONTENTS, SEND_PURPOSES, sendPrompt, type Prompt, type SendContent, type SendPurpose } from "../../assist/prompts.ts";
import { sizedFor } from "../../assist/context.ts";
import { readAudit } from "../../cloudflare/store.ts";
import type { DiscussionAbout, DiscussionKind } from "../../discussions/discussions.ts";
import { reportStamp } from "../../repos/report.ts";
import { parseFilter } from "../../roadmap/export.ts";
import { describeFilter } from "../../../ui/filter.js";
import { MAX_QUESTION } from "../../../ui/generated.js";
import type { ServerContext } from "../context.ts";
import type { Call } from "../gate.ts";
import { bodyObject, domainField, HttpError, sendJson, textField } from "../http.ts";
import type { Route } from "../router.ts";
import type { createDiscussions, DiscussionSources } from "./discussions.ts";

/** A repair plan is longer than an explanation; this is what a local model may write for one. */
export const SEND_TOKENS = 3_000;
/** A model on a processor writing 3 000 tokens at a few a second takes many minutes. */
export const SEND_TIMEOUT_MS = 1_200_000;
/** What the local model can be asked for, one route each. */
const ASSIST_ROUTES = ["finding", "roadmap", "domain", "ask", "cloudflare"];

export function assistRoutes(ctx: ServerContext, sources: DiscussionSources, discussions: ReturnType<typeof createDiscussions>): Route[] {
	const { options, confirmModel } = ctx;
	const { recordDiscussion } = discussions;

	/**
	 * "Send to a model": the roadmap or the findings, all or what the filters show, to the model the
	 * owner picks, for a deeper analysis or a repair plan. The request names the model by Porchlight's
	 * own id and what to send; the data comes from this server's copy of the report (invariant 13).
	 * The answer is text for the page to show, labelled as generated; nothing acts on it.
	 */
	async function send({ res, body }: Call): Promise<void> {
		const fields = bodyObject(body);
		const target = ctx.targets().find((candidate) => candidate.id === fields.target);
		if (!target) throw new HttpError(400, "Choose one of the models offered. Set one up under Settings → Model");
		if (!(SEND_CONTENTS as readonly unknown[]).includes(fields.content)) throw new HttpError(400, `Choose what to send: ${SEND_CONTENTS.join(" or ")}`);
		if (!(SEND_PURPOSES as readonly unknown[]).includes(fields.purpose)) throw new HttpError(400, `Choose what to ask for: ${SEND_PURPOSES.join(" or ")}`);
		const text = (name: string) => (typeof fields[name] === "string" ? (fields[name] as string) : null);
		const report = await ctx.storedReport();
		const filter = parseFilter({ severity: text("severity"), kind: text("kind"), match: text("q"), repo: text("repo"), new: text("new") }, await ctx.newKeysOf(report));
		// A local model that reads less than the usual gets a smaller data block and answer (R6F-8).
		const sized = sizedFor(target.config, { cap: target.hosted ? HOSTED_DATA_CAP : DATA_CAP, maxTokens: SEND_TOKENS });
		const prompt = sendPrompt(report, {
			content: fields.content as SendContent,
			purpose: fields.purpose as SendPurpose,
			filter,
			cap: sized.cap,
		});

		// A hosted provider answers many requests at once; the owner's own model one at a time.
		const local = !target.hosted;
		if (local && ctx.modelBusy()) throw new HttpError(409, "The local model is still answering another request. Try again when it has finished, or send to a hosted model.");
		if (local) ctx.setModelBusy(true);
		ctx.sending(1);
		const cancel = new AbortController();
		const onClose = () => {
			if (!res.writableFinished) cancel.abort();
		};
		res.once("close", onClose);
		const started = Date.now();
		try {
			const answer = await chat(target.config, prompt.messages, { fetchFn: options.fetchFn, signal: cancel.signal, timeoutMs: SEND_TIMEOUT_MS, maxTokens: sized.maxTokens ?? SEND_TOKENS, ...(sized.contextLength !== null ? { contextLength: sized.contextLength } : {}) });
			const partial = describeFilter(filter);
			// What the page's filter was, in the request's own words, so a follow-up rebuilds the same data.
			const filterWords = Object.fromEntries((["severity", "kind", "q", "repo", "new"] as const).flatMap((name) => (text(name) === null ? [] : [[name, text(name) as string]])));
			const about: DiscussionAbout = {
				scannedAt: report.scannedAt,
				stamp: reportStamp(report),
				content: fields.content as string,
				purpose: fields.purpose as string,
				...(Object.keys(filterWords).length > 0 ? { filter: filterWords } : {}),
				...(partial ? { partial } : {}),
			};
			const discussion = await recordDiscussion("send", about, target.config, target.id, prompt.cut, {
				question: null,
				answer,
				model: target.config.model,
				at: new Date().toISOString(),
				seconds: Math.round((Date.now() - started) / 100) / 10,
			});
			sendJson(res, 200, {
				text: answer,
				model: target.config.model,
				label: target.label,
				hosted: target.hosted,
				...(prompt.cut ? { cut: prompt.cut } : {}),
				...(partial ? { partial } : {}),
				...(discussion ? { discussion: discussion.id, title: discussion.title } : {}),
			});
		} catch (err) {
			if (err instanceof AssistantError) throw new HttpError(err.status, err.message);
			throw err;
		} finally {
			res.off("close", onClose);
			ctx.sending(-1);
			if (local) ctx.setModelBusy(false);
		}
	}

	/** Asks the model in use about one kind of thing the page shows. */
	function assist(kind: DiscussionKind) {
		return async ({ res, body }: Call): Promise<void> => {
			const model = ctx.model();
			const assistant = model.config;
			if (!assistant) throw new HttpError(503, model.error ?? "No model is connected. Choose one in Settings → Model");
			const fields = bodyObject(body);
			confirmModel(fields, assistant);

			// A local model that reads less than the usual gets a smaller data block and answer (R6F-8).
			const sized = sizedFor(assistant, { cap: DATA_CAP });
			let prompt: Prompt;
			/** What the answer is about, kept with it as a discussion so it can be followed up. */
			let about: DiscussionAbout;
			let firstQuestion: string | null = null;
			if (kind === "domain") {
				const domain = domainField(fields);
				const report = await sources.latestDomainReport(domain);
				prompt = domainPrompt(report, sized.cap);
				about = { domain, takenAt: String(report.takenAt) };
			} else if (kind === "cloudflare") {
				const report = await readAudit(sources.auditPath);
				if (!report) throw new HttpError(404, "There is no Cloudflare audit yet. Run one first.");
				prompt = cloudflarePrompt(report, sized.cap);
				about = { checkedAt: report.checkedAt, zones: report.zones.length };
			} else if (kind === "ask") {
				const question = fields.question;
				if (typeof question !== "string" || question.trim() === "" || question.length > MAX_QUESTION) {
					throw new HttpError(400, `Ask a question of 1 to ${MAX_QUESTION} characters`);
				}
				const report = await ctx.storedReport();
				prompt = askPrompt(report, question, sized.cap);
				about = { scannedAt: report.scannedAt, stamp: reportStamp(report) };
				firstQuestion = question.trim();
			} else if (kind === "finding") {
				const target = {
					repo: textField(fields, "repo", 1000),
					ruleId: textField(fields, "ruleId", 500),
					location: textField(fields, "location", 2000),
					detail: fields.detail === undefined ? undefined : textField(fields, "detail", 2000),
				};
				const report = await ctx.storedReport();
				const found = locateFinding(report, target);
				if (!found) throw new HttpError(404, "That finding is not in the latest scan. Reload the page to see the current one.");
				prompt = findingPrompt(report, found.repo, found.finding);
				about = {
					scannedAt: report.scannedAt,
					stamp: reportStamp(report),
					repo: target.repo,
					ruleId: target.ruleId,
					location: target.location,
					detail: found.finding.detail,
					title: found.finding.title,
					severity: found.finding.severity,
				};
			} else {
				const report = await ctx.storedReport();
				prompt = roadmapPrompt(report, sized.cap);
				about = { scannedAt: report.scannedAt, stamp: reportStamp(report) };
			}

			if (ctx.modelBusy()) throw new HttpError(409, "The model is still answering another request. Try again when it has finished.");
			ctx.setModelBusy(true);
			// A page that is closed stops waiting, so Ollama stops working on an answer nobody will read.
			const cancel = new AbortController();
			const onClose = () => {
				if (!res.writableFinished) cancel.abort();
			};
			res.once("close", onClose);
			const started = Date.now();
			try {
				const text = await chat(assistant, prompt.messages, { fetchFn: options.fetchFn, signal: cancel.signal, ...(sized.contextLength !== null ? { contextLength: sized.contextLength, maxTokens: sized.maxTokens } : {}) });
				const discussion = await recordDiscussion(kind, about, assistant, null, prompt.cut, {
					question: firstQuestion,
					answer: text,
					model: assistant.model,
					at: new Date().toISOString(),
					seconds: Math.round((Date.now() - started) / 100) / 10,
				});
				sendJson(res, 200, { text, model: assistant.model, ...(prompt.cut ? { cut: prompt.cut } : {}), ...(discussion ? { discussion: discussion.id, title: discussion.title } : {}) });
			} catch (err) {
				if (err instanceof AssistantError) throw new HttpError(err.status, err.message);
				throw err;
			} finally {
				res.off("close", onClose);
				ctx.setModelBusy(false);
			}
		};
	}

	return [
		["POST /api/repos/send", send],
		...ASSIST_ROUTES.map((kind): Route => [`POST /api/assist/${kind}`, assist(kind as DiscussionKind)]),
		// Another method on a kind there is: refused as such; a kind there is not: not found.
		[
			(call) => call.url.pathname.startsWith("/api/assist/"),
			({ url }) => {
				throw ASSIST_ROUTES.includes(url.pathname.slice("/api/assist/".length)) ? new HttpError(405, "Method not allowed") : new HttpError(404, "Not found");
			},
		],
	];
}
