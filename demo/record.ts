// Records what Porchlight's own server answers for the demo data, for the demo Worker to serve.
// Run from the repository root: node demo/record.ts
//
// The server runs here, on this computer, against made-up data: a scan of eight repositories that
// exist only as empty folders in a temporary directory, the stand-in monitor in place of the
// network, and no model, token or project. Every local path in an answer is replaced with
// /home/demo/…, and the recording is refused if one is left.
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { monitorConfig } from "../cli/src/monitor/client.ts";
import { History } from "../cli/src/repos/history.ts";
import { startUiServer } from "../cli/src/ui/server.ts";
import { demoReport, earlierReport, REPOSITORIES } from "./make-demo-report.mjs";
import { resetStandIn, STAND_IN_TOKEN, standInFetch } from "./stand-in-monitor.mjs";

const DEMO_ROOT = "/home/demo/projects";
const DEMO_STATE = "/home/demo/.porchlight";
const DOMAINS = ["example.test", "shop-with-a-rather-long-name.example", "new.example"];

const work = await realpath(await mkdtemp(join(tmpdir(), "porchlight-demo-")));
const root = join(work, "projects");
const state = join(work, "state");
try {
	for (const name of REPOSITORIES) await mkdir(join(root, name, ".git"), { recursive: true });
	await mkdir(state, { recursive: true, mode: 0o700 });
	const report = demoReport(root);
	await writeFile(join(state, "repo-scan.json"), JSON.stringify(report));
	const history = new History(state);
	await history.add(earlierReport(root));
	await history.add(report);
	resetStandIn();

	const server = await startUiServer({
		port: 0,
		reportPath: join(state, "repo-scan.json"),
		defaultRoot: root,
		monitor: monitorConfig({
			PORCHLIGHT_MONITOR_URL: "https://monitor.demo.invalid",
			PORCHLIGHT_ADMIN_TOKEN: STAND_IN_TOKEN,
		}),
		assistant: null,
		assistantUnset: true,
		github: { dir: join(state, "github") },
		fetchFn: standInFetch as typeof fetch,
		tailnetAddress: () => null,
		accessPort: 0,
	});

	const get = (path: string) =>
		new Promise<{ status: number; type: string; disposition?: string; body: string }>(
			(resolve, reject) => {
				const req = request(
					{
						host: "127.0.0.1",
						port: server.port,
						path,
						headers: { "x-porchlight-session": server.sessionKey },
					},
					(res) => {
						let body = "";
						res.setEncoding("utf8");
						res.on("data", (chunk) => (body += chunk));
						res.on("end", () =>
							resolve({
								status: res.statusCode ?? 0,
								type: String(res.headers["content-type"] ?? ""),
								...(res.headers["content-disposition"]
									? { disposition: String(res.headers["content-disposition"]) }
									: {}),
								body,
							}),
						);
					},
				);
				req.on("error", reject);
				req.end();
			},
		);

	const paths = [
		"/api/state",
		"/api/repos/report",
		"/api/repos/history",
		"/api/repos/scan",
		`/api/repos/preview?root=${encodeURIComponent(root)}&depth=3`,
		"/api/busy",
		"/api/activity?after=0",
		"/api/analysis",
		"/api/model",
		"/api/model/local",
		"/api/github",
		"/api/access",
		"/api/cloudflare",
		"/api/cloudflare/token",
		"/api/investigate",
		"/api/discussions",
		"/api/host",
		// What the page has read since 0.10.0: due dates, first-seen dates, notes matching nothing, the
		// roadmap, connections, attention, the egress log, the OSV database and the model per task.
		"/api/attention",
		"/api/connections",
		"/api/egress",
		"/api/findings/due-policy",
		"/api/findings/orphans",
		"/api/findings/seen",
		"/api/model-tasks",
		"/api/repos/osv-database",
		"/api/repos/roadmap",
		// Since 0.11.0: the GitHub settings audit's state (none run in the demo).
		"/api/github/audit",
		"/api/domains",
		...DOMAINS.flatMap((domain) => [`/api/domains/${domain}`, `/api/domains/${domain}/history`]),
		...["roadmap", "findings"].flatMap((content) =>
			["md", "html", "csv", "json"].map(
				(format) => `/api/domains/example.test/export?content=${content}&format=${format}`,
			),
		),
	];
	const recorded: Record<
		string,
		{ status: number; type: string; disposition?: string; body: string }
	> = {};
	for (const path of paths)
		recorded[path.replace(encodeURIComponent(root), encodeURIComponent(DEMO_ROOT))] =
			await get(path);
	await server.close();

	// The demo's own copy of the stored report, for the roadmap and exports the Worker works out per filter.
	recorded["report"] = { status: 200, type: "application/json", body: JSON.stringify(report) };

	let text = JSON.stringify(recorded);
	for (const [local, shown] of [
		[root, DEMO_ROOT],
		[state, DEMO_STATE],
		[work, "/home/demo"],
	]) {
		text = text
			.split(local)
			.join(shown)
			.split(JSON.stringify(local).slice(1, -1))
			.join(shown)
			.split(encodeURIComponent(local))
			.join(encodeURIComponent(shown));
	}
	const leaks = text.match(/\/(?:Users|private|var\/folders|tmp)\/[^"\\\s]*/g);
	if (leaks)
		throw new Error(
			`A local path is left in the recording: ${[...new Set(leaks)].slice(0, 3).join(", ")}`,
		);
	for (const word of [process.env.USER, process.env.LOGNAME].filter(
		(value): value is string => typeof value === "string" && value.length > 2,
	)) {
		if (text.includes(word)) throw new Error("The recording names this computer's user");
	}

	const out = new URL("./src/recorded.json", import.meta.url);
	await writeFile(out, `${JSON.stringify(JSON.parse(text), null, "\t")}\n`);
	const failed = Object.entries(JSON.parse(text) as Record<string, { status: number }>).filter(
		([, answer]) => answer.status >= 400,
	);
	console.log(
		`Recorded ${Object.keys(recorded).length} answers to ${out.pathname.split("/").slice(-3).join("/")}`,
	);
	for (const [path, answer] of failed) console.log(`  ${answer.status} ${path}`);
} finally {
	await rm(work, { recursive: true, force: true });
}
