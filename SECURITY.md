# Security policy

## Reporting a vulnerability

Report a vulnerability privately, not in a public issue, pull request or discussion.

Use GitHub's private vulnerability reporting: on the repository's **Security** tab, choose **Report a vulnerability** ([direct link](https://github.com/AES256Afro/Porchlight/security/advisories/new)). The report is visible only to the maintainer, and a fix and an advisory can be prepared in private from it.

Please include:

- the version (`node cli/bin/porchlight.js --version`, the DMG's name, or the image tag) and how Porchlight was run: command line, web interface, Mac app, container, or the monitor Worker;
- the steps that show the problem, with made-up data;
- what an attacker gains, and what they need first (a repository the owner scans, a page open in the owner's browser, a device on the tailnet, the monitor's address).

Do not include real credentials, tokens or private data, yours or anyone else's. If a report needs a secret-shaped value, describe it or use an obviously fake one.

## What to expect

- An acknowledgement within 7 days.
- An assessment, and whether it will be fixed, within 30 days.
- A fixed release, with a GitHub security advisory that credits the reporter unless they ask not to be named.

Please give the fix time to ship before publishing details. Porchlight is maintained by one person, so these are aims, not guarantees.

## Scope

In scope: the CLI and web interface (`cli/`), the Mac app (`mac/`), the container image and its BoxPilot manifest (`Dockerfile`, `boxpilot/`), the monitor Worker (`monitor/`), and the release process (`.github/`, `scripts/`). The invariants in `CLAUDE.md` describe what Porchlight promises, so a way to break one of them is a vulnerability: for example a request about a domain before its ownership is proven, a secret's value in a report or export, a scanned repository running code or switching a rule off, or the web interface answering another site.

Out of scope: findings in a dependency that Porchlight does not use in an affected way; the public demo at porchlight.theengineers.xyz holding made-up data, unless it serves something other than that data or accepts a change; and attacks that need the owner's own computer account already.

## Supported versions

Only the latest release is supported. Fixes are not backported.

## Verifying what you run

Each release's DMG and container image can be checked against `SHA256SUMS` and GitHub's artifact attestations: see "Verify a download" in the README.
