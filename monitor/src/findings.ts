import { resolves } from "./collect/dns.ts";
import type { HttpProbe, SecurityHeader } from "./collect/http.ts";
import type { Settings } from "./env.ts";
import type { HostState, Snapshot } from "./snapshot.ts";

export type Severity = "high" | "medium" | "low";

/** A problem with the current state of the domain, as opposed to a change between scans. */
export interface Finding {
	/** Stable across scans, so a finding is reported once when it appears and once when it clears. */
	id: string;
	severity: Severity;
	host: string;
	/** Which observation the finding rests on; decides whether a later scan can clear it. */
	basis: "dns" | "http" | "cert" | "apex";
	title: string;
}

const DAY_MS = 86_400_000;
const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

/**
 * Findings for `snapshot`. A previous finding whose evidence could not be
 * re-observed this run (the probe failed, or the host was beyond the cap) is
 * carried forward, so a transient failure does not report it as fixed and
 * then as new again.
 */
export function deriveFindings(
	snapshot: Snapshot,
	previous: Finding[],
	settings: Settings,
	now: Date,
): Finding[] {
	const found = new Map<string, Finding>();
	const add = (finding: Finding) => found.set(finding.id, finding);

	for (const [host, state] of Object.entries(snapshot.hosts)) {
		const live = state.dns !== null && resolves(state.dns);
		if (state.dns && state.dns.cname.length > 0 && !live) {
			add({
				id: `dangling-cname:${host}`,
				severity: "high",
				host,
				basis: "dns",
				title: `CNAME target ${state.dns.cname.at(-1)} does not resolve; check for subdomain takeover`,
			});
		}
		if (live && state.cert) {
			const finding = certFinding(host, state.cert, settings, now);
			if (finding) add(finding);
		}
		if (state.http?.ok && !pageUnavailable(state.http.status)) {
			for (const header of missingHeaders(state.http)) {
				add({
					id: `missing-header:${host}:${header}`,
					severity:
						header === "strict-transport-security" || header === "content-security-policy"
							? "medium"
							: "low",
					host,
					basis: "http",
					title: `Missing ${header} header`,
				});
			}
		}
	}

	if (snapshot.apex.CAA?.length === 0) {
		add({
			id: `no-caa:${snapshot.domain}`,
			severity: "low",
			host: snapshot.domain,
			basis: "apex",
			title: "No CAA record: any certificate authority may issue for this domain",
		});
	}

	for (const finding of previous) {
		if (!found.has(finding.id) && !reobserved(snapshot, finding)) add(finding);
	}

	return [...found.values()].sort(
		(a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id),
	);
}

/**
 * Certificate lifetimes range from days to a year, so the warning window is
 * the configured number of days or a fifth of the certificate's lifetime,
 * whichever is shorter. Otherwise short-lived certificates would always warn.
 */
function certFinding(
	host: string,
	cert: NonNullable<HostState["cert"]>,
	settings: Settings,
	now: Date,
): Finding | null {
	const notAfter = Date.parse(cert.notAfter);
	const lifetimeDays = (notAfter - Date.parse(cert.notBefore)) / DAY_MS;
	const daysLeft = (notAfter - now.getTime()) / DAY_MS;
	const date = cert.notAfter.slice(0, 10);
	if (daysLeft <= 0) {
		return {
			id: `cert-expired:${host}`,
			severity: "high",
			host,
			basis: "cert",
			title: `Latest certificate in CT logs expired ${date}; no replacement logged`,
		};
	}
	if (daysLeft <= Math.min(settings.certExpiryWarnDays, lifetimeDays / 5)) {
		return {
			id: `cert-expiring:${host}`,
			severity: "medium",
			host,
			basis: "cert",
			title: `Latest certificate in CT logs expires ${date}; no renewal logged yet`,
		};
	}
	return null;
}

/** Which headers a response should carry depends on what kind of response it is. */
function missingHeaders(probe: Extract<HttpProbe, { ok: true }>): SecurityHeader[] {
	const success = probe.status >= 200 && probe.status < 300;
	let expected: SecurityHeader[];
	if (success && probe.html) {
		expected = [
			"strict-transport-security",
			"content-security-policy",
			"x-content-type-options",
			"x-frame-options",
			"referrer-policy",
			"permissions-policy",
		];
	} else if (success) {
		expected = ["strict-transport-security", "x-content-type-options"];
	} else {
		// Redirects and error pages: only transport security is meaningful.
		expected = ["strict-transport-security"];
	}
	return expected.filter((header) => {
		if (probe.present.includes(header)) return false;
		return !(header === "x-frame-options" && probe.frameAncestors);
	});
}

/**
 * A server error or rate limit says the site could not serve its page just
 * then, not how the page is configured: an outage's bare 503 lacks every
 * header the site normally sends. Header findings are neither raised nor
 * cleared by one.
 */
function pageUnavailable(status: number): boolean {
	return status >= 500 || status === 429;
}

/** Whether this scan had the evidence to confirm or clear `finding`. */
function reobserved(snapshot: Snapshot, finding: Finding): boolean {
	if (finding.basis === "apex") return snapshot.apex.CAA !== undefined;
	const state = snapshot.hosts[finding.host];
	if (!state) return true; // The host left the inventory, which clears its findings.
	if (state.dns === null) return false;
	if (finding.basis === "http") {
		if (!resolves(state.dns)) return true;
		return state.http?.ok === true && !pageUnavailable(state.http.status);
	}
	return true;
}

/**
 * A finding that turns into a worse one about the same thing (a certificate
 * that was expiring has now expired) is reported as the new, worse finding;
 * the milder one is not also reported as resolved.
 */
const WORSENS_TO: Record<string, string> = { "cert-expiring": "cert-expired" };

export function diffFindings(
	previous: Finding[],
	current: Finding[],
): { added: Finding[]; resolved: Finding[] } {
	const before = new Set(previous.map((finding) => finding.id));
	const after = new Set(current.map((finding) => finding.id));
	const worsened = (finding: Finding) => {
		const kind = finding.id.slice(0, finding.id.indexOf(":"));
		const worse = WORSENS_TO[kind];
		return worse !== undefined && after.has(`${worse}${finding.id.slice(kind.length)}`);
	};
	return {
		added: current.filter((finding) => !before.has(finding.id)),
		resolved: previous.filter((finding) => !after.has(finding.id) && !worsened(finding)),
	};
}
