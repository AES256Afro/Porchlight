// The report's response and the page's own files on the wire (M16: OP-5, OP-6, OP-7).
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { test, type TestContext } from "node:test";
import { gunzipSync } from "node:zlib";
import { saveAnalysis, unitKey, type Judgement } from "../src/analysis/analyse.ts";
import { repoName } from "../src/repos/report.ts";
import type { Finding } from "../src/repos/types.ts";
import { suggestionsFor } from "../src/roadmap/repos.ts";
import { acceptsGzip, etagMatches, startUiServer, type UiServer } from "../src/ui/server.ts";
import { findingKey } from "../ui/tracking.js";
import { bigReport } from "./big-report.ts";
import { tempDir } from "./helpers.ts";

async function start(t: TestContext, findings: number) {
	const dir = await tempDir();
	const reportPath = join(dir, "state", "repo-scan.json");
	await mkdir(join(dir, "state"), { recursive: true });
	const report = bigReport("/work", findings);
	await writeFile(reportPath, JSON.stringify(report));
	const server = await startUiServer({ port: 0, reportPath, defaultRoot: dir, monitor: null, monitorError: "Set PORCHLIGHT_MONITOR_URL" });
	t.after(() => server.close());
	return { server, report, dir };
}

interface Raw {
	status: number;
	headers: Record<string, string | string[] | undefined>;
	body: Buffer;
}

function get(server: UiServer, path: string, headers: Record<string, string> = {}, key = true): Promise<Raw> {
	return new Promise((resolve, reject) => {
		const req = request({ host: "127.0.0.1", port: server.port, method: "GET", path, headers: { ...(key ? { "x-porchlight-session": server.sessionKey } : {}), ...headers } }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
		});
		req.on("error", reject);
		req.end();
	});
}

function post(server: UiServer, path: string, body: unknown): Promise<Raw> {
	return new Promise((resolve, reject) => {
		const req = request({ host: "127.0.0.1", port: server.port, method: "POST", path, headers: { "x-porchlight-session": server.sessionKey, "content-type": "application/json" } }, (res) => {
			const chunks: Buffer[] = [];
			res.on("data", (chunk: Buffer) => chunks.push(chunk));
			res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
		});
		req.on("error", reject);
		req.end(JSON.stringify(body));
	});
}

const json = (raw: Raw) => JSON.parse((raw.headers["content-encoding"] === "gzip" ? gunzipSync(raw.body) : raw.body).toString("utf8"));

test("the report for 5,000 findings is under 300 KB gzipped, each repair sent once and named by every finding it repairs", async (t) => {
	const { server, report } = await start(t, 5000);

	const plain = await get(server, "/api/repos/report");
	const zipped = await get(server, "/api/repos/report", { "accept-encoding": "gzip, deflate, br" });

	assert.equal(plain.headers["content-encoding"], undefined, "nothing compressed for a client that did not ask");
	assert.equal(zipped.headers["content-encoding"], "gzip");
	assert.equal(zipped.headers["cache-control"], "no-store", "the report names secrets' files: never kept by the browser");
	assert.match(String(zipped.headers.vary), /accept-encoding/);
	assert.ok(zipped.body.length < 300 * 1024, `on the wire: ${zipped.body.length} bytes`);
	assert.deepEqual(gunzipSync(zipped.body), plain.body, "the same answer either way");

	const answer = json(plain);
	assert.ok(answer.suggestions.length < 5000 / 2, `${answer.suggestions.length} repairs for 5,000 findings`);
	// Every finding's repair is the one the whole report plans for it (invariant 12), however it is sent.
	const planned = suggestionsFor(report);
	const byKey = new Map<string, Finding>();
	for (const repo of report.repos) for (const finding of repo.findings) byKey.set(findingKey(repoName(report, repo), finding), finding);
	let checked = 0;
	for (const repo of answer.report.repos) {
		for (const finding of repo.findings) {
			const original = byKey.get(findingKey(repo.name, finding))!;
			assert.ok(original, "every finding is one of the report's");
			assert.equal("suggestion" in finding, false, "the repair is not repeated on the finding");
			assert.deepEqual(answer.suggestions[finding.fix], planned.get(original));
			checked++;
		}
	}
	assert.equal(checked, 5000, "no finding is left out");
});

test("the report's response is built again when the report, a judgement or a note changes, and not otherwise", async (t) => {
	const { server, report, dir } = await start(t, 300);
	const first = await get(server, "/api/repos/report");
	assert.deepEqual((await get(server, "/api/repos/report")).body, first.body);

	const repo = report.repos[0]!;
	const finding = repo.findings.find((each) => each.kind === "secret")!;
	const name = repoName(report, repo);
	assert.equal((await post(server, "/api/findings/note", { repo: name, ruleId: finding.ruleId, location: finding.location, detail: finding.detail, status: "rotated", note: "" })).status, 200);
	assert.equal(json(await get(server, "/api/repos/report")).findingNotes[findingKey(name, finding)].status, "rotated");

	const judgement: Judgement = { verdict: "likely", reason: "Read by the start-up code.", steps: [], model: "test-model", at: "2026-11-20T10:00:00.000Z" };
	await saveAnalysis(join(dir, "state", "repo-analysis.json"), { scannedAt: report.scannedAt, items: { [unitKey(name, finding)]: judgement } });
	const judged = json(await get(server, "/api/repos/report")).report.repos.flatMap((each: { findings: Finding[] }) => each.findings).filter((each: { analysis?: Judgement }) => each.analysis);
	assert.deepEqual(judged.map((each: { analysis: Judgement }) => each.analysis), [judgement]);

	await writeFile(join(dir, "state", "repo-scan.json"), JSON.stringify(bigReport("/work", 10)));
	assert.equal(json(await get(server, "/api/repos/report")).report.repos[0].findings.length, 10);
});

test("the deeper analysis's new judgements come on their own, keyed by the findings they judge (OP-6)", async (t) => {
	const { server, report, dir } = await start(t, 200);
	assert.deepEqual(json(await get(server, "/api/analysis/judgements")), { scannedAt: report.scannedAt, judgements: [] });

	const repo = report.repos[1]!;
	const name = repoName(report, repo);
	const pkg = repo.findings.find((each) => each.kind === "vulnerability")!;
	const secret = repo.findings.find((each) => each.kind === "secret")!;
	const early: Judgement = { verdict: "unlikely", reason: "Only a test imports it.", steps: [], model: "test-model", at: "2026-11-20T10:00:00.000Z" };
	const late: Judgement = { verdict: "confirmed", reason: "A real key shape.", steps: [], model: "test-model", at: "2026-11-20T10:05:00.000Z" };
	await saveAnalysis(join(dir, "state", "repo-analysis.json"), { scannedAt: report.scannedAt, items: { [unitKey(name, pkg)]: early, [unitKey(name, secret)]: late } });

	const all = json(await get(server, "/api/analysis/judgements"));
	// A package's advisories are judged together, so the judgement reaches each of them.
	const sameUnit = repo.findings.filter((each) => unitKey(name, each) === unitKey(name, pkg));
	assert.ok(sameUnit.length > 1);
	assert.deepEqual(new Set(all.judgements.map((each: { key: string }) => each.key)), new Set([...sameUnit, secret].map((each) => findingKey(name, each))));

	const since = json(await get(server, `/api/analysis/judgements?since=${encodeURIComponent(late.at)}`));
	assert.deepEqual(since.judgements, [{ key: findingKey(name, secret), analysis: late }]);
});

test("the page's own files are sent with a validator and gzipped, and not again while unchanged (OP-7)", async (t) => {
	const { server } = await start(t, 1);
	const first = await get(server, "/store.js", { "accept-encoding": "gzip" }, false);
	assert.equal(first.status, 200);
	assert.equal(first.headers["cache-control"], "no-cache");
	assert.equal(first.headers["content-encoding"], "gzip");
	assert.match(String(first.headers["content-security-policy"]), /default-src 'none'/, "the security headers stay");
	const etag = String(first.headers.etag);
	assert.match(etag, /^"[\w-]+"$/);
	assert.match(gunzipSync(first.body).toString("utf8"), /export const store/);

	const again = await get(server, "/store.js", { "if-none-match": etag }, false);
	assert.equal(again.status, 304);
	assert.equal(again.body.length, 0);
	assert.equal((await get(server, "/store.js", { "if-none-match": '"other"' }, false)).status, 200);
	assert.equal((await get(server, "/store.js", {}, false)).headers["content-encoding"], undefined);
});

test("reads Accept-Encoding and If-None-Match as browsers write them", () => {
	assert.equal(acceptsGzip("gzip, deflate, br, zstd"), true);
	assert.equal(acceptsGzip("br;q=1.0, gzip;q=0.8"), true);
	assert.equal(acceptsGzip("gzip;q=0"), false);
	assert.equal(acceptsGzip("*"), true);
	assert.equal(acceptsGzip("*, gzip;q=0"), false);
	assert.equal(acceptsGzip("identity"), false);
	assert.equal(acceptsGzip(undefined), false);
	assert.equal(etagMatches('"a", W/"b"', '"b"'), true);
	assert.equal(etagMatches("*", '"b"'), true);
	assert.equal(etagMatches('"c"', '"b"'), false);
	assert.equal(etagMatches(undefined, '"b"'), false);
});
