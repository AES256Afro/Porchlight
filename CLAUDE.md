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

## Interface conventions

- A severity is always shape, colour and word together (`severityBadge`), never colour alone. Status colours mark state only; text stays in the ink colours.
- An incomplete scan is shown as incomplete (the "Not covered" banner), never as clean.
- Browser code is typed with JSDoc and checked by `npm run typecheck`. It imports its data types from the TypeScript sources.

## Testing

- Tests never touch the network. The monitor injects `Deps` (`fetch`, `now`) and tests pass `fakeDeps` from `monitor/test/fake-net.ts`. The CLI injects a `Runner` and tests pass `fakeRunner`.
- Secret-shaped test data is assembled at run time (`fakeAwsKeyId` in `cli/test/helpers.ts`), so this repository's own pre-commit secret scan has nothing to find. Do not commit literal credential-shaped strings.
- `cli/test/fixtures/osv-scanner-2.7.1.json` is real osv-scanner output, trimmed. When the tool's format changes, capture a new fixture instead of editing this one by hand.
- osv-scanner exits 127 with an empty, well-formed report when it cannot reach its database. Treat any exit code other than 0, 1 and 128 as a failure, never as "no vulnerabilities".
