// @ts-check

/**
 * Builds an element. Text is always set as text, never parsed as HTML: what
 * this page shows comes from repositories and DNS records, which an attacker
 * may control.
 *
 * @param {string} tag
 * @param {Record<string, unknown> | null} [props] `class`, `dataset`, `on<event>` handlers, properties, or attributes
 * @param {...(Node | string | number | null | undefined | false)} children
 * @returns {HTMLElement}
 */
export function h(tag, props, ...children) {
	const element = document.createElement(tag);
	for (const [key, value] of Object.entries(props ?? {})) {
		if (value === null || value === undefined || value === false) continue;
		if (key === "class") element.className = String(value);
		else if (key === "dataset") Object.assign(element.dataset, value);
		else if (key.startsWith("on") && typeof value === "function") {
			element.addEventListener(key.slice(2), /** @type {EventListener} */ (value));
		} else if (key in element && !key.startsWith("aria-")) {
			/** @type {any} */ (element)[key] = value;
		} else element.setAttribute(key, value === true ? "" : String(value));
	}
	append(element, children);
	return element;
}

/**
 * @param {Element} parent
 * @param {(Node | string | number | null | undefined | false)[]} children
 */
export function append(parent, children) {
	for (const child of children) {
		if (child === null || child === undefined || child === false) continue;
		parent.append(child instanceof Node ? child : document.createTextNode(String(child)));
	}
}

/**
 * @param {Element} parent
 * @param {...(Node | string | number | null | undefined | false)} children
 */
export function replace(parent, ...children) {
	parent.replaceChildren();
	append(parent, children);
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** Shapes drawn on a 16x16 grid. Severity is carried by shape and label as well as colour. */
const ICONS = {
	critical: [["path", { d: "M8 1.2 14.8 8 8 14.8 1.2 8Z", fill: "currentColor" }]],
	high: [["path", { d: "M8 2 14.5 13.5h-13Z", fill: "currentColor" }]],
	medium: [["rect", { x: 2.5, y: 2.5, width: 11, height: 11, rx: 2, fill: "currentColor" }]],
	low: [["circle", { cx: 8, cy: 8, r: 5, fill: "none", stroke: "currentColor", "stroke-width": 2 }]],
	good: [
		["circle", { cx: 8, cy: 8, r: 7, fill: "currentColor" }],
		["path", { d: "m4.8 8.2 2.2 2.2 4.2-4.6", fill: "none", stroke: "var(--surface)", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round" }],
	],
	warning: [
		["path", { d: "M8 1.5 15 14H1Z", fill: "currentColor" }],
		["path", { d: "M8 6v4M8 11.6v.4", fill: "none", stroke: "var(--on-warning)", "stroke-width": 1.6, "stroke-linecap": "round" }],
	],
	pending: [
		["circle", { cx: 8, cy: 8, r: 6, fill: "none", stroke: "currentColor", "stroke-width": 1.8 }],
		["path", { d: "M8 4.8V8l2.2 1.6", fill: "none", stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round" }],
	],
	chevron: [["path", { d: "m6 3.5 4.5 4.5L6 12.5", fill: "none", stroke: "currentColor", "stroke-width": 1.8, "stroke-linecap": "round", "stroke-linejoin": "round" }]],
	copy: [
		["rect", { x: 5.5, y: 5.5, width: 8, height: 8, rx: 1.5, fill: "none", stroke: "currentColor", "stroke-width": 1.5 }],
		["path", { d: "M10.5 3.5v-.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1H4", fill: "none", stroke: "currentColor", "stroke-width": 1.5 }],
	],
	plus: [["path", { d: "M8 3v10M3 8h10", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round" }]],
	minus: [["path", { d: "M3 8h10", fill: "none", stroke: "currentColor", "stroke-width": 2, "stroke-linecap": "round" }]],
	change: [["path", { d: "M2.5 5.5h9l-2.5-2.5M13.5 10.5h-9l2.5 2.5", fill: "none", stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round" }]],
};

/**
 * @param {keyof typeof ICONS} name
 * @param {string} [className]
 * @returns {SVGSVGElement}
 */
export function icon(name, className = "") {
	const svg = document.createElementNS(SVG_NS, "svg");
	svg.setAttribute("viewBox", "0 0 16 16");
	svg.setAttribute("aria-hidden", "true");
	svg.setAttribute("class", `icon ${className}`.trim());
	for (const [tag, attributes] of ICONS[name]) {
		const shape = document.createElementNS(SVG_NS, /** @type {string} */ (tag));
		for (const [key, value] of Object.entries(attributes)) shape.setAttribute(key, String(value));
		svg.append(shape);
	}
	return svg;
}

const SEVERITY_LABELS = { critical: "Critical", high: "High", medium: "Medium", low: "Low" };

/**
 * A severity as shape, colour and word together.
 *
 * @param {"critical" | "high" | "medium" | "low"} severity
 * @returns {HTMLElement}
 */
export function severityBadge(severity) {
	return h("span", { class: `severity severity-${severity}` }, icon(severity), SEVERITY_LABELS[severity]);
}

/**
 * @param {string} iso
 * @returns {string} for example "17 Nov 2026, 12:39"
 */
export function formatWhen(iso) {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return iso;
	return date.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** @param {number} count @param {string} one @param {string} many */
export function plural(count, one, many) {
	return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/**
 * Shows a short message that announces itself to screen readers and then leaves.
 *
 * @param {string} message
 * @param {"info" | "error"} [kind]
 */
export function toast(message, kind = "info") {
	const region = document.getElementById("toasts");
	if (!region) return;
	const item = h("div", { class: `toast toast-${kind}` }, message);
	region.append(item);
	setTimeout(() => item.remove(), kind === "error" ? 8000 : 4000);
}

/**
 * A stat tile: a label and the number it names.
 *
 * @param {string} label
 * @param {number | string} value
 * @param {Node | null} [mark] shown beside the label
 * @returns {HTMLElement}
 */
export function statTile(label, value, mark = null) {
	return h(
		"div",
		{ class: "tile" },
		h("div", { class: "tile-label" }, mark, label),
		h("div", { class: "tile-value" }, typeof value === "number" ? value.toLocaleString() : value),
	);
}
