import { resolves } from "./collect/dns.ts";
import type { HttpProbe, SecurityHeader } from "./collect/http.ts";
import type { Settings } from "./env.ts";
import type { HostState, Snapshot } from "./snapshot.ts";
import type { Finding, Severity } from "./types.ts";

export type { Finding, Severity };

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
		// A certificate carried from an older scan says nothing about now: it would age into a false
		// "expired" while the log cannot be read. Its findings are carried instead (see `reobserved`).
		if (live && state.cert && certObserved(snapshot, host)) {
			const finding = certFinding(host, state.cert, settings, now);
			if (finding) add(finding);
		}
		if (state.http?.ok && !pageUnavailable(state.http.status)) {
			for (const finding of [hstsFinding(host, state.http), ...cookieFindings(host, state.http)]) {
				if (finding) add(finding);
			}
			for (const header of missingHeaders(state.http)) {
				// Browsers ignore Strict-Transport-Security without a max-age they can read (RFC 6797), so it is as good as missing.
				const unreadable =
					header === "strict-transport-security" && state.http.hsts?.maxAge === null;
				add({
					id: `missing-header:${host}:${header}`,
					severity:
						header === "strict-transport-security" || header === "content-security-policy"
							? "medium"
							: "low",
					host,
					basis: "http",
					title: unreadable
						? "Strict-Transport-Security has no max-age browsers can read, so they ignore it"
						: `Missing ${header} header`,
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
			// Certificate authorities climb to the parent's CAA record (RFC 8659), and the parent of a
			// subdomain is not proven, so it is not looked up (invariant 1). Without a public suffix list
			// a name of three labels or more may be a subdomain, so the title says what was not checked.
			title:
				snapshot.domain.split(".").length > 2
					? "No CAA record on this name; a CAA record on a parent domain, which is not checked, may still limit who can issue"
					: "No CAA record: any certificate authority may issue for this domain",
		});
	}
	if (snapshot.dnssec === false) {
		add({
			id: `no-dnssec:${snapshot.domain}`,
			severity: "low",
			host: snapshot.domain,
			basis: "apex",
			title:
				"DNSSEC is not enabled: DNS answers for this domain are not signed, so a forged one cannot be told apart",
		});
	}
	const spf = spfFinding(snapshot.domain, snapshot.apex.TXT);
	if (spf) add(spf);

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

/** Browsers are asked to remember HTTPS for at least this long; less, and the protection lapses between visits. */
const MIN_HSTS_SECONDS = 180 * 86_400;

/** A Strict-Transport-Security header that is sent, but too weak to do its job. */
function hstsFinding(host: string, probe: Extract<HttpProbe, { ok: true }>): Finding | null {
	const maxAge = probe.hsts?.maxAge;
	// No header at all is the missing-header finding; an older snapshot, or a max-age that could not be read, says nothing.
	if (maxAge === undefined || maxAge === null || maxAge >= MIN_HSTS_SECONDS) return null;
	const off = maxAge === 0;
	const days = Math.floor(maxAge / 86_400);
	const hours = Math.max(1, Math.floor(maxAge / 3_600));
	const lasts =
		days >= 1 ? (days === 1 ? "1 day" : `${days} days`) : hours === 1 ? "1 hour" : `${hours} hours`;
	return {
		id: `weak-hsts:${host}`,
		severity: off ? "medium" : "low",
		host,
		basis: "http",
		title: off
			? "Strict-Transport-Security has max-age=0, which tells browsers to stop insisting on HTTPS"
			: `Strict-Transport-Security lasts ${lasts}; use at least 180 days so browsers keep insisting on HTTPS`,
	};
}

/** A cookie that carries a sign-in, by its name: the ones a script should never be able to read. */
const SESSION_COOKIE = /sess|sid$|^sid|auth|token|login|jwt/i;
/** Anti-forgery cookies (Django's csrftoken, Angular's XSRF-TOKEN) are made for scripts to read. */
const CSRF_COOKIE = /csrf|xsrf/i;
/** Cookie names listed in a finding's title before the rest are counted. */
const COOKIES_NAMED = 4;

/** Cookies set without the flags that keep them off plain HTTP and out of scripts. One finding per kind per host. */
function cookieFindings(host: string, probe: Extract<HttpProbe, { ok: true }>): Finding[] {
	const cookies = probe.cookies ?? [];
	const named = (list: typeof cookies) => {
		const names = [...new Set(list.map((cookie) => cookie.name))].sort();
		const shown = names.slice(0, COOKIES_NAMED).join(", ");
		return names.length > COOKIES_NAMED
			? `${shown} and ${names.length - COOKIES_NAMED} more`
			: shown;
	};
	const findings: Finding[] = [];
	const insecure = cookies.filter((cookie) => !cookie.secure);
	if (insecure.length > 0) {
		findings.push({
			id: `insecure-cookies:${host}`,
			severity: "low",
			host,
			basis: "http",
			title: `Cookies set without the Secure flag, so a browser would also send them over plain HTTP: ${named(insecure)}`,
		});
	}
	const readable = cookies.filter(
		(cookie) =>
			!cookie.httpOnly && SESSION_COOKIE.test(cookie.name) && !CSRF_COOKIE.test(cookie.name),
	);
	if (readable.length > 0) {
		findings.push({
			id: `script-readable-cookies:${host}`,
			severity: "low",
			host,
			basis: "http",
			title: `Sign-in cookies set without the HttpOnly flag, so a script on the page can read them: ${named(readable)}`,
		});
	}
	return findings;
}

/**
 * What the domain's SPF record says about who may send its mail. `txt` is the apex TXT records
 * already looked up; undefined (the lookup failed) says nothing.
 */
function spfFinding(domain: string, txt: string[] | undefined): Finding | null {
	if (txt === undefined) return null;
	const records = txt.filter((value) => /^v=spf1(\s|$)/i.test(value));
	const finding = (id: string, severity: Severity, title: string): Finding => ({
		id: `${id}:${domain}`,
		severity,
		host: domain,
		basis: "apex",
		title,
	});
	if (records.length === 0)
		return finding(
			"no-spf",
			"low",
			"No SPF record: receiving servers cannot tell which mail really comes from this domain",
		);
	if (records.length > 1)
		return finding(
			"weak-spf",
			"low",
			`${records.length} SPF records: receivers treat more than one as an error and ignore them all`,
		);
	const all = /(?:^|\s)([+?~-]?)all\s*$/i.exec(records[0]!)?.[1];
	if (all === "+" || all === "")
		return finding(
			"weak-spf",
			"medium",
			"The SPF record ends in +all, which lets any server send mail as this domain",
		);
	if (all === "?")
		return finding(
			"weak-spf",
			"low",
			"The SPF record ends in ?all, which says nothing about mail from other servers; use ~all or -all",
		);
	// No `all` and no `redirect=` ends the same as ?all (RFC 7208 section 4.7).
	if (all === undefined && !/(?:^|\s)redirect=/i.test(records[0]!))
		return finding(
			"weak-spf",
			"low",
			"The SPF record has no all at its end, which says nothing about mail from other servers; end it with ~all or -all",
		);
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
		if (header === "strict-transport-security" && probe.hsts?.maxAge === null) return true;
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
	if (finding.basis === "apex") {
		// Each apex finding rests on one lookup: it is cleared only by a scan that made that lookup.
		const kind = finding.id.slice(0, finding.id.indexOf(":"));
		if (kind === "no-dnssec") return snapshot.dnssec !== undefined;
		if (kind === "no-spf" || kind === "weak-spf") return snapshot.apex.TXT !== undefined;
		return snapshot.apex.CAA !== undefined;
	}
	const state = snapshot.hosts[finding.host];
	if (!state) return true; // The host left the inventory, which clears its findings.
	if (state.dns === null) return false;
	if (!resolves(state.dns)) return true;
	if (finding.basis === "cert") return certObserved(snapshot, finding.host);
	if (finding.basis === "http") {
		if (state.http?.ok !== true || pageUnavailable(state.http.status)) return false;
		// Many sites set cookies only on some responses (a first visit, an A/B test, bot checks), so a
		// response that set none says nothing about the cookies, and would make these findings flap.
		if (/^(insecure|script-readable)-cookies:/.test(finding.id))
			return (state.http.cookies?.length ?? 0) > 0;
		return true;
	}
	return true;
}

/**
 * Whether this scan read the certificate log for `host`: not while the log could not be read, and
 * for the bare domain not while its own query failed (a certificate naming it alone would be missing).
 */
function certObserved(snapshot: Snapshot, host: string): boolean {
	return snapshot.ctOk && !(host === snapshot.domain && snapshot.ctApexOk === false);
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
	const before = new Map(previous.map((finding) => [finding.id, finding]));
	const after = new Set(current.map((finding) => finding.id));
	const worsened = (finding: Finding) => {
		const kind = finding.id.slice(0, finding.id.indexOf(":"));
		const worse = WORSENS_TO[kind];
		return worse !== undefined && after.has(`${worse}${finding.id.slice(kind.length)}`);
	};
	return {
		// A finding that grows more severe under the same id (HSTS from an hour to max-age=0, SPF from
		// ?all to +all) is reported again, as new: otherwise the worse state would never be alerted.
		added: current.filter((finding) => {
			const was = before.get(finding.id);
			return !was || SEVERITY_ORDER[finding.severity] < SEVERITY_ORDER[was.severity];
		}),
		resolved: previous.filter((finding) => !after.has(finding.id) && !worsened(finding)),
	};
}
