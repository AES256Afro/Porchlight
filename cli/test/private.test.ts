import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { hasGpsPosition, isPrivateRule, nameKind, namedFindings, privateFindings, type Match } from "../src/repos/private.ts";
import { gitleaksConfig } from "../src/repos/rules.ts";
import { triagePrivate } from "../src/repos/triage.ts";
import { installed, photoWithGps, tempDir } from "./helpers.ts";

const exec = promisify(execFile);
/** Made-up values, assembled at run time so this repository's own scan has nothing to find. */
const j = (...parts: string[]) => parts.join("");

test("reads whether a photo's EXIF data holds a GPS position, and nothing else", () => {
	assert.equal(hasGpsPosition(photoWithGps([51, 30, 2645], [0, 7, 3982])), true);
	assert.equal(hasGpsPosition(photoWithGps([51, 30, 2645], [0, 7, 3982], true)), true, "big-endian TIFF");
	assert.equal(hasGpsPosition(photoWithGps([0, 0, 0], [0, 0, 0])), false, "a GPS block of zeros is no position");
	// A TIFF file, and PNG's eXIf chunk, hold the same structure without JPEG's wrapper.
	const tiff = photoWithGps([48, 51, 0], [2, 21, 0]).subarray(12, 12 + 104);
	assert.equal(hasGpsPosition(tiff), true);
	assert.equal(hasGpsPosition(Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n\0\0\0\x68eXIf", "latin1"), tiff])), true);
	// Truncated, corrupt or hostile data is read with every offset checked, and never throws.
	const whole = photoWithGps([51, 30, 2645], [0, 7, 3982]);
	for (let cut = 0; cut < whole.length; cut += 7) assert.doesNotThrow(() => hasGpsPosition(whole.subarray(0, cut)));
	const pointsAway = Buffer.from(whole);
	// The GPS directory's place, 18 bytes into the TIFF data, which starts 12 bytes into the JPEG.
	pointsAway.writeUInt32LE(0xfffffff0, 12 + 18);
	assert.equal(hasGpsPosition(pointsAway), false);
	assert.equal(hasGpsPosition(Buffer.from("not a photo at all")), false);
});

test("names a personal document or a data dump by whole words of its name and its type", () => {
	const kinds = (paths: string[]) => paths.map((path) => nameKind(path)?.title ?? null);
	assert.deepEqual(kinds(["scans/Passport Scan.JPG", "my-resume.pdf", "w2_2025.pdf", "bank-statement-march.pdf", "id_card.png"]), [
		"A .jpg file named like a passport",
		"A .pdf file named like a CV",
		"A .pdf file named like a tax document",
		"A .pdf file named like a bank statement",
		"A .png file named like an identity card",
	]);
	assert.deepEqual(kinds(["capture.har", "backup/users.sqlite", "inbox.mbox", "contacts.vcf"]), [
		"An HTTP archive, which holds cookies and tokens: a .har file",
		"A database file: a .sqlite file",
		"A mailbox: a .mbox file",
		"A contacts file: a .vcf file",
	]);
	// Parts of words, code, and pictures a CV is unlikely to be are not documents.
	assert.deepEqual(kinds(["opencv-logo.png", "src/ssn-validator.ts", "icons/resume.png", "passports.md", "Thumbs.db", "LICENSE"]), [null, null, null, null, null, null]);
	assert.equal(nameKind("capture.har")?.severity, "high");
	assert.equal(nameKind("app.db")?.severity, "medium");
});

test("groups matches per rule and file, counts different values, and places each where it is most exposed", () => {
	const match = (ruleId: string, file: string, line: number, extra: Partial<Match> = {}): Match => ({ ruleId, file, line, column: 1, source: "history", commit: "c1", date: "2026-11-02T10:00:00Z", ...extra });
	const findings = privateFindings([
		// One card number, re-added by a later commit on another line: still one value in any one commit.
		match("private-payment-card", "pay.py", 4, { commit: "c2", date: "2026-11-05T10:00:00Z" }),
		match("private-payment-card", "pay.py", 3),
		// Two addresses on one line are two values.
		match("private-email", "team.txt", 1),
		match("private-email", "team.txt", 1, { column: 30 }),
		match("private-email-example", "tests/users.json", 2, { source: "files", commit: undefined, date: undefined }),
		match("private-iban", ".env", 1, { source: "local", commit: undefined, date: undefined }),
		match("unknown-rule", "x", 1),
	]);
	const shown = findings.map((finding) => [finding.ruleId, finding.title, finding.location, finding.detail, finding.severity, finding.count]);
	assert.deepEqual(shown, [
		["private-payment-card", "A payment card number", "pay.py:3", "commit c1 on 2026-11-02", "medium", 1],
		["private-email-example", "An example email address", "tests/users.json:2", "current files", "low", 1],
		["private-iban", "An IBAN bank account number", ".env:1", "on this computer only, not in git", "medium", 1],
		["private-email", "2 email addresses", "team.txt:1", "commit c1 on 2026-11-02", "low", 2],
	]);
	assert.ok(findings.every((finding) => finding.kind === "private-data" && finding.tool === "gitleaks"));
	assert.match(findings[2]!.note ?? "", /on this computer only, never committed/);
	assert.match(findings[1]!.note ?? "", /a value published for examples or testing; in a test path/);

	// The same file seen in history and as it is now is placed in history, where it has been copied.
	const both = privateFindings([match("private-us-ssn", "hr.csv", 2, { source: "files", commit: undefined, date: undefined }), match("private-us-ssn", "hr.csv", 2)]);
	assert.deepEqual([both.length, both[0]!.detail, both[0]!.severity], [1, "commit c1 on 2026-11-02", "high"]);
});

test("enough contact details in one file make it a possible data dump; examples never count towards one", () => {
	const contacts = (ruleId: string, n: number, file = "people.csv") => Array.from({ length: n }, (_, i): Match => ({ ruleId, file, line: i + 2, source: "history", commit: "c1", date: "2026-11-02T10:00:00Z" }));
	const dump = privateFindings([...contacts("private-email", 15), ...contacts("private-phone", 5)]);
	assert.deepEqual(
		dump.map((finding) => [finding.ruleId, finding.title, finding.severity, finding.count]),
		[["private-data-dump", "Possible data dump: 15 email addresses and 5 phone numbers in one file", "high", 20]],
	);
	// 19 is not a dump: each kind is listed as it is.
	assert.deepEqual(privateFindings(contacts("private-email", 19)).map((finding) => finding.title), ["19 email addresses"]);
	// 500 example addresses in a test fixture stay an example, ranked low.
	const fixture = privateFindings(contacts("private-email-example", 500, "tests/fixtures/users.json"));
	assert.deepEqual(fixture.map((finding) => [finding.ruleId, finding.severity]), [["private-email-example", "low"]]);
	// A dump in a test folder is still one, a step lower, with the reason.
	assert.deepEqual(privateFindings(contacts("private-email", 30, "tests/people.csv")).map((finding) => [finding.severity, finding.note]), [["medium", "Ranked lower: in a test path"]]);
});

test("ranks private data down for each reason to doubt it, and never drops it", () => {
	assert.deepEqual(triagePrivate("high", "exports/customers.csv", {}), { severity: "high" }, "a data file is where people's data is: not a reason");
	assert.deepEqual(triagePrivate("low", "package.json", { contact: true }), { severity: "low", note: "Ranked lower: in project metadata, where a maintainer's address is public by design" });
	assert.equal(triagePrivate("medium", "AUTHORS", { contact: true }).severity, "low");
	assert.equal(triagePrivate("medium", "AUTHORS", {}).severity, "medium", "metadata lowers contact details only");
	assert.equal(triagePrivate("high", "docs/passport.pdf", {}).severity, "medium");
	assert.equal(triagePrivate("high", "tests/fixtures/x.json", { example: true, local: true }).severity, "low");
});

test("a file found by name is placed at the oldest commit that added it", () => {
	const findings = namedFindings([
		{ path: "id/passport.pdf", source: "files" },
		{ path: "id/passport.pdf", source: "history", commit: "bbbbbbbb", date: "2026-11-05T00:00:00Z" },
		{ path: "id/passport.pdf", source: "history", commit: "aaaaaaaa", date: "2026-11-01T00:00:00Z" },
		{ path: "README.md", source: "files" },
	]);
	assert.deepEqual(findings.map((finding) => [finding.location, finding.detail, finding.severity]), [["id/passport.pdf", "commit aaaaaaaa on 2026-11-01", "high"]]);
});

test("the private-data rules match what they are for, and leave example values to their own rules", async (t) => {
	if (!(await installed("gitleaks"))) return t.skip("gitleaks is not installed");
	const dir = await tempDir();
	const lines: [string, string | null][] = [
		[`contact = "${j("jane.doe", "@", "gmail.com")}"`, "private-email"],
		[`user = "${j("alice", "@", "example.com")}"`, "private-email-example"],
		// REP-B12: an address on a real domain under an example-looking label is a real address.
		[`mail ${j("alice", "@", "test.acme-corp.io")}`, "private-email"],
		[`from ${j("noreply", "@", "github.com")} and ${j("git", "@", "github.com")}:me/repo.git`, null],
		[`icon${j("@", "2x.png")} lodash@4.17.21 @babel/core@7.0.0`, null],
		[`call ${j("+44 20 ", "8123 4567")}`, "private-phone"],
		[`call ${j("(212) 555-", "0142")}`, "private-phone-example"],
		// B32: international numbers written compact or in groups of their own country.
		[`call ${j("+1415", "5552671")}`, "private-phone"],
		[`fr ${j("+33 1 23 ", "45 67 89")}`, "private-phone"],
		[`call ${j("+1212", "5550142")}`, "private-phone-example"],
		["version 1.2.3, built 2026-11-20", null],
		[`ssn ${j("536-", "22-", "4471")}`, "private-us-ssn"],
		[`ssn ${j("078-05-", "1120")}`, "private-us-ssn-example"],
		[`card ${j("4539 1488 ", "0343 6467")}`, "private-payment-card"],
		[`card ${j("4242424242", "424242")} and ${j("4000000000", "000002")}`, "private-payment-card-test"],
		["id 45391488034364671234", null],
		[`iban ${j("DE44 5001 0517 ", "5407 3249 31")}`, "private-iban"],
		[`iban ${j("DE89370400", "440532013000")}`, "private-iban-example"],
		[`home: ${j("51.50735", ", -0.12776")}`, "private-gps"],
		["probabilities 0.12345, 0.98765", null],
		["weights [0.123456, 1.234567]", null],
		[`quito ${j("-0.180653", ", -78.467838")}`, "private-gps"],
		["hosts 192.168.1.20 and 8.8.8.8", "private-ip"],
		[`peer at ${j("box.tail1234", ".ts.net")}`, "private-tailnet-name"],
		[`db at ${j("db1.prod", ".internal")}:5432, not service-1.internal-cluster.example.test`, "private-internal-name"],
		["store = threading.local(); self.internal = True; this.local.value", null],
	];
	await writeFile(join(dir, "sample.txt"), `${lines.map(([line]) => line).join("\n")}\n`);
	const { stdout } = await exec("gitleaks", ["dir", "--config", gitleaksConfig({ privateData: true }), "--report-format", "json", "--report-path", "-", "--redact", "--no-banner", "--no-color", "--log-level", "error", "--exit-code", "0", "."], { cwd: dir });
	const rows = JSON.parse(stdout) as { RuleID: string; StartLine: number; Secret: string; Match: string }[];
	const found = lines.map((_, index) => [...new Set(rows.filter((row) => row.StartLine === index + 1 && isPrivateRule(row.RuleID)).map((row) => row.RuleID))]);
	assert.deepEqual(
		found,
		lines.map(([, rule]) => (rule ? [rule] : [])),
	);
	for (const row of rows) assert.ok(!row.Secret.match(/\d{4}|@/), "gitleaks hands over no value");
});

test("a file name holding a control character or a space never forges a commit in the list of added files (S42)", async () => {
	const { parseAdded } = await import("../src/repos/gitleaks.ts");
	const [one, two, blob] = ["a".repeat(40), "b".repeat(40), "c".repeat(40)];
	const forged = `x\x01${"d".repeat(40)} 2026-01-01T00:00:00Z`;
	const out = [
		`\x01${one} 2026-11-20T10:00:00+00:00`,
		`\n:000000 100644 ${"0".repeat(40)} ${blob} A`,
		"two.txt",
		`\x01${two} 2026-11-19T10:00:00+00:00`,
		`\n:000000 100644 ${"0".repeat(40)} ${blob} A`,
		forged,
		`:000000 160000 ${"0".repeat(40)} ${blob} A`,
		"modules/theme",
		"",
	].join("\0");
	const added = parseAdded(out);
	assert.deepEqual([...added.keys()].sort(), ["modules/theme", forged, "two.txt"].sort());
	assert.equal(added.get(forged)?.commit, two, "the oddly named file was added by the commit that added it");
	assert.equal(added.get("modules/theme")?.blob, "", "a submodule has no content to read");
	assert.equal(added.get("two.txt")?.commit, one);
});
