// @ts-check
// Click paths ("Settings → Model", "System Settings → Network → Firewall") as breadcrumbs, each
// step a link where it has a place of its own. Only the paths listed here become links: an arrow
// anywhere else ("1.2 → 1.3") stays text. Each address is fixed here, never taken from a scan or a
// request (invariant 8), and the text stays the same words, so the CLI and exports print it as is.
//
// - "page": a place in Porchlight itself (`#/…`).
// - "web": a page on another site (GitHub's settings, Cloudflare's dashboard), opened in the browser.
// - "mac": a pane of System Settings on this Mac (`x-apple.systempreferences:`), linked only when
//   the page is shown on the Mac itself; from another device it would open that device's settings.
// - "plain": a path Porchlight has no address for (BoxPilot's, another app's), shown as breadcrumbs.

/** @typedef {"page" | "web" | "mac" | "plain"} PathKind */
/** @typedef {{ label: string, href: string | null }} Crumb */
/** @typedef {{ text: string, kind: PathKind, crumbs: Crumb[] }} KnownPath */

const SEP = " → ";

/** A pane of System Settings. Each id is a pane macOS ships (/System/Library/ExtensionKit/Extensions). */
const pane = (/** @type {string} */ id) => `x-apple.systempreferences:${id}`;
const SYSTEM_SETTINGS = "x-apple.systempreferences:";
const GENERAL = pane("com.apple.systempreferences.GeneralSettings");
const SHARING = pane("com.apple.Sharing-Settings.extension");
const NETWORK = pane("com.apple.Network-Settings.extension");
const PRIVACY = pane("com.apple.settings.PrivacySecurity.extension");
const USERS = pane("com.apple.Users-Groups-Settings.extension");

/** Cloudflare's dashboard. `:account` and `:zone` are Cloudflare's own placeholders: it asks which one. */
const CLOUDFLARE = "https://dash.cloudflare.com/";
const cloudflare = (/** @type {string} */ to) => `https://dash.cloudflare.com/?to=/:account/${to}`;

/** @type {[text: string, kind: PathKind, hrefs: (string | null)[]][]} */
const LIST = [
	// Porchlight's own Settings page, by section (see `settingsAnchor`).
	["Settings → Model", "page", ["#/settings", "#/settings/model"]],
	["Settings → Access from other devices", "page", ["#/settings", "#/settings/access"]],
	["Settings → Appearance", "page", ["#/settings", "#/settings/appearance"]],
	["Settings → Projects", "page", ["#/settings", "#/settings/projects"]],
	["Settings → Cloudflare", "page", ["#/settings", "#/settings/cloudflare"]],
	["Settings → Monitor", "page", ["#/settings", "#/settings/monitor"]],

	// Cloudflare's dashboard, as the Cloudflare audit's fixes name it.
	["Cloudflare → SSL/TLS → Overview", "web", [CLOUDFLARE, cloudflare(":zone/ssl-tls"), cloudflare(":zone/ssl-tls")]],
	["Cloudflare → SSL/TLS → Edge Certificates", "web", [CLOUDFLARE, cloudflare(":zone/ssl-tls"), cloudflare(":zone/ssl-tls/edge-certificates")]],
	["Cloudflare → SSL/TLS → Origin Server", "web", [CLOUDFLARE, cloudflare(":zone/ssl-tls"), cloudflare(":zone/ssl-tls/origin")]],
	["Cloudflare → DNS → Records", "web", [CLOUDFLARE, cloudflare(":zone/dns/records"), cloudflare(":zone/dns/records")]],
	["Cloudflare → DNS → Settings", "web", [CLOUDFLARE, cloudflare(":zone/dns/records"), cloudflare(":zone/dns/settings")]],
	["Cloudflare → Security → Settings", "web", [CLOUDFLARE, cloudflare(":zone/security/settings"), cloudflare(":zone/security/settings")]],
	["Cloudflare → Manage Account → Members", "web", [CLOUDFLARE, null, cloudflare("members")]],
	["Cloudflare → Manage Account → Account API Tokens", "web", [CLOUDFLARE, null, cloudflare("api-tokens")]],
	["Cloudflare → My Profile → API Tokens", "web", [CLOUDFLARE, "https://dash.cloudflare.com/profile", "https://dash.cloudflare.com/profile/api-tokens"]],

	// GitHub.
	[
		"Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token",
		"web",
		[
			"https://github.com/settings/profile",
			"https://github.com/settings/apps",
			"https://github.com/settings/tokens",
			"https://github.com/settings/personal-access-tokens",
			"https://github.com/settings/personal-access-tokens/new",
		],
	],

	// System Settings. A toggle or a sheet inside a pane has no address of its own, so it is text.
	["System Settings → General → Software Update", "mac", [SYSTEM_SETTINGS, GENERAL, pane("com.apple.Software-Update-Settings.extension")]],
	...["Remote Login", "Screen Sharing", "Remote Management", "Remote Application Scripting", "File Sharing", "Printer Sharing"].map(
		(service) => /** @type {[string, PathKind, (string | null)[]]} */ ([`System Settings → General → Sharing → ${service}`, "mac", [SYSTEM_SETTINGS, GENERAL, SHARING, null]]),
	),
	["System Settings → General → AirDrop & Handoff → AirPlay Receiver", "mac", [SYSTEM_SETTINGS, GENERAL, pane("com.apple.AirDrop-Handoff-Settings.extension"), null]],
	["System Settings → Network → Firewall → Options → Enable stealth mode", "mac", [SYSTEM_SETTINGS, NETWORK, null, null, null]],
	["System Settings → Network → Firewall", "mac", [SYSTEM_SETTINGS, NETWORK, null]],
	["System Settings → Privacy & Security → FileVault", "mac", [SYSTEM_SETTINGS, PRIVACY, null]],
	["System Settings → Privacy & Security", "mac", [SYSTEM_SETTINGS, PRIVACY]],
	["System Settings → Users & Groups → Automatically log in as", "mac", [SYSTEM_SETTINGS, USERS, null]],
	["System Settings → Users & Groups → Guest User", "mac", [SYSTEM_SETTINGS, USERS, null]],
	[
		"System Settings → Lock Screen → Require password after screen saver begins or display is turned off",
		"mac",
		[SYSTEM_SETTINGS, pane("com.apple.Lock-Screen-Settings.extension"), null],
	],

	// Places Porchlight has no address for.
	["Apps → Porchlight → Settings", "plain", []],
	["Apps → Porchlight", "plain", []],
	["Settings → API in Studio", "plain", []],
];

/** @type {KnownPath[]} */
export const KNOWN_PATHS = LIST.map(([text, kind, hrefs]) => ({
	text,
	kind,
	crumbs: text.split(SEP).map((label, index) => ({ label, href: hrefs[index] ?? null })),
}));

// Longest first, so "… → Firewall → Options → …" wins over "… → Firewall", and whole words only,
// so "Settings → Model" is not found inside a longer name.
const byText = new Map(KNOWN_PATHS.map((path) => [path.text, path]));
const PATTERN = new RegExp(
	`(?<![\\w&])(${[...byText.keys()]
		.sort((a, b) => b.length - a.length)
		.map((text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
		.join("|")})(?![\\w])`,
);

/**
 * Text cut into plain parts and the known paths in it, in order.
 *
 * @param {string} text
 * @returns {(string | KnownPath)[]}
 */
export function splitPaths(text) {
	const parts = text.split(PATTERN);
	/** @type {(string | KnownPath)[]} */
	const out = [];
	parts.forEach((part, index) => {
		if (index % 2 === 1) out.push(/** @type {KnownPath} */ (byText.get(part)));
		else if (part !== "") out.push(part);
	});
	return out;
}

/**
 * Whether the page may link to an address (S46): one of its own pages (`#/…`), a file of its own
 * (`/…`, not `//host`), a web page over https, a System Settings pane, or a file the page made
 * itself (`blob:`). Nothing else, so a `javascript:` or `data:` address from data never becomes a link.
 *
 * @param {string} href
 */
export function linkAllowed(href) {
	const value = href.trim();
	if (value === "" || value.startsWith("#")) return true;
	if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\")) return true;
	return /^(https:\/\/|x-apple\.systempreferences:|blob:)/i.test(value);
}

/**
 * The section of the Settings page an address names, as an element id, or null.
 *
 * @param {string[]} path the address's path, as `parseHash` gives it
 */
export function settingsAnchor(path) {
	const sections = ["model", "download", "projects", "access", "appearance", "cloudflare", "monitor"];
	return path[0] === "settings" && sections.includes(path[1] ?? "") ? `settings-${path[1]}` : null;
}
