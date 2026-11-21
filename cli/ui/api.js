// @ts-check
import { plainError } from "./hints.js";

const STORAGE_KEY = "porchlight.session";

export class ApiError extends Error {
	/**
	 * @param {number} status
	 * @param {string} message
	 * @param {Record<string, any>} body
	 */
	constructor(status, message, body) {
		super(message);
		this.status = status;
		this.body = body;
	}
}

/**
 * The link printed by `porchlight ui` carries the session key after `#k=`.
 * Keep it for this tab only and take it out of the address bar, so it is not
 * left in history or copied along with the link.
 */
export function adoptSessionKey() {
	const match = location.hash.match(/^#k=([\w-]+)$/);
	if (!match?.[1]) return;
	setSessionKey(match[1]);
	history.replaceState(null, "", `${location.pathname}#/overview`);
}

/** @param {string} key */
export function setSessionKey(key) {
	try {
		sessionStorage.setItem(STORAGE_KEY, key.trim());
	} catch {
		memoryKey = key.trim();
	}
}

let memoryKey = "";

/** Whether this tab holds a key, so a refusal can be told apart from a first visit. */
export function hasSessionKey() {
	return sessionKey() !== "";
}

/** What to say when Porchlight does not answer at all. app.js sets it once it knows how Porchlight was started. */
let offlineMessage = "Porchlight is not answering. If it was closed, start it again.";

/** @param {string} message */
export function setOfflineMessage(message) {
	offlineMessage = message;
}

function sessionKey() {
	try {
		return sessionStorage.getItem(STORAGE_KEY) ?? memoryKey;
	} catch {
		return memoryKey;
	}
}

/**
 * Fetches a file from the API and hands it to the browser to save. A plain
 * link cannot do this, because the request has to carry the session key.
 *
 * @param {string} path
 * @returns {Promise<string>} the name the file was saved under
 */
export async function download(path) {
	let response;
	try {
		response = await fetch(`/api${path}`, { headers: { "x-porchlight-session": sessionKey() } });
	} catch {
		throw new ApiError(0, offlineMessage, {});
	}
	if (!response.ok) {
		const data = await response.json().catch(() => ({}));
		throw new ApiError(response.status, typeof data.error === "string" ? plainError(data.error) : response.status >= 502 && response.status <= 504 ? offlineMessage : `Export failed (${response.status})`, data);
	}
	const filename = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "porchlight-export";
	const url = URL.createObjectURL(await response.blob());
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.append(link);
	link.click();
	link.remove();
	setTimeout(() => URL.revokeObjectURL(url), 10_000);
	return filename;
}

/**
 * Reads a text file from the API rather than saving it, such as a discussion to copy.
 *
 * @param {string} path
 * @returns {Promise<string>}
 */
export async function apiText(path) {
	let response;
	try {
		response = await fetch(`/api${path}`, { headers: { "x-porchlight-session": sessionKey() } });
	} catch {
		throw new ApiError(0, offlineMessage, {});
	}
	if (!response.ok) {
		const data = await response.json().catch(() => ({}));
		throw new ApiError(response.status, failureWords(response.status, data), data);
	}
	return response.text();
}

/**
 * How long a read may take before it is given up on (R6U-9): over a slow tailnet link a request that
 * never answers would hold a page or a poll for ever. Changes and a model's answers can take minutes,
 * so they wait unless the caller sets a limit.
 */
const READ_TIMEOUT_MS = 60_000;

/**
 * A proxy in front of Porchlight answers 502 to 504 when Porchlight itself does not: that is said as
 * "not answering", not as "Request failed (502)".
 *
 * @param {number} status
 * @param {Record<string, any>} data
 */
function failureWords(status, data) {
	if (typeof data.error === "string") return plainError(data.error);
	if (status >= 502 && status <= 504) return offlineMessage;
	return `Request failed (${status})`;
}

/**
 * Calls this server's API. Throws ApiError for any non-2xx answer.
 *
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 * @param {{ signal?: AbortSignal, timeout?: number }} [options] `signal` stops the request; the call then throws an ApiError with `body.stopped`. `timeout` gives up after that many milliseconds (reads default to a minute)
 * @returns {Promise<Record<string, any>>}
 */
export async function api(method, path, body, options = {}) {
	let response;
	const limit = options.timeout ?? (method === "GET" ? READ_TIMEOUT_MS : 0);
	const timer = limit > 0 && typeof AbortSignal.timeout === "function" ? AbortSignal.timeout(limit) : null;
	const signal = timer && options.signal ? AbortSignal.any([options.signal, timer]) : (timer ?? options.signal);
	try {
		response = await fetch(`/api${path}`, {
			method,
			signal,
			headers: {
				"x-porchlight-session": sessionKey(),
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch {
		// Stopped by the owner, which is not the same as Porchlight not answering.
		if (options.signal?.aborted) throw new ApiError(0, "Stopped", { stopped: true });
		if (timer?.aborted) throw new ApiError(0, "Porchlight took too long to answer. The connection may be slow; try again in a moment.", { timeout: true });
		throw new ApiError(0, offlineMessage, {});
	}
	/** @type {Record<string, any>} */
	let data = {};
	try {
		data = await response.json();
	} catch {
		// A non-JSON answer is reported by its status below.
	}
	if (!response.ok) throw new ApiError(response.status, failureWords(response.status, data), data);
	return data;
}
