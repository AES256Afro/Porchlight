// @ts-check

const STORAGE_KEY = "securityx.session";

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
 * The link printed by `securityx ui` carries the session key after `#k=`.
 * Keep it for this tab only and take it out of the address bar, so it is not
 * left in history or copied along with the link.
 */
export function adoptSessionKey() {
	const match = location.hash.match(/^#k=([\w-]+)$/);
	if (!match?.[1]) return;
	setSessionKey(match[1]);
	history.replaceState(null, "", `${location.pathname}#/repos`);
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

function sessionKey() {
	try {
		return sessionStorage.getItem(STORAGE_KEY) ?? memoryKey;
	} catch {
		return memoryKey;
	}
}

/**
 * Calls this server's API. Throws ApiError for any non-2xx answer.
 *
 * @param {string} method
 * @param {string} path
 * @param {unknown} [body]
 * @returns {Promise<Record<string, any>>}
 */
export async function api(method, path, body) {
	let response;
	try {
		response = await fetch(`/api${path}`, {
			method,
			headers: {
				"x-securityx-session": sessionKey(),
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch {
		throw new ApiError(0, "SecurityX is not running. Start it again with: securityx ui", {});
	}
	/** @type {Record<string, any>} */
	let data = {};
	try {
		data = await response.json();
	} catch {
		// A non-JSON answer is reported by its status below.
	}
	if (!response.ok) throw new ApiError(response.status, data.error ?? `Request failed (${response.status})`, data);
	return data;
}
