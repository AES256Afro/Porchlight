// What a roadmap prints comes from repositories and DNS records, which
// someone else may control. Each output format has its own way of turning
// text into something active, and each is closed off here.

/** Text for an HTML document. */
export function html(text: string): string {
	return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/**
 * One CSV cell. A cell that begins with = + - @ (or a tab or return) is run
 * as a formula by spreadsheets, so it is prefixed with an apostrophe, which
 * they show as text.
 */
export function csvCell(value: string | number): string {
	let text = String(value);
	if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
	return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function csvRow(cells: (string | number)[]): string {
	return cells.map(csvCell).join(",");
}

/**
 * Plain text inside Markdown: every character that could start a link, an
 * image, emphasis, a heading, a table cell or raw HTML is escaped, and line
 * breaks are flattened so one field cannot begin a new block.
 */
export function mdText(text: string): string {
	return text.replace(/\s*[\r\n]+\s*/g, " ").replace(/[\\`*_{}[\]()#+!|<>~]/g, "\\$&");
}

/** A code span, fenced with more backticks than the text contains so it cannot close early. */
export function mdCode(text: string): string {
	const flat = text.replace(/\s*[\r\n]+\s*/g, " ");
	const longestRun = Math.max(0, ...(flat.match(/`+/g) ?? []).map((run) => run.length));
	const fence = "`".repeat(longestRun + 1);
	const pad = flat.startsWith("`") || flat.endsWith("`") ? " " : "";
	return `${fence}${pad}${flat}${pad}${fence}`;
}
