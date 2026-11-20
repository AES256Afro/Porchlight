// @ts-check
// How the Discussions page names and finds discussions, and where each one links back to. No DOM
// here, so it is tested directly. Every address is built with buildHash from Porchlight's own pages.
import { buildHash } from "./list.js";

/** @typedef {import("../src/discussions/discussions.ts").DiscussionSummary} DiscussionSummary */
/** @typedef {import("../src/discussions/discussions.ts").DiscussionView} DiscussionView */
/** @typedef {import("../src/discussions/discussions.ts").DiscussionKind} DiscussionKind */

/** @type {readonly (readonly [DiscussionKind, string])[]} */
export const KIND_LABELS = [
	["finding", "Explain a finding"],
	["roadmap", "What to fix first"],
	["ask", "Question about a scan"],
	["send", "Sent to a model"],
	["cloudflare", "Cloudflare analysis"],
	["domain", "Explain a domain's scan"],
];

/** @param {string} kind */
export function kindLabel(kind) {
	return KIND_LABELS.find(([key]) => key === kind)?.[1] ?? "Discussion";
}

/**
 * The discussions a kind, a project and a search leave, in the order given. The search matches the
 * title, the model, the repository and the domain, ignoring case. `project` is a project's id, or
 * "none" for discussions kept in no project.
 *
 * @param {DiscussionSummary[]} discussions
 * @param {{ kind?: string | null, project?: string | null, q?: string | null }} filter
 */
export function filterDiscussions(discussions, filter) {
	const query = (filter.q ?? "").trim().toLowerCase();
	return discussions.filter((discussion) => {
		if (filter.kind && discussion.kind !== filter.kind) return false;
		if (filter.project === "none" ? discussion.project !== undefined : filter.project && discussion.project !== filter.project) return false;
		if (!query) return true;
		return [discussion.title, discussion.model, discussion.repo ?? "", discussion.domain ?? ""].some((field) => field.toLowerCase().includes(query));
	});
}

/**
 * Where a discussion's subject is shown: the finding, the roadmap, the domain or the overview. Null
 * when there is no page for it.
 *
 * @param {DiscussionView} discussion
 * @returns {{ href: string, label: string } | null}
 */
export function aboutLink(discussion) {
	const about = discussion.about;
	if (discussion.kind === "finding" && about.repo && about.location) return { href: buildHash(["findings"], { repo: about.repo, q: about.location }), label: "Open the finding" };
	if (discussion.kind === "domain" && about.domain) return { href: buildHash(["domains", about.domain]), label: "Open the domain" };
	if (discussion.kind === "roadmap") return { href: buildHash(["roadmap"]), label: "Open the roadmap" };
	if (discussion.kind === "cloudflare") return { href: buildHash(["cloudflare"]), label: "Open the Cloudflare audit" };
	if (discussion.kind === "send") {
		const filter = about.filter ?? {};
		const settings = { severity: filter.severity, kind: filter.kind, q: filter.q, repo: filter.repo };
		return about.content === "findings" ? { href: buildHash(["findings"], settings), label: "Open the findings" } : { href: buildHash(["roadmap"], settings), label: "Open the roadmap" };
	}
	if (discussion.kind === "ask") return { href: buildHash(["overview"]), label: "Open the overview" };
	return null;
}
