import assert from "node:assert/strict";
import { lstat, mkdir, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import {
	appendLog,
	checkFolder,
	cleanName,
	fileName,
	isOwnName,
	PARTS,
	prepareProject,
	ProjectError,
	ProjectStore,
	rewriteFile,
	saveFile,
	type Project,
} from "../src/projects/projects.ts";
import { makeTree, tempDir } from "./helpers.ts";

const at = new Date(2026, 10, 19, 15, 30, 7);

async function project(folder: string, name = "acme-audit"): Promise<Project> {
	const made: Project = { id: "prj_0123456789abcdef", name, folder, createdAt: at.toISOString() };
	await prepareProject(made);
	return made;
}

test("files are named from Porchlight's own list with the date and time, never from scan data", () => {
	assert.equal(fileName("roadmap", "md", at), "2026-11-19 15.30 Repair roadmap.md");
	assert.equal(fileName("findings-partial", "csv", at, 2), "2026-11-19 15.30 Findings (partial) 2.csv");
	assert.equal(fileName("discussion-finding", "md", at), "2026-11-19 15.30 Explain a finding.md");
	assert.throws(() => fileName("roadmap", "exe", at));
	// Only those names can be written over again.
	assert.ok(isOwnName("2026-11-19 15.30 Repair roadmap.md"));
	assert.ok(isOwnName("2026-11-19 15.30 Question about the scan 12.md"));
	for (const name of ["../2026-11-19 15.30 Repair roadmap.md", "2026-11-19 15.30 Anything.md", "2026-11-19 15.30 Repair roadmap.md/x", "x.md", ".bashrc"]) {
		assert.ok(!isOwnName(name), name);
	}
	assert.equal(cleanName("  acme\naudit\u0007 "), "acme audit");
	assert.equal(cleanName(""), null);
	assert.equal(cleanName("x".repeat(61)), null);
});

test("checking a folder says what would be made and why to think again, and makes nothing", async () => {
	const home = await tempDir();
	await makeTree(home, { "Projects/": "", "code/app/.git/": "", "code/app/docs/": "", "notes.txt": "x" });

	const fresh = await checkFolder("~/Projects/acme-audit", { home });
	assert.equal(fresh.error, undefined);
	const folder = join(home, "Projects", "acme-audit");
	assert.equal(fresh.folder.endsWith(join("Projects", "acme-audit")), true);
	assert.deepEqual(
		fresh.creates.map((path) => path.slice(fresh.folder.length)),
		["", "/Porchlight", "/Porchlight/Exports", "/Porchlight/Discussions", "/Porchlight/Log"],
	);
	assert.deepEqual(fresh.warnings, []);
	assert.equal(await stat(folder).catch(() => null), null, "a check makes nothing");

	// Inside a repository, or a folder Porchlight scans: said, not refused.
	const inRepo = await checkFolder(join(home, "code", "app", "docs"), { home, scanRoots: [join(home, "code")] });
	assert.equal(inRepo.error, undefined);
	assert.equal(inRepo.warnings.length, 2);
	assert.match(inRepo.warnings[0]!, /inside a git repository .*add Porchlight\/ to its \.gitignore/);
	assert.match(inRepo.warnings[1]!, /which Porchlight scans/);

	for (const [input, message] of [
		["", /Type the folder/],
		["Projects/acme", /whole path/],
		["~", /not the whole disk or your home folder/],
		["/", /not the whole disk/],
		["~/notes.txt", /a file, not a folder/],
		["~/missing/deeper/acme", /does not exist/],
		["~/Projects/a\u0000b", /not a folder Porchlight can use/],
		[["~/Projects"], /Type the folder/],
	] as const) {
		const check = await checkFolder(input, { home });
		assert.match(check.error ?? "", message, String(input));
		assert.deepEqual(check.creates, []);
	}

	// A link where Porchlight's own folder would be is refused: it writes only into folders of its own.
	await makeTree(home, { "linked/": "", "elsewhere/": "" });
	await symlink(join(home, "elsewhere"), join(home, "linked", "Porchlight"));
	assert.match((await checkFolder("~/linked", { home })).error ?? "", /is a link/);

	// A service keeps its project folders inside its data folder.
	assert.match((await checkFolder("~/Projects/acme", { home, within: join(home, "code") })).error ?? "", /Choose one inside/);
	assert.match((await checkFolder("~/code", { home, within: join(home, "code") })).error ?? "", /Choose one inside/, "inside it, not the folder itself");
	assert.match((await checkFolder("~/notes.txt", { home, within: join(home, "code") })).error ?? "", /Choose one inside/, "said before anything outside is looked at");
	assert.equal((await checkFolder("~/code/projects-x", { home, within: join(home, "code") })).error, undefined);
});

test("saved files are new files, readable only by the owner, inside Porchlight's own folder", async () => {
	const base = await tempDir();
	const acme = await project(join(base, "acme"));
	for (const part of PARTS) assert.equal((await stat(join(base, "acme", "Porchlight", part))).mode & 0o777, 0o700, part);

	const first = await saveFile(acme, "Exports", "roadmap", "md", "# One\n", at);
	const second = await saveFile(acme, "Exports", "roadmap", "md", "# Two\n", at);
	assert.deepEqual([first.name, second.name], ["2026-11-19 15.30 Repair roadmap.md", "2026-11-19 15.30 Repair roadmap 2.md"]);
	assert.equal(first.path, join(base, "acme", "Porchlight", "Exports", first.name));
	assert.equal(await readFile(first.path, "utf8"), "# One\n", "the first is never written over");
	assert.equal((await stat(second.path)).mode & 0o777, 0o600);

	// A file of the owner's in the way is left alone; Porchlight takes the next name.
	await writeFile(join(base, "acme", "Porchlight", "Exports", "2026-11-19 15.30 Findings.csv"), "mine");
	assert.equal((await saveFile(acme, "Exports", "findings", "csv", "a,b\n", at)).name, "2026-11-19 15.30 Findings 2.csv");
	assert.equal(await readFile(join(base, "acme", "Porchlight", "Exports", "2026-11-19 15.30 Findings.csv"), "utf8"), "mine");

	// A transcript is written again in place, through a new file: a link planted at its name is replaced, not followed.
	const kept = await saveFile(acme, "Discussions", "discussion-ask", "md", "first\n", at);
	await rewriteFile(acme, "Discussions", kept.name, "second\n");
	assert.equal(await readFile(kept.path, "utf8"), "second\n");
	const outside = join(base, "outside.txt");
	await writeFile(outside, "untouched");
	await rm(kept.path);
	await symlink(outside, kept.path);
	await rewriteFile(acme, "Discussions", kept.name, "third\n");
	assert.equal(await readFile(outside, "utf8"), "untouched");
	assert.ok((await lstat(kept.path)).isFile());
	await assert.rejects(rewriteFile(acme, "Discussions", "../outside.txt", "x"), ProjectError);
	assert.deepEqual((await readdir(join(base, "acme", "Porchlight", "Discussions"))).filter((name) => name.endsWith(".tmp")), []);

	// A link where one of Porchlight's folders should be: nothing is written through it.
	await rm(join(base, "acme", "Porchlight", "Log"), { recursive: true });
	await mkdir(join(base, "target"));
	await symlink(join(base, "target"), join(base, "acme", "Porchlight", "Log"));
	await assert.rejects(appendLog(acme, "Scan started"), /is a link/);
	assert.deepEqual(await readdir(join(base, "target")), []);

	// A folder the owner moved or deleted is not made again behind their back.
	const gone = await project(join(base, "gone"));
	await rm(join(base, "gone"), { recursive: true });
	await assert.rejects(saveFile(gone, "Exports", "roadmap", "md", "x", at), /is not there any more/);
	assert.equal(await stat(join(base, "gone")).catch(() => null), null);
});

test("the log is one line per event, and nothing in an event can add a line", async () => {
	const base = await tempDir();
	const acme = await project(join(base, "acme"));
	await appendLog(acme, "Scan started: /work, 3 levels down", at);
	await appendLog(acme, "Scan failed: bad\n15:31:00  Exported everything\u001b[2J", new Date(2026, 10, 19, 15, 31, 0));
	const path = join(base, "acme", "Porchlight", "Log", "2026-11-19.log");
	assert.equal(await readFile(path, "utf8"), "15:30:07  Scan started: /work, 3 levels down\n15:31:00  Scan failed: bad 15:31:00 Exported everything [2J\n");
	assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test("the list of projects is kept readable only by the owner, and removing one leaves its files", async () => {
	const base = await tempDir();
	const store = new ProjectStore(join(base, "state", "projects.json"));
	assert.deepEqual(await store.read(), { version: 1, current: null, projects: [] });

	const acme = await store.add("acme-audit", join(base, "acme"));
	assert.match(acme.id, /^prj_[0-9a-f]{16}$/);
	assert.equal((await store.current())?.id, acme.id, "a new project is the one in use");
	await assert.rejects(store.add("ACME-audit", join(base, "other")), /already a project called/);
	const other = await store.add("other", join(base, "other"));
	assert.equal((await store.current())?.id, other.id);
	await store.use(acme.id);
	assert.equal((await store.current())?.id, acme.id);
	await assert.rejects(store.use("prj_0000000000000000"), /no such project/);
	assert.equal((await stat(store.path)).mode & 0o777, 0o600);

	await prepareProject(acme);
	await saveFile(acme, "Exports", "roadmap", "md", "x", at);
	await store.remove(acme.id);
	assert.equal(await store.current(), null);
	assert.deepEqual((await store.read()).projects.map((one) => one.name), ["other"]);
	assert.equal((await readdir(join(base, "acme", "Porchlight", "Exports"))).length, 1, "its files stay");

	// A list edited by hand keeps only well-formed projects.
	await writeFile(
		store.path,
		JSON.stringify({
			current: "prj_aaaaaaaaaaaaaaaa",
			projects: [
				{ id: "prj_aaaaaaaaaaaaaaaa", name: "ok", folder: "/work/ok", createdAt: "2026-11-19T00:00:00Z" },
				{ id: "../x", name: "bad id", folder: "/work/x", createdAt: "2026-11-19T00:00:00Z" },
				{ id: "prj_bbbbbbbbbbbbbbbb", name: "relative", folder: "work/x", createdAt: "2026-11-19T00:00:00Z" },
			],
		}),
	);
	const read = await store.read();
	assert.deepEqual([read.current, read.projects.map((one) => one.name)], ["prj_aaaaaaaaaaaaaaaa", ["ok"]]);
});
