// @ts-check
// Shows the chosen look in the page. The list of looks is in looks.js, which the server shares.
import { DEFAULT_LOOK, isLook } from "./looks.js";

/** The page an address with no section opens. */
export function homeSection(look = currentLook()) {
	return look === "roadmap" ? "roadmap" : "overview";
}

export function currentLook() {
	const id = document.documentElement.dataset.look;
	return isLook(id) ? /** @type {string} */ (id) : DEFAULT_LOOK;
}

const REMEMBERED = "securityx-look";

/**
 * Shows a look. It is also remembered in this browser, only so the next load
 * starts in it before the server has answered; the server's copy decides.
 *
 * @param {string} id
 */
export function applyLook(id) {
	const look = isLook(id) ? id : DEFAULT_LOOK;
	document.documentElement.dataset.look = look;
	try {
		localStorage.setItem(REMEMBERED, look);
	} catch {
		// Storage can be off; the server's copy still applies once loaded.
	}
}

/** The look this browser last showed, for the first paint. */
export function rememberedLook() {
	try {
		const id = localStorage.getItem(REMEMBERED);
		return isLook(id) ? /** @type {string} */ (id) : DEFAULT_LOOK;
	} catch {
		return DEFAULT_LOOK;
	}
}
