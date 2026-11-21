// FT-5: DKIM key strength, read from the records the Cloudflare audit already fetched.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { test } from "node:test";
import { dkimKey, dkimStrengthCheck } from "../src/cloudflare/dkim.ts";
import { emailChecks } from "../src/cloudflare/rules.ts";

/** A DKIM record's p= value for a new RSA key of this many bits, made at run time. */
function rsaKey(bits: number, type: "spki" | "pkcs1" = "spki"): string {
	const { publicKey } = generateKeyPairSync("rsa", { modulusLength: bits });
	return publicKey.export({ type, format: "der" }).toString("base64");
}

test("reads a key's type and size, test mode and revocation", () => {
	assert.deepEqual(dkimKey(`v=DKIM1; k=rsa; p=${rsaKey(1024)}`), { state: "rsa", bits: 1024, testing: false });
	assert.deepEqual(dkimKey(`v=DKIM1; t=y; p=${rsaKey(2048, "pkcs1")}`), { state: "rsa", bits: 2048, testing: true });
	// A long key split by the provider into chunks with spaces still reads.
	const long = rsaKey(2048);
	assert.deepEqual(dkimKey(`v=DKIM1; p=${long.slice(0, 100)} ${long.slice(100)}`), { state: "rsa", bits: 2048, testing: false });
	assert.deepEqual(dkimKey(`v=DKIM1; k=ed25519; p=${Buffer.alloc(32, 7).toString("base64")}`), { state: "ed25519", testing: false });
	assert.deepEqual(dkimKey("v=DKIM1; p="), { state: "revoked" });
	assert.equal(dkimKey("v=DKIM1; k=rsa; p=MIIB").state, "unreadable");
	assert.equal(dkimKey("v=DKIM1; k=rsa").state, "unreadable");
	assert.equal(dkimKey("v=DKIM1; p=not*base64").state, "unreadable");
});

test("a 1024-bit key or test mode fails, a 2048-bit key passes, and keys behind a CNAME are not judged", () => {
	const weak = dkimStrengthCheck([{ name: "old._domainkey.example.test", type: "TXT", value: `v=DKIM1; p=${rsaKey(1024)}` }]);
	assert.equal(weak?.status, "failed");
	assert.equal(weak?.severity, "medium");
	assert.match(weak?.detail ?? "", /1 RSA key is shorter than 2048 bits/);
	assert.deepEqual(weak?.items, ["old._domainkey.example.test: RSA 1024 bits"]);

	const tiny = dkimStrengthCheck([{ name: "s._domainkey.example.test", type: "TXT", value: `v=DKIM1; p=${rsaKey(512)}` }]);
	assert.equal(tiny?.severity, "high");

	const testing = dkimStrengthCheck([{ name: "s._domainkey.example.test", type: "TXT", value: `v=DKIM1; t=y; p=${rsaKey(2048)}` }]);
	assert.deepEqual([testing?.status, testing?.severity], ["failed", "low"]);
	assert.ok(testing?.fix?.some((step) => step.includes("t=y")));

	const good = dkimStrengthCheck([
		{ name: "new._domainkey.example.test", type: "TXT", value: `v=DKIM1; p=${rsaKey(2048)}` },
		{ name: "old._domainkey.example.test", type: "TXT", value: "v=DKIM1; p=" },
		{ name: "s1._domainkey.example.test", type: "CNAME", value: "s1.domainkey.provider.example" },
	]);
	assert.equal(good?.status, "passed");
	assert.equal(good?.fix, undefined);
	assert.match(good?.detail ?? "", /1 DKIM key is 2048-bit .* 1 behind a CNAME was not read/);

	// Only CNAMEs: the keys were not seen, which is not a pass (invariant 5).
	const delegated = dkimStrengthCheck([{ name: "s1._domainkey.example.test", type: "CNAME", value: "s1.provider.example" }]);
	assert.equal(delegated?.status, "unknown");
	assert.equal(dkimStrengthCheck([]), null);
});

test("the audit's email rules carry the strength check beside DKIM, from the records already read", () => {
	const zone = {
		id: "a".repeat(32),
		name: "example.test",
		plan: "free",
		type: "full",
		records: {
			ok: true,
			value: [
				{ type: "MX", name: "example.test", content: "mail.example.test" },
				{ type: "TXT", name: "s1._domainkey.example.test", content: `"v=DKIM1; k=rsa; " "p=${rsaKey(1024)}"` },
			],
		},
	} as unknown as Parameters<typeof emailChecks>[0];
	const checks = emailChecks(zone);
	assert.equal(checks.find((check) => check.id === "dkim")?.status, "passed");
	const strength = checks.find((check) => check.id === "dkim-keys");
	assert.equal(strength?.status, "failed");
	assert.deepEqual(strength?.items, ["s1._domainkey.example.test: RSA 1024 bits"]);
	// Never the key itself.
	assert.doesNotMatch(JSON.stringify(strength), /MI[GI][A-Za-z0-9+/]{20}/);
});
