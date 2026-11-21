import { MURAL_COLUMNS, type Mural } from "../assist/mural.ts";
import { SEVERITIES } from "../repos/types.ts";
import { csvNoteRows, csvRow, html, jsonText, mdCode, mdText } from "./escape.ts";
import { EXPORT_TOKENS, footLine, utcTime } from "./style.ts";
import { emptyCounts, phaseTitle, sumCounts, totalOf, type Action, type Counts, type FindingRow, type FindingsList, type Phase, type Roadmap } from "./types.ts";

export const FORMATS = ["md", "html", "csv", "json"] as const;
export type Format = (typeof FORMATS)[number];

export interface Rendered {
	body: string;
	contentType: string;
	extension: Format;
}

export function isFormat(value: string): value is Format {
	return (FORMATS as readonly string[]).includes(value);
}

/** `mural`: a model-written board, added in its own labelled section (not to CSV, which has no room for one). */
export function renderRoadmap(roadmap: Roadmap, format: Format, mural?: Mural): Rendered {
	switch (format) {
		case "md":
			return { body: markdown(roadmap, mural), contentType: "text/markdown; charset=utf-8", extension: "md" };
		case "html":
			return { body: page(roadmap, mural), contentType: "text/html; charset=utf-8", extension: "html" };
		case "csv":
			return { body: csv(roadmap), contentType: "text/csv; charset=utf-8", extension: "csv" };
		case "json":
			return { body: jsonText(mural ? { ...roadmap, mural } : roadmap), contentType: "application/json; charset=utf-8", extension: "json" };
	}
}

export function renderFindings(list: FindingsList, format: Format, mural?: Mural): Rendered {
	switch (format) {
		case "md":
			return { body: findingsMarkdown(list, mural), contentType: "text/markdown; charset=utf-8", extension: "md" };
		case "html":
			return { body: findingsPage(list, mural), contentType: "text/html; charset=utf-8", extension: "html" };
		case "csv":
			return { body: findingsCsv(list), contentType: "text/csv; charset=utf-8", extension: "csv" };
		case "json":
			return { body: jsonText(mural ? { ...list, mural } : list), contentType: "application/json; charset=utf-8", extension: "json" };
	}
}

// The mural: the model's words beside figures Porchlight counted, labelled as generated.

function muralLabel(mural: Mural): string {
	return `Written by ${mural.model} on ${mural.generatedAt.slice(0, 10)}. This is generated text and can be wrong: check it against the figures, which Porchlight counted, and the details below.`;
}

function muralFigures(mural: Mural): [string, string][] {
	const { findings, analysis } = mural.facts;
	const now = mural.facts.actions[0];
	return [
		["Findings", number(findings.total)],
		["Critical", number(findings.critical)],
		["High", number(findings.high)],
		["Medium", number(findings.medium)],
		["Low", number(findings.low)],
		["Repositories affected", `${number(mural.facts.repositoriesAffected)} of ${number(mural.facts.repositories)}`],
		[now ? `Actions: ${now.phase}` : "Actions", number(now?.actions ?? 0)],
		["Judged by a model", `${number(analysis.judged)} of ${number(analysis.items)}`],
		...(mural.facts.sinceLastScan
			? ([
					["Fixed since last scan", number(mural.facts.sinceLastScan.fixed)],
					["New since last scan", number(mural.facts.sinceLastScan.new)],
				] as [string, string][])
			: []),
	];
}

function muralSection(mural: Mural): string {
	const columns = MURAL_COLUMNS.map(
		([key, title]) =>
			`<div class="column column-${key}"><h3>${html(title)}</h3>${mural[key].length > 0 ? `<ul>${mural[key].map((item) => `<li>${html(item)}</li>`).join("")}</ul>` : `<p class="sub">Nothing written.</p>`}</div>`,
	).join("\n");
	const figures = muralFigures(mural)
		.map(([label, value]) => `<div class="figure"><span>${html(label)}</span><strong>${html(value)}</strong></div>`)
		.join("");
	return `<section class="mural" aria-label="Mural">
<p class="generated">${html(muralLabel(mural))}</p>
${mural.headline ? `<p class="headline">${html(mural.headline)}</p>` : ""}
<div class="figures">${figures}</div>
<div class="board">
${columns}
</div>
${mural.cut ? `<p class="sub">${html(`The model read part of the scan: ${mural.cut}`)}</p>` : ""}
</section>`;
}

function muralMarkdown(mural: Mural): string[] {
	const lines = ["## Mural", "", `*${mdText(muralLabel(mural))}*`, ""];
	if (mural.headline) lines.push(`**${mdText(mural.headline)}**`, "");
	lines.push(`Figures counted by Porchlight: ${muralFigures(mural).map(([label, value]) => `${label} ${value}`).join(" · ")}.`, "");
	for (const [key, title] of MURAL_COLUMNS) {
		lines.push(`### ${title}`, "", ...(mural[key].length > 0 ? mural[key].map((item) => `- ${mdText(item)}`) : ["Nothing written."]), "");
	}
	if (mural.cut) lines.push(mdText(`The model read part of the scan: ${mural.cut}`), "");
	return lines;
}

/** `porchlight-roadmap-2026-11-17`, with a label (a domain, or "partial") in the middle. Safe as a file name. */
export function fileStem(kind: "roadmap" | "findings", scannedAt: string, label?: string): string {
	const safe = label?.toLowerCase().replace(/[^a-z0-9.-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "");
	return [`porchlight-${kind}`, safe, scannedAt.slice(0, 10).replace(/[^0-9-]/g, "")].filter(Boolean).join("-");
}

const number = (value: number) => value.toLocaleString("en-US");
const plural = (count: number, one: string, many: string) => `${number(count)} ${count === 1 ? one : many}`;

/** "9 findings (3 critical, 4 high, 2 medium)"; severities with nothing in them are left out. */
function clearsText(counts: Counts): string {
	const parts = SEVERITIES.filter((severity) => counts[severity] > 0).map((severity) => `${number(counts[severity])} ${severity}`);
	return `${plural(totalOf(counts), "finding", "findings")} (${parts.join(", ")})`;
}

/** The first few IDs, then a count: an upgrade can clear dozens of advisories. */
function shortList(items: string[], limit = 6): string[] {
	return items.length > limit ? [...items.slice(0, limit), `and ${number(items.length - limit)} more`] : items;
}

function intro(roadmap: Roadmap): string {
	const { actions, findings, groups } = roadmap.totals;
	// A filtered export that matches nothing says so: the scan's other findings are not in it (B50).
	if (actions === 0) return roadmap.scope ? "Nothing to repair matches what this export covers. The scan's other findings are not in it." : "Nothing to repair: the scan found no problems in what it covered.";
	const [one, many] = roadmap.places ?? ["place", "places"];
	return `${plural(actions, "action clears", "actions clear")} ${plural(findings, "finding", "findings")} across ${plural(groups, one, many)}. Work down the list: each phase is more pressing than the one after it.`;
}

/**
 * Each action's number, "phase.action" ("2.3"), counted down each phase in the order it is printed, so a
 * ticket can cite one (R6V-2). The same in every format.
 */
function actionNumbers(roadmap: Roadmap): Map<Action, string> {
	const numbers = new Map<Action, string>();
	roadmap.phases.forEach((phase, index) => {
		let count = 0;
		for (const group of phase.groups) for (const action of group.actions) numbers.set(action, `${index + 1}.${++count}`);
	});
	return numbers;
}

/** Steps three or more actions of a phase share, word for word, are printed once for the phase (RD-16). */
const SHARED_FROM = 3;

interface SharedSteps {
	label: string;
	how: string[];
	/** The numbers of the actions that follow them. */
	actions: string[];
}

/** Per phase, the steps its actions share, and which shared set each action follows. Labels run A, B, C across the export. */
function sharedSteps(roadmap: Roadmap, numbers: Map<Action, string>): { byPhase: SharedSteps[][]; of: Map<Action, SharedSteps> } {
	const of = new Map<Action, SharedSteps>();
	let next = 0;
	const byPhase = roadmap.phases.map((phase) => {
		const sets = new Map<string, Action[]>();
		for (const group of phase.groups) {
			for (const action of group.actions) {
				if (action.how.length < 2) continue;
				const key = action.how.join("\n");
				sets.set(key, [...(sets.get(key) ?? []), action]);
			}
		}
		const shared: SharedSteps[] = [];
		for (const actions of sets.values()) {
			if (actions.length < SHARED_FROM) continue;
			const label = next < 26 ? String.fromCharCode(65 + next) : `${next + 1}`;
			next++;
			const set = { label, how: actions[0]!.how, actions: actions.map((action) => numbers.get(action)!) };
			shared.push(set);
			for (const action of actions) of.set(action, set);
		}
		return shared;
	});
	return { byPhase, of };
}

/** "Shared steps A (for 1.2, 1.3 and 1.4)". */
function sharedTitle(set: SharedSteps): string {
	const list = set.actions.length > 1 ? `${set.actions.slice(0, -1).join(", ")} and ${set.actions.at(-1)}` : set.actions[0];
	return `Shared steps ${set.label} (for ${list})`;
}

function phaseCounts(phase: Phase): { actions: number; findings: number } {
	const actions = phase.groups.flatMap((group) => group.actions);
	return { actions: actions.length, findings: totalOf(sumCounts(actions)) };
}

// Markdown: a checklist that can be pasted into an issue or kept in a repository.

function markdown(roadmap: Roadmap, mural?: Mural): string {
	const lines = [
		`# ${mdText(roadmap.title)}`,
		"",
		`Source: ${mdCode(roadmap.source)}, scanned ${roadmap.scannedAt.slice(0, 10)}.`,
		"",
		intro(roadmap),
		"",
	];
	if (roadmap.scope) lines.push(`**Partial roadmap.** It covers only: ${mdText(roadmap.scope)}.`, "");
	if (roadmap.caveats.length > 0) {
		lines.push("**The scan was incomplete, so this roadmap is too.** Not covered:", "", ...roadmap.caveats.map((caveat) => `- ${mdText(caveat)}`), "");
	}
	if (mural) lines.push(...muralMarkdown(mural), "## The roadmap", "");

	lines.push("| Phase | Actions | Findings cleared |", "| --- | ---: | ---: |");
	roadmap.phases.forEach((phase, index) => {
		const { actions, findings } = phaseCounts(phase);
		lines.push(`| ${index + 1}. ${phase.title} | ${number(actions)} | ${number(findings)} |`);
	});
	lines.push("");

	const numbers = actionNumbers(roadmap);
	const shared = sharedSteps(roadmap, numbers);
	roadmap.phases.forEach((phase, index) => {
		if (phase.groups.length === 0) return;
		lines.push(`## ${index + 1}. ${phase.title}`, "", phase.summary, "");
		for (const set of shared.byPhase[index] ?? []) {
			lines.push(`**${sharedTitle(set)}:**`, "", ...set.how.map((step, at) => `${at + 1}. ${mdStep(step)}`), "");
		}
		for (const group of phase.groups) {
			lines.push(`### ${mdText(group.name)}`, "");
			for (const action of group.actions) {
				lines.push(`- [ ] **${numbers.get(action)} ${mdText(action.title)}**`);
				lines.push(`  - Where: ${mdCode(action.where)}`);
				lines.push(`  - Clears ${clearsText(action.counts)}: ${shortList(action.clears).map(mdText).join(", ")}`);
				const set = shared.of.get(action);
				if (set) lines.push(`  - Follow shared steps ${set.label}, above.`);
				else for (const step of action.how) lines.push(`  - ${mdStep(step)}`);
			}
			lines.push("");
		}
	});
	lines.push("---", "", `*${mdText(footLine(roadmap.scanKind ?? "Scan", roadmap.scannedAt))}*`, "");
	return lines.join("\n");
}

/** Steps are written by this program and mark commands with backticks; whatever sits between them is data. */
function mdStep(step: string): string {
	return step
		.split("`")
		.map((part, index) => (index % 2 === 1 ? mdCode(part) : mdText(part)))
		.join("");
}

// CSV: one row per action, for a tracker or a spreadsheet.

function csv(roadmap: Roadmap): string {
	const rows = [csvRow(["No.", "Phase", "Priority", "Place", "Action", "Where", "Findings cleared", "Critical", "High", "Medium", "Low", "Clears", "How", "Done"])];
	const numbers = actionNumbers(roadmap);
	roadmap.phases.forEach((phase, index) => {
		for (const group of phase.groups) {
			for (const action of group.actions) {
				rows.push(
					csvRow([
						numbers.get(action) ?? "",
						`${index + 1}. ${phase.title}`,
						action.priority,
						group.name,
						action.title,
						action.where,
						totalOf(action.counts),
						...SEVERITIES.map((severity) => action.counts[severity]),
						action.clears.join(" "),
						action.how.join(" ").replace(/`/g, ""),
						"",
					]),
				);
			}
		}
	});
	rows.push(...csvNoteRows(14, 4, roadmap.scope ? `It covers only: ${roadmap.scope}.` : null, roadmap.caveats));
	return `${rows.join("\r\n")}\r\n`;
}

// HTML: one self-contained file, with no script and nothing loaded from anywhere, that prints cleanly.

function page(roadmap: Roadmap, mural?: Mural): string {
	const numbers = actionNumbers(roadmap);
	const shared = sharedSteps(roadmap, numbers);
	const phases = roadmap.phases.map((phase, index) => phaseSection(phase, index, numbers, shared)).join("\n");
	const summaryRows = roadmap.phases
		.map((phase, index) => {
			const { actions, findings } = phaseCounts(phase);
			return `<tr><th scope="row">${index + 1}. ${html(phase.title)}</th><td>${html(phase.summary)}</td><td class="num">${number(actions)}</td><td class="num">${number(findings)}</td></tr>`;
		})
		.join("\n");
	const notices = [
		roadmap.scope ? `<p class="notice"><strong>Partial roadmap.</strong> It covers only: ${html(roadmap.scope)}.</p>` : "",
		roadmap.caveats.length > 0
			? `<div class="notice"><strong>The scan was incomplete, so this roadmap is too.</strong> Not covered:<ul>${roadmap.caveats.map((caveat) => `<li>${html(caveat)}</li>`).join("")}</ul></div>`
			: "",
	].join("\n");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="color-scheme" content="light dark">
<title>${html(documentTitle(roadmap.title, roadmap.source, roadmap.scannedAt))}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${html(roadmap.title)}</h1>
<p class="sub">Source: <code>${html(roadmap.source)}</code>, scanned ${html(roadmap.scannedAt.slice(0, 10))}.</p>
<p>${html(intro(roadmap))}</p>
${notices}
${mural ? muralSection(mural) : ""}
<table class="summary">
<thead><tr><th scope="col">Phase</th><th scope="col">What is in it</th><th scope="col" class="num">Actions</th><th scope="col" class="num">Findings cleared</th></tr></thead>
<tbody>
${summaryRows}
</tbody>
</table>
${phases}
<footer class="foot">${html(footLine(roadmap.scanKind ?? "Scan", roadmap.scannedAt))}</footer>
</main>
</body>
</html>
`;
}

/**
 * The page's title, which a browser also takes as the name of a PDF printed from it: what it is, where
 * from and the day, so two saved exports are never named alike (R6V-2).
 */
function documentTitle(title: string, source: string, at: string): string {
	return `${title}, ${source}, ${utcTime(at).slice(0, 10)}`;
}

function phaseSection(phase: Phase, index: number, numbers: Map<Action, string>, shared: ReturnType<typeof sharedSteps>): string {
	if (phase.groups.length === 0) return "";
	const sets = (shared.byPhase[index] ?? [])
		.map((set) => `<div class="shared"><h3>${html(sharedTitle(set))}</h3><ol>${set.how.map((step) => `<li>${htmlStep(step)}</li>`).join("")}</ol></div>`)
		.join("\n");
	const groups = phase.groups
		.map((group) => `<section class="group">\n<h3>${html(group.name)}</h3>\n<ul class="actions">\n${group.actions.map((action) => actionItem(action, numbers.get(action) ?? "", shared.of.get(action))).join("\n")}\n</ul>\n</section>`)
		.join("\n");
	return `<section class="phase">\n<h2>${index + 1}. ${html(phase.title)}</h2>\n<p class="sub">${html(phase.summary)}</p>\n${sets}\n${groups}\n</section>`;
}

function actionItem(action: Action, number: string, set: SharedSteps | undefined): string {
	const steps = set ? `<li>Follow shared steps ${html(set.label)}, above.</li>` : action.how.map((step) => `<li>${htmlStep(step)}</li>`).join("");
	return `<li class="action">
<label><input type="checkbox"> <span class="number">${html(number)}</span> <span class="title">${html(action.title)}</span></label>
<dl>
<dt>Where</dt><dd><code>${html(action.where)}</code></dd>
<dt>Clears</dt><dd><span class="mark ${action.priority}">${html(action.priority)}</span> ${html(clearsText(action.counts))}: ${shortList(action.clears).map(html).join(", ")}</dd>
<dt>How</dt><dd><ol>${steps}</ol></dd>
</dl>
</li>`;
}

function htmlStep(step: string): string {
	return step
		.split("`")
		.map((part, index) => (index % 2 === 1 ? `<code>${html(part)}</code>` : html(part)))
		.join("");
}

// Findings: every finding with its suggested fix, grouped by where it was found.

function countRows(rows: FindingRow[]): Counts {
	const counts = emptyCounts();
	for (const row of rows) counts[row.severity]++;
	return counts;
}

/** Rows by place, keeping the order of first appearance: the place with the worst finding leads. */
function byPlace(rows: FindingRow[]): [string, FindingRow[]][] {
	const places = new Map<string, FindingRow[]>();
	// Appended in place: copying a place's rows for each row is quadratic (B55).
	for (const row of rows) {
		const place = places.get(row.place);
		if (place) place.push(row);
		else places.set(row.place, [row]);
	}
	return [...places];
}

function findingsIntro(list: FindingsList): string {
	if (list.rows.length === 0) return list.scope ? "No finding matches what this list covers. The scan's other findings are not in it." : "No findings: the scan found no problems in what it covered.";
	const [one, many] = list.places ?? ["place", "places"];
	return `${clearsText(countRows(list.rows))} across ${plural(byPlace(list.rows).length, one, many)}, most severe first. Each comes with the repair that clears it.`;
}

/** What the finding is, in one line: its ID, its title and what it applies to. */
function findingLabel(row: FindingRow): string {
	return `${row.id}: ${row.title}${row.detail ? ` (${row.detail})` : ""}`;
}

function findingsMarkdown(list: FindingsList, mural?: Mural): string {
	const lines = [`# ${mdText(list.title)}`, "", `Source: ${mdCode(list.source)}, scanned ${list.scannedAt.slice(0, 10)}.`, "", findingsIntro(list), ""];
	if (list.scope) lines.push(`**Partial list.** It covers only: ${mdText(list.scope)}.`, "");
	if (list.caveats.length > 0) {
		lines.push("**The scan was incomplete, so this list is too.** Not covered:", "", ...list.caveats.map((caveat) => `- ${mdText(caveat)}`), "");
	}
	if (mural) lines.push(...muralMarkdown(mural), "## The findings", "");
	for (const [place, rows] of byPlace(list.rows)) {
		lines.push(`## ${mdText(place)}`, "", "| Severity | Finding | Where | Suggested fix | When |", "| --- | --- | --- | --- | --- |");
		for (const row of rows) {
			// Cells are plain escaped text: a code span cannot hold a pipe inside a table.
			lines.push(`| ${row.severity} | ${mdText(findingLabel(row))} | ${mdText(row.where)} | ${mdText(row.suggestion)} | ${phaseTitle(row.phase)} |`);
		}
		lines.push("");
	}
	lines.push("---", "", `*${mdText(footLine(list.scanKind ?? "Scan", list.scannedAt))}*`, "");
	return lines.join("\n");
}

function findingsCsv(list: FindingsList): string {
	const rows = [csvRow(["Severity", "Type", "Place", "ID", "Finding", "Where", "Detail", "When", "Suggested fix", "How", "Note"])];
	for (const row of list.rows) {
		rows.push(
			csvRow([row.severity, row.type, row.place, row.id, row.title, row.where, row.detail, phaseTitle(row.phase), row.suggestion, row.how.join(" ").replace(/`/g, ""), row.note ?? ""]),
		);
	}
	rows.push(...csvNoteRows(11, 4, list.scope ? `It covers only: ${list.scope}.` : null, list.caveats));
	return `${rows.join("\r\n")}\r\n`;
}

function findingsPage(list: FindingsList, mural?: Mural): string {
	const notices = [
		list.scope ? `<p class="notice"><strong>Partial list.</strong> It covers only: ${html(list.scope)}.</p>` : "",
		list.caveats.length > 0
			? `<div class="notice"><strong>The scan was incomplete, so this list is too.</strong> Not covered:<ul>${list.caveats.map((caveat) => `<li>${html(caveat)}</li>`).join("")}</ul></div>`
			: "",
	].join("\n");
	const sections = byPlace(list.rows)
		.map(([place, rows]) => {
			const body = rows
				.map(
					(row) =>
						`<tr><td><span class="mark ${row.severity}">${html(row.severity)}</span></td><td><strong>${html(row.title)}</strong><br><code>${html(row.id)}</code>${row.detail ? ` ${html(row.detail)}` : ""}${row.note ? `<br><span class="sub">${html(row.note)}</span>` : ""}</td><td><code>${html(row.where)}</code></td><td>${html(row.suggestion)}<br><span class="sub">${html(phaseTitle(row.phase))}</span></td></tr>`,
				)
				.join("\n");
			return `<section class="group">\n<h2>${html(place)}</h2>\n<table class="summary findings">\n<thead><tr><th scope="col">Severity</th><th scope="col">Finding</th><th scope="col">Where</th><th scope="col">Suggested fix</th></tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>\n</section>`;
		})
		.join("\n");

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="color-scheme" content="light dark">
<title>${html(documentTitle(list.title, list.source, list.scannedAt))}</title>
<style>${STYLE}</style>
</head>
<body>
<main>
<h1>${html(list.title)}</h1>
<p class="sub">Source: <code>${html(list.source)}</code>, scanned ${html(list.scannedAt.slice(0, 10))}.</p>
<p>${html(findingsIntro(list))}</p>
${notices}
${mural ? muralSection(mural) : ""}
${sections}
<footer class="foot">${html(footLine(list.scanKind ?? "Scan", list.scannedAt))}</footer>
</main>
</body>
</html>
`;
}

/**
 * The page's own colour list (tokens.css) and the rules for an export. Every colour is a token: a mark is
 * drawn in a -mark tone or --critical, at least 3:1 like the page's (VS-11), and printing is always light
 * (R6V-1). cli/test/contrast.test.ts reads the tokens and checks that nothing here adds a colour.
 */
const STYLE = `
${EXPORT_TOKENS}
:root { --line: var(--hairline); }
body { margin: 0; background: var(--page); color: var(--ink); font: 14px/1.5 var(--sans); }
main { max-width: 920px; margin: 0 auto; padding: 32px 24px 64px; }
h1 { font-size: 26px; line-height: 1.2; margin: 0 0 4px; }
h2 { font-size: 19px; margin: 36px 0 2px; padding-top: 16px; border-top: 2px solid var(--ink); }
h3 { font-size: 15px; margin: 22px 0 8px; overflow-wrap: anywhere; }
p { margin: 8px 0; }
.sub { color: var(--ink-2); margin-top: 0; }
code { font: 12.5px var(--mono); background: var(--page); border: 1px solid var(--line); border-radius: 4px; padding: 1px 5px; overflow-wrap: anywhere; }
.notice { margin: 14px 0; padding: 10px 14px; border: 1px solid var(--warning-mark); border-left-width: 5px; border-radius: 8px; background: var(--surface); }
.notice ul { margin: 4px 0 0; padding-left: 20px; }
table.summary { width: 100%; margin: 18px 0 4px; border-collapse: collapse; background: var(--surface); border: 1px solid var(--line); }
.summary th, .summary td { padding: 8px 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
.summary thead th { color: var(--ink-2); font-size: 12px; font-weight: 500; }
.summary .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.shared { margin: 12px 0; padding: 10px 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); break-inside: avoid; }
.shared h3 { margin: 0 0 6px; }
.shared ol { margin: 0; padding-left: 20px; }
ul.actions { list-style: none; margin: 0; padding: 0; }
.action { margin: 0 0 10px; padding: 12px 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 10px; break-inside: avoid; }
.action label { display: flex; gap: 8px; align-items: baseline; }
.action .number { font-variant-numeric: tabular-nums; color: var(--ink-2); font-weight: 600; }
.action .title { font-weight: 600; overflow-wrap: anywhere; }
.action input { flex: none; }
dl { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 14px; margin: 8px 0 0 24px; }
dt { color: var(--ink-2); }
dd { margin: 0; overflow-wrap: anywhere; }
dd ol { margin: 0; padding-left: 18px; }
.mark { display: inline-block; padding: 0 7px; border: 1px solid var(--line); border-left: 5px solid var(--muted); border-radius: 4px; font-size: 12px; }
.mark.critical { border-left-color: var(--critical); }
.mark.high { border-left-color: var(--serious-mark); }
.mark.medium { border-left-color: var(--warning-mark); }
.mural { margin: 22px 0 28px; padding: 20px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; break-inside: avoid; }
.mural .generated { margin: 0 0 10px; padding-left: 10px; border-left: 3px solid var(--accent); color: var(--ink-2); font-size: 12.5px; }
.mural .headline { margin: 0 0 14px; font-size: 20px; font-weight: 600; line-height: 1.3; }
.figures { display: grid; grid-template-columns: repeat(auto-fit, minmax(118px, 1fr)); gap: 8px; margin-bottom: 16px; }
.figure { display: grid; gap: 2px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--page); }
.figure span { color: var(--ink-2); font-size: 12px; }
.figure strong { font-size: 18px; font-variant-numeric: tabular-nums; }
.board { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.board .column { padding: 12px 14px; border: 1px solid var(--line); border-top: 5px solid var(--muted); border-radius: 10px; background: var(--page); }
.board .column-found { border-top-color: var(--critical); }
.board .column-decided { border-top-color: var(--warning-mark); }
.board .column-done { border-top-color: var(--good); }
.board .column-next { border-top-color: var(--accent); }
.board h3 { margin: 0 0 8px; font-size: 14px; }
.board ul { margin: 0; padding-left: 18px; }
.board li { margin: 0 0 6px; overflow-wrap: anywhere; }
table.findings { table-layout: fixed; }
table.findings th:nth-child(1) { width: 92px; }
table.findings th:nth-child(3) { width: 24%; }
table.findings th:nth-child(4) { width: 30%; }
table.findings td { overflow-wrap: anywhere; }
table.findings tr { break-inside: avoid; }
.foot { margin-top: 48px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--ink-2); font-size: 12px; }
@media print { body { font-size: 11pt; } main { max-width: none; padding: 0; } h2 { break-after: avoid; } h3 { break-after: avoid; } }
`;
