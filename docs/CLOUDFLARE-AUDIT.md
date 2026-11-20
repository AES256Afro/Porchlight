# Cloudflare account audit: the built-in rules

Porchlight's Cloudflare page (and `porchlight cloudflare audit`) reads your Cloudflare account through an API token you make, and judges every zone with the rules below. The rules are plain code in `cli/src/cloudflare/rules.ts`: no model is involved, and nothing needs the network beyond Cloudflare's API, apart from one optional DNS lookup described under [DNS](#dns). A model can analyse the result afterwards if you ask; it changes nothing here.

The rules were set from Cloudflare's documentation as of November 2026 (sources at the end). **They have been tested only against a fake account built from that documentation, not against a real Cloudflare account.** Field names, plan details and dashboard paths should be checked on a real read-only token before relying on them; see [Not yet verified](#not-yet-verified).

## How a check is reported

| Status | Meaning |
| --- | --- |
| Problem (with a severity) | The setting is weaker than the rule recommends |
| Could not check | The token may not read it, or Cloudflare did not answer, or the answer was not understood. **Never counted as passed.** The page names the permission to add |
| Passed | As recommended |
| Not on this plan | The zone's plan does not include the feature. **Never counted as a problem**: a Free zone is not told to turn on a paid feature |

## The token

Make a token at Cloudflare → My Profile → API Tokens. **Settings → Cloudflare** has a link that opens Cloudflare's "Create token" page with most of these ticked; Cloudflare drops permission keys it does not recognise without saying so, so check the list.

Read permissions (all the audit needs):

| Scope | Permission | What Porchlight reads with it |
| --- | --- | --- |
| Zone | Zone Read | Your zones and their plans |
| Zone | Zone Settings Read | SSL/TLS mode, Always Use HTTPS, TLS versions, HSTS, Automatic HTTPS Rewrites, security level, Browser Integrity Check, global authenticated origin pulls |
| Zone | DNS Read | DNS records and DNSSEC |
| Zone | SSL and Certificates Read | Universal SSL, certificate packs, uploaded certificates, zone-level authenticated origin pulls |
| Zone | Zone WAF Read | Which WAF managed rulesets are deployed |
| Zone | Bot Management Read | Bot Fight Mode and Super Bot Fight Mode |
| Account | Account Settings Read | Members, their roles and two-factor authentication |
| Account | Account API Tokens Read | Account-owned tokens |
| User | API Tokens Read | Your own user tokens (a user token only) |

Optional, only for changes you approve one at a time:

| Scope | Permission | What it lets Porchlight do |
| --- | --- | --- |
| Zone | DNS Write | Add the `_porchlight-challenge` ownership record |
| Zone | Zone Settings Write | Turn on Always Use HTTPS, TLS 1.3, Automatic HTTPS Rewrites and Browser Integrity Check; set the minimum TLS version to 1.2 |

Both user tokens (`cfut_…`) and account tokens (`cfat_…`) work. The token is verified with Cloudflare before it is saved (`GET /user/tokens/verify`, or `GET /accounts/{id}/tokens/verify` for an account token).

## SSL/TLS

| Rule | Problem when | Severity | Plan | Fix (dashboard) | API that changes it |
| --- | --- | --- | --- | --- | --- |
| SSL/TLS encryption mode | Off / Flexible / Full | critical / high / medium | all | Origin certificate, then Full (strict) in Cloudflare → SSL/TLS → Overview | `PATCH /zones/{id}/settings/ssl {"value":"strict"}` |
| Always Use HTTPS | off | medium | all | Cloudflare → SSL/TLS → Edge Certificates | `PATCH …/settings/always_use_https {"value":"on"}` (Porchlight can apply) |
| Minimum TLS version | 1.0 or 1.1 | medium | all | Cloudflare → SSL/TLS → Edge Certificates | `PATCH …/settings/min_tls_version {"value":"1.2"}` (Porchlight can apply) |
| TLS 1.3 | off | low | all | Cloudflare → SSL/TLS → Edge Certificates | `PATCH …/settings/tls_1_3 {"value":"on"}` (Porchlight can apply) |
| HSTS | off; max-age under 6 months | medium; low | all | Cloudflare → SSL/TLS → Edge Certificates, 6 months then 12; includeSubDomains and preload only when every subdomain has HTTPS | `PATCH …/settings/security_header` (not applied by Porchlight: hard to undo) |
| Automatic HTTPS Rewrites | off | low | all | Cloudflare → SSL/TLS → Edge Certificates | `PATCH …/settings/automatic_https_rewrites {"value":"on"}` (Porchlight can apply) |
| Universal SSL | off with no other active certificate | high | all | Cloudflare → SSL/TLS → Edge Certificates | `PATCH /zones/{id}/ssl/universal/settings {"enabled":true}` |
| Edge certificates | of the certificates in use (an active pack, or one you uploaded): expired; a Cloudflare-managed one within 14 days (it should have renewed at 30); an uploaded one within 30. Also a pack in an error state. The backup certificate Cloudflare keeps beside every Universal one (`backup_issued`) and a pack on its way in or out (`pending_…`) are not problems, and their dates are not read | critical; high; medium | all | Cloudflare → SSL/TLS → Edge Certificates | `GET /zones/{id}/ssl/certificate_packs?status=all` |
| Authenticated origin pulls | neither global (`tls_client_auth`) nor zone-level is on | low | all | Origin certificate on the server first, then Cloudflare → SSL/TLS → Origin Server | `PATCH …/settings/tls_client_auth {"value":"on"}` |

Automatic SSL/TLS (`ssl_automatic_mode: auto`) is noted in the detail: it raises the mode only once the origin presents a valid certificate. Strict (SSL-Only Origin Pull) counts as Full (strict).

## DNS

| Rule | Problem when | Severity | Fix |
| --- | --- | --- | --- |
| DNSSEC | not active (pending: the DS record is missing at the registrar) | medium; *not on this plan* for a partial (CNAME) setup | Cloudflare → DNS → Settings, then the DS record at the registrar |
| CAA records | none at the apex | low | Add CAA records in Cloudflare → DNS → Records; Cloudflare then adds those its own certificate authorities need |
| Origin addresses behind proxied hosts | a DNS-only A/AAAA record has the same address as a proxied one | high | Proxy it, or move the service; then change the leaked address |
| DNS-only records | A/AAAA/CNAME records that skip the proxy, apart from mail, VPN, `_`-prefixed and MX names | low (review) | Proxy website and API records |
| Internal addresses in public DNS | private, loopback, link-local or CGNAT addresses (IPv4 and IPv6) | medium | Delete, or move to private DNS |
| Records pointing at names that do not exist in your zones | a CNAME into one of your zones names a record that is not there | medium | Delete it or create the target |
| Records pointing at services that may be gone | a CNAME outside your zones points at a name that no longer exists (subdomain takeover) | high | Delete it before someone claims the name |

The last rule needs a DNS lookup of each CNAME target outside your account. Porchlight makes it (through Cloudflare's DNS-over-HTTPS resolver, at most 40 a zone) **only for a zone whose `_porchlight-challenge` TXT record holds the token this computer keeps for it, checked in the same audit** (invariant 1). For other zones the rule is **Could not check**, with the targets listed, those on services where names can be claimed (Heroku, GitHub Pages, S3, Azure, Netlify, …) first. The option can be turned off (`--no-lookups`).

## Email

| Rule | Problem when | Severity |
| --- | --- | --- |
| SPF | none (medium if the domain has MX records, low if not: then `v=spf1 -all`); more than one; `+all`; `?all`; no `all` | medium; medium; high; medium; low |
| DMARC | none at `_dmarc`; `p=none` or no policy | medium; low |
| DKIM | the domain receives mail (MX) but publishes no key under `_domainkey` | medium |

DKIM selectors cannot be listed over DNS, but the API returns every record in the zone, so a key published in Cloudflare is found whatever its selector.

## Firewall and bots

| Rule | Free | Pro / Business | Enterprise |
| --- | --- | --- | --- |
| WAF managed rules | Free Managed Ruleset deployed and on; disabled: high; not listed: **Could not check** (Cloudflare may run it by default) | Cloudflare Managed Ruleset (`efb7b8c9…`) not deployed or off: high | same as Pro |
| OWASP Core Ruleset | *not on this plan* | not deployed: low (start in log mode) | same as Pro |
| Security level | Under Attack mode left on: low. Cloudflare no longer scores threats, so the level only switches Under Attack mode | same | same |
| Browser Integrity Check | off: low (Porchlight can turn it on) | same | same |
| Bot protection | Bot Fight Mode off: low | Super Bot Fight Mode letting definitely automated traffic through: low | *not judged*: Bot Management replaces it |

Dashboard paths: Cloudflare → Security → Settings (filter by Web application exploits or Bot traffic).

## Proof of ownership

| Rule | Problem when | Severity |
| --- | --- | --- |
| Porchlight ownership record | `_porchlight-challenge.<zone>` (or the old `_securityx-challenge`) does not hold the token this computer keeps for the zone in `investigate-domains.json` | low; Porchlight can add it |

The same record proves the domain for **Investigate with a model**, and the monitor's token is shared when the monitor watches the domain.

## Account and tokens

| Rule | Problem when | Severity |
| --- | --- | --- |
| Two-factor authentication for members | an accepted member has none; Cloudflare does not say: Could not check | high |
| Super Administrators | more than two, or invitations not accepted | low |
| Account API tokens / Your API tokens | a token with write permissions over every zone or account, no IP filter and no end date; a token unused for 180 days | medium; low |

Members are shown by a masked email (`a…@example.com`) only. The token Porchlight uses is never called idle.

## Changes Porchlight can make (invariant 21)

The default is read-only. With DNS Write or Zone Settings Write added to the token, a problem with a change offers **Let Porchlight make this change…**. Porchlight then shows the exact request (method, full address, body, and the Authorization header as "your saved token, not shown"). Only **Approve and send**, on the page of the computer Porchlight runs on, sends it, once. Every change sent, accepted or refused, is recorded in `cloudflare-changes.json` and listed on the page. A request shown and not answered expires after 10 minutes. Changes are fixed templates (`cli/src/cloudflare/apply.ts`); a request names only the zone and which change.

## Not covered

The Global API Key and how members sign in (SSO, passkeys); your own firewall custom rules, rate limiting, Page Rules and configuration rules; Workers, Pages, R2, Zero Trust and Tunnel; your origin servers themselves; DNS hosted elsewhere and your registrar's settings. An audit covers the first 200 zones of an account.

## Not yet verified

Checked only against Cloudflare's documentation and a fake account in the tests:

- the exact shape of `GET /zones/{id}/bot_management` on each plan (`fight_mode`, `sbfm_definitely_automated`);
- whether a Free zone's Free Managed Ruleset appears in its `http_request_firewall_managed` entry point (if it never does, the rule will always say Could not check on Free zones and should change);
- whether `GET /accounts/{id}/members` still returns `user.two_factor_authentication_enabled` and `roles` after the move to permission policies;
- the permission keys in the token template link (`zone`, `zone_settings`, `dns`, `ssl_and_certificates`, `firewall_services`, `account_settings`, `account_api_tokens`);
- the `?to=/:account/:zone/…` dashboard links.

To verify: make a read-only token with the permissions above, save it in Settings → Cloudflare, run the audit, and compare each zone's result with its dashboard.

### First run against a real account (20 November 2026)

One account of 26 zones, all on the Free plan. The audit ran to the end. What it showed:

- **Fixed.** Every zone lists a second Universal pack with the status `backup_issued`: the backup certificate Cloudflare keeps beside each Universal one. The certificate rule counted it as "not active", so every zone failed. It now counts only the certificates in use (see the table above).
- **Still open.** The token could not read WAF rulesets or Bot Management ("Zone WAF Read" and "Bot Management Read" were missing), so both checks said Could not check on every zone, as they should. That leaves the first two items above unverified, and it is not known whether the token came from the template link. If it did, `firewall_services` is the wrong key for Zone WAF Read and the link has no key for Bot Management.
- **Second run, the same day, with a token given every permission.** WAF rulesets and Bot Management were read on all 26 zones, so both checks ran; their results have not been compared with the dashboard. `GET /user/tokens` was still refused, so "API Tokens Read" may be a permission Cloudflare does not give an API token at all; the page now says it is optional.
- **Bot Fight Mode cannot be turned on yet.** `PUT /zones/{id}/bot_management` with `{"fight_mode":true}` was answered HTTP 400 "Bad Request" on every Free zone tried, with a token that had every permission. The template stays in `apply.ts` but the rule no longer offers it, until the body Cloudflare wants is known.
- **Not compared yet.** No zone's result has been read against its dashboard, and the members check was not looked at.

## Sources

Cloudflare developer documentation, read November 2026: [Encryption modes](https://developers.cloudflare.com/ssl/origin-configuration/ssl-modes/), [Always Use HTTPS](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/always-use-https/), [HTTP Strict Transport Security](https://developers.cloudflare.com/ssl/edge-certificates/additional-options/http-strict-transport-security/), [Universal SSL](https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/), [Authenticated Origin Pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/), [DNSSEC](https://developers.cloudflare.com/dns/dnssec/) and [DNSSEC states](https://developers.cloudflare.com/dns/dnssec/dnssec-states/), [DNS record types](https://developers.cloudflare.com/dns/manage-dns-records/reference/dns-record-types/), [WAF managed rules](https://developers.cloudflare.com/waf/managed-rules/), [Security level](https://developers.cloudflare.com/waf/tools/security-level/), [Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/bot-fight-mode/) and [Super Bot Fight Mode](https://developers.cloudflare.com/bots/get-started/super-bot-fight-mode/), [API token permissions](https://developers.cloudflare.com/fundamentals/api/reference/permissions/), [Token formats](https://developers.cloudflare.com/fundamentals/api/get-started/token-formats/), [Token template URLs](https://developers.cloudflare.com/fundamentals/api/how-to/account-owned-token-template/), [Manage members](https://developers.cloudflare.com/fundamentals/manage-members/manage/), and [API deprecations](https://developers.cloudflare.com/fundamentals/api/reference/deprecations/) (the batch `GET /zones/{id}/settings` ends 31 March 2027, so each setting is read on its own).
