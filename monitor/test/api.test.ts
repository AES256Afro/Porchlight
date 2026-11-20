import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vite-plus/test";
import { fakeDeps } from "./fake-net.ts";
import { call, resetDb } from "./helpers.ts";

beforeEach(resetDb);

describe("authentication", () => {
	it("answers the health check without credentials and reveals nothing", async () => {
		const response = await call(fakeDeps(), "GET", "/", { token: null });
		expect(response).toEqual({ status: 200, body: "porchlight-monitor\n" });
	});

	it("rejects missing and wrong tokens", async () => {
		const deps = fakeDeps();
		expect((await call(deps, "GET", "/domains", { token: null })).status).toBe(401);
		expect((await call(deps, "GET", "/domains", { token: "wrong" })).status).toBe(401);
		expect(
			(await call(deps, "POST", "/domains", { token: "wrong", body: { domain: "example.test" } }))
				.status,
		).toBe(401);
		expect((await call(deps, "GET", "/domains")).body).toEqual({ domains: [] });
	});

	it("refuses to run with no token, or a weak one, configured", async () => {
		const deps = fakeDeps();
		expect((await call(deps, "GET", "/domains", { env: { ADMIN_TOKEN: undefined } })).status).toBe(
			503,
		);
		expect(
			(await call(deps, "GET", "/domains", { token: "hunter2", env: { ADMIN_TOKEN: "hunter2" } }))
				.status,
		).toBe(503);
		// An empty configured token must not match an empty presented one.
		expect(
			(await call(deps, "GET", "/domains", { token: "", env: { ADMIN_TOKEN: "" } })).status,
		).toBe(503);
	});

	it("hides internal errors from the caller", async () => {
		const broken = {
			prepare() {
				throw new Error("D1_ERROR: no such table: domains: SQLITE_ERROR");
			},
		} as unknown as D1Database;
		expect(await call(fakeDeps(), "GET", "/domains", { env: { DB: broken } })).toEqual({
			status: 500,
			body: { error: "The database has no tables yet. Apply the migrations; see the README." },
		});
	});

	it("names the fix when the database is missing a newer migration", async () => {
		const behind = {
			prepare() {
				throw new Error("D1_ERROR: no such column: error_streak: SQLITE_ERROR");
			},
		} as unknown as D1Database;
		expect(await call(fakeDeps(), "GET", "/domains", { env: { DB: behind } })).toEqual({
			status: 500,
			body: { error: "The database is missing a migration. Apply the migrations; see the README." },
		});
	});

	it("is enforced by the deployed entry point, not only the router", async () => {
		const response = await exports.default.fetch("https://monitor.test/domains");
		expect(response.status).toBe(401);
		expect(response.headers.get("cache-control")).toBe("no-store");
	});
});

describe("domain management", () => {
	it("rejects input that is not a domain name", async () => {
		const deps = fakeDeps();
		for (const body of [
			{ domain: "localhost" },
			{ domain: "10.0.0.1" },
			{ domain: "a b.com" },
			{ domain: 7 },
			{},
			null,
		]) {
			expect((await call(deps, "POST", "/domains", { body })).status).toBe(400);
		}
		expect(
			(await call(deps, "POST", "/domains", { body: { domain: `${"a".repeat(2000)}.com` } }))
				.status,
		).toBe(413);
	});

	it("normalises the name and keeps one stable challenge per domain", async () => {
		const deps = fakeDeps();
		const first = await call(deps, "POST", "/domains", { body: { domain: "Example.TEST." } });
		const again = await call(deps, "POST", "/domains", { body: { domain: "example.test" } });

		expect(first.body.domain).toMatchObject({
			name: "example.test",
			verified: false,
			lastScanAt: null,
		});
		expect(first.body.domain.challenge).toMatchObject({
			type: "TXT",
			name: "_porchlight-challenge.example.test",
		});
		expect(first.body.domain.challenge.value).toMatch(/^porchlight-verify=[0-9a-f]{48}$/);
		expect(again.body.domain.challenge).toEqual(first.body.domain.challenge);
		expect((await call(deps, "GET", "/domains")).body.domains).toHaveLength(1);
	});

	it("deletes a domain and answers 404 for it afterwards", async () => {
		const deps = fakeDeps();
		await call(deps, "POST", "/domains", { body: { domain: "example.test" } });

		expect((await call(deps, "DELETE", "/domains/example.test")).body).toEqual({
			deleted: "example.test",
		});
		expect((await call(deps, "GET", "/domains/example.test")).status).toBe(404);
		expect((await call(deps, "POST", "/domains/example.test/scan")).status).toBe(404);
	});

	it("answers unknown routes and methods precisely", async () => {
		const deps = fakeDeps();
		expect((await call(deps, "GET", "/nope")).status).toBe(404);
		expect((await call(deps, "PUT", "/domains")).status).toBe(405);
		await call(deps, "POST", "/domains", { body: { domain: "example.test" } });
		expect((await call(deps, "GET", "/domains/example.test/scan")).status).toBe(405);
		expect((await call(deps, "POST", "/domains/example.test/unknown")).status).toBe(404);
		// A name that is not valid percent-encoding is simply not a registered domain.
		expect((await call(deps, "GET", "/domains/%E0%A4%A")).status).toBe(404);
	});
});
