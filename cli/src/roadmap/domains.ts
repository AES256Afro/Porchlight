import type { Finding, ScanReport } from "../../../monitor/src/types.ts";
import type { Severity } from "../repos/types.ts";
import { assemble, emptyCounts, type Action, type FindingRow, type FindingsList, type PhaseKey, type Planned, type Roadmap } from "./types.ts";

/** A finding as the monitor reports it (monitor/src/types.ts). Its `id` is `<kind>:<host>` or `missing-header:<host>:<header>`. */
export type MonitorFinding = Pick<Finding, "id" | "severity" | "host" | "title">;

/** The parts of a monitor scan report a roadmap is built from. */
export type MonitorReport = Pick<ScanReport, "domain" | "takenAt" | "notes"> & { findings: MonitorFinding[] };

const SUMMARIES: Record<PhaseKey, string> = {
	now: "Records someone else could take over, and certificates that have expired.",
	next: "Certificates about to expire, and missing headers that protect every visitor.",
	schedule: "Nothing from the monitor falls here.",
	later: "Hardening that is worth doing but not urgent.",
};

/** The monitor's highest level is high, and it means exposed now. */
const PHASE_OF: Record<MonitorFinding["severity"], PhaseKey> = { high: "now", medium: "next", low: "later" };

/** A starting value for each header. Tighten it once the site is known to work with it. */
const HEADER_VALUES: Record<string, string> = {
	"strict-transport-security": "`Strict-Transport-Security: max-age=31536000`. Add `includeSubDomains` only once every subdomain serves HTTPS.",
	"content-security-policy": "`Content-Security-Policy: default-src 'self'`. Start with `Content-Security-Policy-Report-Only` to see what it would block.",
	"x-content-type-options": "`X-Content-Type-Options: nosniff`.",
	"x-frame-options": "`X-Frame-Options: DENY`, or `frame-ancestors 'none'` in the Content-Security-Policy.",
	"referrer-policy": "`Referrer-Policy: strict-origin-when-cross-origin`.",
	"permissions-policy": "`Permissions-Policy: geolocation=(), camera=(), microphone=()`, listing only what the site uses.",
};

/** Turns a monitor scan of one domain into repairs, grouped by host. */
export function buildDomainRoadmap(report: MonitorReport): Roadmap {
	return assemble(
		{ title: `Repair roadmap for ${report.domain}`, source: report.domain, scannedAt: report.takenAt, scope: null, caveats: report.notes, scanKind: "Monitor scan", places: ["host", "hosts"] },
		SUMMARIES,
		plan(report),
	);
}

const TYPE_OF: Record<Action["kind"], string> = {
	dns: "DNS",
	certificate: "Certificate",
	headers: "Headers",
	review: "Other",
	upgrade: "Other",
	replace: "Other",
	rotate: "Other",
	keep: "Other",
	purge: "Other",
	workflow: "Other",
};

/** Every open finding for the domain with the repair that clears it, most severe first. */
export function listDomainFindings(report: MonitorReport): FindingsList {
	const rank = { high: 0, medium: 1, low: 2 };
	const rows: FindingRow[] = plan(report).flatMap(({ group, phase, action, findings }) =>
		findings.map((finding) => ({
			place: group,
			severity: finding.severity,
			type: TYPE_OF[action.kind],
			id: finding.id.split(":")[0]!,
			title: finding.title,
			where: action.where,
			detail: "",
			phase,
			suggestion: action.title,
			// Missing headers are one action for a host; each finding keeps the step for its own header.
			how: finding.id.startsWith("missing-header:") ? action.how.filter((_, index) => action.clears[index] === finding.id.split(":").at(-1)) : action.how,
		})),
	);
	rows.sort((a, b) => rank[a.severity as keyof typeof rank] - rank[b.severity as keyof typeof rank] || a.place.localeCompare(b.place, "en") || a.title.localeCompare(b.title, "en"));
	return { title: `Findings and suggested fixes for ${report.domain}`, source: report.domain, scannedAt: report.takenAt, scope: null, caveats: report.notes, scanKind: "Monitor scan", places: ["host", "hosts"], rows };
}

/** The repair for each open finding, keyed by the finding's ID, for showing beside it. */
export function domainSuggestions(report: MonitorReport): Record<string, { title: string; how: string[] }> {
	return Object.fromEntries(listDomainFindings(report).rows.map((row, index, rows) => [idOf(report, rows, index), { title: row.suggestion, how: row.how }]));
}

function idOf(report: MonitorReport, rows: FindingRow[], index: number): string {
	const row = rows[index]!;
	return report.findings.find((finding) => finding.host === row.place && finding.title === row.title)?.id ?? `${row.id}:${row.place}`;
}

function plan(report: MonitorReport): Planned<MonitorFinding>[] {
	const entries: Planned<MonitorFinding>[] = [];
	const headersByHost = new Map<string, MonitorFinding[]>();

	for (const finding of report.findings) {
		const kind = finding.id.split(":")[0];
		if (kind === "missing-header") {
			headersByHost.set(finding.host, [...(headersByHost.get(finding.host) ?? []), finding]);
			continue;
		}
		const action = single(kind, finding);
		entries.push({ group: finding.host, phase: PHASE_OF[finding.severity], action, findings: [finding] });
	}

	for (const [host, findings] of headersByHost) {
		const priority = findings.some((finding) => finding.severity === "medium") ? "medium" : "low";
		const headers = findings.map((finding) => finding.id.split(":").at(-1)!);
		entries.push({
			group: host,
			phase: PHASE_OF[priority],
			findings,
			action: {
				kind: "headers",
				priority,
				title: `Add ${headers.length === 1 ? "1 security header" : `${headers.length} security headers`} to responses from ${host}`,
				where: `https://${host}/`,
				how: headers.map((header) => HEADER_VALUES[header] ?? `Send the \`${header}\` header.`),
				clears: headers,
				counts: count(findings),
			},
		});
	}

	return entries;
}

function single(kind: string | undefined, finding: MonitorFinding): Action {
	const base = { priority: finding.severity as Severity, where: finding.host, clears: [finding.title], counts: count([finding]) };
	switch (kind) {
		case "dangling-cname":
			return {
				...base,
				kind: "dns",
				title: `Remove or repoint the DNS record for ${finding.host}`,
				how: [
					"If the service behind it is gone, delete the CNAME record.",
					"If it is still wanted, point it at a target you control. Until then, whoever claims the old target can serve content on this name.",
				],
			};
		case "cert-expired":
			return {
				...base,
				kind: "certificate",
				title: `Issue a new certificate for ${finding.host}`,
				how: ["Issue and install a new certificate.", "Find out why renewal did not happen by itself, so it does next time."],
			};
		case "cert-expiring":
			return {
				...base,
				kind: "certificate",
				title: `Renew the certificate for ${finding.host} before it expires`,
				how: ["Renew it now, or confirm that automatic renewal is about to run.", "If renewal is automatic, check its logs: it has not logged a new certificate yet."],
			};
		case "no-caa":
			return {
				...base,
				kind: "dns",
				title: `Add a CAA record for ${finding.host}`,
				how: ['Publish a CAA record naming the certificate authority you use, for example `0 issue "letsencrypt.org"`.', "Add one record for each authority that issues certificates for this domain."],
			};
		case "weak-hsts":
			return {
				...base,
				kind: "headers",
				title: `Make Strict-Transport-Security last longer on ${finding.host}`,
				how: [
					"Send `Strict-Transport-Security: max-age=31536000`.",
					"Raise it in steps if you are unsure every page works over HTTPS: a browser that has seen the header refuses plain HTTP until it runs out.",
				],
			};
		case "insecure-cookies":
			return {
				...base,
				kind: "headers",
				title: `Add the Secure flag to the cookies ${finding.host} sets`,
				how: ["Set each cookie with `Secure`, in the application or in the framework's session settings.", "A Secure cookie is not sent over plain HTTP, so check first that the site is only ever reached over HTTPS."],
			};
		case "script-readable-cookies":
			return {
				...base,
				kind: "headers",
				title: `Add the HttpOnly flag to the sign-in cookies ${finding.host} sets`,
				how: [
					"Set the sign-in cookie with `HttpOnly`, so a script injected into a page cannot read it.",
					"If your own scripts read it, give them what they need another way, such as a separate cookie that does not carry the sign-in.",
				],
			};
		case "no-dnssec":
			return {
				...base,
				kind: "dns",
				title: `Turn on DNSSEC for ${finding.host}`,
				how: ["Enable DNSSEC where the domain's DNS is hosted.", "Add the DS record it gives you at the registrar. Nothing is signed until both are done."],
			};
		case "no-spf":
			return {
				...base,
				kind: "dns",
				title: `Add an SPF record for ${finding.host}`,
				how: [
					"Publish one TXT record listing who sends mail for the domain, such as `v=spf1 include:_spf.google.com ~all` for Google Workspace.",
					"If the domain sends no mail at all, publish `v=spf1 -all`.",
				],
			};
		case "weak-spf":
			return {
				...base,
				kind: "dns",
				title: `Tighten the SPF record for ${finding.host}`,
				how: ["Keep exactly one TXT record that starts `v=spf1`, listing only the servers that send your mail.", "End it with `~all` or `-all`, never `+all` or `?all`."],
			};
		default:
			// A finding kind this version does not know is still listed, in the monitor's own words.
			return { ...base, kind: "review", title: finding.title, how: ["Look into this finding on the Domains page."] };
	}
}

function count(findings: MonitorFinding[]) {
	const counts = emptyCounts();
	for (const finding of findings) counts[finding.severity]++;
	return counts;
}
