# Active testing: design for review

**Status:** Proposed, 2026-11-17. Nothing here is built. Building it changes invariant 2 in `CLAUDE.md` ("Passive only"), which needs the owner's explicit yes.

## What it would be

SecurityX today only observes: certificate logs, DNS, and one `GET /` per host. Active testing would add an agent that tests the owner's own domains the way an attacker would, one step at a time, and keeps going until it proves or rules out a goal. The model for it is ARTEX:

- A **planner** turns a goal ("can anyone reach an admin interface on example.com?") into small **intents**, each one concrete step such as "request /admin on app.example.com" or "check which TLS versions api.example.com accepts".
- **Workers** carry out intents with real tools and write the results back.
- The planner reads the results, decides the next intents, and stops when the goal is proven, ruled out, or out of budget.
- Every active step passes deterministic **brakes** before it runs: scope, an allowlist, budgets and approvals. The model never decides what is allowed.

## What changes in the rules

| Invariant | Today | Proposed |
| --- | --- | --- |
| 1. Ownership gate | No request about a domain until its TXT record verifies | Unchanged, and it becomes the outer edge of every test run: the record is re-checked when a run starts and before each approval |
| 2. Passive only | One `GET /` per host, no redirects, no port scans, no path guessing | **Passive by default.** The monitor's scheduled scans stay exactly as they are. Active steps happen only in a test run the owner starts on one verified domain, inside its scope and behind the brakes below |
| 3. Secrets stay in the scanner | gitleaks values never leave the scanner | Unchanged. Evidence captured by active tests (cookies, tokens, personal data in responses) is stored only on the runner, redacted in exports, and never sent to a remote model |

The repository scanner is unaffected: it only reads the owner's files.

## Scope: what a test run may touch

Owning a domain is not the same as owning the machines it points at. `app.example.com` may resolve to a Cloudflare edge, a Vercel deployment or shared hosting, and probing those addresses tests someone else's infrastructure.

- **Application level (HTTP/HTTPS to a hostname):** allowed for hostnames under a verified domain that the monitor has already seen, requested by name with the Host header and SNI set to that name. Redirects are followed only within scope.
- **Network level (ports, TLS on raw addresses, service fingerprinting):** only for IP addresses the owner lists by hand and confirms are theirs, for example a VPS. Each confirmation is recorded in the audit log, and an address is used only while the domain's DNS still points at it.
- **Never in scope:** third-party services the site uses (identity providers, payment pages, CDN control planes), anything reached by a redirect out of scope, other tenants on shared hosting.
- Every target is resolved once and pinned for the step, so a DNS change mid-run cannot redirect a step to someone else's machine.

## Where it runs

Not in the Cloudflare Worker: it cannot run tools, and it is limited to 50 outbound requests per invocation. A **runner** inside the SecurityX container on the BoxPilot server does the work. The Worker stays the inventory and schedule; the runner asks it for each domain's verified scope.

Two consequences to accept:

- Test traffic leaves from the owner's home internet connection. A domain behind Cloudflare or a cloud host means that provider sees attack-shaped traffic, and its terms for testing your own site apply (AWS and Cloudflare both allow it, with conditions).
- The runner needs more in its image (a recording proxy, possibly `nuclei` and `nmap`), and it should be its own container with network access limited to the scope proxy, so that a compromised tool cannot reach the rest of the home network.

## Architecture

```
Owner (SecurityX page)
  │ goal, approvals, kill switch
  ▼
Planner (language model) ──▶ intents (JSON, schema-checked)
  ▲                              │
  │ results, framed as data      ▼
  │                         Gate: scope · allowlist · budgets · approval
  │                              │ (rejects or holds; never the model's call)
  │                              ▼
Exploration graph ◀── Workers ──▶ Recording proxy ──▶ in-scope targets
(per run: what was tried,         (no shell; argv     (every request and
 what came back, why)              from templates)     response kept as evidence)
  │
  └─ anchors ─▶ Asset graph (hosts, services, endpoints, technologies; grows from the monitor's snapshots)
```

- **Planner.** Model-agnostic: Ollama on the server, or an OpenAI- or Anthropic-compatible endpoint. Its output is a JSON intent that must match a schema; anything else is discarded and counted against the turn budget. It sees tool output only inside a framed data block, and nothing in that block can change scope, budgets or approvals: those live in the gate, outside the model.
- **Gate.** Plain code with tests. It checks each intent against the scope, an allowlist of tools with argument templates (an argv prefix plus allowed flags and values, never a shell string), the run's budgets, and the approval policy. It rejects an intent or holds it for approval; it never rewrites one.
- **Workers.** Run one allowlisted tool per intent, with a time limit, through the recording proxy. First set: HTTP requests (built in), TLS and header checks, a small curated content-discovery list, a curated `nuclei` template set. `nmap` only for addresses confirmed under network level.
- **Recording proxy.** Keeps every request and response a worker makes. A finding must quote the exchange that proves it, and **Retest** replays that exchange.
- **Two graphs, one audit trail.** The asset graph says what exists. The exploration graph says, per run, what was tried, what came back and why the planner chose it. Anchors tie each step to the assets it touched. Both live in SQLite in the runner's `/data`, which BoxPilot backs up.

## Brakes and their defaults

| Brake | Default |
| --- | --- |
| Active testing | Off for every domain until the owner turns it on for that domain |
| Approval tiers | **Observe** (requests a normal visitor makes to known pages): automatic. **Probe** (discovery, fingerprinting, read-only templates): approval per intent, or per run if the owner allows. **Exploit** (payloads meant to change state, bypass sign-in or read what should be private): approval per intent, always |
| Never allowed | Denial of service or load testing, password guessing against real accounts, social engineering, keeping data beyond the evidence a finding needs |
| Noise governor | At most 2 requests per second per host and 2 000 per run, with automatic back-off on 429s, 5xx bursts or WAF blocks |
| Budgets | Run time (60 minutes), planner turns (40), model tokens; the run stops cleanly at any limit |
| Kill switch | Stops every worker and drops pending intents immediately, from the SecurityX page and from BoxPilot |
| Audit | Every intent, gate decision, approval, request and response is kept with the run, read-only |

## The model

Qwen3.5-9B on the server's CPU is a good fit for the explanations and summaries being built now. It is a weak planner: choosing and chaining tools over many turns is where small models fail most, and on a CPU each turn takes tens of seconds. The planner should work with any endpoint, so a stronger model (a GPU at home, or a hosted API) can drive it later. Sending evidence to a hosted model would be a separate, explicit opt-in, because responses can contain personal data.

## Milestones

Each milestone is useful on its own, ships behind a per-domain switch, and is tested against a scripted network and scripted tools (no real targets in tests).

| | Milestone | Uses a model? |
| --- | --- | --- |
| A1 | Runner container, scope service (verified domains, owner-confirmed addresses), recording proxy, audit log, kill switch. Manual one-off requests from the page | No |
| A2 | A curated probe catalogue (headers, TLS, exposed admin and debug paths, risky files, known-vulnerability templates) run by the gate with approvals and budgets | No |
| A3 | The planner loop: goal → intents → gate → workers → results, and the exploration graph | Yes |
| A4 | Evidence-backed findings, Retest, and the two graphs on the page | Optional |
| A5 | BoxPilot packaging: the runner's own container and network limits, approvals as BoxPilot notifications | No |

A2 alone covers most of what an attacker's first hour would find, without a model.

## Questions for the owner

1. Is it acceptable to reverse "Passive only" in this form (passive by default, active only in owner-started runs)? Or should active testing be a separate app, so SecurityX keeps its simple passive promise?
2. Which of your domains point at machines you control yourself (a VPS, the home server), as opposed to Cloudflare, Vercel or other shared hosts? Only the first kind can get network-level tests.
3. Where should approvals reach you: the SecurityX page only, or also BoxPilot notifications on your phone?
4. Which model should plan: Qwen on the server's CPU (slow and weaker), a local GPU, or a hosted API (faster and stronger, but data leaves the server)?
5. Are you comfortable with `nuclei` and `nmap` in the image?
