// The page's DOM-free decisions behind M14, "a steadier, quieter page".
import assert from "node:assert/strict";
import { test } from "node:test";
import { monitorStatusWords, overviewRedraws, plainError, readyToAdd, runStatusWord } from "../ui/hints.js";
import { isPageAddress, paginate } from "../ui/list.js";
import { linkAllowed } from "../ui/paths.js";
import { depthOf, presetChoices, startingChoices } from "../ui/scan-choices.js";
import { createDrafts, findingKey } from "../ui/tracking.js";

test("Skip to content is not a page's address, so following it keeps the page and its filters (B45)", () => {
	assert.equal(isPageAddress("#view"), false);
	assert.equal(isPageAddress("#main"), false);
	for (const hash of ["", "#", "#/", "#/findings?severity=high", "#/settings/model"]) assert.equal(isPageAddress(hash), true, hash);
});

test("an empty depth box means the same depth for the preview and the scan (UI-B11)", () => {
	assert.equal(depthOf("", 3), 3);
	assert.equal(depthOf("  ", 4), 4);
	assert.equal(depthOf(null, 3), 3);
	assert.equal(depthOf("0", 3), 0);
	assert.equal(depthOf("6", 3), 6);
	for (const bad of ["7", "-1", "2.5", "two", "1e1"]) assert.equal(depthOf(bad, 3), 3, bad);
});

test("Check again starts from the last scan's choices when the address names none (B42)", () => {
	const deep = { ...presetChoices("deep"), skip: ["old-site"] };
	const carried = startingChoices(new URLSearchParams(""), deep);
	assert.deepEqual(carried, deep);
	assert.notEqual(carried.skip, deep.skip, "a copy, so the form never changes the report's");
	// The address wins when it names anything.
	assert.equal(startingChoices(new URLSearchParams("preset=quick"), deep).preset, "quick");
	assert.deepEqual(startingChoices(new URLSearchParams("skip=a"), deep).skip, ["a"]);
	// A report from before there were choices starts as Standard.
	assert.equal(startingChoices(new URLSearchParams(""), undefined).preset, "standard");
});

test("the Overview redraws only what a change shows: a host check redraws the glance strip alone, a project switch nothing (B41, QL-1)", () => {
	assert.deepEqual(overviewRedraws("host"), ["glance"]);
	assert.deepEqual(overviewRedraws("projects"), []);
	assert.deepEqual(overviewRedraws("notes"), ["review"]);
	assert.deepEqual(overviewRedraws("scan"), ["scan", "glance"]);
	assert.deepEqual(overviewRedraws("cloudflare"), ["cloudflare", "glance"]);
	for (const change of ["host", "notes", "scan", "cloudflare"] as const) assert.ok(!overviewRedraws(change).includes("summary"), `${change} leaves the folder box and the summary alone`);
	assert.ok(overviewRedraws("report").includes("summary"));
	assert.ok(!overviewRedraws("cloudflare").includes("summary"), "a Cloudflare poll leaves the folder box and the summary alone");
});

test("a project folder is added only once its check is on show for what is typed, and a warning needs a second press (S30)", () => {
	const clean = { warnings: [] };
	const warned = { warnings: ["It is inside a git repository"] };
	assert.equal(readyToAdd(null, "", "~/audit", null), "look", "Return before any check");
	assert.equal(readyToAdd(clean, "~/old", "~/audit", null), "look", "the check is about another folder");
	assert.equal(readyToAdd(clean, "~/audit", "~/audit ", null), "add");
	assert.equal(readyToAdd({ warnings: [], error: "Not a folder" }, "~/audit", "~/audit", null), "refused");
	assert.equal(readyToAdd(warned, "~/repo", "~/repo", null), "confirm");
	assert.equal(readyToAdd(warned, "~/repo", "~/repo", "~/repo"), "add", "the second press, after the warning was shown");
	assert.equal(readyToAdd(warned, "~/repo", "~/repo", "~/other"), "confirm");
	assert.equal(readyToAdd(clean, "", "", null), "look");
});

test("network failures are said in the page's words (R6U-10)", () => {
	assert.equal(plainError("Could not reach the monitor: fetch failed"), "Could not reach the monitor: no connection could be made (the address could not be found, or nothing answered)");
	assert.match(plainError("fetch failed"), /^No connection could be made/);
	assert.match(plainError("The ownership record could not be checked: no answer (DNS status 2)"), /SERVFAIL\), often a DNSSEC problem$/);
	assert.doesNotMatch(plainError("no answer (DNS status 2)"), /status 2/);
	// Anything else is left as it was.
	assert.equal(plainError("The token was refused"), "The token was refused");
});

test("a run that used up its turns is not called Finished (B49)", () => {
	assert.equal(runStatusWord({ status: "done", ended: "The turn budget (25) is used up." }), "Turn budget used up");
	assert.equal(runStatusWord({ status: "done", ended: "The model finished." }), "Finished");
	assert.equal(runStatusWord({ status: "waiting" }), "Waiting for you");
	assert.equal(runStatusWord({ status: "failed" }), "Failed");
});

test("the Domains page says where the monitor's alerts go and what last went wrong (B48, MON-C2)", () => {
	const when = (iso: string) => `at ${iso}`;
	assert.equal(monitorStatusWords(undefined, when), null, "a monitor too old to say");
	const fine = monitorStatusWords({ alerts: { to: "webhook", host: "hooks.slack.com", format: "slack", delivery: { lastDeliveredAt: "T1", lastError: null } }, schedule: { lastError: null } }, when);
	assert.deepEqual(fine, { alerts: "Alerts go to hooks.slack.com (slack). The last one was delivered at T1.", good: true, problems: [], unknown: [] });
	const failing = monitorStatusWords(
		{ alerts: { to: "webhook", host: "ntfy.sh", delivery: { lastDeliveredAt: null, lastError: { at: "T2", error: "HTTP 500" } } }, schedule: { lastError: { at: "T3", error: "D1 timed out" } } },
		when,
	);
	assert.equal(failing?.good, false);
	assert.deepEqual(failing?.problems, ["The last alert could not be delivered (at T2): HTTP 500", "The monitor's daily run failed (at T3): D1 timed out"]);
	const logOnly = monitorStatusWords({ alerts: { to: "log", problem: "The webhook must be https.", delivery: null }, schedule: null }, when);
	assert.equal(logOnly?.good, false);
	assert.match(logOnly?.alerts ?? "", /only to the monitor's own log.*must be https/);
	// A record the monitor could not read is not known, never "nothing went wrong" (invariant 5).
	assert.equal(logOnly?.unknown.length, 1);
	assert.deepEqual(logOnly?.problems, []);
});

test("a note being typed survives a redraw, and Save clears it (B44)", () => {
	const drafts = createDrafts<{ status: string; note: string; until: string }>();
	const key = findingKey("shop", { ruleId: "aws-access-token", location: "app.env:3", detail: "abc123" });
	drafts.set(key, { status: "in-progress", note: "Ticket SEC-12, half typ", until: "" });
	// The editor is built again from scratch: it reads the draft, not the saved note.
	assert.equal(drafts.get(key)?.note, "Ticket SEC-12, half typ");
	assert.equal(drafts.get(findingKey("shop", { ruleId: "aws-access-token", location: "app.env:4", detail: "abc123" })), undefined, "each finding has its own");
	drafts.clear(key);
	assert.equal(drafts.get(key), undefined);
	assert.equal(drafts.size, 0);
});

test("the page links only to its own pages, https, System Settings and its own files (S46)", () => {
	for (const ok of ["#/overview", "https://dash.cloudflare.com/profile", "x-apple.systempreferences:com.apple.Sharing-Settings.extension", "/favicon.svg", "blob:http://127.0.0.1:7777/x", ""]) assert.equal(linkAllowed(ok), true, ok);
	for (const bad of ["javascript:alert(1)", "JAVASCRIPT:alert(1)", " javascript:x", "data:text/html,x", "//evil.example", "/\\evil.example", "http://example.com", "file:///etc/passwd", "vbscript:x"]) assert.equal(linkAllowed(bad), false, bad);
});

test("the same message already on show is not shown again, so a minute offline is one notice (B49)", async () => {
	// dom.js is typed against the browser's DOM; it touches none until a page draws, so it is loaded by address.
	const dom = (await import(new URL("../ui/dom.js", import.meta.url).href)) as { isDuplicateToast: (showing: { message: string; kind: string }[], message: string, kind: string) => boolean };
	const showing = [{ message: "Porchlight is not answering. Start it again with: porchlight ui", kind: "error" }];
	assert.equal(dom.isDuplicateToast(showing, "Porchlight is not answering. Start it again with: porchlight ui", "error"), true);
	assert.equal(dom.isDuplicateToast(showing, "Porchlight is not answering. Start it again with: porchlight ui", "info"), false);
	assert.equal(dom.isDuplicateToast(showing, "Saved", "info"), false);
	assert.equal(dom.isDuplicateToast([], "Saved", "info"), false);
});

test("each list that can grow is paged at a boundary the page can reach (UI-B13, F-D1, D-D1)", () => {
	// Ten domains a page on the Cloudflare page, twenty-five rows on a domain's report.
	const zones = Array.from({ length: 50 }, (_, index) => index);
	assert.deepEqual(paginate(zones, 5, 10), { items: [40, 41, 42, 43, 44, 45, 46, 47, 48, 49], page: 5, pages: 5, from: 41, to: 50, total: 50 });
	assert.equal(paginate(zones, 6, 10).page, 5, "a page past the end is pulled back");
	assert.equal(paginate(Array.from({ length: 26 }), 2, 25).items.length, 1);
	assert.equal(paginate([], 3, 25).page, 1);
});
