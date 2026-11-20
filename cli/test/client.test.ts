import assert from "node:assert/strict";
import { test } from "node:test";
import { callMonitor, monitorConfig } from "../src/monitor/client.ts";
import { describeDomain } from "../src/monitor/describe.ts";

const TOKEN = "t".repeat(40);

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
	const seen: { url: string; init: RequestInit }[] = [];
	const fakeFetch = (async (url: URL, init: RequestInit) => {
		seen.push({ url: url.toString(), init });
		return Response.json({ domain: { name: "example.com" } }, { status: 201 });
	}) as unknown as typeof fetch;
	const config = monitorConfig({ PORCHLIGHT_MONITOR_URL: "https://monitor.example", PORCHLIGHT_ADMIN_TOKEN: TOKEN });

	const response = await callMonitor(config, "POST", "/domains", { domain: "example.com" }, fakeFetch);

	assert.deepEqual(response, { status: 201, body: { domain: { name: "example.com" } } });
	assert.equal(seen[0]!.url, "https://monitor.example/domains");
	assert.equal(seen[0]!.init.redirect, "error");
	assert.equal(seen[0]!.init.body, '{"domain":"example.com"}');
	assert.equal((seen[0]!.init.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
});

test("keeps the path of a monitor served under one", async () => {
	const seen: string[] = [];
	const fakeFetch = (async (url: URL) => {
		seen.push(url.toString());
		return Response.json({ domains: [] });
	}) as unknown as typeof fetch;
	for (const base of ["https://example.com/monitor", "https://example.com/monitor/", "https://example.com/monitor?x=1"]) {
		const config = monitorConfig({ PORCHLIGHT_MONITOR_URL: base, PORCHLIGHT_ADMIN_TOKEN: TOKEN });
		await callMonitor(config, "GET", "/domains/example.com/scan", undefined, fakeFetch);
	}
	assert.deepEqual(seen, Array(3).fill("https://example.com/monitor/domains/example.com/scan"));
});

test("turns a non-JSON error page into a readable error", async () => {
	const fakeFetch = (async () => new Response("<html>Bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
	const config = monitorConfig({ PORCHLIGHT_MONITOR_URL: "https://monitor.example", PORCHLIGHT_ADMIN_TOKEN: TOKEN });

	assert.deepEqual(await callMonitor(config, "GET", "/domains", undefined, fakeFetch), {
		status: 502,
		body: { error: "<html>Bad gateway</html>" },
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
