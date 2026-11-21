import { fileURLToPath } from "node:url";
import { triagePrivate } from "./triage.ts";
import type { Finding, SecretSource, Severity } from "./types.ts";

// Private data (M7): personal data committed to a repository, which is a leak even when it is not a
// key. Three ways of finding it, none of which ever keeps a value (invariant 3):
//
// - gitleaks, with Porchlight's own rules (gitleaks-private.toml) beside its built-in ones, over the
//   same history and files a secrets scan reads, with --redact. Matches are grouped per rule and
//   file and counted, so a file of 500 addresses is one finding, not 500. Enough contact details in
//   one file make it a possible data dump.
// - File names: databases, mail archives, HTTP archives and contact files by type, and documents
//   named like a passport or a payslip. The name and type only; such a file is never opened.
// - Photos the repository tracks, as they are now: whether their EXIF data holds a GPS position.
//   The position itself is never read out.

/** Porchlight's rules for gitleaks, used instead of gitleaks.toml when a scan looks for private data. */
export const PRIVATE_CONFIG = fileURLToPath(new URL("./gitleaks-private.toml", import.meta.url));

/** Contact details (addresses and phone numbers that are not examples) in one file that make it a possible data dump. */
export const DUMP_THRESHOLD = 20;

/** Whether a gitleaks rule is one of Porchlight's private-data rules rather than a secret's. */
export function isPrivateRule(ruleId: unknown): boolean {
	return typeof ruleId === "string" && ruleId.startsWith("private-");
}

/** What each rule finds, in words for one match and for several, and how serious one is before triage. */
interface Kind {
	severity: Severity;
	one: string;
	many: string;
	/** A value published for examples or testing: always ranked low, and never counted towards a dump. */
	example?: boolean;
	/** Contact details: counted towards a data dump, and lowered in project metadata. */
	contact?: boolean;
}

const KINDS: Record<string, Kind> = {
	"private-email": { severity: "low", one: "An email address", many: "email addresses", contact: true },
	"private-email-example": { severity: "low", one: "An example email address", many: "example email addresses", example: true },
	"private-phone": { severity: "low", one: "A phone number", many: "phone numbers", contact: true },
	"private-phone-example": { severity: "low", one: "An example phone number", many: "example phone numbers", example: true },
	"private-us-ssn": { severity: "high", one: "A US Social Security number", many: "US Social Security numbers" },
	"private-us-ssn-example": { severity: "low", one: "An example US Social Security number", many: "example US Social Security numbers", example: true },
	// Without a checksum (gitleaks never hands over the value) a card-shaped number is less certain than an IBAN.
	"private-payment-card": { severity: "medium", one: "A payment card number", many: "payment card numbers" },
	"private-payment-card-test": { severity: "low", one: "A test payment card number", many: "test payment card numbers", example: true },
	"private-iban": { severity: "high", one: "An IBAN bank account number", many: "IBAN bank account numbers" },
	"private-iban-example": { severity: "low", one: "An example IBAN bank account number", many: "example IBAN bank account numbers", example: true },
	"private-gps": { severity: "medium", one: "GPS coordinates precise enough to find a building", many: "sets of GPS coordinates precise enough to find a building" },
	"private-ip": { severity: "low", one: "A private network address", many: "private network addresses" },
	"private-tailnet-ip": { severity: "low", one: "A Tailscale or carrier-grade NAT address", many: "Tailscale or carrier-grade NAT addresses" },
	"private-tailnet-name": { severity: "medium", one: "A Tailscale machine name, which names the tailnet", many: "Tailscale machine names, which name the tailnet" },
	"private-internal-name": { severity: "low", one: "An internal host name", many: "internal host names" },
};

/** Where a match was found: the place words a finding's detail uses, for secrets and private data alike. */
export const PLACES = {
	files: "current files",
	changed: "current files, changed since the last commit",
	local: "on this computer only, not in git",
	uncommitted: "on this computer only, an uncommitted change",
} as const;

/** One gitleaks match, as much of it as Porchlight keeps: never the value. */
export interface Match {
	ruleId: string;
	file: string;
	line?: number;
	column?: number;
	commit?: string;
	date?: string;
	source: SecretSource;
	changed?: boolean;
}

/** The detail a finding gives for where it was found: a commit, or the files as they are now, or this computer. */
export function placeOf(match: Pick<Match, "source" | "changed" | "commit" | "date">): string {
	if (match.source === "history") {
		if (!match.commit) return "working tree";
		return `commit ${match.commit.slice(0, 8)}${match.date ? ` on ${dayOf(match.date)}` : ""}`;
	}
	if (match.source === "local") return match.changed ? PLACES.uncommitted : PLACES.local;
	return match.changed ? PLACES.changed : PLACES.files;
}

/** The day of a commit in UTC, as gitleaks gives it, whichever form git printed it in. */
function dayOf(date: string): string {
	const time = Date.parse(date);
	return Number.isNaN(time) ? date.slice(0, 10) : new Date(time).toISOString().slice(0, 10);
}

/** Most exposed first: a commit can have been copied anywhere; this computer's files have not left it. */
const EXPOSURE: Record<SecretSource, number> = { history: 0, files: 1, local: 2 };

/**
 * The private-data findings among gitleaks' matches: one per rule and file, with how many different
 * values it holds, placed where it is most exposed (the oldest commit that has it, if any). A file
 * with DUMP_THRESHOLD or more contact details becomes one "possible data dump" finding instead.
 */
export function privateFindings(matches: Match[]): Finding[] {
	const groups = new Map<string, Match[]>();
	for (const match of matches) {
		if (!KINDS[match.ruleId] || match.file === "") continue;
		const key = `${match.ruleId}\n${match.file}`;
		groups.set(key, [...(groups.get(key) ?? []), match]);
	}

	const findings: Finding[] = [];
	const contacts = new Map<string, { matches: Match[]; counts: Map<string, number> }>();
	for (const group of groups.values()) {
		const first = group[0]!;
		const kind = KINDS[first.ruleId]!;
		const count = distinctValues(group);
		if (kind.contact) {
			const entry: { matches: Match[]; counts: Map<string, number> } = contacts.get(first.file) ?? { matches: [], counts: new Map() };
			entry.matches.push(...group);
			entry.counts.set(first.ruleId, count);
			contacts.set(first.file, entry);
			continue;
		}
		findings.push(finding(first.ruleId, count === 1 ? kind.one : `${count} ${kind.many}`, group, count));
	}
	for (const { matches: group, counts } of contacts.values()) {
		const total = [...counts.values()].reduce((sum, count) => sum + count, 0);
		if (total >= DUMP_THRESHOLD) {
			const parts = [...counts].map(([ruleId, count]) => `${count} ${KINDS[ruleId]!.many}`);
			findings.push(finding("private-data-dump", `Possible data dump: ${parts.join(" and ")} in one file`, group, total));
			continue;
		}
		for (const [ruleId, count] of counts) {
			const kind = KINDS[ruleId]!;
			findings.push(finding(ruleId, count === 1 ? kind.one : `${count} ${kind.many}`, group.filter((match) => match.ruleId === ruleId), count));
		}
	}
	return findings;
}

/**
 * How many values of one rule a file holds: the most places matched in any one commit (or in the
 * files as they are now), by line and column. Counting across commits would count a value again
 * each time an edit moved its line.
 */
function distinctValues(matches: Match[]): number {
	const places = new Map<string, Set<string>>();
	for (const match of matches) {
		const snapshot = match.commit ?? match.source;
		places.set(snapshot, (places.get(snapshot) ?? new Set()).add(`${match.line ?? ""}:${match.column ?? ""}`));
	}
	return Math.max(1, ...[...places.values()].map((set) => set.size));
}

/** A finding for a group of matches in one file, placed where the group is most exposed. */
function finding(ruleId: string, title: string, group: Match[], count: number): Finding {
	const exposure = Math.min(...group.map((match) => EXPOSURE[match.source]));
	const placed = group
		.filter((match) => EXPOSURE[match.source] === exposure)
		.sort((a, b) => (Date.parse(a.date ?? "") || 0) - (Date.parse(b.date ?? "") || 0) || (a.line ?? 0) - (b.line ?? 0))[0]!;
	return {
		tool: "gitleaks",
		kind: "private-data",
		ruleId,
		title,
		location: placed.line ? `${placed.file}:${placed.line}` : placed.file,
		detail: placeOf(placed),
		source: placed.source,
		count,
		...triagePrivate(ruleId === "private-data-dump" ? "high" : KINDS[ruleId]!.severity, placed.file, {
			example: KINDS[ruleId]?.example === true,
			contact: KINDS[ruleId]?.contact === true,
			local: placed.source === "local",
		}),
	};
}

/** A file a repository has, by name: in history (added in that commit) or among the files as they are now. */
export interface NamedFile {
	path: string;
	source: SecretSource;
	commit?: string;
	date?: string;
}

/** Files whose type holds people's data in bulk, by extension, with the words and severity for one. */
const DUMP_TYPES: Record<string, { what: string; severity: Severity }> = {
	har: { what: "An HTTP archive, which holds cookies and tokens", severity: "high" },
	pst: { what: "An Outlook mailbox", severity: "high" },
	ost: { what: "An Outlook mailbox", severity: "high" },
	mbox: { what: "A mailbox", severity: "high" },
	vcf: { what: "A contacts file", severity: "high" },
	eml: { what: "An email message", severity: "medium" },
	sqlite: { what: "A database file", severity: "medium" },
	sqlite3: { what: "A database file", severity: "medium" },
	db: { what: "A database file", severity: "medium" },
	mdb: { what: "A database file", severity: "medium" },
	accdb: { what: "A database file", severity: "medium" },
};

/** Types a scanned or photographed personal document comes as. A CV is looked for only among documents. */
const DOCUMENT_TYPES = new Set(["pdf", "doc", "docx", "odt", "rtf", "pages"]);
const IMAGE_TYPES = new Set(["jpg", "jpeg", "png", "heic", "heif", "tif", "tiff", "webp"]);

/** Words in a file's name, one or two together, and the document they suggest. */
const DOCUMENT_NAMES: [string[], string, "any" | "document"][] = [
	[["passport"], "a passport", "any"],
	[["id", "card"], "an identity card", "any"],
	[["identity", "card"], "an identity card", "any"],
	[["national", "id"], "an identity card", "any"],
	[["driving", "licence"], "a driving licence", "any"],
	[["driving", "license"], "a driving licence", "any"],
	[["drivers", "license"], "a driving licence", "any"],
	[["driver", "license"], "a driving licence", "any"],
	[["ssn"], "a Social Security card", "any"],
	[["social", "security"], "a Social Security card", "any"],
	[["birth", "certificate"], "a birth certificate", "any"],
	[["residence", "permit"], "a residence permit", "any"],
	[["tax", "return"], "a tax document", "any"],
	[["w2"], "a tax document", "any"],
	[["1040"], "a tax document", "any"],
	[["p60"], "a tax document", "any"],
	[["payslip"], "a payslip", "any"],
	[["paystub"], "a payslip", "any"],
	[["pay", "slip"], "a payslip", "any"],
	[["pay", "stub"], "a payslip", "any"],
	[["salary", "slip"], "a payslip", "any"],
	[["bank", "statement"], "a bank statement", "any"],
	[["medical", "record"], "a medical record", "any"],
	[["medical", "records"], "a medical record", "any"],
	[["prescription"], "a medical record", "any"],
	[["cv"], "a CV", "document"],
	[["resume"], "a CV", "document"],
	[["curriculum", "vitae"], "a CV", "document"],
];

/**
 * What a file's name says it holds, or null. Whole words of the name are compared, never parts of
 * one, so `opencv-logo.png` is not a CV and `ssn-validator.ts` is not a document at all.
 */
export function nameKind(path: string): { ruleId: string; title: string; severity: Severity } | null {
	const name = path.split("/").at(-1)!.toLowerCase();
	const dot = name.lastIndexOf(".");
	const extension = dot > 0 ? name.slice(dot + 1) : "";
	const dump = DUMP_TYPES[extension];
	if (dump && name !== "thumbs.db") return { ruleId: "private-dump-file", title: `${dump.what}: a .${extension} file`, severity: dump.severity };
	const document = DOCUMENT_TYPES.has(extension);
	if (!document && !IMAGE_TYPES.has(extension)) return null;
	const words = name.slice(0, dot).split(/[^a-z0-9]+/).filter((word) => word !== "");
	for (const [wanted, what, types] of DOCUMENT_NAMES) {
		if (types === "document" && !document) continue;
		const found = words.some((_, start) => wanted.every((word, offset) => words[start + offset] === word));
		if (found) return { ruleId: "private-document", title: `A .${extension} file named like ${what}`, severity: "high" };
	}
	return null;
}

/** Findings for files that hold people's data by their type or name alone: one per path, where it is most exposed. */
export function namedFindings(files: NamedFile[]): Finding[] {
	const byPath = new Map<string, NamedFile>();
	for (const file of files) {
		const known = byPath.get(file.path);
		const older = (Date.parse(file.date ?? "") || 0) < (Date.parse(known?.date ?? "") || 0);
		if (!known || EXPOSURE[file.source] < EXPOSURE[known.source] || (file.source === known.source && older)) byPath.set(file.path, file);
	}
	const findings: Finding[] = [];
	for (const file of byPath.values()) {
		const kind = nameKind(file.path);
		if (!kind) continue;
		findings.push({
			tool: "gitleaks",
			kind: "private-data",
			ruleId: kind.ruleId,
			title: kind.title,
			location: file.path,
			detail: placeOf(file),
			source: file.source,
			...triagePrivate(kind.severity, file.path, { local: file.source === "local" }),
		});
	}
	return findings;
}

/** Photo types whose EXIF data can hold a GPS position. */
export const PHOTO_TYPES = new Set(["jpg", "jpeg", "heic", "heif", "tif", "tiff", "png", "webp", "dng"]);

/** A finding for a photo whose EXIF data holds a GPS position. */
export function photoFinding(file: NamedFile): Finding {
	return {
		tool: "gitleaks",
		kind: "private-data",
		ruleId: "private-photo-location",
		title: "A photo with a GPS position in its EXIF data",
		location: file.path,
		detail: placeOf(file),
		source: file.source,
		...triagePrivate("medium", file.path, { local: file.source === "local" }),
	};
}

/**
 * Whether a photo's EXIF data holds a GPS position: a latitude or longitude that is not zero. The
 * TIFF structure EXIF uses is read with every offset checked against the file's length, and the
 * position itself is never read out, only whether there is one.
 */
export function hasGpsPosition(content: Buffer): boolean {
	for (const start of tiffStarts(content)) {
		const found = gpsInTiff(content, start);
		if (found !== null) return found;
	}
	return false;
}

/** Where EXIF's TIFF data may begin: after "Exif\0\0" (JPEG, HEIC, WebP), in a PNG eXIf chunk, or at the start of a TIFF file. */
function tiffStarts(content: Buffer): number[] {
	const starts: number[] = [];
	const exif = content.indexOf(Buffer.from("Exif\0\0", "latin1"));
	if (exif >= 0) starts.push(exif + 6);
	const png = content.indexOf(Buffer.from("eXIf", "latin1"));
	if (png >= 0) starts.push(png + 4);
	starts.push(0);
	return starts;
}

/** true or false when a TIFF header is found at `start`; null when there is none. */
function gpsInTiff(content: Buffer, start: number): boolean | null {
	if (start + 8 > content.length) return null;
	const order = content.toString("latin1", start, start + 2);
	if (order !== "II" && order !== "MM") return null;
	const little = order === "II";
	const u16 = (at: number) => (at + 2 <= content.length ? (little ? content.readUInt16LE(at) : content.readUInt16BE(at)) : null);
	const u32 = (at: number) => (at + 4 <= content.length ? (little ? content.readUInt32LE(at) : content.readUInt32BE(at)) : null);
	if (u16(start + 2) !== 42) return null;
	/** The value of one tag in the directory at `offset` (relative to the TIFF start), as stored in its entry. */
	const entry = (offset: number, tag: number) => {
		const count = u16(start + offset);
		if (count === null || count > 1000) return null;
		for (let i = 0; i < count; i++) {
			const at = start + offset + 2 + i * 12;
			if (u16(at) === tag) return { type: u16(at + 2), count: u32(at + 4), value: u32(at + 8) };
		}
		return null;
	};
	const ifd0 = u32(start + 4);
	if (ifd0 === null) return false;
	const gps = entry(ifd0, 0x8825);
	if (!gps || gps.value === null) return false;
	/** Whether a latitude (2) or longitude (4) tag holds three rationals that are not all zero. */
	const nonZero = (tag: number) => {
		const found = entry(gps.value!, tag);
		if (!found || found.type !== 5 || found.count !== 3 || found.value === null) return false;
		for (let part = 0; part < 3; part++) {
			const numerator = u32(start + found.value + part * 8);
			if (numerator !== null && numerator !== 0) return true;
		}
		return false;
	};
	return nonZero(2) || nonZero(4);
}
