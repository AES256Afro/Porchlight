# Porchlight audit, plan and milestones (2026-11-17)

Read-only audit of `main` at `740fe46` (0.3.0). No source was changed. Baseline: `npm run check` clean; 56 monitor and 102 CLI tests pass.

Labels: **[R]** reproduced, **[C]** confirmed by reading the code, **[P]** plausible and still to be confirmed.

## How the audit ran

| Stage | What ran | Sweeps | Stop rule |
|---|---|---|---|
| 1 | Design, quality of life, function, usability of the web interface, plus a live walk-through (desktop, phone width, light and dark) | 10 per category (40) | 7 sweeps found nothing new |
| 2 | Security (5 sub-categories) and bugs/code quality | 7 security, 10 bug | A category was dropped after 3 sweeps with no new issue. Security ended at sweep 7, bugs at sweep 10. |
| 3 | Readability and visual, quality of life, features, optimisation | 3 per category (12) | Each category was dropped after 3 sweeps |

Checked and sound: the ownership gate comes first; no redirects are followed; the admin token fails closed and is compared in constant time; all SQL is parameterised; the UI server's Host, Origin, session-key and CSP checks held against 11 crafted requests; there is no `innerHTML`; HTML and CSV escaping, download names and model-prompt framing are correct; CI actions are pinned by SHA.

## Change list

### Security

| ID | Sev | Finding | Where | Fix |
|---|---|---|---|---|
| S1 | **High** | A scanned repo's `.git/config` diff driver runs commands during the scan **[R]**. In the container, `safe.directory '*'` removes git's protection against foreign-owned repos, so anyone who can write a repo under the mount runs code next to `PORCHLIGHT_ADMIN_TOKEN`. | `cli/src/repos/gitleaks.ts:11`, `Dockerfile:9` | Pass `--log-opts="--all --full-history --no-textconv --no-ext-diff"`. Narrow `safe.directory` to `/repos/*`. Consider scanning a `clone --bare --no-local` copy. |
| S2 | Med | gitleaks exits 0 with `[]` when git cannot read the repo (dubious ownership, broken worktree), so the repo shows as **clean** **[R]**. | `gitleaks.ts:26` | Treat non-empty stderr as a failure. Add a fake-runner test. |
| S3 | Med | A repo's own `.gitleaks.toml` (`useDefault=false`) or `osv-scanner.toml` turns detection off silently **[R for gitleaks]**. | `gitleaks.ts`, `osv.ts:16` | Pass a shipped `--config` that extends the defaults. Add a coverage note when a repo carries scanner config or ignore files. |
| S4 | Med | DoH `Status` (SERVFAIL/REFUSED, sent with HTTP 200) is read as "no records" **[R]**. This breaks invariant 5: hosts are dropped and findings "resolved". | `monitor/src/doh.ts:34` | Throw unless `Status` is 0 or 3. Add `Status: 2` to `fake-net.ts`. |
| S5 | Low | Terminal control characters in file names reach the terminal and exports. | `report.ts:113`, `main.ts:96` | Strip C0/C1 characters before printing and in `mdText`/`csvCell`. |
| S6 | Low | Markdown exports still autolink URLs and `@user` on GitHub. | `cli/src/roadmap/escape.ts:30` | Escape `@` and `:`, and break `www.`, or put data fields in code spans. |
| S7 | Low | `--out` report files are written 0644, while the UI saves 0600. | `main.ts:105,155` | Write them with `{ mode: 0o600 }`. |
| S8 | Info | The base image is not pinned by digest. CI imports BoxPilot's schema from its default branch. | `Dockerfile:4`, `ci.yml:19` | Pin the digest, and pin the schema to a BoxPilot tag. |

### Bugs

| ID | Sev | Finding | Where |
|---|---|---|---|
| B1 | **High** | A filtered roadmap plans the upgrade from the filtered subset, so it names a version that does not clear every advisory **[R]**. This breaks invariant 12. | `cli/src/roadmap/repos.ts:97` |
| B2 | **High** | A UI scan with no scanner installed overwrites the last good report (the CLI refuses this) **[R]**. | `cli/src/ui/server.ts:225` |
| B3 | High | A repo with a missing scanner shows a green "Clean" badge **[C]**. | `cli/ui/repos.js:275`, `scan.ts:72` |
| B4 | High | A monitor outage is shown as "No domains yet". The error banner is overwritten **[R]**. | `cli/ui/domains.js:96-126` |
| B5 | Med | When the scan root is itself a repo, it is named `basename(root)` on the server and `.` on the page, so filters and exports disagree **[R]**. | `roadmap/repos.ts:96` and 3 others |
| B6 | Med | Each cron tick runs an hour late, so the scan interval drifts to interval + 1h. | `monitor/src/store.ts:74` |
| B7 | Med | After a lapse, re-verifying still shows "Ownership check failed" until the next scan. | `monitor/src/api.ts:112` |
| B8 | Med | Dead certificate-log names take the `MAX_HOSTS` probe slots forever. The host list only grows. | `monitor/src/snapshot.ts:43-63` |
| B9 | Med | Header findings are "resolved" when a site returns a 5xx, then "new" again on the next scan. | `monitor/src/findings.ts:154` |
| B10 | Med | A failed monitor scan sends no alert and waits a full interval before retrying. | `monitor/src/scan.ts:55` |
| B11 | Low | One failed poll marks a running scan "failed" and stops tracking it. | `cli/ui/store.js:124` |
| B12 | Low | `severity=none` round-trips in the address, but the server rejects it, so an export of "what the filters show" fails. | `list.js:95`, `export.ts:37` |
| B13 | Low | The dangling-CNAME title names the wrong hop, because the chain is sorted. | `findings.ts:45` |
| B14 | Low | A 0.x minor upgrade is not flagged as breaking. | `roadmap/versions.ts:49` |
| B15 | Low | A monitor URL with a path drops its prefix. | `cli/src/monitor/client.ts:44` |
| B16 | Low | Malformed percent-encoding gives a 500, not a 404. | `monitor/src/api.ts:54` |
| B17 | Low | An expiring certificate that then expires is reported as "Resolved". | certificate finding IDs |
| B18 | Low | A cron scan and a manual scan of the same domain can send the same alert twice. | `runScan`, no claim step |
| B19 | Low | gitleaks dedupe merges two different secrets found on the same file and line. | `gitleaks.ts:41` |

### Interface (Stage 1, highest value)

- **Accessibility.**
  - Focus is lost on every in-place redraw (disclosures, pager, sorts, tabs).
  - The scan status live region is rewritten every 800 ms.
  - In light mode the Medium and High severity icons are 1.8:1 and 2.6:1 (WCAG asks for 3:1), and `--muted` text is 3.4:1 (AA asks for 4.5:1).
  - Field borders are about 1.5:1.
  - Roadmap tabs have no arrow keys or tabpanel.
  - The remove dialog has no accessible name.
- **Feedback.**
  - Error toasts vanish after 8 s, and the DNS verify result is never shown inline.
  - A wrong session key gives no message.
  - There is no loading state between pages.
  - Overlapping Explain clicks get a 409 banner.
  - Scans and model answers cannot be cancelled.
- **Filters.**
  - There is no "Clear filters" action.
  - Switching views drops the filters.
  - A Roadmap severity filter can be set from the address but has no control on the page.
  - A stale `?repo=` shows "All repositories" while still filtering.
  - The By-repository sort is not kept in the address.
  - "Show all" and roadmap groups render whole lists.
- **Hierarchy.**
  - The "N credentials look live" warning is buried at the bottom of a card. Make it a top banner that links to the actions.
  - Overview tiles are not links.
  - Roadmap and Findings do not link to each other.
- **Live walk-through.**
  - Stat tiles leave one orphaned on its own row.
  - On a phone, "Domains" scrolls out of the top nav with no cue.
  - The domain page's findings table is clipped at medium widths.
  - "Add domain" is stacked awkwardly in the header.
  - User-facing copy says "MAX_HOSTS is 12".
  - The add-domain error passes through raw API text (`Body must be {"domain": ...}`).
  - "Start it again with: porchlight ui" is wrong under BoxPilot.

## Plan and milestones

Each milestone ships as its own release with tests that would have caught its bugs.

### M1: Trustworthy results (security and broken invariants). Size: M

**Status: shipped in 0.4.0.** Built 2026-11-17:
- S1–S4 and B1–B5 are fixed, with tests that fail on the old code (DNS status, roadmap) or that run the real gitleaks against a hostile repository.
- Invariant 14 has been added to CLAUDE.md.
- Container smoke step 4 has been added, but no Docker daemon was available here, so it will first run in CI.
- osv-scanner: a repository's `osv-scanner.toml` is named in the report but not overridden.

S1, S2, S3, S4, B1, B2, B3, B4, B5.

New tests:
- a fake runner returning gitleaks stderr with exit 0;
- DoH `Status: 2`;
- a filtered roadmap in which the filtered-out advisory carries the highest fix;
- a scan root that is itself a repo;
- a hostile-repo fixture with a textconv driver and a `.gitleaks.toml`, built at run time.

Add a CLAUDE.md invariant, subject to the owner's approval: **"A scanned repository is hostile input: its config never runs code or changes detection."**

**Done when:** every [R] item has a failing-then-passing test, and the container smoke test scans a seeded hostile repo.

### M2: Monitor correctness. Size: M

**Status, 2026-11-20: built, not released.** Every item below has a test that fails on the old code. The monitor needs migration `0002_scan_health.sql` applied before the deploy (README, "Deploy").
- B6: "due" allows five minutes of slack (half a tick), so a scan recorded after its tick does not slip a tick each day.
- B7: verifying a lapsed domain clears "Ownership check failed" and makes it due on the next tick.
- B8: hosts beyond `MAX_HOSTS` take turns, never-probed names first; names the log lists but DNS shows gone are kept out of the inventory, at the back of the queue (`gone` in the snapshot).
- B9: a 5xx or 429 neither raises nor clears header findings.
- B10: a failed scan is retried after 1 h, then every 2 h; one alert at three failures in a row, one when scans recover. `errorStreak` is in the API, `domains list` and the Domains page.
- B13: the CNAME chain is followed from the host, so the title names the last hop. Chains are compared as sets, so older (sorted) snapshots do not report a change.
- B15: the CLI keeps a monitor URL's path prefix.
- B16: malformed percent-encoding answers 404.
- B17: an expiring certificate that expires is reported as newly expired, not also as resolved.
- B18: a scan claims the domain first (`scan_claimed_at`, 15-minute lease); a second scan answers "busy" (409 from the API).
- The cron runs `*/10`. crt.sh is asked with `deduplicate=Y`, and an answer over 16 MB is refused (the scan then notes the log could not be read).

B6, B7, B8, B9, B10 (retry after 1–2 h, and alert after N errors in a row), B13, B16, B17, B18, and B15 on the client side.

Also run the cron `*/10` (24 domains a day today). Add `deduplicate=Y` to the crt.sh query and cap its body size.

**Done when:** the schedule test steps exactly 24 h, header findings survive a 200 → 503 → 200 sequence without alerts, and an error streak is visible in `domains list`.

### M3: Output hygiene. Size: S

**Status, 2026-11-20: built, not released.** Each item has a test that fails on the old code (`cli/test/output.test.ts` and additions to the parser, version and roadmap tests).
- S5: `stripControls` in `escape.ts` replaces C0 (except tab and line breaks), a bare carriage return, DEL, C1 and the bidirectional overrides with U+FFFD. Every export format uses it. The CLI prints everything through `forTerminal`, and JSON output (`jsonText`) escapes those characters instead, so the data is unchanged. The scan's own Markdown report (`renderMarkdown`) now escapes names, paths and titles; it did not before.
- S6: Markdown text escapes the colon of `://` and `mailto:`, `www.` and `@`, and shows `@name` and `@org/team` as code, because GitHub mentions ignore a backslash.
- S7: `--out` reports and exports are written 0600 through `writePrivate`, an older file included.
- B12: `severity=none` exports an empty selection that says "no severity selected".
- B14: `mayBreak` reads versions like npm's and Cargo's caret: before 1.0, a minor (or before 0.1, a patch) change gets the changelog warning.
- B19: gitleaks matches are told apart by rule, line and entropy, which is never kept, so two secrets on one line stay two findings. A second one in the same commit gets the column in its detail.
- S8: the base image is pinned by digest and CI's BoxPilot checkout to the `v1.253.0` commit (its catalog schema is unchanged since).
- picomatch: nothing left to do; `npm audit` finds no advisory in any of the three packages.

S5, S6, S7, B12, B14, B19.

Pin the base image digest and the BoxPilot schema (S8). Fix the picomatch dev advisory.

### M4: Accessible and calmer interface. Size: M–L

**Status, 2026-11-20: built, not released.** Checked in the browser with a demo scan and a stand-in monitor at 375, 800 and 1280 px, light and dark.
- Focus: `replace()` in `dom.js` gives focus back to the control in the same place after a redraw (the same label, or the same position), with the caret kept. The pager and the domain actions use `aria-disabled`, so the button that was pressed keeps focus. Roadmap phases are a real tab list: arrow keys, Home and End, one Tab stop, and a tab panel.
- Live region: the scan status no longer announces itself every 800 ms. `announce()` says the scan started, where it is twice a minute, and that it finished or failed. A failed poll is retried five times before the scan is marked failed (B11).
- Contrast: new `--warning-mark`, `--serious-mark`, `--field-border` and `--on-accent` tokens, a darker `--muted` in light themes, and fixes to the Native, Terminal and High contrast looks. `cli/test/contrast.test.ts` checks text at 4.5:1 and marks, field edges and the focus ring at 3:1 for every look, light and dark.
- Scales: six type sizes (from 16), four corner radii, and spacing snapped to one scale; the same test keeps them there.
- Errors stay until dismissed; news leaves after 5 s. A refused key says why (pasted wrong, or Porchlight restarted). Pages dim while the next one loads. The offline message names how to start Porchlight again: terminal, Mac app or BoxPilot.
- Filters travel between All findings, By repository and the Roadmap. "Clear filters" appears when something is filtered. A repository named by the address but not in the scan is shown as a choice. The Roadmap has the severity filter. The By repository order is in the address. Each repository's findings and each roadmap group are paged.
- The live-credentials warning heads the Overview, linking to each finding and to the repairs. The Overview tiles open what they count. A finding links to its repair, and a repair to its findings (`Action.match`).
- Layout: tile rows never leave one tile alone (6, 3 by 2, 2 by 3); on a phone the sections get their own line with an edge cue; setup steps and the domain findings table fit their boxes. "Add a website" sits at the top right, says what was wrong with a name in plain words, and the DNS check's result stays on the page. The monitor's note no longer says "MAX_HOSTS".
- Code: the shared parts moved to `cli/ui/finding-parts.js`. The monitor's API types live in `monitor/src/types.ts`, and the CLI and the page import them. A test checks that every file in `cli/ui/` is served.
- Not done: no automated axe run (the contrast test and a scripted tab-order check stand in for it); the "Explain" 409 on overlapping clicks and cancelling a scan stay with M5.

- Focus restore on redraw.
- Throttle the live region.
- Light-mode contrast tokens, plus type, spacing and radius scales (14 font sizes down to about 5).
- Toasts that persist for errors.
- Wrong-key message and loading states.
- Clear and keep filters across views, show hidden filters, sort in the address, page long lists.
- Promote the credentials banner.
- Fix the walk-through layout issues.
- Move shared parts out of `findings.js`.
- Import the monitor types instead of re-declaring them.

**Done when:** a keyboard-only run through every page keeps focus, axe or a manual WCAG AA check passes in both themes, and nothing orphans or clips at 375, 800 or 1280 px.

### M5: Daily-use quality of life. Size: M

- Per-command `--help`, `--version`, and `porchlight doctor`.
- `[3/17]` progress lines with timings.
- CLI scans saved where the UI reads them.
- Rescan a single repo, and cancel a scan or a model answer.
- BoxPilot settings for depth and schedule.
- Cache the parsed report by mtime.
- `availableParallelism()`, and run the two scanners concurrently.
- CI npm and buildx caches and parallel jobs.
- Split the 250-line server closure into a gate plus a route table.
- Move releasing to `RELEASING.md` and open the README with a quick start.

### M6: Features that fit the invariants. Size: L

1. Repo scan history and "new since last scan" (a failed scanner never counts as resolved).
2. Mark a secret rotated or accepted, with a reason and an expiry. It **re-ranks only** and stays listed and exported (invariant 10).
3. Scheduled repo scans in the container, with owner-only notifications (counts, titles and paths; never values or authors).
4. Free monitor checks from data already fetched: HSTS details, cookie flags, DNSSEC (AD bit), SPF.
5. `/domains/:name/history` and a timeline, plus open-finding counts in the domain list.
6. Notification formats for Slack, Discord, ntfy and email.
7. SBOM and licences (CycloneDX export).
8. Offline OSV database cached in `/data`.
9. Incremental gitleaks scans (`last..HEAD`, with a full scan weekly).

### M7: Private data, not only secrets. Size: L

*Added 2026-11-19 at the owner's request.* Today a scan finds credentials (gitleaks) and vulnerable packages (osv-scanner) and nothing else. Personal data committed to a repository is a leak too, even when it isn't a key. M7 looks for it.

**What it looks for:**

| Kind | Examples | How it is told apart from noise |
| --- | --- | --- |
| Contact details | email addresses, phone numbers | `example.com`/`.test` domains, `555-01xx` numbers and the repository's own author address rank low |
| Government and financial IDs | US SSN, IBAN, payment card numbers | checksum (Luhn, IBAN mod 97) and known test card numbers rank low |
| Location | street addresses, GPS coordinates, EXIF location in committed photos | coordinates only with enough precision to point at a house |
| Network internals | private IPs, internal host names, VPN and tailnet addresses | documentation ranges (RFC 5737) rank low |
| Data dumps | `.sql`, `.sqlite`, `.db`, `.csv` or `.json` with many email-like values, `.har`, `.eml`/`.mbox`, notebook outputs | flagged by type and volume, not line by line |
| Personal documents | committed PDFs or images named like passports, IDs, tax forms, CVs, bank statements | file name and type only; contents are not read |

**How it runs:**
- A second gitleaks pass with Porchlight's own private-data rules (a fixed file shipped with Porchlight, like `GITLEAKS_CONFIG`), so history is covered the same way secrets are. It always runs with `--redact`.
- A small read-only pass over tracked files for what patterns can't catch: file types, dump volume, EXIF location. No symbolic links, no git configuration, no code from the repository (invariant 14).
- A new finding type, `private-data`, with its own filter, severity badge and roadmap action ("remove from history with git filter-repo, then add to .gitignore").

**What stays true:**
- Reports carry the kind, the file, the line and a count, never the value (invariant 3 extended to private data).
- Triage re-ranks and never drops (invariant 10): sample data in a test fixture still appears, one step lower, with the reason.
- A model judging a private-data finding sees no file content, the same as for a secret (invariant 16).

**Done when:** a seeded fixture with each kind (values built at run time, like `fakeAwsKeyId`) is found in both the working tree and a deleted commit, the report contains none of the values, and example data ranks below real-looking data.

### M8: Scan options: how deep a scan goes. Size: M

*Added 2026-11-19 at the owner's request.* Today the only option is "folder levels to look through". M8 adds presets in the scan form's Options and matching CLI flags:

| Preset | Secrets | Dependencies | Private data | History | Afterwards |
| --- | --- | --- | --- | --- | --- |
| Quick | current files | yes | no | none | — |
| Standard (today) | full history | yes | no | all branches | — |
| Deep | full history | yes | yes | all branches | Deeper analysis by the model starts on its own |

Under the presets, separate switches:
- which checks to run (secrets, dependencies, private data);
- history (none, the last N commits, or everything);
- folder levels (as today);
- repositories to skip;
- **uncommitted and git-ignored files** (off by default). These hold real `.env` files, which never left the machine. Findings there are labelled "on this computer only", so they don't read as leaks.

Any scan with less than the full set says so in the report and every export (invariant 12, "Not covered"), so a Quick scan never reads as a clean result. The chosen options are saved with the report and shown on the Overview.

**Done when:** each preset's report names exactly what it covered, a Quick scan of a repository with a secret only in history says history wasn't covered, and the options survive a reload (in the address, like the filters).

### Owner decisions needed

1. **DMARC, MTA-STS and TLS-RPT TXT lookups.** Are these fixed protocol labels allowed under invariant 2? They are not subdomain guesses, but they add DNS queries, and the ownership-gate request-list tests would change.
2. **Default local model.** The suggested `…uncensored-hauhaucs-aggressive` quant is from an unvetted publisher and is weaker against injected instructions. Switch to a mainstream instruct model?
3. **A separate exit code for "incomplete scan".** This is breaking for CI users.
4. **Rotated/accepted design (M6.2).** Confirm it re-ranks only.
5. **`docs/ACTIVE-TESTING.md`.** It still waits for your answers and conflicts with invariant 2.
6. **M7 kinds.** Which kinds of private data to look for: all six in the table, or a subset? Street addresses and names are the noisiest.
7. **M7 values.** No value at all in the report (proposed), or a masked hint such as `j•••@g•••.com`?
8. **M8 local files.** Should Deep include uncommitted and git-ignored files by default, or keep them a separate switch?
