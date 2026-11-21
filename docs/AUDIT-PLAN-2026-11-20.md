# Porchlight audit, plan and milestones (2026-11-20)

Read-only audit of `main` at `c1b6a5a`: 0.10.0 plus M6, M7 and M8, which are built but not released. No source file was changed. Baseline: `npm run check` is clean. The monitor's 84 tests pass; the CLI's 343 pass and 1 is skipped (it needs 127.0.0.2).

This is the second audit. The first, `docs/AUDIT-PLAN-2026-11-17.md`, led to M1–M8. None of its items has regressed. Its status lines are out of date: M2–M5 shipped in 0.9.0 and 0.10.0.

Labels: **[R]** reproduced (a script, a throwaway repository or the real scanners), **[C]** confirmed by reading the code, **[P]** plausible, still to confirm. Each finding gives the IDs from the sweep reports in brackets. Those reports hold the `file:line`, the scenario and a test for each item, and are kept outside git in `reports/audit-2026-11-20/`, because they include working reproductions.

> **Before committing this file:** it describes unfixed problems, four of them High, in a repository that appears to be public. Commit it with the M9 fixes, or keep it local until then, as the first audit was committed together with its fixes.

## How the audit ran

| Stage | What ran | Sweeps | Stop rule |
|---|---|---|---|
| 1 | Design, quality of life, function and usability over 10 surfaces (Overview and scan setup, Findings, Roadmap and exports, Domains, Investigate, Cloudflare, this computer, models, Settings, CLI/Mac app/container), plus a live walk-through of the demo (1280 px dark, 375 px light) | 10 per category (40), plus the walk-through | Every sweep found something new |
| 2, round 1 | Code, bugs and security per subsystem: UI server, repository scanning, monitor/build/CI/demo/Mac, investigate/Cloudflare/host, models, browser code | 6–7 per category per subsystem (about 120) | Code dropped after three empty sweeps in the UI server, models, monitor and repository subsystems. Bugs and security hit the cap of 7 without three empty sweeps. |
| 2, round 2 | Security by attacker (hostile repository, hostile network peer, hostile neighbour), data egress and disclosure, and bugs by cross-cutting lens (invariant 5, data shapes over time, text and time, the CLI as a contract) | 55 (13 attacker, 18 egress, 24 bug) | Dropped after three empty sweeps: network peer, neighbour, egress, disclosure, data shapes, the CLI contract. Still open: hostile repository (all six sweeps found something), invariant 5, and text and time. These continue in Stage 5. |
| 3 | Readability, usability, visual, quality of life, features and optimisation | 3 per category (18) | Each category dropped after its third sweep |
| 5 | Adversarial verification of every High and every [C]/[P] Medium; hostile repository, round three; bugs, round three (invariant 5, text and time, the monitor end to end, the Mac app and container); a clean-copy design spike; bugs, round four | 7 security, 42 bug, the verification and the spike | Dropped after three empty sweeps: text and time, the monitor's write paths, the Mac app and container. Hostile repository (20 sweeps) and invariant 5 (18 sweeps) never had three empty sweeps; both end with a structural fix in the plan instead of more sweeps. |
| 6 | Readability (README, CLAUDE.md and docs, tests), usability (WCAG 2.2, other people, error messages), visual (exports, small sizes, motion and state), quality of life (container operator, CLI-only owner, six months on), features (trust, monitor, models), optimisation (memory, disk, energy) | 3 per category (18) | Each category dropped after its third sweep; 17 of 18 found something new |

**Checked and sound:**
- The ownership gate comes first, and covers verify.
- No redirect is followed, apart from the webhook and crt.sh.
- The admin token fails closed and is compared over SHA-256.
- Every D1 query is parameterised.
- Host, Origin and session-key checks hold, the two listeners' keys are kept apart, and the body cap applies after the key.
- The pages have no `innerHTML`, inline style or `javascript:` link.
- The JSON framing of model prompts cannot be broken by a finding title.
- Hosted model addresses are fixed, and keys never reach the page, a log or error text.
- A follow-up goes only to the model it began with.
- The Cloudflare token stays in the header and is scrubbed from errors, and changes needing care must be named.
- An investigation's connection address is pinned, so DNS rebinding cannot move it.
- Project writes use `O_EXCL|O_NOFOLLOW`.
- Every file Porchlight writes is 0600 in a 0700 folder, except S12.
- No secret appears in process arguments.
- CI actions are pinned by SHA and scanner downloads are checksummed.
- On the page: filter and sort take 1.3 ms at 5,000 findings, `parseScanReport` 1.3 ms, and the CLI starts in 80 ms.

## Change list

### Security

| ID | Sev | Finding | Fix |
|---|---|---|---|
| S9 | **High** | **A scanned repository can run its own programs during a Standard scan.** gitleaks runs its own `git log -p`, which still obeys the repository's `.git/config`. It has two routes, each with all Porchlight tokens in its environment (S13); this breaks invariant 14. In the container, `/repos/*` is trusted, so any `.git` folder someone else wrote is enough. **[R]** (R2S-1, R2S-2, R2E-1) | Add `--submodule=short` to the log options. Run gitleaks and every git call with `GIT_NO_LAZY_FETCH=1`, `GIT_TERMINAL_PROMPT=0`, and `GIT_CONFIG_COUNT` entries that repeat `GIT_SAFE_ARGS`. Name a partial clone under "Not covered". Add both fixtures to the hostile-repository test. |
| | | — *(a) Submodule diff.* `diff.submodule=diff`, plus `diff.external` in the submodule's config, hands the change to a child `git diff` that does not inherit `--no-ext-diff`. The script ran twice. | |
| | | — *(b) Partial clone.* `extensions.partialClone` and a promisor remote make git lazily fetch missing blobs from a host the repository names, running its `core.sshCommand` or `credential.helper`. | |
| S10 | **High** | **The host check runs code from the folder Porchlight was started in.** `python3 -m pip list` runs with no working folder, and Python puts the current folder first on its import path. Running `porchlight ui` or `host check` from a clone with a top-level `pip/` runs that code. `findOnPath` accepts relative PATH entries. The scanners have the same weakness: with an empty PATH entry, the local-files run (`cwd: repo`) executed `<repo>/gitleaks`. **[R]** (HOST-S1, R2S-9) | Give every command a private temporary working folder and `PYTHONSAFEPATH=1`. Resolve each tool once to an absolute path using only absolute PATH entries. A fake-runner test asserts the working folder and the path. |
| S11 | **High** | **The evidence sent to a model can carry a live key.** `evidence.ts` keeps the whole line that names a package, up to 160 characters, so `require("stripe")("sk_live_…")` goes to the model (hosted ones too), onto the page and into `repo-analysis.json`. A minified bundle does the same. Breaks invariants 3, 13 and 16, and the consent text "Secret values are never sent". **[R]** (AI-S1) | Keep only the matched import text, and skip lines over about 300 characters. Do not rely on dropping lines gitleaks reported: evidence reads the working tree, where history line numbers do not apply. Test with a run-time-assembled key on the import line. |
| S12 | **High** | **The Mac app leaves the session key readable by other accounts on the computer.** `~/.porchlight` is created 0755 and `app.log` 0644, and the log holds `http://127.0.0.1:PORT/#k=KEY`. Every macOS account is in `staff`, and home folders are `drwxr-x---`, so any other account can read the key and drive the API: Cloudflare changes, the tailnet switch, GitHub and model keys. Confirmed on the owner's computer. Breaks invariant 7. **[R]** (J-F1, BLD-S1) | Create the folder 0700 and the log 0600, correct existing ones at launch, and mask `#k=…` before writing. |
| S13 | Med | Every child process (gitleaks, osv-scanner, git, npm, pip, brew) inherits `PORCHLIGHT_ADMIN_TOKEN`, model, GitHub and Cloudflare keys, the UI key and the notice URL. This makes S9 and S10 take every token. **[R]** (R2E-7) | Give each child a minimal environment, and delete secrets from `process.env` once read. |
| S14 | Med | `git replace` refs, or a commit-graph file edited so a commit has no parent, hide a committed key from the history scan while `main` still pushes it. **[R]** (REP-S1, R2S-4) | `GIT_NO_REPLACE_OBJECTS=1` and `core.commitGraph=false` for gitleaks and git. |
| S15 | Med | A shallow repository (a `.git/shallow` file, or a `--depth 1` clone) is reported as fully read. **[R]** (REP-S2) | `rev-parse --is-shallow-repository`, then "Not covered". |
| S16 | Med | `gitleaks:allow` comments hide findings, and `settingNotes` does not name them. **[R]** (REP-S3) | `--ignore-gitleaks-allow`. |
| S17 | Med | An `osv-scanner.toml` under `build/`, `dist/`, `target/`, `vendor/` or `venv` is applied but never named, and the 5,000-folder search cap stops silently. **[R]** (REP-S4) | Record osv-scanner's own "Loaded filter from" lines. |
| S18 | Med | A committed lockfile that `.gitignore` covers is skipped. osv-scanner exits 128, which reads as clean. **[R]** (REP-S5) | Compare the lockfiles git tracks with those osv-scanner read, and add a "Not covered" line for the rest. |
| S19 | Med | osv-scanner does more than the page says. It resolves `requirements.txt` and `pom.xml` at api.deps.dev (also from the host check, and in offline-database mode). It posts hashes of vendored files. Its Go call analysis runs `go env` and `go list` inside every Go repository, under the SBOM's "contacts nothing" flags too; with Go installed, that can download whatever modules a hostile `go.mod` names. The scan page never says package names leave the computer. **[R]** (REP-S6, R2E-2, R2E-3, R2S-5, US-3) | Pass `--no-resolve --no-call-analysis=all --x-disable-plugins=filesystem/vendored` on every lookup, the SBOM's included. Have the preview name the destination. Give the host check the offline database too. |
| S20 | Med | A tailnet device can switch the model to a hosted provider under the owner's key, delete `model-settings.json` with every key, and make the computer request its own loopback services through `/api/model/test`. **[R]** (SRV-S1, AI-S4) | Every POST under `/api/model` only from the loopback page. |
| S21 | Med | A start-up admin token with a newline makes fetch throw an error that quotes `Bearer <token>`, and the server returns it to the page. **[R]** (SRV-S2) | Validate the token as Settings does (`^[\x21-\x7e]{32,512}$`), and build the 502 text from the error code only. |
| S22 | Med | A tab that loaded "Ollama on this computer" still sends findings and import lines after another tab or device switches to a hosted model. Analysis, Explain and the mural carry no record of which model the page showed. **[R]** (SRV-S3) | Each request names the model the page showed. The server answers 409 on a mismatch, and a hosted model needs `sendsToHosted`. |
| S23 | Med | A `compatible` server is always treated as the owner's own (Settings suggests OpenRouter). The page then says "Stays with your own model", and a Deep scan sends findings and code lines without the hosted notice. **[C]** (AI-S2) | Hosted unless the host is loopback, private, CGNAT, `.local`, `.ts.net` or a single label, or the owner says it is theirs (owner decision 6). |
| S24 | Med | Two investigation starts during the ownership lookup both get 202, and Stop reaches only the second. With "approve all", the first kept sending requests after Stop. **[R]** (SRV-S4) | Record the run before the first await (see M10). |
| S25 | Med | Overlapping on/off requests for "Access from other devices" can leave `access.json` saying on while nothing listens, so the next start reopens the tailnet listener. **[R]** (SRV-S5) | Handle access changes one at a time, writing the file before changing memory. |
| S26 | Med | The ownership token reaches the model when the challenge record is a CNAME: a `dns_lookup TXT` of the target returns `porchlight-verify=<token>`. **[R]** (INV-S1) | Replace the token in every tool output before it goes into a prompt. |
| S27 | Low | `Set-Cookie: SECRET`, `=SECRET` and `sid = SECRET` pass to the model unredacted. Lowered on verification: these are cookies an anonymous `GET` to the owner's own site receives. **[R]** (INV-S2) | Replace everything after `Set-Cookie:`, keeping the name only when it is a valid token. |
| S28 | Low–Med | A "Fix these" request previewed before a newer audit, or before a change made in Cloudflare's own dashboard, can still be approved within 10 minutes. The fixed template (`include_subdomains:false, preload:false`, or TLS 1.2) can lower a stronger setting set since. A single approval is also not blocked during a batch. **[C]** (CF-S1, CF-S2) | Read the setting's current value just before sending, and send only if it is still the failing value. Clear waiting requests when an audit is saved. |
| S29 | Low | In a running investigation, "Approve all the rest" sits above the run's limits, which are in a closed disclosure. The start form does list them open, so invariant 20 is met; only `turnsLeft` is new at that point. Lowered on verification. **[C]** (UI-S1) | Show the limits open, above the buttons. |
| S30 | Med | A project folder can be added before its check is shown. Return or a quick Add posts at once, and the "inside a git repository" warning is never seen. Invariant 23. **[C]** (UI-S2) | Add only when the shown check matches the typed folder. |
| S31 | Med | The host check contacts the network unasked: `npm ls -g` runs npm's update notifier (two `GET /npm` against a fake registry), and `brew outdated` may download the formula list [P]. Invariant 19. **[R]** (HOST-S2, HOST-S6) | `NPM_CONFIG_UPDATE_NOTIFIER=false`, and skip brew when its cache is absent. |
| S32 | Med | "Commands to fix these" holds commands that need a decision or fail. `git config --global credential.helper osxkeychain` replaces a `store` helper and breaks unattended jobs. `brew update && brew upgrade` and `npm -g …@latest` cross major versions, pip upgrades fail under PEP 668, and option-like pip specs pass the pattern (`"--index-url" "evil.example"`) [R]. A `!` in an epoch version triggers history expansion. **[C/R]** (HOST-S3–S5, G-F2, UI-S4) | Keep these in each check's fix text, out of the combined block. Use the strict spec pattern, and leave `!` out. |
| S33 | Med | A stopped scan leaves plain copies of a repository's tracked files (2,190 files, a `config.env` included) in `porchlight-files-*`. There is no SIGTERM handler, and in the container node runs as PID 1 with no init, so `docker stop` kills it with SIGKILL. **[R]** (R2E-8) | Handle SIGTERM/SIGINT with a cleanup deadline, remove stale folders at start-up, and run the image under `tini`. |
| S34 | Med | `porchlight ui --report <file>`, as the README suggests, moves every key, token, `access.json`, GitHub clones and the OSV database next to that file, possibly inside a git checkout. **[C]** (R2B-4) | Keep settings and secrets in the data folder always; `--report` names only the report and its history. |
| S35 | Med | Local paths and personal details leave the computer. The absolute scan folder is printed in every export (`/Users/<name>/…`) and sent in Ask, Summarise, Send and the mural prompt. osv-scanner's stderr (with a path) goes into the SBOM [R] and prompts. The failed-scan notice carries the folder and a raw error. The Cloudflare account name ("<email>'s Account") is unmasked in the page and exports. **[C/R]** (C-D1, C-F4, C-F5, REP-S7, R2E-5, R2E-6) | Send the folder's name only; replace paths in error lines with repository names; mask an email in the account name. |
| S48 | Med | Ordinary repository settings blank the history gitleaks reads, with nothing on stderr. `color.ui=always`, `core.bigFileThreshold=1`, `* -diff` or `binary` in `.gitattributes` (teams mark lockfiles and bundles `-diff`), and `log.showRoot=false` each left a committed key unreported. `format.pretty`, `log.date` and `log.abbrevCommit` turn findings into "working tree on 0001-01-01" or change their identity. **[R]** (R2S-3) | Add `--root --color=never --text` to the log options, and pin `format.pretty`, `log.date` and `log.abbrevCommit` through `GIT_CONFIG_COUNT`. |
| S49 | Med | The SBOM can carry a credential: osv-scanner's last stderr line can quote a lockfile's `git+https://<token>@github.com/…` and becomes the `porchlight:not-covered` value word for word. A `go.mod` `replace` to `/Users/<name>/…` becomes a component name. **[R]** (R2S-6) | Write fixed words and the exit code, never stderr; drop components named by an absolute path. |
| S50 | Med | Fetched GitHub repositories named `.dotfiles`, `.github`, `Library` or `vendor` are listed as fetched but never scanned, and nothing says so. Dotfiles are where keys live. **[R]** (R2S-7) | Scan exactly the fetched list, and add a "Not covered" line for any fetched repository missing from the report. |
| S51 | Med | A large data file blocks the server, then drops the repository's whole secrets result. Grouping private-data matches is quadratic: 160,000 matches blocked the event loop for 18 s, then threw `RangeError`, so gitleaks counted as failed. A 50 MB photo limit is checked only after reading up to 256 MB. **[R]** (R2S-8) | Push into the existing array, and check a blob's size with `cat-file -s` first. |
| S36 | Low | The public demo carries the recording computer's chip and memory ("Apple M5 Pro", 48 GB, in `/api/model/local`). The recorder's name check is case-sensitive and skips the host name, and the DMG search is manual. **[R]** (W1, BLD-S3) | Substitute a made-up machine; compare in lower case, adding the host name and full name. Script the DMG search. Record again and redeploy. |
| S37 | Low | A model's words reach the Activity view (an invalid tool name). Its repair steps become live links to Settings, GitHub and System Settings. A Hub id becomes an address. Invariant 13. **[C]** (INV-B2, SRV-S6, AI-S5, UI-S3, UI-S6) | Fixed words in Activity, model steps as plain text, the server builds the Hub link. |
| S38 | Low | Plain-text exports, Copy and "Save as text" skip `stripControls`. U+2028 and U+2029 are kept in notices and `oneLine`. Bidirectional overrides from scanned names reach the page, the Activity view and the project log, so a quoted `git filter-repo --path` step can display reordered. **[C]** (AI-S7, SRV-C4, R2S-11) | Use `stripControls` everywhere text leaves, and one text helper on the page. |
| S39 | Low | `declaredAs` reads through a symbolic link in a folder name (outside `package.json`). **[R]** (AI-S3) | Check `realpath(folder)` is inside the repository. |
| S40 | Low | The notice address check accepts `http://10.example.com`, so plain-http notices go across the internet. **[R]** (REP-S9) | Test for an IPv4 literal first. |
| S41 | Low | CSV cells containing `;` or a tab are not quoted (`x;=HYPERLINK(…)` in a semicolon locale). **[P]** (REP-S10) | Quote them. |
| S42 | Low | A control character in a file name forges a commit name in the added-files parser. **[R]** (REP-S8) | Parse `-z` output token by token. |
| S43 | Low | The investigation address check misses `64:ff9b:1::/48`, `fec0::/10` and `::a.b.c.d`, and blocks all of NAT64 on DNS64 networks. An HTTP request has only an idle timeout. **[R]** (INV-S3, INV-B3) | Judge the embedded IPv4, and add a total-time limit. |
| S44 | Low | CI can skip the BoxPilot schema check and still pass. The manifest check does not require `secret: true` on three credentials. Checkouts keep their credentials. **[C]** (BLD-S2, BLD-C1) | `BOXPILOT_REQUIRED=1`, the three checks, and `persist-credentials: false`. |
| S45 | Low | The tailnet listener binds the first 100.64.0.0/10 address on any interface, which a hotspot can own. **[C]** (SRV-S7) | Prefer the Tailscale interface. |
| S46 | Low | Invariant 8 has no automated guard: `h()` would accept `innerHTML` or `srcdoc`, and no test looks for them. **[C]** (UI-S5) | Refuse those keys; add a static sweep test. |
| S52 | Low | A notice to any webhook that is not Slack, Discord or ntfy sends `{"text": …}` unescaped. Mattermost, Rocket.Chat and Google Chat render it, so a file named `@channel ![](https://x.example/p).env` pings everyone and loads a remote image. **[C]** (R2S-10) | Escape `text` as Markdown with mentions broken, or require an explicit format. |
| S47 | Info | A `compatible` key may go over plain http to another host. `HOSTED[provider]` accepts `__proto__`. `isInspectable` is on in the released app. The investigation probes third-party hosts an in-scope CNAME points at. `monitor/cloudflare.config.ts` ships the owner's D1 database ID. (AI-S8, INV-S4, US-5) | — |

### Bugs

| ID | Sev | Finding |
|---|---|---|
| B20 | **Med–High** | **A secret seen in several commits gets a new identity on every scan.** gitleaks reports matches in a different order each run, and `findingsOf` keeps the first, so the commit in `detail` changes. Twelve identical scans gave "1 new, 1 fixed" at all 11 comparisons; verification saw four different commits in 12 runs. Rotated/Accepted statuses, New marks, notices, discussions and judgements detach. It affects a secret matched in two or more commits at the same file and line (the key line edited, or a rebased copy reached through `--all`); a key added once stays stable. Breaks invariant 17. **[R]** (R2B-1) Fix: sort by date, commit, line, column before removing duplicates. This changes the kept commit, and so `findingKey`, once per affected secret. Ship it with a migration of notes by repository, rule and location, and update `parsers.test.ts:85-106`. |
| B21 | **High** | **Saves corrupt or vanish under concurrency.** Nine private-file writers use a fixed `${path}.${pid}.tmp`, and the callers read, modify and write with nothing in between. Two notes saved at once failed or were lost in 10 of 10 runs, once leaving `finding-notes.json` unparseable; three at once lost two in 20 of 20 on verification. Two rescans left `repo-scan.json` invalid in 2 of 3 runs, after which every page answers 500. Random temporary names alone do not fix the loss: writes must be serialised per file. **[R]** (SRV-B2, REP-B10, AI-C1) |
| B22 | **High** | **The roadmap's upgrade command cannot reach a major or 0.x target.** "Upgrade next from 15.2.6 to 16.0.1: Run `npm update next`" stays inside the declared range, then wrongly blames a transitive dependency. The same applies to pnpm, cargo, bundle, composer and poetry. Breaks invariant 12. **[C]** (C-F1) |
| B23 | **High** | **The suggested upgrade can land inside a range that is still vulnerable.** With advisory A at [0, 1.2.5) and [1.5.0, 1.5.2), and B fixed in 1.5.0, the roadmap says "upgrade to 1.5.0". Breaks invariant 12. **[R]** (REP-B4) |
| B24 | Med | Background jobs check "running?" and only mark themselves after an await. Two scans run and Stop aborts one while the other saves (invariant 17). Two analyses double the model calls and overwrite each other. The same gap exists in rescans, murals, the Cloudflare audit and GitHub fetches. **[R]** (SRV-B1, AI-B4) |
| B25 | Med | A failed read is treated as empty and then written back. An unreadable history index prunes every kept scan; a truncated notes file keeps only the next note; the project list and investigation tokens behave alike. Corrupt model or monitor settings show as "not set", and the next save drops saved keys; doctor says "ok". Invariant 5. **[R]** (SRV-B3, I-F2, AI-C4) |
| B26 | Med | The released 0.10.0 and a newer checkout share `~/.porchlight`. Saving a note in the older one deletes every Rotated note and `until` date, and it reads a Quick report as complete (exit 0, history-only secrets "fixed"). Reports carry no format version. **[R]** (R2B-3) |
| B27 | Med | Scans of different folders are compared as one: `Projects/api` and `Work/api` are both "api", giving "1 new, 2 fixed" and shared notes. **[R]** (R2B-2) |
| B28 | Med | "Committed" means git's index, not HEAD. A staged, never-committed key is dropped (Standard with local files) or called committed (Quick). **[R]** (REP-B1) |
| B29 | Med | Deep under-counts private data in a file grown over many commits: 25 addresses read as one low "email address"; Quick says a high data dump. **[R]** (REP-B2) |
| B30 | Med | Keys committed in nested repositories or submodules are labelled "on this computer only", with "no rotation needed", or not scanned at all with no note. **[R]** (REP-B3) |
| B31 | Med | A key typed into a tracked file gets "check that .gitignore covers it", which cannot stop `git commit -a`. Invariant 12. **[R]** (REP-B5) |
| B32 | Med | The phone rule misses `+14155552671`, `+44 7700 900123`, `+33 1 23 45 67 89` and `+49 30 12345678`. **[R]** (REP-B11) |
| B33 | Med | A SERVFAIL for a name already found gone makes it a "new host", alerted, then "gone" next scan. Invariant 5. **[R]** (MON-S1) |
| B34 | Med | A finding that worsens under the same id is never alerted: HSTS `max-age=3600` → `0`, or SPF `?all` → `+all`. **[R]** (MON-B1) |
| B35 | Med | The Cloudflare audit passes what it did not see. CNAMEs into an unread zone and names it never looked up pass ("All 0 names … still exist"). Lists stop at 40 pages silently. HTTP 429 is not handled (about 65 zones). An unreadable custom-certificate list counts as none. Invariants 5 and 21. **[R]** (CF-B1–B4, R2B-7) |
| B36 | Med | Deeper analysis never stops early when the model is unreachable: 10 of 10 calls with a revoked key, up to 500. **[R]** (AI-B3) |
| B37 | Med | Prompt budgets: `pack()` ignores its `cap`, so a hosted roadmap gets 24 of 1,200 actions. Data outside the findings is not counted, so 120 repositories make a 29,350-character block for an 8,192-token local model. **[R]** (AI-B1, AI-B2) |
| B38 | Med | "Scan again" keeps `scannedAt`, so a mural with the old counts is still "current". Follow-ups rebuild from data the earlier answers never saw. Invariants 16 and 22. **[C]** (AI-B5, SRV-B4) |
| B39 | Med | Evidence finds no imports in Rust, Java, C# or packages imported under another name (PyYAML), so the model answers "unlikely" and Log4Shell sorts last. **[R]** (AI-B6) |
| B40 | Med | Check does nothing visible while the model analyses or GitHub fetches, because the page treats every 409 as "another tab's scan". **[C]** (A-F1) |
| B41 | Med | The Overview redraws on unrelated changes (the 800 ms host or Cloudflare polls) and resets the typed folder, so Check scans a different folder from the one previewed. **[C]** (A-F2, UI-B2) |
| B42 | Med | "Check again" forgets the last scan's choices and depth: after a Deep scan at depth 4, the next is Standard at depth 3, and private data becomes "could not be checked again". An empty depth box previews 3 but scans 0. **[C]** (A-Q1, UI-B11) |
| B43 | Med | A slow page draws over the page the owner moved to, and Domains can pull the address back to itself. **[C]** (UI-B1) |
| B44 | Med | Unsaved note drafts are wiped by redraws, every 800 ms during any scan on By repository. **[C]** (B-F3, UI-B3) |
| B45 | Med | "Skip to content" (`#view`) routes to the Overview and drops the page's filters. **[R]** (UI-B4) |
| B46 | Med | A repository with no findings shows a green "Clean" after a Quick or reduced scan, or with unread files. An incomplete scan must never read as clean. **[C]** (B-F2, UI-B5) |
| B47 | Med | A failed or clean repository has no "Scan again", since only rows with findings expand. **[C]** (B-F1) |
| B48 | Med | The page's monitor setup runs `npm install` at the root, which never installs `monitor/`. Alerts silently go only to the Worker log when `ALERT_WEBHOOK_URL` is unset, and nothing says so. **[C]** (D-F1, D-F2) |
| B49 | Med | Investigate offline adds a persistent `role=alert` toast every second. A run that uses up its turns reads as "Finished", and a model that never answers in JSON burns all 25 turns. **[C]** (E-F1, UI-B8, E-F5) |
| B50 | Low–Med | An export filtered to nothing (a mistyped `--repo`) says "the scan found no problems" and exits 0. **[R]** (R2B-5) |

**Lower-severity bugs, by area** (details in the sweep reports):
- **Repository scanning:**
  - A new Quick-found key is never "new" (REP-B6).
  - "Last N commits" checks names outside its window (REP-B7).
  - A moved line splits one secret into two (REP-B8).
  - Case-only path clashes fail Quick on macOS (REP-B9).
  - Private-data rules match `threading.local()` and coordinates in code (REP-B12).
  - Renamed default branches break GitHub updates (REP-B13).
  - Unread files let findings count as fixed (REP-B14).
  - Untracked files are not checked by name or EXIF (REP-B15).
  - "No repositories found" when all were skipped (R2B-9).
  - Fetched copies are scanned as current (R2B-10).
  - `.gitleaksignore` advice that cannot work (C-F3).
  - "See these N findings" opens more than N (C-F6).
  - "By file" sorts line 10 before 9 (B-F5).
- **Monitor:**
  - HSTS without max-age counts as present (MON-B2).
  - `no-caa` on subdomains (MON-B3).
  - CSRF cookies flagged as sign-in cookies (MON-B4).
  - An SPF record with no `all` is not flagged (MON-B5).
  - Cookie findings flap (MON-B6).
  - Claims do not re-check due (MON-B7).
  - Snapshot rows grow toward D1's 2 MB limit near 11–13k names (MON-B8, OP-12).
  - A manual scan can be cut off before its alert (MON-B9).
  - Notes omit failed apex lookups (MON-C1).
  - Webhook and cron errors reach no one (MON-C2).
  - A failed bare-domain certificate query raises a false "expiring" (R2B-6).
  - Failed scans have no reason (D-F3).
  - A monitor path is dropped silently (D-F4).
  - The alert title is "1 new findings" (D-D2).
- **Cloudflare:**
  - Partial-setup zones are judged as full (CF-B5).
  - DMARC by CNAME and wildcard targets are misread (CF-B6).
  - One malformed answer crashes the audit (CF-B7).
  - One failed poll ends the audit on the page (F-F1).
  - "Fix these" is capped at 300 silently (F-F5).
  - Settings and `CLOUDFLARE-AUDIT.md` are out of date (F-F6).
  - "Tick all" ticks every change marked with care (F-U4).
- **This computer:**
  - One truncated SSH key hides every credential result (HOST-B1).
  - Any listener from a system folder passes (HOST-B2).
  - Unparsed netstat output reads as a pass (HOST-B3).
  - Linux owners are told macOS commands (G-F1).
  - The package area can vanish silently (G-F4).
  - doctor assumes a Mac and `~/.porchlight` (J-F2).
- **Investigation:**
  - A Stop during the ownership re-check reads as lost ownership (INV-B1).
  - "Record found" never clears (E-F3).
  - Remove silently invalidates the published record (E-F4).
  - The turns field and the server disagree (E-F6).
- **Models:**
  - Token budgets in characters overflow (AI-B7).
  - Murals cannot be stopped (AI-B8).
  - "Use this model" drops https and the port (AI-B9).
  - Stale domain discussions offer follow-ups (AI-B10).
  - Truncated answers are not marked (H-F1).
  - "Save and use" saves a model that cannot answer (H-F3).
  - "Fits this computer" for a remote Ollama (H-F5).
- **Server:**
  - A rescan drops what was not covered (SRV-B5).
  - The newest long answer is left out of a local follow-up (SRV-B6).
  - `--host ::1` cannot be opened (SRV-B7).
  - A failed rescan postpones the schedule (SRV-B8).
- **Page:**
  - Export's Cancel does not cancel, and a mural is billed and saved minutes later (UI-B9, B-F4, C-F2).
  - Host and Cloudflare polls give up after one failure (UI-B10, F-F1).
  - Stale Settings, Cloudflare and Activity state (UI-B12).
  - Full redraws close open details (F-F2, G-F3).
- **CLI, build and tests:**
  - Piping into `head` prints an EPIPE stack (R2B-8).
  - `/repos` itself is not a safe directory (BLD-B1).
  - arm64 images are not smoke-tested (BLD-B2).
  - The demo answers 500 to a bad escape (BLD-B3).
  - The Mac app keeps all server output in memory (BLD-B4).
  - Stale DMG notes and manifest text (J-F3, J-F4).
  - "Roadmap first" does not open the Roadmap (I-F1).
  - The test suite has left 9,547 `porchlight-test-*` folders in the temporary folder.

### Interface (Stage 1, highest value)

- **Accessibility.** These regress M4's goals in surfaces M4 did not touch.
  - Buttons use `disabled` in about 20 places, so keyboard focus drops to the page body (I-U1, UI-B6).
  - Live regions still re-announce every 0.8–1.5 s in Send, analysis, Explain answers (up to 1,500 words), the host check, Cloudflare, GitHub, Investigate and Activity (H-U1, G-U1, E-U1, I-U2, UI-B7).
  - The answers panel, approval card and "Fix these" never take focus (H-U2, E-U2, F-U3).
  - **In windows under about 760 px tall, the foot of the sidebar (scan status, the Dashboard look's counts) cannot be reached [R]** (I-D1).
  - Under 900 px the scan status is hidden everywhere but the Overview (A-U4, I-U3).
- **Hierarchy.**
  - Once a scan exists, the Overview still opens with the scan form; results start below the fold (A-D1, W3).
  - Settings is 4,988 px with no index (I-D2).
  - Cloudflare draws every zone fully expanded with no filter or paging (F-D1).
  - A domain report lists new findings twice and is not paged (D-D1).
  - The host page puts "Commands to fix these" last (G-D1).
  - On a 375 px phone, Findings shows two screens of filters and tiles before the first finding (W8).
- **Feedback.**
  - A request waiting for approval is invisible from other pages, so runs stall (E-Q1).
  - "Connected" means configured, not working (US-8).
  - "Not covered" prints one line per repository per tool with no next step (US-9).
  - "Scan finished" says nothing else (A-Q4).
- **Consistency.**
  - One action has three verbs: Check, Scan, Audit (RD-8).
  - Findings are also called problems and items, and fixed is also resolved (RD-9).
  - The page says both domain and website (RD-10).
  - The off-machine notice is worded four ways (RD-11).
  - Cloudflare permissions are spelled four ways (F-U1).
  - The navigation says "This Mac" on macOS against the owner's copy rule (W2; owner decision 1).

## Stage 3

### Readability (three sweeps: code, page copy, terminal and exports)

- **RD-1:** `startUiServer` is one 2,181-line function with about 45 shared variables. Split it along its existing blocks into `ui/routes/<area>.ts`.
- **RD-2:** routes are dispatched twice.
- **RD-3:** "the page on this computer" is tested five ways.
- **RD-4:** `check()` in `rules.ts` takes 8 positional arguments.
- **RD-5:** pure view functions are trapped inside 650-line page closures.
- **RD-6:** `styles.css` (3,868 lines) is in the order it was written.
- **RD-14:** `host check --help` says "It only reads", but by default it asks Apple and OSV.dev.
- **RD-15:** `repos scan` prints Markdown escapes in the terminal (`axios\@1.6.0`).
- **RD-16:** the roadmap export repeats the same three rotation steps 34 times.
- **RD-17:** small terminal fixes: "1 problems", and the exit-code rule buried under `--fail-on`.

### Usability and quality of life (three sweeps each, by journey)

- **US-1:** the quick start downloads 455 MB a scan does not need (the monitor's packages). Lead with `node cli/bin/porchlight.js ui`.
- **US-2:** the Mac app previews the whole home folder when `~/Projects` is missing, and never checks git before the first scan.
- **US-4:** "fix, scan again, see it fixed" takes 5 steps and never says "fixed".
- **US-5:** monitor setup is 6 steps and 8 commands, including an edit to a tracked file that holds the owner's D1 ID.
- **US-6, US-7:** Domains, Cloudflare and Investigate do not link to each other's fixes.
- **US-10:** nothing says what to copy to a new computer, and scanning from another folder orphans every note.
- **QL-1:** the morning check takes four pages and three manual runs. An "at a glance" strip on the Overview would cover it.
- **QL-2:** the Mac app never checks by itself.
- **QL-3:** there is no review queue for ended acceptances.
- **QL-4:** team exports carry none of the owner's decisions.
- **QL-5:** nothing shows that a schedule ran or what it scanned.
- **QL-6:** there are no keyboard shortcuts.
- **QL-7:** Porchlight is hard to use in CI: no baseline, no SARIF, and chosen gaps fail `--fail-on`.
- **QL-8:** past 144 domains the monitor falls behind silently.
- **From Stage 1:**
  - A "New since the last scan" filter (B-Q1).
  - Bulk status (B-Q2).
  - Copy buttons on repair commands (B-Q3, C-Q2).
  - Reuse the mural instead of rewriting it per export (C-Q1).
  - `repos export` without a path (C-Q4).
  - Run again, with the last domain and goal (E-Q2).
  - "Fix these" that keeps its scroll and groups by domain (F-Q1).
  - Mark checks changed since the audit (F-Q2).
  - Compare with the last audit (F-Q3).
  - Host-check history (G-Q1).
  - Earlier answers offered where they were asked (H-Q1).
  - "Ask again about the latest scan" (H-Q3).
  - `porchlight` on PATH (J-Q1).
  - The CLI reads the monitor saved in Settings (J-Q2, D-Q1).

### Visual (three sweeps: brand fit, hierarchy, charts)

- **VS-1:** the interface reads as a generic blue-grey dashboard, and the brand's door red (#d8412a) and ochre (#ac742a) clash with Critical (#d03b3b) and the Medium mark (1.18:1). Rule: warm colours only in the mark and wordmark.
- **VS-2–VS-5:**
  - Take the accent from the brand's steel blue (#3f6080, 6.23:1).
  - Build dark mode on the brand's blacks (all pairs still pass).
  - Set condensed capitals for the wordmark and page titles, from installed fonts, since the CSP blocks web fonts.
  - Add a "Poster moderne" look.
- **VS-6–VS-10:** two card widths, two primary buttons on one screen, inconsistent tiles and icons, look previews that do not match their looks, host names breaking mid-word.
- **VS-11:** the HTML export's Medium and High marks are 1.79:1 and 2.57:1, below the app's 3:1, and no test covers them.
- **VS-12–VS-15:**
  - A findings trend across kept scans, with narrower or other-folder scans hollow and not joined (history must record the preset first).
  - Domain sparklines.
  - One severity bar in place of four displays.
  - Phase and area charts.
  - Build them with an `svg()` helper, colour by class, carry each number in text, and keep the tables.

### Features (three sweeps: coverage gaps, workflow, platform)

- **FT-1: GitHub repository settings audit** with the token the owner already gives:
  - What it reads: branch protection and rulesets, secret scanning and push protection, open alerts (with `hide_secret=true`), Dependabot, the Actions token's default permission, write deploy keys, and insecure webhooks.
  - Cost: High value, M effort.
- **FT-2: risks in Actions workflows**, read from the index with no YAML dependency:
  - What it flags: `pull_request_target` checking out the PR's code, `${{ github.event.*.title }}` inside `run:`, unpinned actions, and `write-all`.
  - Cost: High value, M effort.
- **FT-3: certificate issuer checked against CAA.** It needs no new request, since crt.sh rows already carry the issuer. Medium-high value, S–M effort.
- **FT-4: domain expiry and transfer lock**, through Cloudflare Registrar or weekly RDAP after the ownership gate. High value, M effort.
- **FT-5: DKIM key strength**, from records the audit already reads.
- **FT-6: licence risk** in the SBOM.
- **FT-7: typosquats and dependency confusion.**
- **FT-8: host-check additions:** SSH agent forwarding, LaunchAgents in writable folders, and browser extensions with all-sites access.
- **FT-9: SARIF output and `--baseline`.**
- **FT-10: `porchlight hook`**, a pre-commit check with Porchlight's own rules.
- **FT-11: "Check it now"** to confirm a fix.
- **FT-12: a GitHub issue from a roadmap action**, the token's first write (owner decision).
- **FT-13: a weekly digest.**
- **FT-14: due dates by severity.**
- **FT-15: Mac menu-bar status**, notifications and launch at login.
- **FT-16: `porchlight status --json`.**
- **FT-17: moving settings between computers**, with keys only in a passphrase-encrypted file.
- **FT-18: `porchlight schedule print`**, which prints a launchd or systemd unit for the owner to install.

### Optimisation (three sweeps: scanning, server and page, monitor and CI)

- **OP-1: reuse unchanged history.** This is the safe subset of M6.9.
  - The key is the versions, config hashes, choices and ref tips, so a rewrite or a new rule forces a full scan.
  - Gain: about 99% of history time for unchanged repositories.
- **OP-2: keywords for four private-data rules.** Measured: gitleaks CPU 63.2 → 50.2 s, with identical matches.
- **OP-3: one `cat-file --batch` for photos.** Measured: 3.04 s → 0.04 s for 400 blobs.
- **OP-4: refresh the offline OSV database once**, not from 8 parallel scanners.
- **OP-5: the report response is 2.9 MB for a 1.3 MB report**, because each finding repeats its repair.
  - Index the repairs, gzip the response, and cache it by the report's identity.
  - Gzip brings it to 134 KB.
- **OP-6: Deeper analysis refetches the report and history after each judgement**, about 73 MB for 25.
- **OP-7: static assets.** The 44 UI modules are sent `no-store` and uncompressed (493 → 133 KB with gzip).
- **OP-8: polling continues in hidden tabs.**
- **OP-9: compress kept scans.** They take 65 MB at 5,000 findings, and gzip shrinks each copy 18×.
- **OP-10: CI never runs the real-scanner tests.**
  - Five tests skip without gitleaks, including the hostile-repository and private-data tests the README cites as verification.
  - Install the pinned scanners, and fail instead of skipping in CI.
- **OP-11: use the monitor's idle cron ticks** to probe waiting hosts daily. Today 200 names take about 20 days to come round.
- **OP-13: merge the CI check and test jobs.**

## Stage 5: second code, bug and security audit

The code-audit category left the loop in Stage 2, so Stage 5 continued the bug and security categories that had not yet had three empty sweeps, and added an adversarial verification of the change list above.

### Verification

An independent agent re-read the code for every High and every Medium marked [C] or [P], and re-reproduced five [R] Mediums with its own scripts. It tried to refute each one.

| Result | Items |
|---|---|
| Confirmed | S9, S10, S11, S12, B21, B22, B23, S14, S16, S19 (deps.dev), S21, S23, S30, S34, S35, B32, B38, B40–B49 |
| Narrower than stated | **B20** (High → Med–High: only a secret matched in several commits at one line), **S29** (Med → Low: the start form does list the limits), **S28** (Med → Low–Med, with a better fix), **S27** (Med → Low) |
| Not settled here | S19's Go part (no Go toolchain on this computer; Stage 5's attacker sweep then reproduced it with a stand-in `go`) |
| Refuted | none |

The verification also corrected the plan. It found:
- M9's proof depends on the real-scanner CI tests, which sat in M13. They now come first in M9.
- The child-process policy as written would overwrite the GitHub token's `GIT_CONFIG_COUNT` and break container scans.
- B20's sort would detach notes without a migration.
- `readJson` throwing would turn a corrupt notes file into a 500.
- B38's content stamp would make every stored discussion stale.

Each correction is in the milestones below.

### Security, hostile repository, round three (7 sweeps; every sweep found something)

| ID | Sev | Finding | Fix |
|---|---|---|---|
| S53 | **Med–High** | **gitleaks' built-in path allowlist silently drops keys by file name.** Porchlight's rule files extend the defaults (`useDefault = true`), which bring in gitleaks' global path allowlist. The same token committed to `src/app.js`, `src/bootstrap.js`, `logo.svg` and `Pipfile.lock` was reported only in `src/app.js`; confirmed independently. Also hidden: `*.pdf`, `*.bin`, `*.socket`, `go.sum`, `venv/…`, `*javascript.json`, and a real token in a `package-lock.json` `resolved` URL. It is a path filter (invariant 10), and nothing names it. **[R]** (R3S-2) | Ship a pinned full copy of the default rules without the global path allowlist (keeping `.git`), and let triage lower lockfile and vendored paths one step. |
| S54 | Med | A key or document added only in a merge's resolution is never read by Standard or Deep: `git log -p` shows no diff for merges. Only Quick finds it. An ordinary conflict resolution is enough. **[R]** (R3S-1) | `--diff-merges=first-parent`, for gitleaks and for the added-files list. |
| S55 | Med | `diff.dstPrefix`, `diff.noprefix` and `i18n.logOutputEncoding` rewrite every path and date gitleaks reports. A forged `node_modules/` prefix drops every finding, `test/` lowers them all, and `noprefix` makes `git filter-repo --path` name the wrong file (invariant 12). **[R]** (R3S-3) | `--default-prefix --encoding=UTF-8`. |
| S56 | Med | osv-scanner follows `-r ../outside/.env` in a `requirements.txt` and a pom's parent `relativePath` out of the repository. The SBOM then lists `pkg:pypi/secret-token@s3cr3tvalue`, a `.vault-token` and SSH key lines as packages. **[R]** (R3S-4) | Resolve every include and parent path before running osv-scanner; if one leaves the repository, skip it there and say why under "Not covered". |
| S57 | Med | Content `git log -p` never shows is pushed but never scanned: a tree or blob a tag points at, annotated tag messages, commit messages. **[R]** (R3S-5) | Scan what non-commit refs reach, or name them as not covered; pipe messages to `gitleaks stdin --redact`. |
| S58 | Low | A repository's config value is quoted in git's error, so the page's error banner shows the repository's own words ("run: curl … \| sh") in Porchlight's voice. **[R]** (R3S-6) | Replace quoted values with fixed words. |
| S59 | Low | Discovery silently leaves out unreadable folders (also how macOS privacy controls show Documents and Desktop), symlinked folders, hidden folders and `vendor/` holding a `.git`. **[R]** (R3S-7) | Return what was skipped and show it as "Not covered". |
| S60 | Low | Nothing caps the number of findings: one 5 MB file of tokens gave 100,000 findings and a 21.7 MB report, kept 50 times; near 400,000 the scan fails. **[R]** (R3S-8) | Group past a threshold per rule and file, with a count. |
| S61 | Low | Quick and last-N scans treat a tracked file past PATH_MAX as deleted, so its key is not reported and not counted as unread. **[R]** (R3S-9) | "Gone" only for ENOENT and links; anything else is "unread". |

**Why this class is not closed by sweeping.** Hostile-repository sweeps ran 20 times over three rounds, and each of the last 13 found a new git setting, ref or object-store detail that changes what gitleaks' internal `git log -p` reads or runs. Adding one flag per discovery does not converge: the design spike below found a 21st vector that gets past every flag proposed. The loop was therefore ended with a structural answer instead of a 21st sweep.

### Stage 5, design spike: scan a clean copy

The question: would scanning a copy that Porchlight makes itself close the hostile-repository class, instead of one flag per trick? Each design was run against 28 fixtures (every vector above, plus three new ones) with the real git, gitleaks and osv-scanner.

**Answer: yes, with one specific recipe.** Make an empty bare repository, fetch every ref except `refs/replace/*` (plus each worktree's HEAD by object id), then check that the copy's refs equal the source's. Our git reads only our own config: `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, and in the container `safe.directory=/repos/*`.

The copy holds none of the source's:
- config, attributes, `modules/` or hooks;
- commit-graph, alternates or grafts;
- shallow file or replace refs.

Git's own checks then make the copy complete, shallow (which is detected) or not made at all: index-pack verifies every object and fetch checks connectivity. Partial clones and the submodule `diff.external` route fail closed or are found, and nothing runs. The full recipe, with each flag explained, is in the spike's report (`s5-clean-copy-spike.md` in the appendix).

| Design | Result |
|---|---|
| Today | Code ran (submodule, partial clone ×2); 10 vectors missed silently |
| Every per-flag fix proposed so far | Every known vector closed, **except a new one**: `.git/info/grafts` with `advice.graftFileDeprecated=false` still hides history. Flag-by-flag fixing does not finish. |
| `clone --bare --no-local` | Silently drops notes, stash, remote-tracking and `refs/original` refs, other worktrees' HEADs and branches hidden by `uploadpack.hideRefs` |
| `clone --bare --local` (hardlinks) | Copies the crafted commit-graph and alternates, and shares files with a store the attacker can write |
| **`init --bare` + `fetch` + ref check (recommended)** | Every vector found, failed closed or detected, with no code run and no network contact |

**Cost.** About 1 s and one pack's worth of disk per 100 MB of pack. A 20,000-commit, 305 MB repository took 3.1 s to copy and 2.0 s to scan, against 1.8 s in place. Porchlight's own repository took 0.19 s to copy.

**Still needed with the copy:**
- `--text --diff-merges=first-parent --encoding=none` (`none`, not the `UTF-8` proposed for S55, which misses a commit's own encoding header);
- the shallow and partial-clone notes;
- S53 (the path allowlist) and S57 (trees, blobs and messages `git log` never shows);
- S13 (a minimal environment);
- the safe git settings on the calls still made against the original (`ls-files`, `cat-file` of the index);
- every osv-scanner item.

**Made unnecessary:**
- `--submodule=short`, `--root`, `--color=never`, `--default-prefix`;
- the `GIT_CONFIG_COUNT` pins for `format.pretty`, `log.date`, `log.abbrevCommit` and `core.commitGraph`;
- the attributes and `bigFileThreshold` fixes.

**New risks the copy brings:**
- A second copy of every committed secret sits on disk. Keep it 0700 under `/data` in the container, check free space first, and remove it on success, on SIGTERM and at start-up.
- Some source config still reaches `upload-pack`, but only through a constant `--upload-pack` string; the ref comparison turns any advertisement trick into a failure.
- The owner's own blobless clones fail unless detected first and named.

| ID | Sev | Finding |
|---|---|---|
| S62 | Med | `.git/info/grafts` plus `advice.graftFileDeprecated=false` hides history from gitleaks, even with every per-flag fix applied. Today it fails closed only because of a hint the repository can switch off. **[R]** (spike) |
| B63 | Med | gitleaks inherits the owner's own `~/.gitconfig`. A personal `diff.noprefix` or `color.ui=always` silently breaks history scans, and a configured credential helper would start on a lazy fetch. No attacker needed. **[R]** (spike) |

### Bugs, round three (24 sweeps; text and time closed after three empty sweeps)

| ID | Sev | Finding |
|---|---|---|
| B51 | **High** | **A domain removed during its scan hands that scan, and a "verified" mark, to the next domain added.** `domains.id` is `INTEGER PRIMARY KEY` without AUTOINCREMENT, so SQLite reuses a deleted id. `saveScan` writes by id alone and sets `verified_at`. In the reproduction the new domain showed as verified without its record. Once proven, its scans made DNS lookups and a `GET /` to the old domain's hosts, which were never checked. Breaks invariant 1. **[R]** on miniflare's D1 (R3B-1) Fix: save only while the claim on that id and name is held, AUTOINCREMENT through a rebuild migration, and ignore a previous snapshot for another domain. |
| B52 | Med | While crt.sh cannot be read, certificates carried from older scans age into false high "expired; no replacement logged" findings and an urgent alert. **[R]** (R3B-2) |
| B53 | Med | The Mac app's server outlives a Force-Quit or crash. A relaunch starts a second server on another port, both share the data folder with separate job locks, and an orphan holding the tailnet listener cannot be turned off from the new page (invariant 7). **[R]** (R3B-3) |
| B54 | Low–Med | A scheduled scan that checked nothing is announced as "0 findings … 0 new" at normal priority, with no incompleteness field. **[R]** (R3B-4) |
| B55 | Low–Med | Building the roadmap is quadratic (`groupBy` spreads its array): 5.5 s at 80,000 findings, on every report load. **[R]** (R3B-6) |
| B56 | Low | Notices exceed Discord's 2,000 characters after escaping, and ntfy's 4,096 bytes with CJK names. **[R]** (R3B-5) |
| B57 | Low | The investigation's TCP tool records local failures and Stop as "closed or filtered", so the model cites its own computer's failure as the host's state. **[C]** (R3B-7) |
| B58 | Low | `münchen.de` is refused as "not a domain name"; nothing converts it to punycode. **[C]** (R3B-8) |
| B59 | Low | The container smoke test's `diff.external` check cannot fail: `git log -p` never runs it without `--ext-diff`. **[R]** (R3B-9) |
| B60 | Low | A `PORCHLIGHT_UI_KEY` in the Mac app's `app.env` leaves the window on "Starting Porchlight…" for ever, and `~` in `PORCHLIGHT_ROOT` is not expanded. **[C]** (R3B-10) |
| B61 | Low | `localeCompare` without a locale makes SBOM and report order depend on LANG. **[R]** (R3B-11) |
| B62 | Low | doctor reports any read error as "No scan is kept yet", and the GitHub repository list stops at 1,000 silently. **[C]** (R3B-12) |

### Bugs, round four (18 sweeps)

Three lenses had not closed. The monitor's write paths closed with three empty sweeps (4–6), and so did the Mac app and container runtimes (3–5), although one more named sweep there still found B72. Invariant 5 found something in its last sweep.

| ID | Sev | Finding |
|---|---|---|
| B64 | Low–Med | Removing a domain while its verify runs marks the next domain added (same reused id) as verified, or answers 500. `markVerified`, `markUnverified` and `markFailed` all write by id after an await. The ownership gate still holds, because each scan checks again. **[R]** (R4B-1) |
| B65 | Low | A verify that lands during a scan's failed ownership check is undone, with an urgent alert and a 24-hour wait. **[R]** (R4B-2) |
| B66 | Low–Med | A failed DNS lookup turns a lapsed domain back to "verified" on the page, and each recovery repeats the lost-ownership alert: three alerts for one lapse. Invariant 5. **[R]** (R4B-3) |
| B67 | Med | **CSV exports drop every "Not covered" line and the partial marker.** An incomplete scan's roadmap and findings CSVs are a bare header row, which reads as clean. Domain CSVs drop the monitor's notes, and a one-zone Cloudflare CSV has no "partial" line and the full audit's file name. Invariants 11 and 12. **[R]** (R4B-4) |
| B68 | Low–Med | When the earlier kept scan cannot be read, the Overview says "This is the first scan kept" above the history table, and a scheduled notice loses "new" and its urgency for a new critical key. **[R]** (R4B-5) |
| B69 | Low | When Cloudflare's account list cannot be read, accounts that own no zone, and their member and token checks, vanish silently. **[R]** (R4B-6) |
| B70 | Low–Med | The Mac app aborts when it cannot write its log (disk full), because `FileHandle.write` raises an Objective-C exception Swift cannot catch; with B53 the server is then orphaned. **[R]** (R4B-7) |
| B71 | Low | A crashed web content process leaves the Mac app's window blank with no message. **[C]** (R4B-8) |
| B72 | Low–Med | A notice address on the owner's own network that the manifest invites (`http://nas:8080/hook`, `http://[fd00::5]/`) is refused by name pattern, and `ui` exits, taking the page and every scan down in BoxPilot. **[R]** (R4B-9) |

**Why invariant 5 is ended structurally too.** "Not observed is not empty" found something in every round: 18 sweeps across rounds two to four, in collectors, comparisons, exports, notices and pages. Each instance is the same mistake: a failed read becomes `null`, `[]` or a missing row, and later code cannot tell it from "nothing there". The structural answer, added to M10, is one result type used from the reader to the page:
- `{ observed: true, value } | { observed: false, reason }`, with `readJson`, `latestChange`, every collector and every export taking it;
- one helper that turns `observed: false` into a "Not covered" line in every format;
- a static test that fails on a new `catch { return [] }` or `?? []` in a reader.

## Stage 6: second three-sweep round

Eighteen sweeps from angles Stage 3 did not use; 17 found something new. Each category then left the rotation.

- **Readability** (README; CLAUDE.md and docs; the tests as documentation):
  - The README and invariant 21 promise a Bot Fight Mode change that the code stopped offering, and Settings still asks for "Bot Management Write" (R6R-1).
  - Stale numbers: model waits of 5 minutes against 15–20 in the code; "one CLI test runs the real gitleaks" against five; `check` covering lint for `cli/`, which it does not (R6R-2).
  - "What the model is sent" still describes the Ollama-only version (R6R-3).
  - The README needs a two-level contents, a Container heading, and tables of environment variables and commands (R6R-4).
  - README C1–C16 and CLAUDE.md 1–23 number the same rules differently, and six invariants have no test named (R6R-5).
  - RELEASING.md leaves out the demo and screenshots (R6R-6).
  - Plan documents for shipped features read as current (R6R-7).
  - No test names an invariant (R6R-8). An invariant → test index is drafted in R6R-9; invariants 6 and 8 have no test.
- **Usability** (WCAG 2.2; people other than the owner; error messages):
  - The Overview does not reflow at 320 px **[R]** (R6U-1).
  - Small targets in the live-credentials list (R6U-2).
  - No `scroll-padding`, so focus can sit under the sticky header or the drawer in Firefox and Safari (R6U-3).
  - Toast actions vanish in 10 s, before a keyboard user can reach them (R6U-4).
  - Password managers are not offered the access key, and the README recommends bookmarking the `#k=` link (R6U-5).
  - No help link or version on the page (R6U-6).
  - A second person's status changes are anonymous and overwrite the last (R6U-7).
  - Locale dates in English sentences (R6U-8).
  - No request timeouts or chained polls on a slow tailnet link (R6U-9).
  - "fetch failed" and "DNS status 2" reach the owner (R6U-10).
  - A Deep scan's analysis can fail where only Activity says so (R6U-11).
- **Visual** (exports; small sizes and other surfaces; motion and state):
  - The HTML export prints pale grey on white from a dark-mode browser (R6V-1).
  - Exports carry no tool version, preset or time zone, every PDF is named "Repair roadmap", and actions are not numbered (R6V-2).
  - Help and doctor assume 100–180 columns (R6V-3).
  - Slack and Discord notices are one monospace block (R6V-4).
  - The 16 px icons are shrunk from 1024 px artwork, and the DMG has no layout (R6V-5).
  - One dimming level means stale, loading and disabled (R6V-6).
  - Smooth scrolling ignores reduced motion (R6V-7).
- **Quality of life** (the container operator; the CLI-only owner; six months on):
  - Scan outcomes never reach `docker logs` (R6Q-1).
  - A backup of `/data` copies full-history clones with their secrets, OSV databases and every key (R6Q-2).
  - Each tab asks for the key again (R6Q-3).
  - No version shown anywhere (R6Q-4).
  - `repos scan --save` never prints what is new or fixed, and there is no `repos history` (R6Q-5).
  - The CLI cannot scan one repository again (R6Q-6) or set statuses (R6Q-7).
  - The monitor loses first-seen dates after 30 days (R6Q-9).
  - History drops each scan's counts with its copy (R6Q-10).
  - Partial clones, `.tmp` files and temporary folders are never swept (R6Q-11).
  - Notes for findings gone from every kept scan accumulate (R6Q-12).
- **Features** (trust in the tool; the monitor; models):
  - `doctor --self`, which on this computer would have caught S12 (R6F-1).
  - Signed releases, a DMG built in CI, attestations, `SHA256SUMS` and a "Verify a download" section (R6F-2).
  - An egress log of every outbound request: host, purpose, bytes, never a body (R6F-3).
  - `porchlight forget` (R6F-4).
  - The monitor's subdomain inventory, which it already holds but never shows (R6F-5).
  - Redirect targets and version-revealing headers from the `GET /` already made (R6F-6).
  - A host whose HTTPS fails from its first scan, never reported (R6F-7).
  - Model capability checks before use (R6F-8).
  - Structured output requests (R6F-9).
  - A model per task (R6F-10).
  - An opt-in prompt-injection regression corpus (R6F-11).
  - Reuse of judgements across scans (R6F-12, owner decision).
  - Turned down as against invariant 2 or 4: TLS grading, `security.txt`, a public status page.
- **Optimisation** (memory; disk; energy and network):
  - The server reaches 412 MB during a Deeper analysis at 20,000 findings, all garbage from rebuilding the 11.4 MB response; OP-5 and OP-6 remove it (R6O-1).
  - Nothing shows or bounds the data folder, which could reach 320 MB of kept scans (R6O-2).
  - The offline OSV databases are refreshed on every scan (R6O-3).
  - Activity polls every second when idle (R6O-4).

## Plan and milestones

Each milestone ships as its own release, with tests that fail on today's code. Order: M9 → M13 first (security and correctness), then M14, then M15 → M18 as the owner prefers.

### M9: Hostile input cannot run code, reach keys or hide history, and the ownership gate holds. Size: M–L

**Status, 2026-11-20: built, not committed or released.** Every item below has a test that fails on the code before it: the new `cli/test/hostile-history.test.ts` was run against HEAD and failed there, and the monitor's 10 new tests were run against the old monitor code and failed.

- **History is read from a clean copy** (`cli/src/repos/git-copy.ts`). Against the real git and gitleaks, the hostile fixtures run nothing and hide nothing:
  - a submodule's `diff.external`;
  - a partial clone with `core.sshCommand`, refused and named;
  - a replace ref and grafts;
  - `color.ui`, `core.bigFileThreshold`, `* -diff`, `log.showRoot`, `diff.noprefix`, `diff.dstPrefix`, `format.pretty` and `log.abbrevCommit`;
  - a key only in a merge resolution;
  - a shallow clone, named under "Not covered".

  Current git marks a partial clone with `remote.<name>.promisor`, not only `extensions.partialClone`; both are checked.
- **Rules:** gitleaks' rules are vendored from the binary itself, with its global path allowlist reduced to `.git` (`cli/src/repos/gitleaks.toml`, by `scripts/vendor-gitleaks-rules.mjs`). gitleaks also runs with `--ignore-gitleaks-allow`. Files git does not track still skip `node_modules`, virtual environments and `vendor/bundle`, and the scan's description says so.
- **Child processes:** every one gets a minimal environment with none of Porchlight's keys, PATH limited to absolute folders, `PYTHONSAFEPATH=1` and npm's update notifier off. Each runs in a private empty folder. Every git call ignores the system's and the user's git settings.
- **Temporary folders** are registered, removed on SIGTERM and SIGINT, and swept at start-up after six hours. The image runs under `tini`.
- **osv-scanner** runs with `--no-resolve --no-call-analysis=all --x-disable-plugins=filesystem/vendored`, in scans and the SBOM. A filter it applied is named wherever it was (S17). A tracked lockfile it did not read (S18), and indirect dependencies not worked out (S19), go under "Not covered". The scan page says package names go to OSV.dev.
- **Evidence for a model** keeps only the import statement, never the rest of its line (S11).
- **The Mac app** keeps `~/.porchlight` 0700 and `app.log` 0600, masks the key line by line, and survives a full disk (S12, B70).
- **"Commands to fix these"** no longer combines pip upgrades, `@latest`, `brew upgrade` or the credential-helper switch (S32).
- **The monitor:**
  - migration `0003_domain_ids_never_reused.sql` rebuilds `domains` with AUTOINCREMENT;
  - every by-id write after an await also matches the name and token;
  - a lapsed domain stays unverified through DNS failures, with one alert (B51, B64–B66).
- **Reports** carry `format: 2`, and a newer format is refused.
- **CI** installs the pinned scanners and fails instead of skipping without them.
- **Left for later, with reasons:**
  - `brew outdated` downloading Homebrew's list when its cache is missing (S31, plausible only, not reproduced).
  - The host check using the offline OSV database.
  - Sweeping `.fetching-*` clones and `.tmp` files (with M10's private-file module).
- **Not run here:**
  - the container smoke test (no Docker daemon);
  - CI;
  - a launch of the rebuilt Mac app.
- **Decisions the monitor change took, open to you:**
  - An unverified domain whose ownership lookup fails is retried after a full interval and its error count does not rise, so it never sends the "3 scans failed" alert.
  - A scan whose save is refused while the domain still exists answers "busy" (409).
- **Porchlight scanning its own repository** reports one match in `cli/src/repos/gitleaks.toml`: a rule whose pattern is a literal that matches itself. gitleaks' own default allowlist skips files of that name, which is why the pre-commit hook passes it.

S9, S10, S11, S12, S13, S14, S15, S16, S17, S18, S19 (the flags and the preview text), S31, S32, S33 (with the leftover sweep of R6Q-11), S48, S53, S54, S55, S62, B51, B63, B64, B65, B66, OP-10, and the report format version from B26.

- **B51 is small and breaks the monitor's ownership gate,** so it ships here rather than with M13, with B64–B66, which share its cause:
  - every by-id write after an await also matches name and token;
  - AUTOINCREMENT through a rebuild migration;
  - no previous snapshot from another domain;
  - ownership state changes only on an observed answer.
- **S53:** a pinned copy of gitleaks' default rules without the global path allowlist. This changes what is found in many repositories, so the release notes should say so.

- **First, CI runs the real scanners** (OP-10, moved here from M13). Install the Dockerfile's pinned, checksummed gitleaks and osv-scanner in the test job, and fail instead of skipping when `CI` is set. Without this, M9's proof skips silently: the hostile-repository tests need gitleaks (`scan.test.ts:234,269,433,507`).
- **One child-process policy in `exec.ts`:**
  - a minimal environment, with tools resolved to absolute paths;
  - `GIT_NO_LAZY_FETCH=1`, `GIT_NO_REPLACE_OBJECTS=1`, `GIT_TERMINAL_PROMPT=0`;
  - for every git call, the copy included: `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, and the safe args appended to `GIT_CONFIG_COUNT` (in the container, `safe.directory=/repos/*` appended as well, because `NOSYSTEM` drops the image's setting);
  - **history is scanned on a clean copy** made by the recipe in "Stage 5, design spike", with log options `--text --encoding=none --diff-merges=first-parent`. This closes S9, S14, S15's silence, S48, S55, S62 and B63 together. A partial clone, or a copy whose refs differ from the source, is "Not covered".
  - a private working folder;
  - `PYTHONSAFEPATH=1`, `NPM_CONFIG_UPDATE_NOTIFIER=false`.
- **Two traps the verification found in this policy:**
  - `github.ts:161-173` already uses `GIT_CONFIG_COUNT=1` for the token header, so new entries must be appended, never replace it.
  - The container's scans depend on the system git config (`safe.directory '/repos/*'`). Once git gets `GIT_CONFIG_NOSYSTEM=1`, every container scan fails unless `safe.directory` is re-added as above, and only `container-smoke.sh` would catch it.
  - Delete secrets from `process.env` only after the last read (`main.ts:394` reads the admin token again).
- **`--no-resolve` narrows coverage** of a `requirements.txt` or `pom.xml` without a lockfile. Say so under "Not covered". A test of the flags must check what was contacted, since osv-scanner also accepts a misspelt plugin name.
- **Reports carry `format: 2`,** because M9 adds new "Not covered" kinds that 0.10.0 would read as a complete scan.
- **Clean up on SIGTERM/SIGINT,** remove stale temporary folders at start-up, and run the container under `tini`.
- **The Mac app:** a 0700 folder, a 0600 log, and `#k=` masked.
- **Done when:**
  - The hostile-repository test gains each of these, and each is found or named under "Not covered":
    - a submodule with `diff.external`;
    - a partial clone with an `sshCommand` and a 401 helper;
    - a replace ref, an edited commit-graph and `.git/info/grafts`;
    - `.git/shallow`;
    - `color.ui=always`, `* -diff` and `diff.noprefix`;
    - a key only in a merge resolution;
    - `gitleaks:allow`;
    - an ignored committed lockfile and a `build/osv-scanner.toml`.
  - Keys in `bootstrap.js`, an `.svg` and a lockfile URL are reported.
  - A fake runner asserts the environment, working folder and arguments of every child.
  - A key on an import line never reaches a prompt.
  - On miniflare's D1, a domain removed and replaced mid-scan neither inherits the scan nor is marked verified.

### M10: Saves and jobs that hold. Size: M

**Status, 2026-11-20: built.** Tests in `cli/test/private-files.test.ts`, `cli/test/conventions.test.ts`, the new tests in `cli/test/ui-server.test.ts` and `cli/test/parsers.test.ts`.

- **One private-file module** (`cli/src/private-files.ts`):
  - `writePrivate` and `writePrivateJson` use a random temporary name;
  - `readPrivateJson` answers missing, read or unreadable;
  - `updatePrivateJson` and `oneAtATime` make one change at a time per file.
  - Every writer that used `${pid}.tmp` now goes through it, and a static test refuses a new one (B21).
- **Unreadable files are never written over.** This covers the history index (never pruned), notes, model settings, investigation domains, the project list and the Cloudflare change log. The page shows why where a page reads them: notes beside the report, history as "could not be compared" (B25, B68).
- **Notes keep entries this version does not understand** (B26).
- **A secret's matches are put in a fixed order,** so its finding names the oldest commit every time (B20). `carryNotes` moves a note to its secret's new identity once, only where that is unambiguous.
- **History compares only scans of the same folders** (B27).
- **Every background job marks itself running before its first await,** and puts its state back if it cannot start: scan, rescan, analysis, mural, Cloudflare audit, GitHub fetch. An investigation is refused while another is starting (B24, S24).
- **The route table declares who may change things.** The model's routes are "owner", never a tailnet device. Downloads, access and the monitor are "here" (S20).
- **Access changes are saved before they take effect,** one at a time, with the listener (S25).
- **Settings, keys and tokens live in the data folder** (`--data`, default `~/.porchlight`, `/data` in the image), and files an earlier version kept beside the report are moved there (S34).
- **The server stops when the Mac app that started it goes away,** through its stdin (B53). The app reloads a page whose web process stopped (B71).
- **Not done:**
  - the full observation type through collectors and exports (`readPrivateJson` and the static test are its first part);
  - a version number in settings files;
  - double-start tests for the analysis and an investigation (the code paths match the tested scan's);
  - the Mac app stopping a server left by an older build.

B20, B21, B24, B25, B26 (the rest of it), B27, B53, B68, B70, B71, S20, S24, S25, S34.

- **One observation type** (see "Why invariant 5 is ended structurally too"): readers, `latestChange`, collectors and exports pass `{ observed, value | reason }`, and a static test refuses new silent fallbacks in readers.

- **B53:** the server exits when the app that started it goes away (a stdin pipe), and the app stops a recorded earlier server at launch, so no orphan keeps the tailnet listener.

- **One private-file module:**
  - `writePrivate` with a random temporary name;
  - `readJson`, which returns `null` only for ENOENT; any other failure becomes a "could not read" state the page shows, never a 500 on `/api/repos/report`;
  - `update(path, fn)`, serialised per file (verification showed the loss comes from read-modify-write, not only the shared temporary name);
  - keeping fields the reader does not know.
- **B20's sort changes the kept commit once per affected secret.** Migrate notes by repository, rule and location in the same release, so no status detaches.
- **One job registry:** `claim(name)` before the first await, released in `finally`.
- **The route table declares who may call each route** ("here", "owner", "any"), `handle()` enforces it, and a test lists every POST against a tailnet caller.
- **Readers flag a report or settings file of a newer format** (the version itself lands in M9).
- **Finding identity is stable:** sort before removing duplicates.
- **History compares only scans of the same folders.**
- **Done when:**
  - 10 concurrent saves keep 10;
  - each job's double start gives 202 and 409;
  - an unreadable index never prunes;
  - 12 identical scans give 0 new and 0 fixed;
  - a note with an unknown status survives a save.

### M11: Repairs that are complete, coverage that is stated. Size: M–L

**Status, 2026-11-20: built.** Tests in `cli/test/roadmap.test.ts`, `hostile-history.test.ts` (real git and gitleaks: B28, B29, B30, S57), `private.test.ts` (B32, REP-B12, S42), `discover.test.ts` (S59), `scan.test.ts` (S50, S58, S60), `scan-choices.test.ts` (B46), `notify.test.ts` (B54, S35, S52), `sbom.test.ts` (S49, S56), `cloudflare.test.ts` (S35, B67), `github.test.ts` and `doctor.test.ts` (B62).

- **The fix planner** picks the lowest version outside every advisory's affected ranges (`safeVersion`), gives the install-at-version command for a major or 0.x upgrade in each package manager, and gives keys typed into a tracked file their own repair (B22, B23, B31). Building it is linear (B55).
- **"Committed" is read from HEAD's tree**, not git's index (B28).
- **Deep reads the files as they are now for private data**, so a file grown one address a commit is counted whole (B29).
- **A repository inside another is scanned in its own right**, and its files are no longer called the outer one's "on this computer only". A submodule that is not checked out, a nested repository deeper than the search, and folders the search passed over (unreadable, a link, hidden, `vendor`) are said under "Not covered" (`notSearched`) without stopping the outer repository's findings counting as fixed (B30, S59).
- **Repositories fetched from GitHub are scanned exactly as listed** (S50).
- **"Clean" only after a full Standard scan that left nothing out**, and every repository row opens to "Scan this repository again" (B46, B47).
- **Exports:** an unknown `--repo` is refused, and an export filtered to nothing says the scan's other findings are not in it (B50). CSV ends with "Partial" and "Not covered" rows, a domain's notes included; a one-zone Cloudflare CSV says it is partial and is named as a part (B67). A cell holding `;` or a tab is quoted (S41).
- **Nothing that leaves the computer names a path:** exports, prompts and the mural give the folder's name; error lines name repositories and `~`; the failed-scan notice gives the folder's name; a personal Cloudflare account's email is masked (S35). The SBOM carries fixed words and the exit code, never osv-scanner's stderr, and drops a package named by a path (S49).
- **osv-scanner is not run on a repository whose manifests would read an existing file outside it** (a requirements `-r` or `-c`, a pom's `<relativePath>`, a manifest that is a link out): it would send that file's lines to OSV.dev as package names. Said under "Not covered", in scans and the SBOM. Maven's default `../pom.xml` is left alone (S56).
- **Commit messages, annotated tags' messages and files a tag points at are read** for secrets; a tag pointing at a folder is said (S57).
- **A repository's own config value quoted in an error is put in fixed words** (S58). **Past 25 secrets of one rule in one file, the rest are one finding with a count** (S60).
- **Notices:** a scheduled scan that checked nothing says so, urgently; every scan notice says whether it was complete, in its title and its JSON (B54). The JSON format's text forms no mention, link, image or tag in a chat that renders Markdown (S52).
- **Smaller:** private-data rules for international phone numbers, real addresses under an example-looking label, `threading.local()`, and probability pairs (B32, REP-B12); grouping private data is linear (S51); a tracked file that cannot be opened is unread, not gone (S61); a control character in a file name cannot forge a commit (S42); order no longer depends on the computer's language (B61); `doctor` tells an unreadable scan from a missing one, and GitHub's list says when an account has more than 1,000 repositories (B62).
- **Not done:** the repository-scanning lows not named above; skipping only the offending manifest rather than the whole repository's dependency check (osv-scanner can exclude folders, not files); reading what a tag pointing at a folder holds.

B22, B23, B28, B29, B30, B31, B32, B46, B47, B50, B54, B55, B61, B62, B67, S35, S41, S42, S49, S50, S51, S52, S56, S57, S58, S59, S60, S61, and the repository-scanning lows.

- **The fix planner:**
  - picks the lowest version outside every advisory's affected ranges;
  - uses the install-at-version form for major and 0.x upgrades;
  - gives separate repairs for uncommitted changes and nested repositories.
- **"Committed" is read from HEAD.**
- **Deep adds the current-files count for private data.**
- **"Clean" only when nothing was left out,** and every repository row can be scanned again.
- **Exports and prompts carry the folder's name, never its path.**
- **Done when:** the planner test covers multi-range advisories and major bumps for each package manager, and a Quick report never shows "Clean".

### M12: Models see only what they are told. Size: M

S22, S23, S26, S27, S37, S38, S39, B36, B37, B38, B39, B57, R6F-8, R6F-9, and the model lows (AI-B7–B10, H-F1, H-F3, H-F5). (S11 is in M9 and S20 in M10.)

- **Capability checks before use, and structured output requests (R6F-8, R6F-9).** Each model's real context length feeds the token budgets of B37.

- **B38's content stamp needs a fallback** for stored discussions that keep only `about.scannedAt`; without one, every existing discussion turns stale at once.

- **Each model request names the model the page showed.**
- **Hosted is decided by host.**
- **Tool output has the token and cookie values replaced.**
- **Budgets are in estimated tokens per provider**, and every data section counts against them.
- **Murals and discussions are keyed on the report's content stamp.**
- **Per-ecosystem import patterns, or "not checked for this ecosystem".**
- **Stop for follow-ups, Send and murals.**
- **Truncated answers are marked.**
- **Done when:** a prompt-content test for every route asserts there is no root path, token, cookie value or key, and a model switch between load and request answers 409.

### M13: The monitor and the audit never pass what they did not see, and releases can be verified. Size: M–L

B33, B34, B35, B48, B52, B56, B58, B59, B69, B72, S28, S44, R2B-6, R2B-7, R6F-2, the monitor and Cloudflare lows, and BLD-B1–B3. (OP-10 and B51 moved to M9.)

- **Releases:**
  - Build the DMG in CI, with attestations for it and the image.
  - Publish `SHA256SUMS` and sign tags.
  - Add a README section "Verify a download".
  - Add `SECURITY.md`, with GitHub's private vulnerability reporting switched on.
  - Script the DMG search, replacing S36's manual step.
- **Replace the smoke test's vacuous `diff.external` check** with the submodule vector (B59).

- **The monitor:**
  - Gone names stay gone on a failed lookup.
  - The variant goes into the finding id (`weak-hsts-off`).
  - Cookie and SPF fixes from the lows.
  - It reports whether alerts go to a webhook, with the last error.
  - The claim re-checks that the domain is still due.
- **The Cloudflare audit:**
  - Unread targets are `unknown`.
  - Pagination is complete or flagged, and 429 is handled with Retry-After.
  - Each change is tied to its audit.
  - Partial zones are `unavailable`.
- **CI:**
  - It tests the demo's refusals.
  - It fails when the BoxPilot schema is missing.
- **Done when:** the request list for a monitor scan is unchanged, and the fake Cloudflare account gains 55-page lists, a 429 and a missing custom-certificate read.

### M14: A steadier, quieter page. Size: L

B40–B45, B49, the accessibility and hierarchy items above, S29, S30, S46, UI-B9–B13, F-D1, D-D1, I-D1, R6U-1 to R6U-5, R6U-8 to R6U-11, R6V-6 and R6V-7.

- **Route currency:** a page that finishes after the owner has moved on draws nothing.
- **One tested `poller()`** with retries, backoff and a pause while hidden (OP-8).
- **Redraw only the part that changed;** drafts are kept by `findingKey`.
- **`aria-disabled` everywhere,** `announce()` for progress, and focus moved into panels and cards.
- **Paging on every long list.**
- **Results first on the Overview,** and a sidebar that scrolls.
- **Static sweep tests:** no `innerHTML`/`srcdoc`/`style=`, no `disabled` on a working button, no `aria-live` on a progress slot.
- **Done when:** a keyboard-only run through every page keeps focus; the static tests pass; and nothing is unreachable at 1280×700 or 375×812.

### M15: Daily use. Size: L

QL-1, QL-3, QL-5, QL-8, US-1, US-2, US-4, US-5, US-8, US-9, US-10, B-Q1, B-Q2, B-Q3, C-Q1, C-Q4, E-Q1, E-Q2, F-Q1, F-Q2, F-Q3, G-Q1, H-Q1, H-Q3, J-Q1, J-Q2, J-Q3, RD-8 to RD-11, B60, R6Q-1, R6Q-4 to R6Q-7, R6Q-12, R6U-6, R6U-7, R6F-1 (`doctor --self`) and R6F-4 (`forget`).

- **"At a glance"** on the Overview, with "Check everything".
- **"New since the last scan"** as a filter.
- **Rescan from the roadmap,** with "2 fixed, 1 new".
- **A schedule line:** last run, next run, notice delivered, tokens ending.
- **A waiting-approval badge.**
- **"Fix these" grouped by domain.**
- **Audit and host-check history.**
- **A monitor setup script.**
- **The quick start without the monitor's packages,** and `porchlight` on PATH.
- **One verb and one noun per thing.**

### M16: Speed. Size: M

OP-1 to OP-9, OP-11, OP-12, OP-13, and R6O-1 to R6O-4.

- **Done when:**
  - 25 report requests at 20,000 findings stay under 200 MB RSS;
  - an unchanged repository's history scan is reused;
  - the report response for 5,000 findings is under 300 KB on the wire;
  - Deep's gitleaks CPU drops by at least 15% with identical matches;
  - every waiting host is probed within 2 days.

### M17: Brand and readability. Size: M–L

VS-1 to VS-15, RD-1 to RD-7, RD-12 to RD-17, R6R-1 to R6R-9, and R6V-1 to R6V-5.

- **The documentation:**
  - Correct the Bot Fight Mode claim in the README and invariant 21.
  - Number the README's constraints by invariant, and add a "Tests:" line under each invariant.
  - Add a two-level contents and tables of commands and environment variables.
- **Exports:**
  - A print stylesheet with light colours.
  - A foot line with the version, preset and time zone.
  - Numbered actions.

- **The brand palette** with warm colours kept to the mark.
- **A "Poster moderne" look.**
- **One colour list** for the page and the HTML export, under the contrast test.
- **The findings trend and severity bar.**
- **The server split into route modules,** and `rules.ts` on `defineRule`.
- **`styles.css` split by layer.**

### M18: New coverage. Size: L, released in parts

- **First part:** FT-3, FT-5, FT-9, FT-10, FT-11, FT-16 and FT-18 (small, and inside today's invariants).
- **Then:** FT-1 and FT-2 (a new finding kind and more token permissions), FT-4 (a new destination), FT-13 and FT-15, FT-6 to FT-8, FT-12, FT-14 and FT-17.
- **From Stage 6:**
  - The subdomain inventory (R6F-5) and the two monitor checks from data already fetched (R6F-6, R6F-7), which belong in the first part.
  - First-seen dates (R6Q-9).
  - The egress log (R6F-3).
  - A model per task (R6F-10).
  - The prompt-injection corpus (R6F-11).

## Owner decisions needed

1. **"This Mac" or "This computer".** The navigation and the host check say "This Mac" on macOS; your copy rule says never "this Mac". (W2, RD-13)
2. **Narrowing Findings to open items.** A status filter would weaken invariant 17 ("a status never hides a finding"). The alternative is an "Open first" order that hides nothing. (B-U1)
3. **Typing the GitHub token under Settings.** Invariant 15 says the token never reaches "the browser". (I-Q1)
4. **One ownership record for every feature.** The Cloudflare audit could adopt the monitor's token, and Domains could offer the record through the Cloudflare template. Invariant 21 says "this computer's token". (F-F3, US-6)
5. **Showing your statuses outside Findings.** On the Roadmap, in a Review card, and as an opt-in column in team exports, without reordering or recounting. Invariant 17 says a status never changes an export. (C-Q3, QL-3, QL-4)
6. **Which `compatible` servers count as yours.** A rule by host, or an explicit "this server is mine". (S23)
7. **Keeping a monitor URL's path.** Invariant 7 keeps the origin alone. (D-F4)
8. **CI mode.** `--baseline`, SARIF, and whether gaps you chose (Quick, `--skip`) fail `--fail-on`. This goes with decision 3 of 2026-11-17. (QL-7, FT-9)
9. **`host check` on the command line.** Make its Apple and OSV lookups opt-in, as on the page, or fix the help text. (RD-14)
10. **New reach.** The GitHub token's first write (FT-12), wider read permissions (FT-1), RDAP as a new destination (FT-4), and Actions workflows as a new finding kind (FT-2).
11. **Words.** "Domain" or "website", and whether the sidebar groups follow the brand line ("Your repos · Your servers · Your computer"). (RD-10)
12. **What a backup of `/data` holds.** A separate `/cache` volume, never backed up, for clones and OSV databases. Invariant 15 says clones live beside the report, and invariant 9 binds the manifest. (R6Q-2)
13. **Remembering the access key on a device,** with Sign out. Invariant 7. (R6Q-3)
14. **Keeping scan summaries beyond the last 50** for trends. Invariant 17 says "last 50". (R6Q-10)
15. **Reusing a model's judgement across scans** when the finding, evidence and model are unchanged. Invariant 16 says judgements are tied to one scan. (R6F-12)
16. **Explain and Ask from the command line.** Invariant 13 is written as "what the page shows". (R6Q-8)
17. **Scanning a clean copy** instead of the repository in place. It costs about 1 s and one pack's worth of temporary disk per 100 MB of pack, and closes the hostile-repository class's configuration side, which 20 sweeps of per-flag fixes did not. Recommended; M9 assumes yes. (See "Stage 5, design spike".)

## Stage 4: what you might be missing

1. **Turn conventions into tests.** Every round found the same kinds of bug in code written since the last audit:
   - `disabled` on a working button;
   - chatty live regions;
   - fixed temporary file names;
   - text leaving without `stripControls`;
   - secrets inherited by child processes;
   - jobs marked running only after an await.

   The project already does this for click paths and contrast. A dozen more static tests in `cli/test`, each failing on one pattern with an allow-list, would close each kind for good. This has more leverage than any single fix above.
2. **Release M9 together with M6–M8, not after them.** Three milestones are built but not released. Several Highs (S9, S11, B20, B21) sit in code those releases carry or extend. Ship 0.11.0 once M9 is in, so no release carries a known High.
3. **A front door for security reports.** The repository appears to be public. It has no `SECURITY.md` and no private reporting channel (GitHub's private vulnerability reporting is one switch). A security tool is judged by this first.
4. **A written threat model.** The invariants say what must hold, but nothing names who it must hold against. This audit used four attackers: a hostile repository, a hostile network peer (DNS, HTTP, APIs, models), a neighbour (another account, a tailnet device, a web page), and a model's own output. A one-page `docs/THREAT-MODEL.md` would let each new feature be checked against all four before it is built. The hostile-repository class was still finding new problems after 13 sweeps.
5. **Keys at rest.** Every token is a plain 0600 file under `~/.porchlight`, so it is copied into Time Machine and any other home-folder backup. The Keychain on macOS and the Secret Service on Linux keep keys out of backups. The container can keep files under `/data`.
6. **A signed, notarised Mac app.** `mac/build.sh` signs ad hoc (`codesign --sign -`), so macOS warns on first open, and an owner cannot tell who built the DMG. The container image already carries an SBOM and build provenance; the Mac app should match.
7. **Porchlight on Porchlight.**
   - Run `repos scan` on this repository in CI, using the CI-mode decision.
   - Watch `porchlight.theengineers.xyz` with your own monitor. The demo sends no HSTS or Permissions-Policy header, which your own monitor flags.
8. **Fuzz the parsers.** Most bugs came from shapes nobody wrote a test for: gitleaks rows in a different order, DoH status codes, Cloudflare pages, model answers that are not JSON. A seeded generator in `node:test`, run over each parser with mutated real fixtures, needs no dependency.
9. **Data mixing between versions (B26).** Until reports and settings carry a format version, every new field risks the same loss. Add the version before 0.11.0 ships.

## Stage 7: what the second pass adds

1. **Two classes did not close by sweeping, and their structural fixes outrank every single item.** The hostile repository (20 sweeps) and invariant 5 (18 sweeps) kept producing new cases. The clean copy (M9) and the observation type (M10) close each class at its source. Build those two first, and turn their fixture sets into permanent tests, so the next audit starts above them.
2. **Your own environment breaks scans with no attacker involved.** Examples:
   - a personal `~/.gitconfig` with `color.ui=always` (B63);
   - LANG reordering SBOMs (B61);
   - an empty PATH entry (S10);
   - backups of `~/.porchlight` and `/data` copying keys and full-history clones (Stage 4 item 5, R6Q-2).

   Run the test suite in CI a second time under a deliberately awkward environment: `LANG=th_TH.UTF-8`, a `~/.gitconfig` with `color.ui=always` and `diff.noprefix=true`, a PATH with an empty entry. It is one CI job and catches a whole kind of bug.
3. **What a scan misses is now the larger risk.** A scanner's harm is a "Clean" the owner trusts. This audit found keys missed in:
   - files gitleaks' default allowlist names (S53);
   - merge resolutions (S54);
   - tags and messages (S57);
   - nested repositories (B30);
   - staged-only changes (B28);
   - long paths (S61).

   It also found that CSV exports drop "Not covered" (B67). Build a **coverage corpus**: one fixture repository with a run-time key in each hard place, and a test that Porchlight finds every one. Then publish that list in the README as "what a scan reaches", so the claim is checked rather than asserted.
4. **The monitor Worker needs the CLI's discipline.** B51 and B64–B66 show its write paths were never tested against a remove, re-add or verify arriving mid-scan. The round-three and round-four agents ran such tests on miniflare's D1 in minutes. Add them to `monitor/test`.
5. **Prove the invariants to the owner, not only to the tests.** Possible ways:
   - `doctor --self` (R6F-1);
   - an egress log (R6F-3);
   - signed, verifiable releases (R6F-2);
   - the coverage corpus above.

   A security tool earns trust by showing its own state. Today the owner has to read CLAUDE.md to know what Porchlight promises.
6. **Hold new surface until M9–M13 ship.** Many bugs sit at the seams between features: rescans with murals and discussions, two tabs with model settings, id reuse in the monitor, the Mac app's lifecycle with the tailnet listener. With 23 invariants, 10 pages, six model providers, a monitor, a Cloudflare audit, investigations, a Mac app and a container, each new feature adds seams. A short freeze on new features while the floor is raised costs little and lowers the count the next audit finds.
7. **Keep this audit's detail private until the fixes ship.** `docs/AUDIT-PLAN-2026-11-20.md` names working attacks on a public repository. The full reports and 283 reproduction scripts are in the git-ignored `reports/audit-2026-11-20/`, which reboots and cleanup do not touch, but which is also not backed up by git.

**Still open from 2026-11-17:**
- Decision 1: the DMARC, MTA-STS and TLS-RPT lookups.
- Decision 2: the default local model, still the "uncensored" GGUF in `boxpilot/porchlight.yaml`.
- Decision 3: an exit code for an incomplete scan.
- Decision 5: `docs/ACTIVE-TESTING.md`.
