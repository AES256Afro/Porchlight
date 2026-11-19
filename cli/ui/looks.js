// @ts-check
// The appearances offered under Settings → Appearance. A look is a name on
// <html data-look>, styled in styles.css; a few also change what a page
// does (which page opens first, where a finding's detail is shown).
// The server keeps the choice (`/api/settings`) and accepts only these ids.

/**
 * @typedef {{ id: string, name: string, description: string }} Look
 */

/** @type {readonly Look[]} */
export const LOOKS = [
	{ id: "today", name: "Standard", description: "The original look. Follows your Mac's light or dark setting." },
	{ id: "light", name: "Light and clean", description: "The same layout, always light." },
	{ id: "dashboard", name: "Severity dashboard", description: "Counts by severity stay in the sidebar on every page." },
	{ id: "tabs", name: "Top tabs", description: "The sections move to a bar along the top, leaving more room for lists." },
	{ id: "split", name: "Split view", description: "Findings on the left, the chosen one's detail on the right, like Mail." },
	{ id: "roadmap", name: "Roadmap first", description: "Opens on the Roadmap: what to fix, in order." },
	{ id: "terminal", name: "Terminal", description: "Monospace type, green on black." },
	{ id: "native", name: "Native Mac", description: "A grey sidebar and compact controls, like the Mac's own apps." },
	{ id: "cards", name: "Repository cards", description: "By repository shows each project as a card." },
	{ id: "model", name: "Model plan view", description: "A model's analysis sits beside each finding's detail." },
	{ id: "contrast", name: "High contrast", description: "Black and white, thick borders, underlined links." },
	{ id: "compact", name: "Compact and dense", description: "Smaller type and tighter rows, so more fits on screen." },
];

export const DEFAULT_LOOK = "today";

/** @param {unknown} id */
export function isLook(id) {
	return typeof id === "string" && LOOKS.some((look) => look.id === id);
}
