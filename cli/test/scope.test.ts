// The scope file (monitor/scope.ts): the owner's proven domains and the names under each, for another
// tool of the owner's to take as the scope it may test. Names and dates only (invariant 3), every
// verified domain whole or no file at all (invariant 5), the admin token added by the server alone
// (invariant 7), and a name made of a fixed stem and the date (invariant 11). Tests never touch the
// network: the monitor is a fake `fetch`.
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, test, type TestContext } from "node:test";
import { helpFor } from "../src/help.ts";
import { monitorConfig, type MonitorResponse } from "../src/monitor/client.ts";
import { buildScope, domainsScope, scopeExport, scopeFilename, ScopeError, type ScopeCommandDeps } from "../src/monitor/scope.ts";
import { startUiServer, type UiOptions, type UiServer } from "../src/ui/server.ts";
import { fakeFetch, tempDir } from "./helpers.ts";

const ADMIN_TOKEN = "admin-token-that-must-never-leave-the-server";
const CHALLENGE = "porchlight-verify=0123456789abcdef0123456789abcdef";
const monitor = monitorConfig({ PORCHLIGHT_MONITOR_URL: "https://monitor.example", PORCHLIGHT_ADMIN_TOKEN: ADMIN_TOKEN });
const NOW = new Date("2026-11-22T21:15:30.123Z");

/** A domain as the monitor's `GET /domains` lists it, with everything it sends beside the name. */
function listed(name: string, verified: boolean, verifiedAt: string | null) {
	return {
		name,
		verified,
		verifiedAt,
		lastScanAt: "2026-11-21T06:00:00.000Z",
		lastScanStatus: verified ? "ok" : verifiedAt ? "unverified" : null,
		errorStreak: 0,
		lastError: null,
		openFindings: { high: 1, medium: 0, low: 2 },
		challenge: { type: "TXT", name: `_porchlight-challenge.${name}`, value: CHALLENGE },
	};
}

/** A host as the monitor's inventory sends it: addresses, certificate, HTTPS answer and findings beside the name. */
function host(name: string, checkedAt: string | null, n = 10) {
	return {
		name,
		probed: checkedAt !== null,
		checkedAt,
		dns: { a: [`203.0.113.${n}`], aaaa: [`2001:db8::${n}`], cname: [`edge-${n}.cdn-vendor.example`] },
		cert: { notBefore: "2026-09-01T00:00:00.000Z", notAfter: "2026-12-30T00:00:00.000Z" },
		https: { ok: true, status: 418 },
		findings: 3,
	};
}

const TAKEN = "2026-11-21T06:00:00.000Z";

/** The fake monitor: two verified domains (one paged), one awaiting verification, one whose ownership check failed. */
function monitorAnswers(overrides: Record<string, (url: URL) => Response> = {}) {
	return (url: URL): Response => {
		const key = `${url.pathname}${url.search}`;
		if (overrides[key]) return overrides[key](url);
		if (key === "/domains") {
			return Response.json({
				domains: [listed("zeta.example", true, "2026-11-02T08:00:00.000Z"), listed("alpha.example", true, "2026-11-01T07:00:00.000Z"), listed("pending.example", false, null), listed("lost.example", false, "2026-10-01T00:00:00.000Z")],
				status: { alerts: { to: "log", delivery: null }, schedule: null },
			});
		}
		const page = (domain: string, number: number, total: number, hosts: unknown[]) =>
			Response.json({ domain, takenAt: TAKEN, total, page: number, pageSize: 2, hosts, gone: number === 1 ? [{ name: `gone.${domain}`, since: "2026-11-01T00:00:00.000Z" }] : [] });
		if (key === "/domains/alpha.example/hosts") return page("alpha.example", 1, 3, [host("alpha.example", "2026-11-21T06:00:01.000Z", 1), host("api.alpha.example", null, 2)]);
		if (key === "/domains/alpha.example/hosts?page=2") return page("alpha.example", 2, 3, [host("www.alpha.example", "2026-11-21T06:00:03.000Z", 3)]);
		if (key === "/domains/zeta.example/hosts") return page("zeta.example", 1, 1, [host("mail.zeta.example", "2026-11-21T06:00:04.000Z", 4)]);
		return Response.json({ error: "Not found" }, { status: 404 });
	};
}

const EXPECTED = {
	format: "porchlight-scope",
	version: 1,
	exportedAt: "2026-11-22T21:15:30.123Z",
	domains: [
		{
			name: "alpha.example",
			verifiedAt: "2026-11-01T07:00:00.000Z",
			hosts: [
				{ name: "alpha.example", checkedAt: "2026-11-21T06:00:01.000Z" },
				{ name: "api.alpha.example", checkedAt: null },
				{ name: "www.alpha.example", checkedAt: "2026-11-21T06:00:03.000Z" },
			],
		},
		{ name: "zeta.example", verifiedAt: "2026-11-02T08:00:00.000Z", hosts: [{ name: "mail.zeta.example", checkedAt: "2026-11-21T06:00:04.000Z" }] },
	],
};

/** The monitor as the CLI asks it: a path, and the answer. */
function getFrom(answer: (url: URL) => Response, asked: string[] = []): (path: string) => Promise<MonitorResponse> {
	return async (path) => {
		asked.push(path);
		const response = answer(new URL(path, "https://monitor.example"));
		return { status: response.status, body: (await response.json()) as Record<string, any> };
	};
}

async function start(t: TestContext, overrides: Partial<UiOptions> = {}): Promise<UiServer & { dir: string }> {
	const dir = await tempDir();
	const server = await startUiServer({ port: 0, reportPath: join(dir, "state", "repo-scan.json"), defaultRoot: dir, monitor: null, monitorError: "Set PORCHLIGHT_MONITOR_URL", ...overrides });
	t.after(() => server.close());
	return Object.assign(server, { dir });
}

async function call(server: UiServer, method: string, path: string, body?: unknown): Promise<{ status: number; headers: Headers; text: string; json: any }> {
	const response = await fetch(`http://127.0.0.1:${server.port}${path}`, {
		method,
		headers: { "x-porchlight-session": server.sessionKey, ...(body === undefined ? {} : { "content-type": "application/json" }) },
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const text = await response.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = undefined;
	}
	return { status: response.status, headers: response.headers, text, json };
}

/** Every value the fake monitor sends that is not a name or a date the scope carries. */
const FORBIDDEN = [ADMIN_TOKEN, CHALLENGE, "_porchlight-challenge", "203.0.113.", "2001:db8::", "cdn-vendor", "2026-09-01", "2026-12-30", "418", "gone.", "pending.example", "lost.example"];
const FORBIDDEN_KEYS = ["dns", "cert", "https", "findings", "probed", "challenge", "openFindings", "lastScanAt", "lastScanStatus", "lastError", "errorStreak", "verified", "gone", "takenAt", "total", "page", "status", "token", "a", "aaaa", "cname"];

describe("the scope file", () => {
	test("has the exact shape: verified domains by name, each with every name of its latest scan, sorted", async () => {
		const asked: string[] = [];
		const scope = await buildScope(getFrom(monitorAnswers(), asked), NOW);
		assert.deepEqual(scope, EXPECTED);
		// Only the verified domains' names are asked for, every page of them, and nothing about a domain itself.
		assert.deepEqual(asked, ["/domains", "/domains/alpha.example/hosts", "/domains/alpha.example/hosts?page=2", "/domains/zeta.example/hosts"]);
		const file = scopeExport(scope);
		assert.deepEqual(JSON.parse(file.body), EXPECTED);
		assert.equal(file.filename, "porchlight-scope-2026-11-22.json");
		assert.equal(file.contentType, "application/json; charset=utf-8");
	});

	test("lists only the domains the monitor reports as verified", async () => {
		const asked: string[] = [];
		const scope = await buildScope(getFrom(monitorAnswers(), asked), NOW);
		assert.deepEqual(
			scope.domains.map((domain) => domain.name),
			["alpha.example", "zeta.example"],
		);
		// Awaiting verification, or verified once and then failing its ownership check: neither is listed, nor its names asked for.
		assert.ok(!asked.some((path) => path.includes("pending.example") || path.includes("lost.example")));
		// None verified: refused, never a file that permits nothing.
		const none = monitorAnswers({ "/domains": () => Response.json({ domains: [listed("pending.example", false, null)] }) });
		await assert.rejects(buildScope(getFrom(none), NOW), (err: unknown) => err instanceof ScopeError && err.status === 409 && /No domain is verified/.test(err.message));
		// A verified domain without the date it was verified is not one the file can describe.
		const undated = monitorAnswers({ "/domains": () => Response.json({ domains: [listed("alpha.example", true, null)] }) });
		await assert.rejects(buildScope(getFrom(undated), NOW), /without the date it was verified/);
	});

	test("carries names and dates only: nothing else the monitor sends is anywhere in the file", async () => {
		const text = scopeExport(await buildScope(getFrom(monitorAnswers()), NOW)).body;
		for (const value of FORBIDDEN) assert.ok(!text.includes(value), `the file holds ${value}`);
		const keys = new Set<string>();
		const walk = (value: unknown): void => {
			if (Array.isArray(value)) value.forEach(walk);
			else if (value && typeof value === "object") {
				for (const [key, inner] of Object.entries(value)) {
					keys.add(key);
					walk(inner);
				}
			}
		};
		walk(JSON.parse(text));
		assert.deepEqual([...keys].sort(), ["checkedAt", "domains", "exportedAt", "format", "hosts", "name", "verifiedAt", "version"]);
		for (const key of FORBIDDEN_KEYS) assert.ok(!keys.has(key), key);
	});

	test("keeps a date the monitor does not know as null, never a made-up one (invariant 5)", async () => {
		const scope = await buildScope(getFrom(monitorAnswers()), NOW);
		const api = scope.domains[0]!.hosts.find((one) => one.name === "api.alpha.example");
		assert.deepEqual(api, { name: "api.alpha.example", checkedAt: null });
		assert.match(scopeExport(scope).body, /"name": "api\.alpha\.example",\n\t+"checkedAt": null/);
		// A date that is not one is refused, not repaired.
		const odd = monitorAnswers({ "/domains/zeta.example/hosts": () => Response.json({ domain: "zeta.example", takenAt: TAKEN, total: 1, hosts: [{ name: "mail.zeta.example", checkedAt: "yesterday" }], gone: [] }) });
		await assert.rejects(buildScope(getFrom(odd), NOW), /not an inventory/);
	});

	test("a domain whose names cannot be read refuses the whole export", async () => {
		const failing: [string, Record<string, (url: URL) => Response>, RegExp][] = [
			["not scanned yet", { "/domains/zeta.example/hosts": () => Response.json({ error: "zeta.example has not been scanned yet" }, { status: 404 }) }, /zeta\.example has not been scanned yet\. Scan it, then export again/],
			["the monitor failed", { "/domains/alpha.example/hosts?page=2": () => Response.json({ error: "D1 is unavailable" }, { status: 500 }) }, /Could not read the names under alpha\.example: D1 is unavailable/],
			["not an inventory", { "/domains/zeta.example/hosts": () => Response.json({ hosts: "none" }) }, /not an inventory/],
			[
				"scanned again between pages",
				{ "/domains/alpha.example/hosts?page=2": () => Response.json({ domain: "alpha.example", takenAt: "2026-11-22T06:00:00.000Z", total: 3, hosts: [host("www.alpha.example", null)], gone: [] }) },
				/scanned alpha\.example again while its names were being read/,
			],
			["fewer names than it said", { "/domains/alpha.example/hosts?page=2": () => Response.json({ domain: "alpha.example", takenAt: TAKEN, total: 3, hosts: [], gone: [] }) }, /said it holds 3 names under alpha\.example but sent 2/],
			["a name outside the domain", { "/domains/zeta.example/hosts": () => Response.json({ domain: "zeta.example", takenAt: TAKEN, total: 1, hosts: [host("zeta.example.attacker.test", null)], gone: [] }) }, /neither zeta\.example nor a subdomain of it/],
			["a name that is not one", { "/domains/zeta.example/hosts": () => Response.json({ domain: "zeta.example", takenAt: TAKEN, total: 1, hosts: [host("203.0.113.9", null)], gone: [] }) }, /not an inventory/],
		];
		for (const [why, overrides, said] of failing) await assert.rejects(buildScope(getFrom(monitorAnswers(overrides)), NOW), said, why);
		// The monitor out of reach is said as that.
		const unreachable = async (path: string): Promise<MonitorResponse> => {
			if (path === "/domains") return getFrom(monitorAnswers())(path);
			throw new Error("fetch failed");
		};
		await assert.rejects(buildScope(unreachable, NOW), /Could not reach the monitor to read the names under alpha\.example: fetch failed/);

		// From the command line: nothing is written, and the error says why.
		const folder = await tempDir();
		const written: string[] = [];
		const deps: ScopeCommandDeps = { now: () => NOW, print: (text) => written.push(text), warn: () => {}, isFolder: async () => true, write: async (path) => void written.push(path) };
		await assert.rejects(domainsScope(["--out", folder], getFrom(monitorAnswers(failing[0]![1])), deps), /not been scanned yet/);
		assert.deepEqual(written, []);
		assert.deepEqual(await readdir(folder), []);
	});

	test("the file's name is a fixed stem and the date, and nothing else", async () => {
		assert.equal(scopeFilename(new Date("2026-01-05T23:59:59.999Z")), "porchlight-scope-2026-01-05.json");
		assert.equal(scopeFilename(new Date("2027-12-31T00:00:00.000Z")), "porchlight-scope-2027-12-31.json");
		// Whatever the domains are called, the name is the same.
		const other = monitorAnswers({ "/domains": () => Response.json({ domains: [listed("zeta.example", true, "2026-11-02T08:00:00.000Z")] }) });
		const [one, two] = [scopeExport(await buildScope(getFrom(monitorAnswers()), NOW)), scopeExport(await buildScope(getFrom(other), NOW))];
		assert.equal(one.filename, two.filename);
		assert.match(one.filename, /^porchlight-scope-\d{4}-\d{2}-\d{2}\.json$/);
	});
});

describe("the scope file from the page", () => {
	test("is read from the monitor with the token as a header only, and downloaded under the fixed name", async (t) => {
		const fetchFn = fakeFetch(monitorAnswers());
		const server = await start(t, { monitor, fetchFn });
		const reply = await call(server, "GET", "/api/domains/scope");
		assert.equal(reply.status, 200);
		assert.match(reply.headers.get("content-disposition") ?? "", /^attachment; filename="porchlight-scope-\d{4}-\d{2}-\d{2}\.json"$/);
		assert.equal(reply.headers.get("content-type"), "application/json; charset=utf-8");
		const scope = JSON.parse(reply.text);
		assert.deepEqual({ ...scope, exportedAt: EXPECTED.exportedAt }, EXPECTED);
		assert.equal(reply.headers.get("content-disposition"), `attachment; filename="porchlight-scope-${scope.exportedAt.slice(0, 10)}.json"`);
		assert.deepEqual(
			fetchFn.calls.map((one) => [one.init.method, one.url]),
			[
				["GET", "https://monitor.example/domains"],
				["GET", "https://monitor.example/domains/alpha.example/hosts"],
				["GET", "https://monitor.example/domains/alpha.example/hosts?page=2"],
				["GET", "https://monitor.example/domains/zeta.example/hosts"],
			],
		);
		for (const one of fetchFn.calls) {
			assert.equal((one.init.headers as Record<string, string>).authorization, `Bearer ${ADMIN_TOKEN}`);
			assert.ok(!one.url.includes(ADMIN_TOKEN));
		}
		for (const value of FORBIDDEN) assert.ok(!reply.text.includes(value), `the download holds ${value}`);
	});

	test("refuses, with the monitor's reason and no file, when a domain's names cannot be read", async (t) => {
		const fetchFn = fakeFetch(monitorAnswers({ "/domains/zeta.example/hosts": () => Response.json({ error: "zeta.example has not been scanned yet" }, { status: 404 }) }));
		const server = await start(t, { monitor, fetchFn });
		const reply = await call(server, "GET", "/api/domains/scope");
		assert.equal(reply.status, 409);
		assert.equal(reply.headers.get("content-disposition"), null);
		assert.match(reply.json.error, /zeta\.example has not been scanned yet/);
		assert.ok(!reply.text.includes("alpha.example"), "nothing of the domains that were read is sent");
		const broken = await start(t, { monitor, fetchFn: fakeFetch(monitorAnswers({ "/domains/alpha.example/hosts": () => Response.json({ error: "Internal error" }, { status: 500 }) })) });
		assert.equal((await call(broken, "GET", "/api/domains/scope")).status, 502);
		const away = await start(t, { monitor, fetchFn: fakeFetch(() => Promise.reject(new TypeError("fetch failed"))) });
		const unreachable = await call(away, "GET", "/api/domains/scope");
		assert.equal(unreachable.status, 502);
		assert.ok(!unreachable.text.includes(ADMIN_TOKEN));
		// Without a monitor: 503, as every other monitor call.
		assert.equal((await call(await start(t), "GET", "/api/domains/scope")).status, 503);
		assert.equal((await call(server, "DELETE", "/api/domains/scope")).status, 405);
	});

	test("is saved in the project in use under a name from the fixed list (invariant 23)", async (t) => {
		const fetchFn = fakeFetch(monitorAnswers());
		const server = await start(t, { monitor, fetchFn });
		assert.equal((await call(server, "POST", "/api/domains/scope")).status, 409, "no project: nothing is written anywhere");
		const folder = join(server.dir, "work", "acme");
		await mkdir(join(server.dir, "work"), { recursive: true });
		assert.equal((await call(server, "POST", "/api/projects", { name: "acme", folder })).status, 200);
		const saved = (await call(server, "POST", "/api/domains/scope")).json.saved;
		assert.match(saved.name, /^\d{4}-\d{2}-\d{2} \d{2}\.\d{2} Scope of proven domains\.json$/);
		assert.equal(saved.part, "Exports");
		const kept = JSON.parse(await readFile(saved.path, "utf8"));
		assert.deepEqual({ ...kept, exportedAt: EXPECTED.exportedAt }, EXPECTED);
		assert.equal((await stat(saved.path)).mode & 0o777, 0o600);
	});
});

describe("porchlight domains scope", () => {
	test("prints the file, or writes it to a file, or into a folder under the fixed name", async () => {
		const printed: string[] = [];
		const said: string[] = [];
		const writes: [string, string][] = [];
		const deps = (folder: boolean): ScopeCommandDeps => ({ now: () => NOW, print: (text) => printed.push(text), warn: (text) => said.push(text), isFolder: async () => folder, write: async (path, text) => void writes.push([path, text]) });
		assert.equal(await domainsScope([], getFrom(monitorAnswers()), deps(false)), 0);
		assert.deepEqual(JSON.parse(printed[0]!), EXPECTED);
		await domainsScope(["--out", "scope.json"], getFrom(monitorAnswers()), deps(false));
		await domainsScope(["--out", "exports"], getFrom(monitorAnswers()), deps(true));
		assert.deepEqual(
			writes.map(([path]) => path),
			["scope.json", join("exports", "porchlight-scope-2026-11-22.json")],
		);
		assert.equal(writes[0]![1], printed[0]);
		assert.deepEqual(said, ["Written to scope.json: 2 proven domains, 4 names", `Written to ${join("exports", "porchlight-scope-2026-11-22.json")}: 2 proven domains, 4 names`]);
		await assert.rejects(domainsScope(["example.com"], getFrom(monitorAnswers()), deps(false)), /Usage: porchlight domains scope/);
	});

	test("has its own help", () => {
		const help = helpFor(["domains", "scope"]) ?? "";
		assert.match(help, /scope {2,}The scope file/);
		assert.match(help, /porchlight-scope-<date>\.json/);
	});
});
