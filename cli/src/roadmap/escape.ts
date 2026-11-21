// What a roadmap prints comes from repositories and DNS records, which
// someone else may control. Each output format has its own way of turning
// text into something active, and each is closed off here.

/**
 * Characters a terminal acts on rather than shows: C0 controls other than
 * tab, line feed and carriage return (ESC starts an escape sequence), DEL, C1
 * controls (CSI is a one-character ESC [), the bidirectional overrides,
 * isolates and marks that make a name read differently from what it is, and
 * the line and paragraph separators some viewers break a line at (S38).
 */
const CONTROLS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
/** A carriage return that does not end a line moves back to its start, so later text overwrites what is there. */
const BARE_RETURN = /\r(?!\n)/g;
/** Shown in place of a removed character, so the reader can tell something was there. */
const REPLACEMENT = "�";

/** Text with every control character a terminal or viewer would act on replaced. Tabs and line breaks stay. */
export function stripControls(text: string): string {
	return text.replace(CONTROLS, REPLACEMENT).replace(BARE_RETURN, REPLACEMENT);
}

/** What the CLI writes to a terminal. Data from a scan can carry escape sequences, so none reaches it. */
export function forTerminal(text: string): string {
	return stripControls(text);
}

/** Characters JSON.stringify leaves as they are that a terminal or viewer would act on. */
const JSON_UNESCAPED = /[\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;

/**
 * JSON for a file or a terminal. JSON.stringify already writes C0 controls as
 * escapes, but not DEL, C1 or bidirectional controls; these are escaped too,
 * so the data is unchanged and nothing in it acts on a terminal.
 */
export function jsonText(value: unknown): string {
	const text = JSON.stringify(value, null, "\t").replace(JSON_UNESCAPED, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
	return `${text}\n`;
}

/** Text for an HTML document. */
export function html(text: string): string {
	return stripControls(text).replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * One CSV cell. A cell that begins with = + - @ (or a tab or return) is run
 * as a formula by spreadsheets, so it is prefixed with an apostrophe, which
 * they show as text. A cell holding a semicolon or a tab is quoted too: a
 * spreadsheet set to a language whose lists use semicolons splits on them, and
 * the part after one would be read as a cell of its own, formula and all (S41).
 */
export function csvCell(value: string | number): string {
	let text = stripControls(String(value));
	if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return /[",;\t\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Rows a CSV export ends with, so a spreadsheet of it is never read as complete when it is not (B67):
 * one for a partial export, saying what it covers, and one for each thing the scan did not cover. The
 * words go in `column` of a row `width` cells wide, after a first cell that names the kind of row.
 */
export function csvNoteRows(width: number, column: number, partial: string | null, notCovered: string[]): string[] {
	const row = (kind: string, text: string) => csvRow(Array.from({ length: width }, (_, index) => (index === 0 ? kind : index === column ? text : "")));
	return [...(partial ? [row("Partial", partial)] : []), ...notCovered.map((note) => row("Not covered", note))];
}

export function csvRow(cells: (string | number)[]): string {
	return cells.map(csvCell).join(",");
}

/**
 * A name GitHub would turn into a mention that notifies someone (`@name`, or
 * `@org/team`). It does so even when the @ is escaped, but leaves code spans
 * alone, so such a name is shown as code.
 */
const MENTION = /((?<![\w@])@\w[\w./-]*)/;

/**
 * Plain text inside Markdown: every character that could start a link, an
 * image, emphasis, a heading, a table cell or raw HTML is escaped, and line
 * breaks are flattened so one field cannot begin a new block. Text that
 * GitHub turns into a link by itself is broken up too: the colon of `://`
 * and of `mailto:`, `www.`, an @ (an email address), and a mention, which
 * becomes code.
 */
export function mdText(text: string): string {
	const flat = stripControls(text).replace(/\s*[\r\n]+\s*/g, " ");
	return flat
		.split(MENTION)
		.map((part, index) => (index % 2 === 1 ? mdCode(part) : escapeMarkdown(part)))
		.join("");
}

function escapeMarkdown(text: string): string {
	return text
		.replace(/[\\`*_{}[\]()#+!|<>~@]/g, "\\$&")
		.replace(/:(?=\/\/)|(?<=\b(?:mailto|xmpp)):/gi, "\\:")
		.replace(/\b(www)\./gi, "$1\\.");
}

/** A code span, fenced with more backticks than the text contains so it cannot close early. */
export function mdCode(text: string): string {
	const flat = stripControls(text).replace(/\s*[\r\n]+\s*/g, " ");
	const longestRun = Math.max(0, ...(flat.match(/`+/g) ?? []).map((run) => run.length));
	const fence = "`".repeat(longestRun + 1);
	const pad = flat.startsWith("`") || flat.endsWith("`") ? " " : "";
	return `${fence}${pad}${flat}${pad}${fence}`;
}

/**
 * A fenced code block, for text kept as it was captured (an HTTP response, say). The fence is longer
 * than any run of backticks inside, so nothing in the text can close it.
 */
export function mdBlock(text: string): string {
	const clean = stripControls(text.replace(/\r\n?/g, "\n"));
	const longestRun = Math.max(0, ...(clean.match(/`+/g) ?? []).map((run) => run.length));
	const fence = "`".repeat(Math.max(3, longestRun + 1));
	return `${fence}text\n${clean}\n${fence}`;
}
