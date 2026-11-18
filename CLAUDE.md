# SecurityX

An attack-surface monitor (Cloudflare Worker, `monitor/`) and a repository scanner with a monitor client (Node CLI, `cli/`). `README.md` covers usage. This file covers what must stay true.

## Commands

- `npm run check` and `npm test` at the root cover both packages.
- Monitor: `npm run dev`, `npm run db:migrate:local`, `npx cf deploy --dry-run` (builds and validates; needs no login).
- Cloudflare work goes through the `cf` CLI and `monitor/cloudflare.config.ts`. Do not add Wrangler or a Wrangler config file.

## Invariants

Do not weaken these without the owner asking for it.

1. **Ownership gate.** No request is made about a domain (certificate log, DNS other than the challenge record, HTTPS) unless `checkOwnership` passed earlier in the same scan. The "ownership gate" tests in `monitor/test/scan.test.ts` assert on the exact request list.
2. **Passive only.** One `GET /` per host, no redirects followed, no port scanning, no guessing of subdomains or paths.
3. **Secrets stay in the scanner.** gitleaks always runs with `--redact`. Reports never carry secret values, matches, author names or emails.
4. **The API fails closed.** A missing or short `ADMIN_TOKEN` makes every `/domains` route answer 503.
5. **"Not observed" is not "empty".** A failed lookup is stored as `null` or a missing key. It must never be reported as a change or clear a finding.
6. **The CLI has no runtime dependencies.** It runs TypeScript directly through Node's type stripping, so use erasable syntax only and `.ts` import extensions. The web interface in `cli/ui/` follows the same rule: plain JavaScript and CSS, no framework, no build step.
7. **The web interface answers only its own page.** `cli/src/ui/server.ts` binds 127.0.0.1 by default, rejects any other Host or a cross-site Origin, and requires the session key on every `/api` call. The monitor's admin token is added server-side and never sent to the browser. Listening on any other address (the BoxPilot container) needs a fixed `SECURITYX_UI_KEY` of at least 32 characters or the server refuses to start; it then accepts any well-formed Host, still compares the Origin's host, and never prints the key.
8. **No HTML is built from data.** Finding titles, file paths and DNS values are attacker-controllable, so `cli/ui` builds every element with `h()` in `dom.js` and never uses `innerHTML`. The Content-Security-Policy forbids inline script and style; keep both in files.
9. **The BoxPilot manifest matches the image.** `boxpilot/securityx.yaml` keeps `defaultExposure: tailnet`, a read-only repos mount and a generated key; `npm run check:boxpilot` checks it against the Dockerfile and BoxPilot's schema. The image is published only from a `v*` tag by CI, after `scripts/container-smoke.sh` passes.
10. **Triage re-ranks; it never drops.** `cli/src/repos/triage.ts` lowers a secret's severity one step per reason (a generic rule, an unlikely path) and records the reason in the finding's `note`. Do not turn it into a filter: a real key can live in a test file. Path rules match whole segments and file-name conventions, never substrings.
11. **Exports are escaped for their format.** Everything a roadmap or findings export prints from a scan goes through `cli/src/roadmap/escape.ts`: entities in HTML, an apostrophe before formula characters in CSV, escaped text or fenced code in Markdown. The HTML export has no script and loads nothing. Download names are built from a fixed stem and a date, never from request input.
12. **A suggested fix is the complete repair.** The fix shown for a finding is planned from its whole repository, not from whatever a filter left on show, so following it clears every advisory against the package. An export of part of a scan says it is partial; one from an incomplete scan says what was not covered.
13. **The local model sees only what the page shows, as data, and is never trusted.** `cli/src/assist/prompts.ts` sends it only fields the page displays, built by the server from its own copy of the report (the request only names what to explain), as one framed JSON block it is told is data, not instructions. Never secret values, authors, emails, the admin token or a domain's challenge. Its output is labelled as generated with the model's name (`generatedText` in `cli/ui/assist.js`), rendered as text with `h()`, never as HTML, and never acted on.

## Interface conventions

- A severity is always shape, colour and word together (`severityBadge`), never colour alone. Status colours mark state only; text stays in the ink colours.
- An incomplete scan is shown as incomplete (the "Not covered" banner), never as clean.
- `cli/ui/filter.js` decides what a filter matches, for the page and for the server alike, so "export what the filters show" exports exactly that. Do not filter anywhere else.
- A page's filters, order and page number live in the address (`cli/ui/list.js`), written with `history.replaceState`, so reload, back and shared links restore the view.
- Pages read shared data from `cli/ui/store.js` and subscribe to it; they do not fetch the report themselves. Long lists are paged, not rendered whole.
- Browser code is typed with JSDoc and checked by `npm run typecheck`. It imports its data types from the TypeScript sources.

## Testing

- Tests never touch the network. The monitor injects `Deps` (`fetch`, `now`) and tests pass `fakeDeps` from `monitor/test/fake-net.ts`. The CLI injects a `Runner` and tests pass `fakeRunner`; the UI server takes a `fetchFn` for the monitor and the local model, and tests pass a fake for both.
- Secret-shaped test data is assembled at run time (`fakeAwsKeyId` in `cli/test/helpers.ts`), so this repository's own pre-commit secret scan has nothing to find. Do not commit literal credential-shaped strings.
- `cli/test/fixtures/osv-scanner-2.7.1.json` is real osv-scanner output, trimmed. When the tool's format changes, capture a new fixture instead of editing this one by hand.
- osv-scanner exits 127 with an empty, well-formed report when it cannot reach its database. Treat any exit code other than 0, 1 and 128 as a failure, never as "no vulnerabilities".
