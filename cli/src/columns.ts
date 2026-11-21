// Fitting the terminal's width (R6V-3): help and doctor are written in columns near 100 characters, so
// on a narrower terminal each paragraph and each option's description is wrapped again, with its hanging
// indent kept. Text that already fits is returned as it is.

/** The width to fit: the terminal's, or 80 when output is not a terminal. Never under 40. */
export function terminalWidth(stream: { isTTY?: boolean; columns?: number } = process.stdout): number {
	return Math.max(40, stream.isTTY && stream.columns ? stream.columns : 80);
}

/** Words of `text` in lines of at most `width` characters, the first after `first`, the rest after `rest`. */
export function wrapWords(text: string, width: number, first: string, rest: string): string[] {
	const lines: string[] = [];
	let line = first;
	let empty = true;
	for (const word of text.split(/\s+/).filter(Boolean)) {
		if (!empty && line.length + 1 + word.length > width) {
			lines.push(line);
			line = rest + word;
		} else {
			line += (empty ? "" : " ") + word;
		}
		empty = false;
	}
	lines.push(line);
	return lines;
}

/** An option or a setting and its description: "  --depth <n>    Folder levels…". */
const ENTRY = /^( {2,}\S(?:.*?\S)?)( {2,})(\S.*)$/;
/** One of several named choices under an option: "  quick: …" at a deeper indent. */
const CHOICE = /^\s+[a-z][\w-]*: /;

/**
 * Help text fitted to `width`. Lines that fit stay; a paragraph or a description that runs over is
 * joined with the lines that continue it and wrapped again under the same indent.
 */
export function fitWidth(text: string, width: number): string {
	const lines = text.split("\n");
	if (lines.every((line) => line.length <= width)) return text;
	const out: string[] = [];
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index]!;
		const entry = ENTRY.exec(line);
		const indent = line.length - line.trimStart().length;
		if (line.trim() === "" || line.startsWith("Usage:")) {
			out.push(line);
			continue;
		}
		if (entry) {
			const head = `${entry[1]}${entry[2]}`;
			const column = head.length;
			let description = entry[3]!;
			// Continuations sit at the description's column, or deeper; a deeper "name:" starts its own line.
			while (index + 1 < lines.length) {
				const next = lines[index + 1]!;
				const nextIndent = next.length - next.trimStart().length;
				if (next.trim() === "" || nextIndent < column || ENTRY.test(next) || (nextIndent > column && CHOICE.test(next))) break;
				description += ` ${next.trim()}`;
				index++;
			}
			const room = column + 20 <= width ? column : Math.min(column, 8);
			if (room === column) out.push(...wrapWords(description, width, head, " ".repeat(column)));
			else out.push(head.trimEnd(), ...wrapWords(description, width, " ".repeat(room), " ".repeat(room)));
			continue;
		}
		// A paragraph: lines at the same indent, up to a blank line or an entry.
		let paragraph = line.trim();
		while (index + 1 < lines.length) {
			const next = lines[index + 1]!;
			const nextIndent = next.length - next.trimStart().length;
			if (next.trim() === "" || ENTRY.test(next) || nextIndent !== indent || CHOICE.test(next)) break;
			paragraph += ` ${next.trim()}`;
			index++;
		}
		const pad = " ".repeat(indent);
		out.push(...wrapWords(paragraph, width, pad, pad));
	}
	return out.join("\n");
}
