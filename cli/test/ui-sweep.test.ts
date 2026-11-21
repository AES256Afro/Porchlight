// Static sweeps of the page (M14, S46, UI-B6, UI-B7): each reads cli/ui as text and fails on a pattern
// the conventions in CLAUDE.md forbid. A new exception is added to a list here, on purpose.
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { test } from "node:test";
import { STYLES } from "../src/ui/server.ts";

const UI = new URL("../ui/", import.meta.url);
const names = (await readdir(UI)).filter((name) => name.endsWith(".js")).sort();
const files = await Promise.all(names.map(async (name) => ({ name, text: await readFile(new URL(name, UI), "utf8") })));
const html = await readFile(new URL("index.html", UI), "utf8");
// Every stylesheet, in the order the page loads them (STYLES in cli/src/ui/server.ts).
const css = (await Promise.all(STYLES.map((name) => readFile(new URL(`${name}.css`, UI), "utf8")))).join("\n");

/** Every line of every module that matches, as "file:line: text". */
function find(pattern: RegExp, skip: (name: string, line: string) => boolean = () => false): string[] {
	const found: string[] = [];
	for (const { name, text } of files) {
		text.split("\n").forEach((line, index) => {
			if (pattern.test(line) && !skip(name, line)) found.push(`${name}:${index + 1}: ${line.trim()}`);
		});
	}
	return found;
}

/** A line that is only a comment, which may name what it forbids. */
const comment = (line: string) => /^\s*(\/\/|\*|\/\*\*)/.test(line);

test("no HTML is built from strings, and no inline script or style (invariant 8, S46)", () => {
	// dom.js names these keys to refuse them.
	assert.deepEqual(
		find(/innerHTML|outerHTML|srcdoc|insertAdjacentHTML|document\.write|DOMParser|createContextualFragment/, (name, line) => comment(line) || (name === "dom.js" && /REFUSED_PROPS/.test(line))),
		[],
	);
	assert.deepEqual(find(/\bstyle\s*[:=]\s*["'`{]|\.style\.|setAttribute\(\s*["']style|cssText/, (_, line) => comment(line)), []);
	assert.deepEqual(find(/["'`]javascript:|["'`]data:text|["'`]vbscript:/i, (_, line) => comment(line)), []);
	assert.deepEqual(find(/\beval\(|new Function\(|setTimeout\(\s*["'`]/, (_, line) => comment(line)), []);
	// The page itself: one module script, no inline script, style or handler.
	assert.deepEqual(html.match(/<script(?![^>]*\bsrc=)[^>]*>/g) ?? [], []);
	assert.deepEqual(html.match(/\sstyle=|<style|\son[a-z]+=/gi) ?? [], []);
});

test("h() refuses markup, inline style and addresses in a scheme the page never uses (S46)", async () => {
	const created: Record<string, unknown>[] = [];
	const element = () => {
		const props: Record<string, unknown> = { className: "", dataset: {}, innerHTML: "", srcdoc: "", href: "", style: {} };
		Object.assign(props, { setAttribute: (key: string, value: string) => (props[`@${key}`] = value), addEventListener: () => {}, append: () => {} });
		created.push(props);
		return props;
	};
	const globals = globalThis as { document?: unknown; Node?: unknown };
	const before = { document: globals.document, Node: globals.Node };
	globals.document = { createElement: element, createTextNode: (text: string) => ({ text }) };
	globals.Node = class {};
	try {
		const dom = (await import(new URL("../ui/dom.js", import.meta.url).href)) as { h: (tag: string, props?: Record<string, unknown> | null) => unknown; REFUSED_PROPS: string[] };
		for (const key of ["innerHTML", "outerHTML", "srcdoc", "insertAdjacentHTML", "style"]) {
			assert.ok(dom.REFUSED_PROPS.includes(key), key);
			assert.throws(() => dom.h("div", { [key]: "<img src=x onerror=alert(1)>" }), new RegExp(`does not set ${key}`), key);
		}
		assert.throws(() => dom.h("iframe"), /does not build/);
		assert.throws(() => dom.h("script"), /does not build/);
		assert.throws(() => dom.h("button", { onclick: "alert(1)" }), /only to a function/);
		for (const href of ["javascript:alert(1)", " JavaScript:alert(1)", "data:text/html,<b>", "//evil.example/", "http://plain.example/", "vbscript:x"]) {
			assert.throws(() => dom.h("a", { href }), /does not link/, href);
		}
		for (const href of ["#/findings?severity=high", "https://osv.dev/vulnerability/GHSA-x", "x-apple.systempreferences:com.apple.preference.security", "/favicon.svg", "blob:http://127.0.0.1/abc"]) {
			assert.doesNotThrow(() => dom.h("a", { href }), href);
		}
		// Text is set as text and an ordinary attribute still goes through.
		const made = dom.h("p", { class: "hint", "aria-label": "Fine" }) as Record<string, unknown>;
		assert.equal(made.className, "hint");
		assert.equal(made["@aria-label"], "Fine");
	} finally {
		globals.document = before.document;
		globals.Node = before.Node;
	}
});

test("no working button uses disabled: it would drop keyboard focus (UI-B6, I-U1)", () => {
	// Form fields that do not apply to the chosen checks are disabled, as fields: they are not buttons.
	const fields = new Set(["scan-options.js:historySelect", "scan-options.js:localBox"]);
	const found = find(/(?<![-\w"'])disabled\s*[:=](?!=)|\bdisabled\b\s*,/, (name, line) => {
		if (comment(line) || /aria-disabled|:disabled|isOff|setOff/.test(line)) return true;
		const target = /(\w+)\.disabled\s*=/.exec(line)?.[1];
		return target !== undefined && fields.has(`${name}:${target}`);
	});
	assert.deepEqual(found, []);
	// The guard that makes aria-disabled mean "does nothing" is in place.
	const app = files.find((file) => file.name === "app.js")?.text ?? "";
	assert.match(app, /addEventListener\(\s*"click"[\s\S]{0,400}aria-disabled="true"[\s\S]{0,400}stopImmediatePropagation/);
	assert.match(app, /addEventListener\(\s*"submit"[\s\S]{0,200}isOff\(event\.submitter\)/);
	// Hover never lights up a button that cannot be used.
	assert.match(css, /\.button\.primary:hover:not\(:disabled\):not\(\[aria-disabled="true"\]\)/);
});

test("no progress slot is a live region: progress is said with announce() at a calm pace (UI-B7, H-U1, E-U1, I-U2)", () => {
	// The live regions left are each filled once, on an action, never by a poll: reviewed one by one.
	const reviewed = new Set([
		"discussion.js:status", // the wait for one follow-up, then its error
		"overview.js:previewSlot", // what a folder holds, asked for when the box is settled
		"investigate.js:startProblem", // why a run could not start
		"projects.js:previewBox", // the check of a folder, asked for when the box is settled
		"scan-options.js:analyseNote", // what Deep sends, when the box is ticked
		"model-settings.js:result", // the answer to "Send a test message"
	]);
	const found: string[] = [];
	for (const { name, text } of files) {
		for (const match of text.matchAll(/(?:const (\w+) = )?h\([^\n]*"aria-live"[^\n]*/g)) {
			const variable = match[1] ?? (/\}, (\w+)\)/.exec(match[0])?.[1] ?? "");
			if (!reviewed.has(`${name}:${variable}`)) found.push(`${name}: ${match[0].trim()}`);
			if (/progress/.test(match[0])) found.push(`${name}: a live region holds progress: ${match[0].trim()}`);
		}
		// A role that is a live region, put on something that holds a progress bar.
		for (const match of text.matchAll(/role: "(status|log|alert)"[^\n]*h\("progress"/g)) found.push(`${name}: ${match[0]}`);
	}
	assert.deepEqual(found, []);
	// None of the reviewed slots is ever handed a progress bar.
	for (const entry of reviewed) {
		const [name, variable] = entry.split(":") as [string, string];
		const text = files.find((file) => file.name === name)?.text ?? "";
		for (const match of text.matchAll(new RegExp(`replace\\(\\s*${variable}\\b[\\s\\S]{0,600}?\\);`, "g"))) {
			assert.ok(!/h\("progress"/.test(match[0]), `${entry} is given a progress bar`);
		}
	}
	// The page's own live regions: the toasts and the calm announcer, nothing else.
	assert.deepEqual(html.match(/aria-live="[a-z]+"/g), ['aria-live="polite"', 'aria-live="polite"']);
	// Activity is a log that adds lines, not a list that is drawn again whole.
	const activity = files.find((file) => file.name === "activity.js")?.text ?? "";
	assert.match(activity, /role: "log"/);
	assert.doesNotMatch(activity, /replace\(\s*list\b/);
});

/**
 * Whether the right side of an assignment is only Porchlight's own words: string literals with nothing
 * put into them, chosen between by conditions (`running ? "Scanning…" : "Scan"`). A condition may read
 * anything, since it is never shown; every value that is shown must be a literal.
 */
function fixedWords(value: string): boolean {
	const literals = value.replace(/"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`[^`$]*`/g, "L").replace(/\s+/g, " ").trim();
	const parts = literals.split(/([?:])/);
	for (let index = 0; index < parts.length; index += 2) {
		if (parts[index + 1] === "?") continue; // a condition
		if (parts[index]!.trim() !== "L") return false;
	}
	return true;
}

test("fixedWords tells Porchlight's own words from data", () => {
	assert.ok(fixedWords('"Export"'));
	assert.ok(fixedWords('running ? "Auditing…" : state.report ? "Audit again" : "Audit your account"'));
	assert.ok(fixedWords("`Plain words`"));
	assert.ok(!fixedWords("hostName()"));
	assert.ok(!fixedWords("`${count} waiting`"));
	assert.ok(!fixedWords('ready ? label : "Busy"'));
	assert.ok(!fixedWords('"Fetch " + name'));
});

test("text put on the page outside h() is fixed words, or passes through shownText (S38)", () => {
	// Text, a title or a label set on an element directly, rather than through h(), which passes it through shownText itself.
	const found: string[] = [];
	for (const { name, text } of files) {
		const assignments = [
			...text.matchAll(/([\w.]+)\.(textContent|innerText|nodeValue|title)\s*=(?!=)([^;]*);/g),
			...text.matchAll(/([\w.]+)\.setAttribute\(\s*"(title|aria-label|aria-description|placeholder|alt)",([^;]*)\);/g),
		];
		for (const match of assignments) {
			const line = text.slice(text.lastIndexOf("\n", match.index) + 1, text.indexOf("\n", match.index));
			if (comment(line)) continue;
			const value = match[3]!.trim();
			if (/^shownText\(/.test(value) || fixedWords(value)) continue;
			found.push(`${name}: ${match[0].replace(/\s+/g, " ")}`);
		}
	}
	assert.deepEqual(found, []);
	// And h() puts every text attribute it is given through shownText, as it does text.
	const dom = files.find((file) => file.name === "dom.js")?.text ?? "";
	assert.match(dom, /TEXT_ATTRIBUTES\.includes\(key\)[^\n]*shownText\(/);
});

test("dates and numbers are written in the page's language, whatever the browser's (R6U-8)", () => {
	assert.deepEqual(
		find(/toLocale(?:Date|Time)?String\(\s*(\)|undefined|\[\])/, (_, line) => comment(line)),
		[],
	);
});

test("motion follows the system's setting (R6V-7), and focus is kept clear of what is fixed on screen (R6U-3)", () => {
	assert.deepEqual(find(/behavior:\s*"smooth"/, (_, line) => comment(line)), []);
	assert.match(css, /scroll-padding-top/);
	assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
	// The sidebar's foot can be scrolled to in a short window (I-D1).
	assert.match(css, /\.sidebar \{[^}]*overflow-y: auto/);
	// The Overview's columns fit a 320px screen (R6U-1).
	assert.match(css, /minmax\(min\(340px, 100%\), 1fr\)/);
});

test("polls go through poller(): no page asks the server on a bare interval (OP-8)", () => {
	// send.js's interval is the wait's own clock, which asks nothing.
	assert.deepEqual(find(/setInterval\(/, (name, line) => comment(line) || (name === "send.js" && /setInterval\(tick, 1000\)/.test(line))), []);
	// A timer that asks the API again is a hand-rolled poller.
	assert.deepEqual(find(/setTimeout\((refresh|poll|tick)\b/, (_, line) => comment(line)), []);
});

test("before approving the rest of a run, its limits are on show above the button (S29, invariant 20)", () => {
	const text = files.find((file) => file.name === "investigate.js")?.text ?? "";
	const card = text.slice(text.indexOf("function approvalCard"), text.indexOf("function findingsView"));
	const limits = card.indexOf("investigate-limits");
	const button = card.indexOf('"Approve all the rest")');
	assert.ok(limits > 0 && button > 0 && limits < button, "the limits come before the button");
	assert.doesNotMatch(card.slice(0, button), /h\(\s*"details"/, "and are not folded away");
});

test("a page that finishes after the owner moved on draws nothing and leaves the address alone (B43)", () => {
	const app = files.find((file) => file.name === "app.js")?.text ?? "";
	assert.match(app, /const slot = h\("div", \{ class: "view-slot" \}\)/);
	assert.match(app, /if \(current !== navigation\) return cleanup\(\);\s*if \(slot\.parentNode !== view\) view\.replaceChildren\(slot\)/);
	// Every change of address made after a wait checks first that its page is still the current one.
	assert.deepEqual(
		find(/location\.(hash|replace)\s*[=(]|history\.replaceState\(/, (name, line) => {
			if (comment(line) || /isCurrent\(\)/.test(line)) return true;
			// The router itself, the session key, and changes made at once by the owner's own click.
			return ["app.js", "api.js", "list.js", "settings.js", "projects.js"].includes(name) || /location\.hash = "#\/(discussions|investigate)"/.test(line) || /domains\/\$\{encodeURIComponent\(zone\.name\)\}/.test(line);
		}),
		[],
	);
});
