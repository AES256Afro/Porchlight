// Porchlight's interface as a public demo. The page is cli/ui as it ships, with one note added; its
// questions are answered from what Porchlight's own server answered for made-up data
// (record.ts), or, where the answer depends on the page's filters, by Porchlight's own roadmap and
// export code. Nothing can be scanned, changed or sent: every such request is refused with a word
// on where to get Porchlight. There is no session key, no secret and no state to protect.
import {
	exportDomain,
	exportRepos,
	ExportError,
	parseFilter,
} from "../../cli/src/roadmap/export.ts";
import { buildRepoRoadmap } from "../../cli/src/roadmap/repos.ts";
import type { ScanReport } from "../../cli/src/repos/types.ts";
import type { ScanReport as MonitorReport } from "../../monitor/src/types.ts";
import recordedJson from "./recorded.json";
import demoCss from "./demo.css?raw";

interface Recorded {
	status: number;
	type: string;
	disposition?: string;
	body: string;
}

const recorded = recordedJson as Record<string, Recorded>;
const report = JSON.parse(recorded.report!.body) as ScanReport;
const domainReport = (
	JSON.parse(recorded["/api/domains/example.test"]!.body) as { report: MonitorReport }
).report;

const REPOSITORY = "https://github.com/AES256Afro/Porchlight";
const REFUSED = `This is a demo with made-up data, so nothing here can be scanned, changed or sent. To use Porchlight on your own code, get it from ${REPOSITORY}.`;

/** The interface's files, as they ship. */
const files = import.meta.glob(
	["../../cli/ui/*.js", "../../cli/ui/*.css", "../../cli/ui/*.svg", "../../cli/ui/index.html"],
	{ query: "?raw", import: "default", eager: true },
) as Record<string, string>;
const asset = (name: string) => files[`../../cli/ui/${name}`];

const TYPES: Record<string, string> = {
	js: "text/javascript; charset=utf-8",
	css: "text/css; charset=utf-8",
	svg: "image/svg+xml",
	html: "text/html; charset=utf-8",
};

/** The same headers Porchlight's own server sends: the page loads nothing from anywhere else. */
const SECURITY_HEADERS = {
	"content-security-policy":
		"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
	"referrer-policy": "no-referrer",
	"cross-origin-resource-policy": "same-origin",
	// no-transform: the zone's own additions (an analytics beacon, script detection) stay out, as the
	// policy above would refuse them anyway.
	"cache-control": "no-store, no-transform",
};

/** The note on every page: what this is, and where the real thing is. Static, in the page's own markup. */
const NOTE = `<aside class="demo-note" aria-label="About this demo"><strong>Demo</strong> with made-up repositories and domains. Porchlight runs on your own computer. <a href="${REPOSITORY}" rel="noopener noreferrer">Get it on GitHub</a></aside>`;
const page = asset("index.html")!
	.replace("</head>", `\t<link rel="stylesheet" href="/demo.css" />\n\t</head>`)
	.replace("</body>", `\t${NOTE}\n\t</body>`);

export default {
	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/healthz") return text("ok\n", "text/plain; charset=utf-8");
		if (!url.pathname.startsWith("/api/")) {
			if (request.method !== "GET" && request.method !== "HEAD")
				return json({ error: "Method not allowed" }, 405);
			if (url.pathname === "/") return text(page, TYPES.html!);
			if (url.pathname === "/demo.css") return text(demoCss, TYPES.css!);
			const name = url.pathname.slice(1);
			const body = /^[\w-]+\.(js|css|svg)$/.test(name) ? asset(name) : undefined;
			return body === undefined
				? json({ error: "Not found" }, 404)
				: text(body, TYPES[name.split(".").at(-1)!]!);
		}
		try {
			return request.method === "GET" ? answer(url) : await change(request, url);
		} catch (err) {
			if (err instanceof ExportError) return json({ error: err.message }, 400);
			// A malformed percent-escape in the address is the asker's mistake: 400 with the demo's
			// own headers, never a 500 from Cloudflare's error page without them.
			if (err instanceof URIError) return json({ error: "The address is malformed." }, 400);
			throw err;
		}
	},
} satisfies ExportedHandler;

/** A question the page asks. */
function answer(url: URL): Response {
	const path = url.pathname;
	const query = url.searchParams;
	const filter = () =>
		parseFilter({
			severity: query.get("severity"),
			kind: query.get("kind"),
			match: query.get("q"),
			repo: query.get("repo"),
		});

	if (path === "/api/repos/roadmap") return json({ roadmap: buildRepoRoadmap(report, filter()) });
	if (path === "/api/repos/export") {
		const file = exportRepos(
			report,
			{ content: query.get("content") ?? undefined, format: query.get("format") ?? undefined },
			filter(),
		);
		return download(file.body, file.contentType, file.filename);
	}
	if (path === "/api/repos/sbom")
		return download(
			JSON.stringify(sbom(), null, "\t"),
			"application/vnd.cyclonedx+json",
			`porchlight-sbom-${report.scannedAt.slice(0, 10)}.cdx.json`,
		);
	// Whatever folder or depth is asked about, the demo has the one folder of eight repositories.
	if (path === "/api/repos/preview")
		return replay(Object.keys(recorded).find((key) => key.startsWith("/api/repos/preview"))!);
	if (path === "/api/activity") return replay("/api/activity?after=0");
	const domainExport = /^\/api\/domains\/([^/]+)\/export$/.exec(path);
	if (domainExport) {
		if (decodeURIComponent(domainExport[1]!) !== domainReport.domain)
			return json(
				{ error: "This domain has not been scanned yet, so there is nothing to export." },
				404,
			);
		const file = exportDomain(domainReport, {
			content: query.get("content") ?? undefined,
			format: query.get("format") ?? undefined,
		});
		return download(file.body, file.contentType, file.filename);
	}
	if (recorded[path] && path !== "report") return replay(path);
	// The scope file is made from the monitor's inventory of names, which the demo does not record.
	if (path === "/api/domains/scope")
		return json({ error: "This part of Porchlight is not in the demo." }, 404);
	if (path.startsWith("/api/domains/")) return json({ error: "Domain is not registered" }, 404);
	return json({ error: "This part of Porchlight is not in the demo." }, 404);
}

/** Something the page asks to change or start. Only where the page is remembered and how it looks are accepted, and kept nowhere. */
async function change(request: Request, url: URL): Promise<Response> {
	if (request.method === "POST" && url.pathname === "/api/view") {
		const body = (await request.json().catch(() => ({}))) as { view?: unknown };
		return json({ view: typeof body.view === "string" ? body.view : "#/overview" });
	}
	if (request.method === "POST" && url.pathname === "/api/settings") {
		const state = JSON.parse(recorded["/api/state"]!.body) as {
			appearance: string;
			answers: string;
		};
		const body = (await request.json().catch(() => ({}))) as {
			appearance?: unknown;
			answers?: unknown;
		};
		return json({
			appearance: typeof body.appearance === "string" ? body.appearance : state.appearance,
			answers: typeof body.answers === "string" ? body.answers : state.answers,
		});
	}
	return json({ error: REFUSED }, 403);
}

/** The vulnerable packages of the demo scan as a small CycloneDX file, as the real one would list them among the rest. */
function sbom() {
	const repos = report.repos.map((repo) => {
		const name = repo.path.split("/").at(-1)!;
		const packages = new Map<
			string,
			{ "bom-ref": string; type: "library"; name: string; version: string; purl: string }
		>();
		for (const finding of repo.findings) {
			if (finding.kind !== "vulnerability") continue;
			const at = finding.detail.lastIndexOf("@");
			const [pkg, version] = [finding.detail.slice(0, at), finding.detail.slice(at + 1)];
			const purl = `pkg:${finding.location.endsWith("requirements.txt") ? "pypi" : "npm"}/${pkg}@${version}`;
			packages.set(purl, {
				"bom-ref": `${name}:${purl}`,
				type: "library",
				name: pkg,
				version,
				purl,
			});
		}
		return {
			type: "application",
			"bom-ref": `repository:${name}`,
			name,
			components: [...packages.values()],
		};
	});
	return {
		bomFormat: "CycloneDX",
		specVersion: "1.5",
		version: 1,
		metadata: {
			timestamp: report.scannedAt,
			tools: { components: [{ type: "application", name: "porchlight (demo)" }] },
			component: { type: "application", "bom-ref": "porchlight:root", name: "projects" },
		},
		components: repos,
	};
}

function replay(key: string): Response {
	const answer = recorded[key]!;
	return new Response(answer.body, {
		status: answer.status,
		headers: {
			...SECURITY_HEADERS,
			"content-type": answer.type,
			...(answer.disposition ? { "content-disposition": answer.disposition } : {}),
		},
	});
}

function json(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" },
	});
}

function text(body: string, type: string): Response {
	return new Response(body, { headers: { ...SECURITY_HEADERS, "content-type": type } });
}

function download(body: string, type: string, filename: string): Response {
	return new Response(body, {
		headers: {
			...SECURITY_HEADERS,
			"content-type": type,
			"content-disposition": `attachment; filename="${filename}"`,
		},
	});
}
