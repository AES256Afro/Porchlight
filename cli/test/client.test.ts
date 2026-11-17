import assert from "node:assert/strict";
import { test } from "node:test";
import { callMonitor, monitorConfig } from "../src/monitor/client.ts";

const TOKEN = "t".repeat(40);

test("requires both settings and names the one that is missing", () => {
	assert.throws(() => monitorConfig({}), /SECURITYX_MONITOR_URL/);
	assert.throws(() => monitorConfig({ SECURITYX_MONITOR_URL: "https://monitor.example" }), /SECURITYX_ADMIN_TOKEN/);
	assert.throws(() => monitorConfig({ SECURITYX_MONITOR_URL: "not a url", SECURITYX_ADMIN_TOKEN: TOKEN }), /not a URL/);
});

test("refuses to send the token over plain http, except to this machine", () => {
	const config = (url: string) => monitorConfig({ SECURITYX_MONITOR_URL: url, SECURITYX_ADMIN_TOKEN: TOKEN });

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
	const config = monitorConfig({ SECURITYX_MONITOR_URL: "https://monitor.example", SECURITYX_ADMIN_TOKEN: TOKEN });

	const response = await callMonitor(config, "POST", "/domains", { domain: "example.com" }, fakeFetch);

	assert.deepEqual(response, { status: 201, body: { domain: { name: "example.com" } } });
	assert.equal(seen[0]!.url, "https://monitor.example/domains");
	assert.equal(seen[0]!.init.redirect, "error");
	assert.equal(seen[0]!.init.body, '{"domain":"example.com"}');
	assert.equal((seen[0]!.init.headers as Record<string, string>).authorization, `Bearer ${TOKEN}`);
});

test("turns a non-JSON error page into a readable error", async () => {
	const fakeFetch = (async () => new Response("<html>Bad gateway</html>", { status: 502 })) as unknown as typeof fetch;
	const config = monitorConfig({ SECURITYX_MONITOR_URL: "https://monitor.example", SECURITYX_ADMIN_TOKEN: TOKEN });

	assert.deepEqual(await callMonitor(config, "GET", "/domains", undefined, fakeFetch), {
		status: 502,
		body: { error: "<html>Bad gateway</html>" },
	});
});
