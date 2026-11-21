# Releasing Porchlight

A release is a signed version tag. CI builds, checks and publishes the container image and the Mac app's DMG from it, attests both, and drafts the GitHub release with the DMG and `SHA256SUMS`; the owner signs the tag, checks the draft, writes its notes and publishes it. The monitor is deployed by hand. Do the steps in this order.

## Once: what the repository needs

- **Private vulnerability reporting** (SECURITY.md sends reports there): Settings → Advanced Security (Code security on older settings pages) → Private vulnerability reporting → Enable. Check that the Security tab then offers "Report a vulnerability".
- **A tag-signing key**, SSH or GPG, added to your GitHub account as a *signing* key (Settings → SSH and GPG keys), and git told to sign tags with it:
  - SSH: `git config --global gpg.format ssh`, `git config --global user.signingkey ~/.ssh/<key>.pub`, `git config --global tag.gpgSign true`.
  - GPG: `git config --global user.signingkey <key id>`, `git config --global tag.gpgSign true`.
  - To check signed tags locally with SSH, list the allowed keys: `git config --global gpg.ssh.allowedSignersFile ~/.ssh/allowed_signers`, with a line `<your email> <the public key>` in that file.
- **Optional: a tag ruleset** (Settings → Rules → Rulesets → New tag ruleset, targeting `v*`): restrict creations, updates and deletions to yourself, so nobody else can push a release tag, and block force-pushes.
- **Runners:** the container job runs on `ubuntu-24.04-arm` for the arm64 smoke test, and the DMG on `macos-15`. Both are standard GitHub-hosted runners for a public repository; a private one needs a plan that includes them.
- **Attestations** need nothing to be switched on for a public repository. A private repository needs GitHub Enterprise Cloud for them.
- **BoxPilot's schema:** CI checks out `AES256Afro/BoxPilot` at a pinned release and fails if it cannot (`BOXPILOT_REQUIRED=1`). If that repository is ever made private, give the checkout a read-only token, or CI stops.

## Before the tag

1. `npm run check` and `npm test` pass on `main`.
2. Set the new version in three places, which `npm run check` compares:
   - `cli/package.json` and its lockfile: `npm version <version> --no-git-tag-version` in `cli/`
   - `boxpilot/porchlight.yaml`: `image.version`
   - `boxpilot/porchlight.yaml`: `image.reference`, as `ghcr.io/aes256afro/securityx:<version>` with no digest yet
3. Commit that as "Release <version>: …".

## The tag

4. Make a signed, annotated tag and check its signature before pushing it:

   ```bash
   git tag -s v<version> -m "Porchlight <version>"
   git tag -v v<version>
   git push origin v<version>
   ```

   CI does not sign anything with your key and cannot tell a signed tag from an unsigned one, so this step is yours. GitHub shows the tag as "Verified" once the key is on your account.

## What CI does with the tag

5. CI stops if the tag does not match `cli/package.json`. Otherwise it runs, side by side:
   - the checks (BoxPilot's schema included, never skipped) and the tests, with the real scanners;
   - the container smoke test (`scripts/container-smoke.sh`) once for each platform it publishes, amd64 and arm64, each on a runner of that platform.

   Then, if all pass:
   - **publish** pushes the image for amd64 and arm64 with buildx's SBOM and provenance, as `ghcr.io/aes256afro/porchlight:<version>` and under the earlier path `ghcr.io/aes256afro/securityx:<version>`, which BoxPilot's catalog pins, and pushes a GitHub artifact attestation beside each name;
   - **dmg** builds `Porchlight-<version>-arm64.dmg` on an Apple silicon runner with `sh mac/build.sh --dmg`, from the tag, with nodejs.org's Node 24 and the scanners' release builds at the image's pinned versions, each checked against its published checksum. `scripts/check-dmg.sh` searches the mounted DMG for the runner's paths and names, and the DMG is attested;
   - **release** writes `SHA256SUMS`, checks the DMG's attestation with `gh attestation verify` the way the README's "Verify a download" tells a reader to, and drafts the GitHub release for the tag with the DMG and `SHA256SUMS` attached (or adds them to a release for the tag that already exists).
6. The publish job prints the image's digest in its run summary, and the draft's notes repeat it. Add it to `image.reference` in `boxpilot/porchlight.yaml` (`…:<version>@sha256:…`) and commit that as "Pin the BoxPilot manifest to the <version> image".
7. Copy the manifest to BoxPilot's `catalog/securityx.yaml` in a BoxPilot pull request. Servers offer the update once a BoxPilot release includes it.

`boxpilot/porchlight.yaml` is the source of truth for BoxPilot's copy. `npm run check` validates it with BoxPilot's own schema when a BoxPilot checkout is at `../BoxPilot` or `BOXPILOT_DIR`; CI checks it against a pinned BoxPilot release and fails without one (`BOXPILOT_REQUIRED=1`).

A package published for the first time starts private on GitHub. Make it public, or no BoxPilot server can pull it.

## The draft release

8. Download the DMG and `SHA256SUMS` from the draft and check them as the README's "Verify a download" says (`shasum -a 256 -c SHA256SUMS`, then `gh attestation verify … --source-ref refs/tags/v<version>`).
9. Search the DMG once more for your own names, which the runner does not know: `sh scripts/check-dmg.sh Porchlight-<version>-arm64.dmg "<your name>" "<your tailnet name>" "<your monitor's host>"`, or the same names one per line in `PORCHLIGHT_DMG_FORBID`. It mounts the DMG read-only, searches every file's contents and name, checks the programs' library search folders, and fails on anything it finds. Do not publish a DMG it fails on.
10. Write the notes (below) and publish the draft.

## A DMG built by hand

CI builds the DMG that is published. To build one on your own Mac, to test it:

- `sh mac/build.sh --dmg` builds `mac/build/Porchlight-<version>-arm64.dmg` from the last commit, never from uncommitted changes, with its own copies of the `node`, gitleaks and osv-scanner on PATH and their licences. It checks that each bundled program links only to macOS's own libraries, and runs `scripts/check-dmg.sh` on the folder it packs, before the DMG is made, for this Mac's home folder, user and host names (and anything in `PORCHLIGHT_DMG_FORBID`).
- A DMG built by hand has no attestation, so do not attach one to a release in place of CI's.

## The monitor

The monitor is not part of the image: each owner deploys their own. When a release changes `monitor/`:

11. Apply the migrations before deploying, since a new version can add columns the Worker reads: `npx cf d1 migrations apply <DATABASE_ID>` in `monitor/`.
12. `npx cf deploy --secrets-file .secrets.production`.

Say in the release notes when a release needs this, so anyone running their own monitor does it too.

## Release notes

Say what changed for someone using Porchlight, not what changed in the code. Name anything the owner has to do: a migration to apply, a setting that moved, a token that needs a new permission. Keep the image digest and the SHA-256 lines from the draft.
