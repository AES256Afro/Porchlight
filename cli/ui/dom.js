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
	download: [["path", { d: "M8 2.5v7.5M4.8 7 8 10.2 11.2 7M3 13h10", fill: "none", stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round", "stroke-linejoin": "round" }]],
	/** Marks text a model wrote. */
	spark: [["path", { d: "M8 1.5c.6 3.9 2.6 5.9 6.5 6.5-3.9.6-5.9 2.6-6.5 6.5-.6-3.9-2.6-5.9-6.5-6.5 3.9-.6 5.9-2.6 6.5-6.5Z", fill: "currentColor" }]],
	overview: [
		["rect", { x: 2, y: 2, width: 5, height: 5, rx: 1, fill: "none", stroke: "currentColor", "stroke-width": 1.5 }],
		["rect", { x: 9, y: 2, width: 5, height: 5, rx: 1, fill: "none", stroke: "currentColor", "stroke-width": 1.5 }],
		["rect", { x: 2, y: 9, width: 5, height: 5, rx: 1, fill: "none", stroke: "currentColor", "stroke-width": 1.5 }],
		["rect", { x: 9, y: 9, width: 5, height: 5, rx: 1, fill: "none", stroke: "currentColor", "stroke-width": 1.5 }],
	],
	findings: [["path", { d: "M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01", fill: "none", stroke: "currentColor", "stroke-width": 1.7, "stroke-linecap": "round" }]],
	roadmap: [
		["path", { d: "m2.5 4 1.2 1.2L5.8 3M2.5 11.2l1.2 1.2 2.1-2.2", fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round", "stroke-linejoin": "round" }],
		["path", { d: "M8.5 4.2h5M8.5 11.6h5", fill: "none", stroke: "currentColor", "stroke-width": 1.6, "stroke-linecap": "round" }],
	],
	settings: [
		["circle", { cx: 8, cy: 8, r: 2.2, fill: "none", stroke: "currentColor", "stroke-width": 1.5 }],
		["path", { d: "M8 1.8v1.8M8 12.4v1.8M1.8 8h1.8M12.4 8h1.8M3.6 3.6l1.3 1.3M11.1 11.1l1.3 1.3M3.6 12.4l1.3-1.3M11.1 4.9l1.3-1.3", fill: "none", stroke: "currentColor", "stroke-width": 1.5, "stroke-linecap": "round" }],
	],
	domains: [
		["circle", { cx: 8, cy: 8, r: 6, fill: "none", stroke: "currentColor", "stroke-width": 1.5 }],
		["path", { d: "M2 8h12M8 2c2 2 2.6 3.8 2.6 6S10 12 8 14c-2-2-2.6-3.8-2.6-6S6 4 8 2Z", fill: "none", stroke: "currentColor", "stroke-width": 1.3 }],
	],
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
 * A step of a suggested fix. The server marks commands with backticks; they
 * become code, and everything else stays plain text.
 *
 * @param {string} step
 * @returns {(Node | string)[]}
 */
export function stepNodes(step) {
	return step.split("`").map((part, index) => (index % 2 === 1 ? h("code", null, part) : part));
}

/**
 * A labelled drop-down.
 *
 * @param {string} label read by screen readers; the visible text is the selected option
 * @param {[value: string, text: string][]} options
 * @param {string} value
 * @param {(value: string) => void} onChange
 * @returns {HTMLSelectElement}
 */
export function select(label, options, value, onChange) {
	const element = /** @type {HTMLSelectElement} */ (
		h("select", { "aria-label": label, onchange: () => onChange(element.value) }, ...options.map(([optionValue, text]) => h("option", { value: optionValue }, text)))
	);
	element.value = options.some(([optionValue]) => optionValue === value) ? value : (options[0]?.[0] ?? "");
	return element;
}

/**
 * "Showing 51 to 100 of 1,860" with Previous and Next.
 *
 * @param {{ page: number, pages: number, from: number, to: number, total: number }} view
 * @param {string} noun plural, for example "findings"
 * @param {(page: number) => void} go
 */
export function pager(view, noun, go) {
	if (view.total === 0) return null;
	return h(
		"nav",
		{ class: "pager", "aria-label": "Pages" },
		h("span", null, `Showing ${view.from.toLocaleString()} to ${view.to.toLocaleString()} of ${view.total.toLocaleString()} ${noun}`),
		view.pages > 1
			? h(
					"span",
					{ class: "pager-buttons" },
					h("button", { type: "button", class: "button", disabled: view.page <= 1, onclick: () => go(view.page - 1) }, "Previous"),
					h("span", { class: "pager-page" }, `Page ${view.page} of ${view.pages}`),
					h("button", { type: "button", class: "button", disabled: view.page >= view.pages, onclick: () => go(view.page + 1) }, "Next"),
				)
			: null,
	);
}

/**
 * A notice above content: the first few lines, the rest folded away.
 *
 * @param {"warning" | "error"} kind
 * @param {string} title
 * @param {string[]} lines
 */
export function banner(kind, title, lines) {
	const first = lines.slice(0, 3);
	const rest = lines.slice(3);
	return h(
		"div",
		{ class: `banner banner-${kind}`, role: kind === "error" ? "alert" : "note" },
		icon("warning"),
		h(
			"div",
			null,
			h("strong", null, title),
			first.length > 0 ? h("ul", null, ...first.map((line) => h("li", null, line))) : null,
			rest.length > 0 ? h("details", null, h("summary", null, `${rest.length} more`), h("ul", null, ...rest.map((line) => h("li", null, line)))) : null,
		),
	);
}

/** What each phase of the roadmap is called. */
export const PHASE_TITLES = { now: "Fix now", next: "Fix next", schedule: "Schedule", later: "When convenient" };

/**
 * A message in place of content: nothing yet, nothing matching, or something went wrong.
 *
 * @param {string} title
 * @param {string} text
 * @param {Node | null} [action]
 */
export function emptyState(title, text, action = null) {
	return h("div", { class: "empty" }, h("h2", null, title), h("p", null, text), action);
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
