import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { cloudflarePrompt } from "../src/assist/prompts.ts";
import { MAX_BATCH, planBatch, planChange } from "../src/cloudflare/apply.ts";
import { allChecks, auditCloudflare, TOKEN_TEMPLATE_URL, WRITE_PERMISSIONS } from "../src/cloudflare/audit.ts";
import { CfClient, tokenShapeProblem } from "../src/cloudflare/client.ts";
import { exportCloudflare, renderCloudflareText } from "../src/cloudflare/export.ts";
import { isInternal, maskEmail, tokenBreadth } from "../src/cloudflare/rules.ts";
import { readSavedToken, saveToken } from "../src/cloudflare/store.ts";
import { CF_CHANGES, type CfReport } from "../src/cloudflare/types.ts";
import { cloudflareAudit } from "../src/main.ts";
import { ACCOUNT_ID, fakeCloudflare, fakeCloudflareToken, FREE_ZONE, HOSTILE, OWNERSHIP_TOKEN, PRO_ZONE, SELF_TOKEN_ID } from "./cloudflare-fake.ts";
import { tempDir } from "./helpers.ts";

async function audit(options: Parameters<typeof fakeCloudflare>[0] = {}, lookups = true) {
	const world = fakeCloudflare(options);
	const report = await auditCloudflare({ token: fakeCloudflareToken(), fetchFn: world.fetchFn, lookups, ownershipTokens: { "free.example": OWNERSHIP_TOKEN }, now: () => world.now });
	return { report, world };
}

function find(report: CfReport, zone: string, id: string) {
	const found = report.zones.find((candidate) => candidate.name === zone)?.checks.find((item) => item.id === id);
	assert.ok(found, `${zone} has no check ${id}`);
	return found;
}

test("audits every zone against the built-in rules, knowing each zone's plan", async () => {
	const { report } = await audit();
	assert.deepEqual(report.zones.map((zone) => [zone.name, zone.plan]), [["free.example", "free"], ["pro.example", "pro"]]);

	// SSL/TLS on the Free zone.
	assert.equal(find(report, "free.example", "ssl-mode").status, "failed");
	assert.equal(find(report, "free.example", "ssl-mode").severity, "high");
	assert.equal(find(report, "free.example", "always-use-https").change, "always-use-https");
	assert.equal(find(report, "free.example", "min-tls").severity, "medium");
	assert.equal(find(report, "free.example", "hsts").status, "failed");
	// A Cloudflare-managed certificate 10 days from expiry has failed to renew.
	assert.equal(find(report, "free.example", "certificates").severity, "high");
	// Only the certificate in use counts: the backup beside it and an old pack being removed are not problems,
	// though the backup is 5 days from expiry and the old one expired 9 days ago.
	assert.deepEqual(find(report, "free.example", "certificates").items, ["free.example, *.free.example: expires in 10 days and has not renewed"]);
	assert.deepEqual([find(report, "pro.example", "certificates").status, find(report, "pro.example", "certificates").detail], ["passed", "The soonest expires in 70 days."]);
	assert.equal(find(report, "pro.example", "ssl-mode").status, "passed");
	assert.equal(find(report, "pro.example", "origin-pulls").status, "passed");

	// DNS.
	assert.equal(find(report, "free.example", "dnssec").status, "failed");
	assert.equal(find(report, "free.example", "origin-exposure").severity, "high");
	assert.match(find(report, "free.example", "origin-exposure").items?.[0] ?? "", /direct\.free\.example .*203\.0\.113\.10/);
	assert.deepEqual(find(report, "free.example", "internal-addresses").items, ["nas.free.example (A 10.0.0.5)"]);
	assert.deepEqual(find(report, "free.example", "dangling-internal").items, ["www.free.example → missing.free.example"]);
	assert.equal(find(report, "pro.example", "caa").status, "passed");

	// Email.
	assert.equal(find(report, "free.example", "spf").status, "passed");
	assert.equal(find(report, "free.example", "dmarc").severity, "low");
	assert.equal(find(report, "free.example", "dkim").status, "failed");
	assert.equal(find(report, "pro.example", "dmarc").status, "passed");
	assert.equal(find(report, "pro.example", "dkim").status, "passed");

	// The plan decides what is a fault. The Free zone is never told to deploy a paid ruleset.
	assert.equal(find(report, "free.example", "waf-owasp").status, "unavailable");
	assert.equal(find(report, "free.example", "waf-managed").status, "unknown");
	const free = report.zones.find((zone) => zone.name === "free.example")!;
	assert.ok(free.checks.filter((item) => item.status === "failed").every((item) => !(item.fix ?? []).join(" ").includes("Cloudflare managed ruleset")));
	assert.equal(find(report, "pro.example", "waf-managed").status, "failed");
	assert.equal(find(report, "pro.example", "waf-managed").severity, "high");
	assert.equal(find(report, "pro.example", "waf-owasp").status, "passed");
	assert.equal(find(report, "free.example", "bot-fight-mode").status, "failed");

	// A read the token was refused is "Could not check", with the permission to add.
	const bots = find(report, "pro.example", "bot-fight-mode");
	assert.equal(bots.status, "unknown");
	assert.equal(bots.permission, "Bot Management Read");

	// Ownership record and the lookups it allows.
	assert.equal(find(report, "free.example", "ownership-record").status, "passed");
	assert.equal(find(report, "pro.example", "ownership-record").change, "ownership-record");
	assert.deepEqual(find(report, "free.example", "dangling-external").items, ["old.free.example → gone-shop.herokuapp.com (no such name)"]);
	assert.equal(find(report, "pro.example", "dangling-external").status, "unknown");

	// Account: members are named by a masked email only; broad tokens are flagged; Porchlight's own is not called idle.
	const account = report.accounts.find((candidate) => candidate.id === ACCOUNT_ID)!;
	const twoFactor = account.checks.find((item) => item.id === "member-2fa")!;
	assert.equal(twoFactor.status, "failed");
	assert.deepEqual(twoFactor.items, ["a…@example.com"]);
	const accountTokens = account.checks.find((item) => item.id === "account-tokens")!;
	assert.equal(accountTokens.severity, "medium");
	assert.ok(accountTokens.items?.some((line) => line.startsWith("ci deploy: can change every zone")));
	assert.ok(accountTokens.items?.some((line) => line.startsWith("old script: not used in")));
	assert.equal(report.userChecks[0]?.status, "passed");

	// Nothing in the report carries the token or a member's full email.
	const text = JSON.stringify(report);
	assert.ok(!text.includes(fakeCloudflareToken()));
	assert.ok(!text.includes("alex@example.com"));
	assert.equal(report.permissions.find((permission) => permission.name === "Zone Settings Read")?.granted, true);
});

test("every request goes to Cloudflare's API with the token as a header only, and only reads", async () => {
	const { world } = await audit();
	const api = world.sent.filter((request) => request.host === "api.cloudflare.com");
	assert.ok(api.length > 20);
	for (const request of api) {
		assert.equal(request.method, "GET");
		assert.ok(request.path.startsWith("/client/v4/"));
		assert.equal(request.authorization, `Bearer ${fakeCloudflareToken()}`);
		assert.ok(!`${request.path}${request.query}`.includes(fakeCloudflareToken()));
	}
	// The deprecated batch settings endpoint is never used: each setting is read on its own.
	assert.ok(!api.some((request) => /^\/client\/v4\/zones\/[0-9a-f]{32}\/settings$/.test(request.path)));
	assert.ok(world.sent.every((request) => request.host === "api.cloudflare.com" || request.host === "cloudflare-dns.com"));
});

test("names are looked up only for a zone whose ownership record proves it in this audit", async () => {
	const { world } = await audit();
	const dns = world.sent.filter((request) => request.host === "cloudflare-dns.com").map((request) => new URLSearchParams(request.query).get("name"));
	// The challenge record first; then only the free zone's targets outside the account.
	assert.equal(dns[0], "_porchlight-challenge.free.example");
	assert.ok(dns.includes("gone-shop.herokuapp.com"));
	assert.ok(dns.includes("free-docs.readthedocs.io"));
	assert.ok(!dns.includes("pro.statuspage.example"), "pro.example has no ownership record, so its targets are not looked up");
	assert.ok(!dns.some((name) => name?.endsWith(".free.example") && !name.startsWith("_porchlight")), "names inside the account are checked from its own records");

	// A record that does not hold the token proves nothing: no target is looked up.
	const unproven = await audit({ owned: false });
	const lookedUp = unproven.world.sent.filter((request) => request.host === "cloudflare-dns.com").map((request) => new URLSearchParams(request.query).get("name") ?? "");
	assert.ok(lookedUp.every((name) => name.startsWith("_porchlight-challenge") || name.startsWith("_securityx-challenge")));
	assert.equal(find(unproven.report, "free.example", "dangling-external").status, "unknown");

	// Turned off: nothing at all is looked up.
	const off = await audit({}, false);
	assert.equal(off.world.sent.filter((request) => request.host === "cloudflare-dns.com").length, 0);
	assert.ok(off.report.notCovered.some((line) => line.includes("turned off")));
});

test("a setting the token may not read is Could not check, never passed", async () => {
	const { report } = await audit({ denySettings: true });
	for (const id of ["ssl-mode", "always-use-https", "min-tls", "tls-1-3", "hsts", "https-rewrites", "security-level", "browser-check"]) {
		const item = find(report, "free.example", id);
		assert.equal(item.status, "unknown", id);
		assert.equal(item.permission, "Zone Settings Read", id);
		assert.match(item.detail, /Zone Settings Read/);
	}
	assert.equal(report.permissions.find((permission) => permission.name === "Zone Settings Read")?.granted, false);
});

test("an account-owned token is verified under its account", async () => {
	const world = fakeCloudflare({ accountToken: true });
	const verified = await new CfClient(fakeCloudflareToken(), world.fetchFn).verify();
	assert.deepEqual({ ok: verified.ok, kind: verified.kind, id: verified.id }, { ok: true, kind: "account", id: SELF_TOKEN_ID });
	const report = await auditCloudflare({ token: fakeCloudflareToken(), fetchFn: world.fetchFn, lookups: false, ownershipTokens: {}, now: () => world.now });
	assert.equal(report.token.kind, "account");
	// An account token has no user tokens to read, so that permission is not asked for.
	assert.deepEqual(report.userChecks, []);
	assert.ok(!report.permissions.some((permission) => permission.scope === "User"));
});

test("token shape, storage and errors never let the token out", async () => {
	assert.equal(tokenShapeProblem(fakeCloudflareToken()), null);
	assert.ok(tokenShapeProblem("has a space in it and is long enough"));
	assert.ok(tokenShapeProblem("short"));
	assert.throws(() => new CfClient("not a token"), /not a Cloudflare API token/);
	assert.throws(() => CfClient.url("/zones/../user"), /Not an API path/);
	assert.throws(() => CfClient.url("//evil.example/x"));

	const dir = await tempDir();
	const path = join(dir, "cloudflare-settings.json");
	await saveToken(path, fakeCloudflareToken());
	assert.equal((await stat(path)).mode & 0o777, 0o600);
	assert.equal((await readSavedToken(path))?.token, fakeCloudflareToken());
	await writeFile(path, JSON.stringify({ token: "bad token" }));
	assert.equal(await readSavedToken(path), null);

	// An error that echoes the token back is scrubbed of it.
	const echo = (async () => Response.json({ success: false, errors: [{ message: `bad token ${fakeCloudflareToken()}` }] }, { status: 400 })) as typeof fetch;
	const answer = await new CfClient(fakeCloudflareToken(), echo).get("/zones");
	assert.equal(answer.ok, false);
	assert.ok(!answer.ok && !answer.message.includes(fakeCloudflareToken()) && answer.message.includes("[token]"));
});

test("exports are escaped for their format and never carry the token", async () => {
	const { report } = await audit();
	const html = exportCloudflare(report, "html");
	assert.equal(html.filename, "porchlight-cloudflare-2026-11-19.html");
	assert.ok(!html.body.includes(HOSTILE));
	assert.ok(html.body.includes("&#60;script&#62;"));
	assert.ok(!/<script/i.test(html.body));
	assert.match(html.body, /default-src 'none'/);
	// Markdown keeps a value as a code span, where a renderer shows markup as text.
	const md = exportCloudflare(report, "md");
	assert.ok(md.body.includes(`\`v=DMARC1; p=none; rua=mailto:${HOSTILE}@free.example\``));
	assert.ok(!md.body.split("\n").some((line) => line.includes(HOSTILE) && !line.trim().startsWith("- `")));
	const csv = exportCloudflare(report, "csv");
	assert.ok(csv.body.split("\r\n")[0]?.startsWith("section,area,check"));
	for (const format of ["md", "html", "csv", "json"] as const) assert.ok(!exportCloudflare(report, format).body.includes(fakeCloudflareToken()));
	// An export of one zone says it is partial and leaves the account out.
	const one = exportCloudflare(report, "md", PRO_ZONE);
	assert.match(one.body, /covers one zone, pro\.example/);
	assert.ok(!one.body.includes("free.example"));
	assert.ok(!one.body.includes("Two-factor"));
	assert.match(renderCloudflareText(report), /\[Problem, High\] SSL\/TLS encryption mode/);
});

test("a model reads what the page shows: never the token, emails, token names or ownership values", async () => {
	const { report } = await audit();
	const prompt = cloudflarePrompt(report);
	const text = prompt.messages.map((message) => message.content).join("\n");
	assert.match(text, /<<<DATA/);
	assert.match(text, /free\.example/);
	assert.ok(!text.includes(fakeCloudflareToken()));
	assert.ok(!text.includes("example.com"), "no member email, not even masked");
	assert.ok(!text.includes("ci deploy"), "no token names");
	assert.ok(!text.includes(OWNERSHIP_TOKEN));
	// Data is framed: a hostile value cannot close the block.
	assert.ok(!text.includes("<script>"));
});

test("a change is a fixed template for one zone, built from nothing a request supplies", () => {
	const setting = planChange({ id: FREE_ZONE, name: "free.example" }, "min-tls-1.2");
	assert.equal(setting.method, "PATCH");
	assert.equal(setting.url, `https://api.cloudflare.com/client/v4/zones/${FREE_ZONE}/settings/min_tls_version`);
	assert.deepEqual(setting.body, { value: "1.2" });
	const record = planChange({ id: PRO_ZONE, name: "pro.example" }, "ownership-record", OWNERSHIP_TOKEN);
	assert.deepEqual(record.body, { type: "TXT", name: "_porchlight-challenge.pro.example", content: `"porchlight-verify=${OWNERSHIP_TOKEN}"`, ttl: 1, comment: "Porchlight ownership record" });
	assert.throws(() => planChange({ id: "../user", name: "x.example" }, "tls-1.3"), /zone ID/);
	assert.throws(() => planChange({ id: PRO_ZONE, name: "pro.example" }, "ownership-record"), /ownership token/);
});

test("rule helpers: internal addresses, masked emails, token breadth, the token template", () => {
	for (const address of ["10.1.2.3", "172.16.0.1", "192.168.1.1", "127.0.0.1", "169.254.1.1", "100.64.0.1", "fd00::1", "fe80::1", "::1"]) assert.ok(isInternal(address), address);
	for (const address of ["203.0.113.10", "172.32.0.1", "100.128.0.1", "2001:db8::1", "8.8.8.8"]) assert.ok(!isInternal(address), address);
	assert.equal(maskEmail("alex@example.com"), "a…@example.com");
	assert.equal(maskEmail(undefined), "a member without an email");
	assert.deepEqual(tokenBreadth({ policies: [{ effect: "allow", resources: { "com.cloudflare.api.account.zone.*": "*" }, permission_groups: [{ name: "DNS Write" }, { name: "Zone Read" }] }] }), { writes: ["DNS Write"], everywhere: true, ipLimited: false, expires: false });
	assert.equal(tokenBreadth({ policies: [{ effect: "allow", resources: { [`com.cloudflare.api.account.zone.${PRO_ZONE}`]: "*" }, permission_groups: [{ name: "DNS Write" }] }] }).everywhere, false);
	const template = new URL(TOKEN_TEMPLATE_URL);
	assert.equal(template.origin, "https://dash.cloudflare.com");
	const keys = JSON.parse(template.searchParams.get("permissionGroupKeys") ?? "[]") as { type: string }[];
	assert.ok(keys.length > 0 && keys.every((key) => key.type === "read"), "the template asks for read permissions only");
});

test("porchlight cloudflare audit prints the audit from a token in the environment", async () => {
	const world = fakeCloudflare();
	const dir = await tempDir();
	let out = "";
	const code = await cloudflareAudit(["--json", "--no-lookups"], { fetchFn: world.fetchFn, env: { PORCHLIGHT_CLOUDFLARE_TOKEN: fakeCloudflareToken() }, dataDir: dir, write: (text) => (out += text) });
	assert.equal(code, 0);
	const report = JSON.parse(out) as CfReport;
	assert.equal(report.zones.length, 2);
	assert.equal(report.lookups, false);
	assert.ok(!out.includes(fakeCloudflareToken()));
	assert.ok(allChecks(report).length > 30);

	// The token saved under Settings → Cloudflare is used when the environment has none.
	await saveToken(join(dir, "cloudflare-settings.json"), fakeCloudflareToken());
	out = "";
	await cloudflareAudit([], { fetchFn: world.fetchFn, env: {}, dataDir: dir, write: (text) => (out += text) });
	assert.match(out, /^Cloudflare audit/);
	assert.match(out, /## free\.example/);

	await assert.rejects(cloudflareAudit([], { fetchFn: world.fetchFn, env: {}, dataDir: await tempDir(), write: () => {} }), /No Cloudflare API token/);
	assert.equal(JSON.parse(await readFile(join(dir, "cloudflare-settings.json"), "utf8")).token, fakeCloudflareToken());
});

test("a personal account's name has its email masked, as a member's is, on the page and in every export (S35)", async () => {
	const email = ["jane.doe", "@", "mail.example"].join("");
	const { report } = await audit({ accountName: `${email}'s Account` });
	assert.deepEqual(report.accounts.map((account) => account.name), ["j…@mail.example's Account"]);
	for (const format of ["md", "html", "csv", "json"] as const) assert.ok(!exportCloudflare(report, format).body.includes(email), format);
});

test("a one-zone CSV says it is partial, says what was not covered, and is not named as the full audit (B67)", async () => {
	const { report } = await audit();
	const zone = report.zones.find((candidate) => candidate.name === "free.example")!;
	const file = exportCloudflare(report, "csv", zone.id);
	assert.match(file.filename, /^porchlight-cloudflare-zone-\d{4}-\d{2}-\d{2}\.csv$/);
	assert.match(file.body, /^Partial,.*This export covers one zone, free\.example/m);
	for (const note of report.notCovered) assert.ok(file.body.includes(note.replace(/"/g, '""')), note);
});

async function auditWith(options: Parameters<typeof fakeCloudflare>[0], extra: { lookups?: boolean; waits?: number[] } = {}) {
	const world = fakeCloudflare(options);
	const waits = extra.waits ?? [];
	const report = await auditCloudflare({
		token: fakeCloudflareToken(),
		fetchFn: world.fetchFn,
		lookups: extra.lookups ?? true,
		ownershipTokens: { "free.example": OWNERSHIP_TOKEN },
		now: () => world.now,
		// No real waiting in a test: the wait asked for is only recorded.
		sleep: async (ms) => {
			waits.push(ms);
		},
	});
	return { report, world, waits };
}

test("a list longer than Porchlight reads is never judged as whole, and one without a page count is read to its end (B35)", async () => {
	const { report, world } = await auditWith({ manyRecords: 55 * 100 });
	const pages = world.sent.filter((request) => request.path === `/client/v4/zones/${FREE_ZONE}/dns_records`).length;
	assert.equal(pages, 40, "it stops at the limit");
	for (const id of ["caa", "origin-exposure", "dangling-internal", "spf", "dmarc", "ownership-record"]) {
		const item = find(report, "free.example", id);
		assert.equal(item.status, "unknown", id);
		assert.match(item.detail, /longer than the 40 pages/, id);
	}
	assert.equal(find(report, "pro.example", "caa").status, "passed", "a zone whose list was read whole is judged as usual");

	// Without total_pages, full pages mean there may be more: it reads on until a page is short.
	const open = await auditWith({ noTotalPages: true, manyRecords: 150 });
	assert.equal(open.world.sent.filter((request) => request.path === `/client/v4/zones/${FREE_ZONE}/dns_records`).length, 2);
	assert.equal(find(open.report, "free.example", "spf").status, "passed");
});

test("Cloudflare's rate limit is waited out, within a bounded wait and number of tries (B35)", async () => {
	const path = `/zones/${FREE_ZONE}/settings/ssl`;
	const once = await auditWith({ rateLimit: { path, times: 1, retryAfter: "2" } });
	assert.deepEqual(once.waits, [2000]);
	assert.equal(find(once.report, "free.example", "ssl-mode").status, "failed", "read on the second try, and judged");

	// A long Retry-After is cut to the bound; without one the wait doubles. Then it gives up: Could not check.
	const always = await auditWith({ rateLimit: { path, times: 100, retryAfter: "600" } });
	assert.deepEqual(always.waits, [30_000, 30_000, 30_000]);
	assert.equal(always.world.sent.filter((request) => request.path === `/client/v4${path}`).length, 4);
	const ssl = find(always.report, "free.example", "ssl-mode");
	assert.equal(ssl.status, "unknown");
	assert.match(ssl.detail, /rate limit was reached; audit again in a few minutes/);
	const bare = await auditWith({ rateLimit: { path, times: 100 } });
	assert.deepEqual(bare.waits, [5000, 10_000, 20_000]);
});

test("an uploaded-certificate list that could not be read is Could not check, never none (B35, R2B-7)", async () => {
	const { report } = await auditWith({ failCustomCertificates: true });
	const pro = find(report, "pro.example", "certificates");
	assert.equal(pro.status, "unknown");
	assert.match(pro.detail, /uploaded certificates/);
	// A problem it did see is still said, with what it could not.
	const free = find(report, "free.example", "certificates");
	assert.equal(free.status, "failed");
	assert.ok(free.items?.includes("Uploaded certificates could not be read, so they were not checked."));
});

test("CNAMEs into a zone that was not read, and names never looked up, are Could not check (B35, CF-B1, CF-B2)", async () => {
	const cross = await auditWith({ crossZoneUnread: true });
	const inside = find(cross.report, "pro.example", "dangling-internal");
	assert.equal(inside.status, "unknown");
	assert.deepEqual(inside.items, ["shop.pro.example → shop.free.example (the records of free.example were not read)"]);

	const skipped = await auditWith({ outsideTargets: ["_acme-challenge.provider.example"] });
	const outside = find(skipped.report, "free.example", "dangling-external");
	assert.equal(outside.status, "unknown");
	assert.doesNotMatch(outside.detail, /All 0 names/);
	assert.match(outside.items?.[0] ?? "", /_acme-challenge\.provider\.example: not a name Porchlight looks up/);
});

test("when the account list cannot be read, the audit says what that leaves out (B69)", async () => {
	const { report } = await auditWith({ denyAccounts: true });
	assert.ok(report.notCovered.some((line) => /^Accounts that own none of the audited zones, with their members and API tokens: this token may not list accounts/.test(line)));
	// The account that owns the zones is still audited.
	assert.deepEqual(report.accounts.map((account) => account.id), [ACCOUNT_ID]);
});

test("a partial (CNAME) zone's DNS rules are not judged from records Cloudflare does not serve, and offer no change (CF-B5)", async () => {
	const { report } = await auditWith({ partialPro: true });
	for (const id of ["caa", "spf", "dmarc", "dkim", "ownership-record", "dnssec"]) {
		const item = find(report, "pro.example", id);
		assert.equal(item.status, "unavailable", id);
		assert.equal(item.change, undefined, id);
	}
	assert.equal(find(report, "free.example", "ownership-record").status, "passed", "a full zone is judged as before");
});

test("DMARC delegated by CNAME is not read as missing, and a wildcard answers for deeper names (CF-B6)", async () => {
	const { report } = await auditWith({ dmarcByCname: true });
	const dmarc = find(report, "pro.example", "dmarc");
	assert.equal(dmarc.status, "unknown");
	assert.equal(dmarc.change, undefined, "no record is offered beside the CNAME");
	assert.match(dmarc.detail, /CNAME to pro-example\.dmarc\.reports\.example/);

	const wild = await auditWith({ wildcard: true });
	assert.equal(find(wild.report, "free.example", "dangling-internal").status, "passed", "*.free.example answers for a.b.free.example and missing.free.example");
});

test("an answer in an unexpected shape makes its checks Could not check, and the audit goes on (CF-B7)", async () => {
	const universal = await auditWith({ malformed: "universal" });
	assert.equal(find(universal.report, "free.example", "universal-ssl").status, "unknown");
	assert.equal(find(universal.report, "pro.example", "ssl-mode").status, "passed");

	const record = await auditWith({ malformed: "record" });
	const caa = find(record.report, "free.example", "caa");
	assert.equal(caa.status, "unknown");
	assert.match(caa.detail, /not in the form Porchlight expects/);
	assert.equal(find(record.report, "pro.example", "caa").status, "passed");
});

test("Fix these covers at most 300 changes and says how many the audit offers (F-F5)", () => {
	const zones = Array.from({ length: 400 }, (_, i) => ({ id: i.toString(16).padStart(32, "0"), name: `z${i}.example`, checks: [{ status: "failed", change: "tls-1.3" as const }] }));
	const { changes, offered } = planBatch(zones, () => OWNERSHIP_TOKEN, "2026-11-19T12:00:00.000Z");
	assert.equal(changes.length, MAX_BATCH);
	assert.equal(offered, 400);
	assert.ok(changes.every((change) => change.auditAt === "2026-11-19T12:00:00.000Z"), "each change is tied to the audit it was planned from");
});

test("Settings and the documentation name only the changes Porchlight offers (F-F6)", async () => {
	// Bot Fight Mode is kept as a template but no rule offers it, so its permission is not asked for.
	const offered = CF_CHANGES.filter((change) => change !== "bot-fight-mode");
	const needed = new Set(offered.map((change) => planChange({ id: FREE_ZONE, name: "free.example" }, change, change === "ownership-record" ? OWNERSHIP_TOKEN : undefined).permission));
	assert.deepEqual(new Set(WRITE_PERMISSIONS.map((permission) => permission.name)), needed);
	const doc = await readFile(join(import.meta.dirname, "..", "..", "docs", "CLOUDFLARE-AUDIT.md"), "utf8");
	assert.match(doc, /Fix these/);
	assert.doesNotMatch(doc, /not applied by Porchlight/);
	assert.doesNotMatch(doc, /approve one at a time/);
	for (const words of ["DNSSEC", "Full (strict)", "DMARC record that only reports", "current value"]) assert.ok(doc.includes(words), words);
});
