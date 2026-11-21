import { env } from "cloudflare:workers";
import { expect } from "vite-plus/test";
import { handleRequest } from "../src/api.ts";
import type { AppEnv } from "../src/env.ts";
import { WEBHOOK, type FakeDeps } from "./fake-net.ts";

export function appEnv(overrides: Partial<AppEnv> = {}): AppEnv {
	return { DB: env.DB, ADMIN_TOKEN: env.ADMIN_TOKEN, ALERT_WEBHOOK_URL: WEBHOOK, ...overrides };
}

export async function resetDb(): Promise<void> {
	await env.DB.batch([
		env.DB.prepare("DELETE FROM snapshots"),
		env.DB.prepare("DELETE FROM domains"),
		env.DB.prepare(
			`UPDATE monitor_status SET alert_sent_at = NULL, alert_error = NULL, alert_error_at = NULL,
			   schedule_error = NULL, schedule_error_at = NULL`,
		),
	]);
}

interface CallOptions {
	body?: unknown;
	token?: string | null;
	env?: Partial<AppEnv>;
}

/** Calls the API as the admin would, returning the status and parsed JSON body. */
export async function call(
	deps: FakeDeps,
	method: string,
	path: string,
	options: CallOptions = {},
	// oxlint-disable-next-line typescript/no-explicit-any -- test assertions read arbitrary response shapes
): Promise<{ status: number; body: any }> {
	const token = options.token === undefined ? env.ADMIN_TOKEN : options.token;
	const request = new Request(`https://monitor.test${path}`, {
		method,
		headers: token === null ? {} : { authorization: `Bearer ${token}` },
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
	});
	const response = await handleRequest(request, appEnv(options.env), deps);
	const text = await response.text();
	return { status: response.status, body: text.startsWith("{") ? JSON.parse(text) : text };
}

/** Registers `domain`, publishes its challenge record in the fake DNS, and verifies it. */
export async function registerVerified(deps: FakeDeps, domain: string): Promise<void> {
	const created = await call(deps, "POST", "/domains", { body: { domain } });
	expect(created.status).toBe(201);
	const { name, value } = created.body.domain.challenge;
	deps.net.txt = { ...deps.net.txt, [name]: [value.replace(/"/g, "")] };
	const verified = await call(deps, "POST", `/domains/${domain}/verify`);
	expect(verified.status).toBe(200);
	deps.requests.length = 0;
}

export const HARDENED_HEADERS = {
	"content-type": "text/html; charset=utf-8",
	"strict-transport-security": "max-age=63072000",
	"content-security-policy": "default-src 'self'; frame-ancestors 'none'",
	"x-content-type-options": "nosniff",
	"referrer-policy": "no-referrer",
	"permissions-policy": "geolocation=()",
};

/** A 90-day certificate with about six weeks left on the fake clock. */
export const VALID_CERT = { notBefore: "2026-10-01T00:00:00Z", notAfter: "2026-12-30T00:00:00Z" };
