// OSV's offline databases are brought up to date once a day, by one run at a time (M16: OP-4, R6O-3).
import assert from "node:assert/strict";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import type { Runner } from "../src/repos/exec.ts";
import { OSV_DATABASE_FRESH_MS, osvDatabaseRefreshedAt, scanDependencies } from "../src/repos/osv.ts";
import { tempDir } from "./helpers.ts";

const NOW = new Date("2026-11-21T09:00:00Z");

/** osv-scanner that takes a while to download, and counts how many downloads ran at once. */
function slowOsv(failOfflineFor: Set<string> = new Set()) {
	const runs: { repo: string; download: boolean }[] = [];
	let downloading = 0;
	let mostAtOnce = 0;
	const run: Runner = async (command, args) => {
		if (command === "git") return { code: 0, stdout: "", stderr: "" };
		const download = args.includes("--download-offline-databases");
		const repo = args.at(-1)!;
		runs.push({ repo, download });
		if (download) {
			downloading++;
			mostAtOnce = Math.max(mostAtOnce, downloading);
			await sleep(20);
			downloading--;
		}
		// No offline copy of an ecosystem this repository needs: osv-scanner fails.
		if (!download && failOfflineFor.has(repo)) return { code: 127, stdout: "", stderr: "no offline version of the OSV database is available" };
		return { code: 128, stdout: "", stderr: "No package sources found" };
	};
	return { run, runs, mostAtOnce: () => mostAtOnce };
}

async function repos(count: number): Promise<string[]> {
	const root = await tempDir();
	const paths = Array.from({ length: count }, (_, i) => join(root, `repo-${i}`));
	for (const path of paths) await mkdir(path);
	return paths;
}

test("a database folder never brought up to date is downloaded by one run while the rest wait, then compared side by side", async () => {
	const database = join(await tempDir(), "osv-db");
	const paths = await repos(8);
	const osv = slowOsv();

	await Promise.all(paths.map((repo) => scanDependencies(repo, osv.run, { database, now: () => NOW })));

	assert.equal(osv.runs.filter((each) => each.download).length, 1, "one download for eight repositories");
	assert.equal(osv.mostAtOnce(), 1);
	assert.equal(osv.runs.length, 8);
	assert.deepEqual(await osvDatabaseRefreshedAt(database), NOW);
	assert.equal((await stat(join(database, "porchlight-refreshed.json"))).mode & 0o777, 0o600);
});

test("databases brought up to date less than a day ago are not downloaded again; a day later they are, once", async () => {
	const database = join(await tempDir(), "osv-db");
	await mkdir(database);
	await writeFile(join(database, "porchlight-refreshed.json"), JSON.stringify({ refreshedAt: NOW.toISOString() }));
	const paths = await repos(3);

	const fresh = slowOsv();
	const hourLater = new Date(NOW.getTime() + 60 * 60 * 1000);
	await Promise.all(paths.map((repo) => scanDependencies(repo, fresh.run, { database, now: () => hourLater })));
	assert.equal(fresh.runs.filter((each) => each.download).length, 0, "a scheduled scan an hour later downloads nothing");

	const stale = slowOsv();
	const dayLater = new Date(NOW.getTime() + OSV_DATABASE_FRESH_MS);
	await Promise.all(paths.map((repo) => scanDependencies(repo, stale.run, { database, now: () => dayLater })));
	assert.equal(stale.runs.filter((each) => each.download).length, 1);
	assert.deepEqual(await osvDatabaseRefreshedAt(database), dayLater);

	// A note dated in the future (a clock put back) is not trusted.
	const before = slowOsv();
	await scanDependencies(paths[0]!, before.run, { database, now: () => NOW });
	assert.equal(before.runs.filter((each) => each.download).length, 1);
});

test("a repository needing an ecosystem the folder lacks is run again, downloading, one at a time", async () => {
	const database = join(await tempDir(), "osv-db");
	await mkdir(database);
	await writeFile(join(database, "porchlight-refreshed.json"), JSON.stringify({ refreshedAt: NOW.toISOString() }));
	const paths = await repos(4);
	const osv = slowOsv(new Set([paths[1]!, paths[3]!]));

	const results = await Promise.all(paths.map((repo) => scanDependencies(repo, osv.run, { database, now: () => NOW })));

	assert.deepEqual(osv.runs.filter((each) => each.download).map((each) => each.repo).sort(), [paths[1], paths[3]].sort());
	assert.equal(osv.mostAtOnce(), 1);
	assert.ok(results.every((result) => result.findings.length === 0));
});

test("a download that fails is a failed scan of that repository, and leaves the folder still to bring up to date", async () => {
	const database = join(await tempDir(), "osv-db");
	const [repo] = await repos(1);
	const run: Runner = async (command) => (command === "git" ? { code: 0, stdout: "", stderr: "" } : { code: 127, stdout: "{}", stderr: "could not reach the database" });
	await assert.rejects(scanDependencies(repo!, run, { database, now: () => NOW }), /could not reach the database/);
	assert.equal(await osvDatabaseRefreshedAt(database), null);
});
