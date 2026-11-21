import assert from "node:assert/strict";
import { test } from "node:test";

// Loaded by address, not by name: the page's module is typed against the browser's DOM, which the
// Node type check does not include. It touches no DOM until a page is drawn.
const page = (await import(new URL("../ui/cloudflare.js", import.meta.url).href)) as {
	tickAllPlain: (changes: readonly { id: string; care?: string }[], left: ReadonlySet<string>) => Set<string>;
};

test("Tick all in Fix these leaves every change with a warning as the owner set it (F-U4)", () => {
	const changes = [{ id: "plain-1" }, { id: "care-1", care: "Browsers then refuse plain HTTP" }, { id: "plain-2" }, { id: "care-2", care: "Visitors may get error 526" }];
	// The owner unticked two plain ones and ticked one with a warning.
	const after = page.tickAllPlain(changes, new Set(["plain-1", "plain-2", "care-2"]));
	assert.deepEqual([...after].sort(), ["care-2"]);
	// From the start, where both with a warning are unticked, they stay unticked.
	assert.deepEqual([...page.tickAllPlain(changes, new Set(["care-1", "care-2"]))].sort(), ["care-1", "care-2"]);
});
