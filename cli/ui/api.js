// @ts-check

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
		throw new ApiError(0, "Porchlight is not running. Start it again with: porchlight ui", {});
	}
	if (!response.ok) {
		const data = await response.json().catch(() => ({}));
		throw new ApiError(response.status, data.error ?? `Export failed (${response.status})`, data);
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
				"x-porchlight-session": sessionKey(),
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	} catch {
		throw new ApiError(0, "Porchlight is not running. Start it again with: porchlight ui", {});
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
