// M10: files Porchlight keeps hold up to concurrent saves, unreadable copies and files from other
// versions (docs/AUDIT-PLAN-2026-11-20.md: B20, B21, B25, B26, B27, B68).
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { scanNotice } from "../src/notify/scan.ts";
import { readPrivateJson, UnreadableFileError, updatePrivateJson, writePrivateJson } from "../src/private-files.ts";
import { carryNotes, History, readNotes, setNote } from "../src/repos/history.ts";
import type { Finding, ScanReport } from "../src/repos/types.ts";
import { findingKey } from "../ui/tracking.js";
import { tempDir } from "./helpers.ts";

function report(scannedAt: string, findings: Finding[], root = "/projects"): ScanReport {
	return {
		format: 2,
		root,
		scannedAt,
		tools: [
			{ tool: "gitleaks", status: "ok", installHint: "" },
			{ tool: "osv-scanner", status: "ok", installHint: "" },
		],
		repos: [{ path: `${root}/shop`, findings, errors: [] }],
	};
}

const secret = (detail: string, severity: Finding["severity"] = "high"): Finding => ({ tool: "gitleaks", kind: "secret", severity, ruleId: "aws-access-token", title: "AWS key", location: "app.env:1", detail });

test("a write never leaves half a file, and many at once leave one whole one (B21)", async () => {
	const dir = await tempDir();
	const path = join(dir, "settings.json");
	await Promise.all(Array.from({ length: 25 }, (_, n) => writePrivateJson(path, { n, padding: "x".repeat(n * 200) })));
	const read = await readPrivateJson(path);
	assert.equal(read.state, "read");
	assert.equal(((await stat(path)).mode & 0o777).toString(8), "600");
	assert.deepEqual((await readdir(dir)).filter((name) => name.endsWith(".tmp")), [], "no temporary file is left");
});

test("a kept file is missing, read, or could not be read: never the last taken for the first (B25)", async () => {
	const dir = await tempDir();
	assert.deepEqual(await readPrivateJson(join(dir, "none.json")), { state: "missing" });
	await writeFile(join(dir, "bad.json"), '{"keys": {"anthropic": "sk-');
	assert.equal((await readPrivateJson(join(dir, "bad.json"))).state, "unreadable");
	await mkdir(join(dir, "folder.json"));
	assert.equal((await readPrivateJson(join(dir, "folder.json"))).state, "unreadable");

	// An unreadable file is never written over: its keys may still be recovered by hand.
	await assert.rejects(
		updatePrivateJson(join(dir, "bad.json"), "Your settings", () => ({ keys: {} })),
		(err: unknown) => err instanceof UnreadableFileError && /could not be read.*nothing was changed/.test(err.message),
	);
	assert.equal(await readFile(join(dir, "bad.json"), "utf8"), '{"keys": {"anthropic": "sk-', "the file is as it was");
});

test("notes saved at once are all kept, and entries another version wrote survive a save (B21, B26)", async () => {
	const dir = await tempDir();
	const path = join(dir, "finding-notes.json");
	// An entry this version does not understand: a status a newer Porchlight added.
	await writeFile(path, `${JSON.stringify({ "shop\nx\ny\nz": { status: "snoozed", note: "later", updatedAt: "2026-11-20T00:00:00Z", by: "phone" } })}\n`);
	await Promise.all(Array.from({ length: 10 }, (_, n) => setNote(path, `shop\nrule\nfile-${n}.env:1\ncommit ${n}`, "rotated", `note ${n}`)));
	const notes = await readNotes(path);
	assert.equal(Object.keys(notes).length, 10, "all ten notes were kept");
	const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, { status: string; by?: string }>;
	assert.deepEqual(raw["shop\nx\ny\nz"], { status: "snoozed", note: "later", updatedAt: "2026-11-20T00:00:00Z", by: "phone" }, "the entry this version does not understand is kept as written");

	// A notes file that cannot be read is said, and never replaced by the next save.
	await writeFile(path, "{ not json");
	await assert.rejects(readNotes(path), UnreadableFileError);
	await assert.rejects(setNote(path, "shop\nrule\na\nb", "fixed", ""), UnreadableFileError);
	assert.equal(await readFile(path, "utf8"), "{ not json");
});

test("an index that cannot be read stops history: nothing kept is pruned, and nothing is called first or fixed (B25, B68)", async () => {
	const dir = await tempDir();
	const history = new History(dir);
	await history.add(report("2026-11-19T09:00:00.000Z", [secret("commit aaaaaaaa")]));
	await history.add(report("2026-11-20T09:00:00.000Z", []));
	const kept = (await readdir(join(dir, "history"))).sort();
	await writeFile(join(dir, "history", "index.json"), "[{ broken");

	await assert.rejects(history.add(report("2026-11-21T09:00:00.000Z", [])), UnreadableFileError);
	assert.deepEqual((await readdir(join(dir, "history"))).sort(), kept, "every kept scan is still there");
	const change = await history.compare(report("2026-11-21T09:00:00.000Z", []));
	assert.equal(change.state, "unreadable");

	// A notice about it says so, and stays urgent while a critical or high finding is open.
	const notice = scanNotice(report("2026-11-21T09:00:00.000Z", [secret("commit aaaaaaaa")]), null, change.state === "unreadable" ? change.reason : undefined);
	assert.equal(notice.urgent, true);
	assert.ok(notice.lines.some((line) => /could not be read, so nothing is marked new or fixed/.test(line)));
});

test("scans of different folders are never compared, so nothing in one counts as fixed in the other (B27)", async () => {
	const dir = await tempDir();
	const history = new History(dir);
	await history.add(report("2026-11-19T09:00:00.000Z", [secret("commit aaaaaaaa")], "/projects"));
	await history.add(report("2026-11-20T09:00:00.000Z", [], "/work"));
	assert.deepEqual(await history.compare(report("2026-11-20T09:00:00.000Z", [], "/work")), { state: "first" }, "the first scan of /work has nothing to be compared with");
	const back = await history.compare(report("2026-11-21T09:00:00.000Z", [], "/projects"));
	assert.equal(back.state, "compared");
	assert.equal(back.state === "compared" ? back.change.previousScannedAt : "", "2026-11-19T09:00:00.000Z", "a scan of /projects is compared with the last scan of /projects");
	const entries = await history.list();
	assert.equal(entries.at(-1)?.newCount, undefined, "no new or fixed count is given against another folder");
});

test("a note follows its secret when the finding names another commit of it, and never moves to another finding (B20)", async () => {
	const dir = await tempDir();
	const path = join(dir, "finding-notes.json");
	const before = secret("commit 7b8cd884 on 2026-11-17");
	await setNote(path, findingKey("shop", before), "rotated", "replaced on the 18th");
	// The same secret, now named by its oldest commit; and another secret's two findings at one place.
	const after = secret("commit 33333333 on 2026-11-16");
	const twin = { ...secret("commit 1111 on 2026-11-01"), location: "two.env:3" };
	const twinB = { ...twin, detail: "commit 2222 on 2026-11-02" };
	await setNote(path, findingKey("shop", { ...twin, detail: "commit 0000 on 2026-10-01" }), "accepted", "ambiguous");

	const moved = await carryNotes(path, report("2026-11-21T09:00:00.000Z", [after, twin, twinB]));
	assert.equal(moved, 1);
	const notes = await readNotes(path);
	assert.equal(notes[findingKey("shop", after)]?.note, "replaced on the 18th");
	assert.equal(notes[findingKey("shop", before)], undefined);
	assert.ok(notes[findingKey("shop", { ...twin, detail: "commit 0000 on 2026-10-01" })], "a note that could belong to either of two findings stays where it was");
});

test("kept scans are gzipped, and one kept as plain JSON before is still read (OP-9)", async () => {
	const dir = await tempDir();
	const history = new History(dir);
	const big = report("2026-11-20T09:00:00.000Z", Array.from({ length: 500 }, (_, n) => secret(`commit ${String(n).padStart(8, "0")}`)));
	const entry = await history.add(big);
	assert.match(entry.file, /\.json\.gz$/);
	const size = (await stat(join(dir, "history", entry.file))).size;
	assert.ok(size * 5 < JSON.stringify(big).length, `${size} bytes kept for ${JSON.stringify(big).length} of JSON`);
	assert.equal(((await stat(join(dir, "history", entry.file))).mode & 0o777).toString(8), "600");
	assert.deepEqual(await history.read(entry.file), big);

	// A scan kept as plain JSON by an earlier version: listed in the index, read as it is.
	const old = report("2026-11-19T09:00:00.000Z", []);
	await writeFile(join(dir, "history", "scan-20261119T090000000.json"), JSON.stringify(old));
	const index = JSON.parse(await readFile(join(dir, "history", "index.json"), "utf8")) as { file: string }[];
	await writeFile(join(dir, "history", "index.json"), JSON.stringify([{ file: "scan-20261119T090000000.json", scannedAt: old.scannedAt, root: "/projects", repositories: 1, findings: 0, counts: {} }, ...index]));
	assert.deepEqual(await history.read("scan-20261119T090000000.json"), old);
});
