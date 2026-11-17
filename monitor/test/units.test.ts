import { describe, expect, it } from "vite-plus/test";
import { latestCertFor, parseCtRows } from "../src/collect/ct.ts";
import { recordsOf, unquoteTxt } from "../src/doh.ts";
import { isWithin, normalizeDomain } from "../src/domain.ts";

describe("normalizeDomain", () => {
	it("canonicalises case, whitespace and the trailing dot", () => {
		expect(normalizeDomain("  Example.COM. ")).toBe("example.com");
		expect(normalizeDomain("xn--bcher-kva.example")).toBe("xn--bcher-kva.example");
	});

	it.each([
		"",
		"localhost",
		"192.168.1.1",
		"exa mple.com",
		"example.com/path",
		"https://example.com",
		"-bad.example.com",
		"a..example.com",
		"*.example.com",
		"example.com:8443",
		`${"a".repeat(64)}.example.com`,
	])("rejects %j", (input) => {
		expect(normalizeDomain(input)).toBeNull();
	});
});

describe("isWithin", () => {
	it("accepts the domain and names beneath it, not lookalikes", () => {
		expect(isWithin("example.com", "example.com")).toBe(true);
		expect(isWithin("api.example.com", "example.com")).toBe(true);
		expect(isWithin("notexample.com", "example.com")).toBe(false);
		expect(isWithin("example.com.evil.net", "example.com")).toBe(false);
	});
});

describe("DNS answer parsing", () => {
	it("joins quoted TXT chunks and unescapes them", () => {
		expect(unquoteTxt('"v=spf1 include:_spf.example.com ~all"')).toBe(
			"v=spf1 include:_spf.example.com ~all",
		);
		expect(unquoteTxt('"abc" "def"')).toBe("abcdef");
		expect(unquoteTxt('"say \\"hi\\""')).toBe('say "hi"');
	});

	it("picks one record type, normalises names, and sorts", () => {
		const answers = [
			{ name: "www.example.com", type: 5, data: "Edge.Example.NET." },
			{ name: "edge.example.net", type: 1, data: "203.0.113.9" },
			{ name: "edge.example.net", type: 1, data: "203.0.113.2" },
		];
		expect(recordsOf(answers, "CNAME")).toEqual(["edge.example.net"]);
		expect(recordsOf(answers, "A")).toEqual(["203.0.113.2", "203.0.113.9"]);
		expect(recordsOf(answers, "AAAA")).toEqual([]);
	});
});

describe("certificate log parsing", () => {
	const rows = [
		{
			name_value: "*.example.com\nexample.com",
			not_before: "2026-09-26T22:49:11",
			not_after: "2026-12-25T22:56:35",
		},
		{
			name_value: "API.example.com\nother.net",
			not_before: "2026-10-01T00:00:00",
			not_after: "2027-01-01T00:00:00",
		},
		{
			name_value: "notexample.com",
			not_before: "2026-10-01T00:00:00",
			not_after: "2027-01-01T00:00:00",
		},
		{
			name_value: "broken.example.com",
			not_before: "not a date",
			not_after: "2027-01-01T00:00:00",
		},
		"not an object",
	];

	it("keeps only well-formed rows and names under the domain", () => {
		expect(parseCtRows(rows, "example.com")).toEqual([
			{
				names: ["*.example.com", "example.com"],
				notBefore: "2026-09-26T22:49:11.000Z",
				notAfter: "2026-12-25T22:56:35.000Z",
			},
			{
				names: ["api.example.com"],
				notBefore: "2026-10-01T00:00:00.000Z",
				notAfter: "2027-01-01T00:00:00.000Z",
			},
		]);
	});

	it("matches a host to its own certificate or a one-level wildcard, preferring the latest expiry", () => {
		const certs = parseCtRows(rows, "example.com");
		expect(latestCertFor("api.example.com", certs)?.notAfter).toBe("2027-01-01T00:00:00.000Z");
		expect(latestCertFor("www.example.com", certs)?.notAfter).toBe("2026-12-25T22:56:35.000Z");
		expect(latestCertFor("a.b.example.com", certs)).toBeNull();
	});
});
