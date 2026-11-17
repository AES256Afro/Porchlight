# SecurityX

Two security tools behind one command line:

- **Attack-surface monitor** (`monitor/`): a scheduled Cloudflare Worker that watches domains you own for new hostnames, DNS changes, expiring certificates and missing security headers, and alerts on what changed since the last scan.
- **Repository scanner** (`cli/`): scans every git repository under a folder for committed secrets and vulnerable dependencies, and merges the results into one ranked report.

## Setup

```bash
npm run setup
```

This installs both packages and enables the pre-commit hook that blocks commits containing secrets.

Requirements:

- Node.js 22.18 or later. The `cf` CLI release candidate asks for 22.23+, 24.22+ or 26.12+ and warns on older versions.
- [gitleaks](https://github.com/gitleaks/gitleaks) for secret scanning: `brew install gitleaks`
- [osv-scanner](https://github.com/google/osv-scanner) for dependency scanning: `brew install osv-scanner`

The examples below assume this alias, run from the project root:

```bash
alias securityx="node $PWD/cli/bin/securityx.js"
```

## Web interface

```bash
securityx ui
```

It prints a link. Open it to get both tools in the browser:

- **Overview**: start a scan and watch its progress, see where things stand, and go to what needs doing first.
- **Findings**: every finding in one list, most severe first, each with the repair that clears it. Switch to **By repository** to see them grouped. Filter by severity, type, repository or text; the filters are kept in the address, so a reload or a shared link shows the same view.
- **Roadmap**: what to repair, in order. One action, such as upgrading a package, can clear many findings.
- **Domains**: register a domain, copy its verification record, check it, scan, and read what changed, with a suggested fix for each finding. This page needs `SECURITYX_MONITOR_URL` and `SECURITYX_ADMIN_TOKEN` set when you start the interface (see [Monitor domains](#monitor-domains)).

Every page with findings has an **Export** button; see [Export a repair roadmap](#export-a-repair-roadmap).

| Option | Effect |
| --- | --- |
| `--port <n>` | Port to listen on (default 4747; on this machine, the next free port if another copy already has it) |
| `--host <address>` | Address to listen on (default 127.0.0.1). Any other address needs `SECURITYX_UI_KEY`; see [Run on BoxPilot](#run-on-boxpilot) |
| `--report <file>` | Scan report to show and update (default `~/.securityx/repo-scan.json`) |
| `--root <dir>` | Folder offered in the scan form (default: the current folder) |

To browse a report made on the command line with `--json`, pass it with `--report`.

How the interface is protected:

- It listens on 127.0.0.1 only.
- The link carries a session key generated for that run. Every request for data needs it, so other pages in your browser, and other users of the machine, get nothing. The key is kept for that tab and removed from the address bar.
- It refuses requests addressed to any other host name or sent from another site.
- The monitor's admin token stays in the SecurityX process. The browser never receives it.
- The page loads nothing from the network, and has no dependencies or build step.

## Run on BoxPilot

SecurityX runs on [BoxPilot](https://github.com/AES256Afro/BoxPilot) as a private app, from the image `ghcr.io/aes256afro/securityx`: the web interface with gitleaks and osv-scanner built in. It is not in BoxPilot's catalog, and the image is private. On the BoxPilot server, open Apps → Private apps, sign in to ghcr.io with a token that can read packages, then add `boxpilot/securityx.yaml`. The monitor still runs on Cloudflare; the image is only its client.

- **Repositories to scan**: the folder of checkouts on the server (default `/srv/projects`), mounted read-only at `/repos`.
- **Access key**: BoxPilot generates `SECURITYX_UI_KEY`. The page asks for it once per browser tab.
- **Monitor address and admin token**: optional, for the Domains page.
- It starts on the tailnet only, because a report names the files and commits where secrets were found.

Outside BoxPilot:

```bash
export SECURITYX_UI_KEY="$(openssl rand -hex 32)"   # keep it: the page asks for it
docker run -d --name securityx -p 127.0.0.1:4747:4747 -e SECURITYX_UI_KEY \
  -v "$HOME/Projects:/repos:ro" -v securityx-data:/data ghcr.io/aes256afro/securityx:0.2.0
```

In the container, `securityx ui --host 0.0.0.0` changes what protects it:

- It refuses to start without `SECURITYX_UI_KEY` of at least 32 characters, and never prints it.
- It answers to any host name (a Tailscale name, a LAN address), so the key on every request is what guards the data. A cross-site Origin is still refused; only its host part is compared, because Tailscale Serve puts HTTPS in front.
- `GET /healthz` answers without the key, for the container's health check.

Releasing:

1. Set the new version in `cli/package.json` and its lockfile (`npm version <version> --no-git-tag-version` in `cli/`) and in `boxpilot/securityx.yaml`: `image.version`, and `image.reference` as `ghcr.io/aes256afro/securityx:<version>` with no digest yet. `npm run check` fails if they disagree.
2. Commit, then push a tag `v<version>`. CI stops if the tag does not match `cli/package.json`. Otherwise it runs the checks, smoke-tests the image (`scripts/container-smoke.sh`) and publishes it for amd64 and arm64, with an SBOM and build provenance. The package is private, like this repository.
3. Add the digest the publish job prints in its run summary to `image.reference` in `boxpilot/securityx.yaml`, and commit that.

SecurityX is a BoxPilot private app, so a release changes nothing in BoxPilot's catalog: `boxpilot/securityx.yaml` is the file you add on the BoxPilot server under Apps → Private apps. `npm run check` validates it with BoxPilot's own schema when a BoxPilot checkout is at `../BoxPilot` or `BOXPILOT_DIR`.

## Scan repositories

```bash
securityx repos scan ~/Projects --out reports/repos.md
```

| Option | Effect |
| --- | --- |
| `--depth <n>` | Directory levels searched for repositories (default 3) |
| `--out <file>` | Write the Markdown report to a file and print a summary |
| `--json` | Emit the report as JSON |
| `--fail-on <severity>` | Exit with code 2 if any finding is at or above `critical`, `high`, `medium` or `low`; exit with code 1 if a scanner was missing or failed, so an incomplete scan never passes |

What it checks:

- **Secrets** in the full commit history, with gitleaks. A secret deleted in a later commit is still reported, because it is still in history and must be rotated. Each match is ranked by how likely it is to be a live credential.
- **Dependencies** named in lockfiles, with osv-scanner, rated by CVSS score.

How secrets are ranked:

| The match is | In ordinary source | In tests, docs, examples, generated files, benchmark output or data files |
| --- | --- | --- |
| A known key format, such as an AWS key, a private key or a JWT | high | medium |
| A generic pattern that only looks like a key | medium | low |

A finding ranked below high says why. Ranking never removes a finding: a real key can sit in a test file, so the lower ranks still deserve a look.

What to know:

- Secret values are never written to the report or the terminal. gitleaks always runs with `--redact`, and author names and emails are dropped.
- A scanner that is not installed, or that failed on a repository, is listed under "Not covered" in the report. A report with that section is not a clean result.
- Dependency scanning needs network access: osv-scanner sends package names and versions to the OSV database (api.osv.dev). Offline, it is reported as not covered.
- Uncommitted and git-ignored files are not scanned.
- `reports/` is git-ignored: a report names the files and commits where secrets were found.

## Export a repair roadmap

A scan can be exported as something to work from, from the Export button in the interface or from the command line:

```bash
securityx repos scan ~/Projects --json --out reports/projects.json
securityx repos export reports/projects.json --out reports/roadmap.md
securityx domains export example.com --format html --out reports/example.html
```

What to export (`--content`):

- **`roadmap`** (default): the repairs, in order. Findings are grouped into actions: one per package to upgrade, credential to rotate, or batch of doubtful secrets to check. Each action says where the work is, what it clears and how to do it.
- **`findings`**: every finding, most severe first, each with the repair that clears it.

The roadmap has four phases:

| Phase | What is in it |
| --- | --- |
| 1. Fix now | Credentials that look live, and critical vulnerabilities |
| 2. Fix next | High-severity vulnerabilities |
| 3. Schedule | Medium-severity vulnerabilities, and possible secrets that need a look |
| 4. When convenient | Low-severity vulnerabilities, and matches unlikely to be real secrets |

An action sits in the phase of the worst finding it clears. An upgrade names the lowest version that clears every advisory against the package, taken from the advisories themselves, and warns when that is a major version change. Where no fixed release exists, the action says so instead of naming a version.

Formats (`--format`):

| Format | For |
| --- | --- |
| `md` (default) | A checklist to paste into an issue or keep in a repository |
| `html` | A self-contained page with no script that opens in any browser; print it, or save it as a PDF from the print dialog |
| `csv` | One row per action or finding, for a tracker or a spreadsheet |
| `json` | Scripts and other tools |

`--severity`, `--kind`, `--match` and `--repo` narrow a repository export to part of the scan. A narrowed export says at the top that it is partial, and one made from an incomplete scan says what the scan did not cover.

Text from repositories and DNS records is escaped for each format, so a hostile file name or package name cannot become markup in the page, a link in the Markdown or a formula in the spreadsheet.

## Monitor domains

### How it works

1. You register a domain. The monitor gives you a TXT record to publish at `_securityx-challenge.<domain>`.
2. Once that record resolves, the domain is verified. The record is re-checked before every scan; if it disappears, scanning stops and you get one alert.
3. Every hour the Worker scans the verified domain whose last scan is oldest, if it is older than 24 hours.
4. Each scan is compared with the previous one. You are alerted only when something changed, a finding appeared, or a finding was fixed.

Nothing is requested from, or about, a domain that has not passed the ownership check.

A scan reads three sources:

| Source | What it reads |
| --- | --- |
| Certificate Transparency logs (crt.sh) | Unexpired certificates for the domain and its subdomains: hostnames and expiry dates |
| DNS over HTTPS (cloudflare-dns.com) | Apex AAAA, NS, MX, TXT and CAA records; A and CNAME records for each host |
| HTTPS | One `GET /` per host that has an address, without following redirects; only the security headers are kept |

It reports these changes: host added, host gone, DNS record changed, HTTPS became reachable or unreachable.

It raises these findings:

| Finding | Severity |
| --- | --- |
| CNAME whose target does not resolve (subdomain takeover risk) | high |
| Latest certificate in the logs has expired with no replacement | high |
| Latest certificate expires soon with no renewal logged | medium |
| Missing `Strict-Transport-Security` or `Content-Security-Policy` | medium |
| Missing `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` or `Permissions-Policy` | low |
| No CAA record | low |

### Run locally

No Cloudflare account is needed.

```bash
cd monitor
cp .dev.vars.example .dev.vars   # then set ADMIN_TOKEN: openssl rand -hex 32
npm run db:migrate:local
npm run dev
```

Then, in another terminal:

```bash
export SECURITYX_MONITOR_URL=http://localhost:5173
export SECURITYX_ADMIN_TOKEN=<the ADMIN_TOKEN from .dev.vars>
securityx domains add example.com
```

### Deploy

```bash
cd monitor
npx cf auth login
npx cf d1 create --name securityx-monitor
```

Put the database ID it prints into `D1_DATABASE_ID` in `cloudflare.config.ts`, then:

```bash
npx cf d1 migrations apply <DATABASE_ID>
printf 'ADMIN_TOKEN=%s\n' "$(openssl rand -hex 32)" > .secrets.production
npx cf deploy --secrets-file .secrets.production
```

To receive alerts, add `ALERT_WEBHOOK_URL=https://...` to `.secrets.production` before deploying. Alerts are POSTed as JSON with a `text` field holding the summary, plus the structured report. Without a webhook, alerts go to the Worker's log.

Point the CLI at the URL `cf deploy` prints, with the same token:

```bash
export SECURITYX_MONITOR_URL=https://<your worker URL>
export SECURITYX_ADMIN_TOKEN=<the ADMIN_TOKEN from .secrets.production>
```

### Use it

```bash
securityx domains add example.com      # prints the TXT record to publish
securityx domains verify example.com   # once the record resolves
securityx domains scan example.com     # scan now; the first scan is the baseline
securityx domains show example.com     # latest report
securityx domains list
securityx domains remove example.com   # also deletes its scan history
```

### Settings

Set in `monitor/cloudflare.config.ts`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `SCAN_INTERVAL_HOURS` | 24 | How old a domain's last scan must be before it is scanned again |
| `MAX_HOSTS` | 12 | Hosts probed per scan: the apex, `www`, then alphabetical. The rest are listed but not probed |
| `CERT_EXPIRY_WARN_DAYS` | 14 | Warning window, capped at a fifth of the certificate's lifetime |
| `SNAPSHOTS_TO_KEEP` | 30 | Scans retained per domain |

The default `MAX_HOSTS` keeps a worst-case scan under 50 outbound requests, the per-invocation limit on the Workers Free plan. Raise it on a paid plan.

### Limits

- Certificate expiry comes from the certificate logs, not from the certificate a server presents. A Worker cannot read a peer certificate.
- Hostnames are discovered only through certificates. A host that has never had one is not found. There is no subdomain guessing by design.
- Addresses behind a CNAME are not compared, because they belong to the target's operator and rotate. An apex that sits behind a rotating load balancer will still produce A-record changes.
- The schedule scans one domain per hour, so 24 domains a day at the defaults.
- Domain names are sent to crt.sh and Cloudflare's DNS resolver.

## Development

```bash
npm run check   # types, lint and formatting
npm test        # both packages
```

- `monitor/src/scan.ts` is the scan pipeline; `snapshot.ts` observes, `findings.ts` and `diff.ts` interpret, `api.ts` is the HTTP API.
- `cli/src/repos/` is the scanner; `cli/src/monitor/client.ts` is the API client. The CLI has no runtime dependencies and runs its TypeScript directly.
- `cli/src/roadmap/` turns findings into repairs and renders the exports.
- `cli/src/ui/server.ts` serves the web interface in `cli/ui/`, which is plain JavaScript modules and CSS, type-checked through JSDoc. `store.js` holds what the pages share; `filter.js` and `list.js` are pure logic shared with the server and covered by tests.
- `.claude/launch.json` starts the interface and a local monitor for previewing in Claude Code.
- Tests do not touch the network: the monitor's use a scripted internet (`monitor/test/fake-net.ts`), the CLI's a scripted process runner. One CLI test runs the real gitleaks on a throwaway repository.
