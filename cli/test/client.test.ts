import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { callMonitor, monitorConfig } from "../src/monitor/client.ts";
import { describeDomain, describeHistory } from "../src/monitor/describe.ts";
import { fakeFetch } from "./helpers.ts";

const TOKEN = "t".repeat(40);

describe("the monitor client", () => {
	test("requires both settings and names the one that is missing", () => {
		assert.throws(() => monitorConfig({}), /PORCHLIGHT_MONITOR_URL/);
		assert.throws(() => monitorConfig({ PORCHLIGHT_MONITOR_URL: "https://monitor.example" }), /PORCHLIGHT_ADMIN_TOKEN/);
		assert.throws(() => monitorConfig({ PORCHLIGHT_MONITOR_URL: "not a url", PORCHLIGHT_ADMIN_TOKEN: TOKEN }), /not a URL/);
	});

	test("refuses to send the token over plain http, except to this machine", () => {
		const config = (url: string) => monitorConfig({ PORCHLIGHT_MONITOR_URL: url, PORCHLIGHT_ADMIN_TOKEN: TOKEN });

		assert.equal(config("https://monitor.example").url.hostname, "monitor.example");
		assert.equal(config("http://localhost:5173").url.port, "5173");
		assert.equal(config("http://127.0.0.1:5173").url.hostname, "127.0.0.1");
		assert.throws(() => config("http://monitor.example"), /must use https/);
		assert.throws(() => config("http://localhost.evil.example"), /must use https/);
		assert.throws(() => config("ftp://localhost"), /must use https/);
	});

	test("sends the token as a bearer header and never follows redirects", async () => {
		const monitor = fakeFetch(() => Response.json({ domain: { name: "example.com" } }, { status: 201 }));
		const seen = monitor.calls;
		const config = monitorConfig({ PORCHLIGHT_MONITOR_URL: "https://monitor.example", PORCHLIGHT_ADMIN_TOKEN: TOKEN });

		const response = await callMonitor(config, "POST", "/domains", { domain: "example.com" }, monitor);

		assert.deepEqual(response, { status: 201, body: { domain: { name: "example.com" } } });
		assert.equal(seen[0]!.url, "https://monitor.example/domains");
		assert.equal(seen[0]!.init.redirect, "error");
		assert.equal(seen[0]!.init.body, '{"domain":"example.com"}');
		assert.equal((seen[0]!.init.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
	});

	test("keeps the path of a monitor served under one", async () => {
		const monitor = fakeFetch(() => Response.json({ domains: [] }));
		for (const base of ["https://example.com/monitor", "https://example.com/monitor/", "https://example.com/monitor?x=1"]) {
			const config = monitorConfig({ PORCHLIGHT_MONITOR_URL: base, PORCHLIGHT_ADMIN_TOKEN: TOKEN });
			await callMonitor(config, "GET", "/domains/example.com/scan", undefined, monitor);
		}
		assert.deepEqual(monitor.calls.map((call) => call.url), Array(3).fill("https://example.com/monitor/domains/example.com/scan"));
	});

	test("turns a non-JSON error page into a readable error", async () => {
		const monitor = fakeFetch(() => new Response("<html>Bad gateway</html>", { status: 502 }));
		const config = monitorConfig({ PORCHLIGHT_MONITOR_URL: "https://monitor.example", PORCHLIGHT_ADMIN_TOKEN: TOKEN });

		assert.deepEqual(await callMonitor(config, "GET", "/domains", undefined, monitor), {
			status: 502,
			body: { error: "<html>Bad gateway</html>" },
		});
	});
});

test("lists a domain's scan state, with a run of failures counted", () => {
	const base = { name: "example.com", verified: true, lastScanAt: "2026-11-20T12:00:00.000Z" };
	assert.equal(describeDomain({ ...base, lastScanAt: null, lastScanStatus: null }), "example.com: verified, never scanned");
	assert.equal(describeDomain({ ...base, lastScanStatus: "ok", errorStreak: 0 }), "example.com: verified, last scan 2026-11-20T12:00:00.000Z (ok)");
	assert.equal(describeDomain({ ...base, lastScanStatus: "error", errorStreak: 1 }), "example.com: verified, last scan 2026-11-20T12:00:00.000Z (error)");
	assert.equal(
		describeDomain({ ...base, lastScanStatus: "error", errorStreak: 3 }),
		"example.com: verified, last scan 2026-11-20T12:00:00.000Z (error, 3 failures in a row)",
	);
	// An older monitor sends no streak.
	assert.equal(describeDomain({ ...base, lastScanStatus: "error" }), "example.com: verified, last scan 2026-11-20T12:00:00.000Z (error)");
	assert.equal(describeDomain({ ...base, lastScanStatus: null }), "example.com: verified, last scan 2026-11-20T12:00:00.000Z (verified again, scan due)");
});

test("lists how many findings a domain has open, when the monitor counts them", () => {
	const base = { name: "example.com", verified: true, lastScanAt: "2026-11-20T12:00:00.000Z", lastScanStatus: "ok" as const };
	assert.match(describeDomain({ ...base, openFindings: { high: 1, medium: 0, low: 2 } }), /\(ok\), 3 open findings \(1 high\)$/);
	assert.match(describeDomain({ ...base, openFindings: { high: 0, medium: 1, low: 0 } }), /\(ok\), 1 open finding$/);
	assert.match(describeDomain({ ...base, openFindings: { high: 0, medium: 0, low: 0 } }), /\(ok\), no open findings$/);
	assert.match(describeDomain({ ...base, openFindings: null }), /\(ok\)$/);
});

test("prints a domain's history newest first, with what each scan saw change", () => {
	const finding = { id: "no-caa:example.com", severity: "low" as const, host: "example.com", basis: "apex" as const, title: "No CAA record" };
	const text = describeHistory("example.com", [
		{ takenAt: "2026-11-19T12:00:00.000Z", baseline: false, changes: [], newFindings: [], resolvedFindings: [finding], openFindings: { high: 0, medium: 0, low: 0 }, hostCount: 2, notes: [] },
		{
			takenAt: "2026-11-18T12:00:00.000Z",
			baseline: false,
			changes: [{ kind: "host_added", host: "shop.example.com" }],
			newFindings: [finding],
			resolvedFindings: [],
			openFindings: { high: 0, medium: 0, low: 1 },
			hostCount: 2,
			notes: ["The certificate log could not be read."],
		},
		{ takenAt: "2026-11-17T12:00:00.000Z", baseline: true, changes: [], newFindings: [], resolvedFindings: [], openFindings: { high: 0, medium: 0, low: 0 }, hostCount: 1, notes: [] },
	]);
	assert.deepEqual(text.split("\n"), [
		"2026-11-19 12:00  0 changes, 0 new findings, 1 resolved; 0 open",
		"    ✓ example.com: No CAA record",
		"2026-11-18 12:00  1 change, 1 new finding, 0 resolved; 1 open",
		"    + new host shop.example.com",
		"    ! [low] example.com: No CAA record",
		"    (The certificate log could not be read.)",
		"2026-11-17 12:00  first scan, 1 host; 0 open",
	]);
	assert.equal(describeHistory("example.com", []), "example.com has not been scanned yet.");
});
