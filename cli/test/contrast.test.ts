import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LOOKS } from "../ui/looks.js";

// The page's colours are tokens on :root, redefined for dark mode and by some looks. Every look is
// read in both light and dark appearances and checked against WCAG AA: text 4.5:1, and 3:1 for what
// is not text but must be seen (a severity mark, a field's edge, the focus ring).
const css = readFileSync(new URL("../ui/styles.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

interface Rule {
	selectors: string[];
	body: string;
	/** Inside @media (prefers-color-scheme: dark). */
	dark: boolean;
	/** Inside any @media. */
	inMedia: boolean;
}

function parseRules(text: string): Rule[] {
	const rules: Rule[] = [];
	const stack: string[] = [];
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === "{") {
			stack.push(text.slice(start, i).trim());
			start = i + 1;
		} else if (text[i] === "}") {
			const prelude = stack.pop() ?? "";
			if (!prelude.startsWith("@")) {
				rules.push({
					selectors: prelude.split(",").map((selector) => selector.trim()),
					body: text.slice(start, i),
					dark: stack.some((outer) => /prefers-color-scheme:\s*dark/.test(outer)),
					inMedia: stack.some((outer) => outer.startsWith("@media")),
				});
			}
			start = i + 1;
		}
	}
	return rules;
}

const rules = parseRules(css);
const declarations = (body: string) => Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((match) => [match[1]!, match[2]!.trim()]));

/** The tokens in force for a look: the base, its dark redefinition, then the look's own (more specific, so last). */
function tokens(look: string, dark: boolean): Record<string, string> {
	const result: Record<string, string> = {};
	for (const rule of rules) if (!rule.inMedia && rule.selectors.includes(":root")) Object.assign(result, declarations(rule.body));
	if (dark) for (const rule of rules) if (rule.dark && rule.selectors.includes(":root")) Object.assign(result, declarations(rule.body));
	for (const rule of rules) {
		if (rule.selectors.includes(`:root[data-look="${look}"]`) && (!rule.inMedia || (dark && rule.dark))) Object.assign(result, declarations(rule.body));
	}
	return result;
}

type Rgb = [number, number, number];

function parseColor(value: string | undefined, under: Rgb): Rgb {
	assert.ok(value, "a token is missing");
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value);
	if (hex) {
		const digits = hex[1]!.length === 3 ? [...hex[1]!].map((digit) => digit + digit).join("") : hex[1]!;
		return [0, 2, 4].map((at) => Number.parseInt(digits.slice(at, at + 2), 16)) as Rgb;
	}
	const rgba = /^rgba?\(([^)]+)\)$/.exec(value);
	if (rgba) {
		const [r, g, b, a = 1] = rgba[1]!.split(",").map(Number) as [number, number, number, number?];
		// A translucent colour is seen over what is under it.
		return [r, g, b].map((channel, at) => channel * a + under[at]! * (1 - a)) as Rgb;
	}
	throw new Error(`Cannot read the colour ${value}`);
}

function luminance([r, g, b]: Rgb): number {
	const linear = (channel: number) => {
		const c = channel / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

function ratio(a: Rgb, b: Rgb): number {
	const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
	return (light + 0.05) / (dark + 0.05);
}

const TEXT = ["--ink", "--ink-2", "--muted", "--link", "--critical-ink"];
const MARKS = ["--critical", "--serious-mark", "--warning-mark", "--good", "--muted", "--field-border", "--accent-hover"];

test("every look reads at WCAG AA in light and dark", () => {
	const failures: string[] = [];
	for (const { id } of LOOKS) {
		for (const dark of [false, true]) {
			const set = tokens(id, dark);
			for (const background of ["--page", "--surface"]) {
				const under = parseColor(set[background], [255, 255, 255]);
				const check = (name: string, minimum: number) => {
					const measured = ratio(parseColor(set[name], under), under);
					if (measured < minimum) failures.push(`${id} (${dark ? "dark" : "light"}): ${name} on ${background} is ${measured.toFixed(2)}:1, needs ${minimum}:1`);
				};
				for (const name of TEXT) check(name, 4.5);
				for (const name of MARKS) check(name, 3);
			}
			const accent = parseColor(set["--accent"], [255, 255, 255]);
			const onAccent = ratio(parseColor(set["--on-accent"], accent), accent);
			if (onAccent < 4.5) failures.push(`${id} (${dark ? "dark" : "light"}): button text on --accent is ${onAccent.toFixed(2)}:1`);
		}
	}
	assert.deepEqual(failures, []);
});

test("marks and fields use the tones made for them, not the fills", () => {
	// --warning and --serious are tints for banners; a mark drawn in them disappears on a light page.
	assert.deepEqual(css.match(/(?<![\w-])color:\s*var\(--(warning|serious)\)/g) ?? [], []);
	for (const rule of rules.filter((candidate) => candidate.selectors.some((selector) => /^(input|select|textarea)$/.test(selector)))) {
		assert.ok(!/border:[^;]*var\(--border\)/.test(rule.body), `${rule.selectors.join(", ")} must use --field-border`);
	}
});

test("type, corners and spacing stay on their scales", () => {
	// Each size and corner is a token; a new one means adding a step, on purpose.
	const sizes = [...css.matchAll(/font-size:\s*([^;]+);/g)].map((match) => match[1]!.trim());
	assert.deepEqual(sizes.filter((size) => !/^var\(--text-(xs|sm|md|lg|xl|2xl)\)$/.test(size)), []);
	assert.deepEqual([...new Set(sizes)].length <= 6, true);
	const corners = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map((match) => match[1]!.trim());
	assert.deepEqual(corners.filter((corner) => !/^(var\(--radius-(sm|md|lg|pill)\)|0|50%)$/.test(corner)), []);
	// Spacing is plain pixels, on the scale written in styles.css.
	const scale = new Set([0, 1, 2, 4, 6, 8, 12, 16, 20, 24, 32, 48, 64]);
	const off: string[] = [];
	for (const match of css.matchAll(/(?:^|[;{\s])((?:padding|margin|gap|row-gap|column-gap)(?:-[a-z-]+)?):\s*([^;{}]+);/g)) {
		for (const px of match[2]!.matchAll(/-?(\d+(?:\.\d+)?)px/g)) if (!scale.has(Number(px[1]))) off.push(`${match[1]}: ${match[2]}`);
	}
	assert.deepEqual(off, []);
});
