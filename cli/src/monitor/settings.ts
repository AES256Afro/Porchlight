/**
 * The monitor's address and admin token, when the owner connects it under Settings → Monitor instead
 * of setting them before start-up. Like the Cloudflare token and the model keys, the token is sent
 * once to Porchlight's own server, kept in `monitor-settings.json` beside the report (0600), and
 * never sent back to the page, a log, a report or a model. It travels only to the address saved
 * with it, as the Authorization header, and only over https (or to this computer).
 */
import { readFile, rm } from "node:fs/promises";
import { writePrivate } from "../investigate/ownership.ts";
import { callMonitor, type MonitorConfig } from "./client.ts";

/** The monitor refuses a shorter ADMIN_TOKEN (`MIN_TOKEN_LENGTH` in monitor/src/api.ts). */
export const MIN_ADMIN_TOKEN = 32;
const MAX_ADMIN_TOKEN = 512;
const MAX_ADDRESS = 300;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export class MonitorSettingsError extends Error {}

/**
 * The address and token as typed, checked and reduced to what is kept: the address's origin (no
 * path, query, user name or fragment) and a token that can travel in a header.
 */
export function parseMonitorSettings(address: unknown, token: unknown): MonitorConfig {
	if (typeof address !== "string" || address.trim() === "") throw new MonitorSettingsError("Type the monitor's address, such as https://porchlight-monitor.your-name.workers.dev");
	const typed = address.trim();
	if (typed.length > MAX_ADDRESS) throw new MonitorSettingsError("That address is too long");
	let url: URL;
	try {
		url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `https://${typed}`);
	} catch {
		throw new MonitorSettingsError("That is not an address. It looks like https://porchlight-monitor.your-name.workers.dev");
	}
	const local = LOCAL_HOSTS.has(url.hostname);
	if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
		throw new MonitorSettingsError("The address must start with https://, so the admin token is never sent in clear text");
	}
	if (url.username || url.password) throw new MonitorSettingsError("Leave any user name or password out of the address");
	if (typeof token !== "string" || token.trim() === "") throw new MonitorSettingsError("Paste the monitor's admin token");
	const secret = token.trim();
	if (secret.length < MIN_ADMIN_TOKEN) throw new MonitorSettingsError(`The admin token is at least ${MIN_ADMIN_TOKEN} characters. This one is shorter, so part of it may be missing`);
	if (secret.length > MAX_ADMIN_TOKEN || !/^[\x21-\x7e]+$/.test(secret)) throw new MonitorSettingsError("The admin token has a space or a character that cannot be sent. Copy it again");
	return { url: new URL(url.origin), token: secret };
}

/**
 * Asks the monitor for its list of domains with this token, to find a mistake before it is saved.
 * Null when it answered; otherwise what is wrong, in words that never carry the token.
 */
export async function monitorProblem(config: MonitorConfig, fetchFn: typeof fetch = fetch): Promise<string | null> {
	let answer;
	try {
		answer = await callMonitor(config, "GET", "/domains", undefined, fetchFn);
	} catch (err) {
		const reason = err instanceof Error ? err.message : String(err);
		return `Could not reach ${config.url.host}: ${reason.split(config.token).join("[token]")}`;
	}
	if (answer.status === 200 && Array.isArray(answer.body?.domains)) return null;
	if (answer.status === 401 || answer.status === 403) return `${config.url.host} refused this admin token. Copy it again from where you made it`;
	if (answer.status === 503) return `${config.url.host} answered, but it has no admin token of its own yet. The Domains page shows how to give it one. Then try again`;
	if (answer.status === 404 || answer.status === 200) return `${config.url.host} answered, but not as a Porchlight monitor. Check the address`;
	return `${config.url.host} answered HTTP ${answer.status}`;
}

export interface SavedMonitor {
	config: MonitorConfig;
	savedAt: string;
}

/** The saved connection, or null when there is none or the file does not hold a usable one. */
export async function readSavedMonitor(path: string): Promise<SavedMonitor | null> {
	try {
		const saved = JSON.parse(await readFile(path, "utf8")) as { url?: unknown; token?: unknown; savedAt?: unknown };
		return { config: parseMonitorSettings(saved.url, saved.token), savedAt: typeof saved.savedAt === "string" ? saved.savedAt : "" };
	} catch {
		return null;
	}
}

export async function saveMonitor(path: string, config: MonitorConfig): Promise<SavedMonitor> {
	const savedAt = new Date().toISOString();
	await writePrivate(path, `${JSON.stringify({ url: config.url.origin, token: config.token, savedAt }, null, "\t")}\n`);
	return { config, savedAt };
}

export async function forgetMonitor(path: string): Promise<void> {
	await rm(path, { force: true });
}
