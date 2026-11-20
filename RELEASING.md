# Releasing Porchlight

A release is a version tag. CI builds and publishes the container image from it; the Mac app and the monitor are built and deployed by hand. Do the steps in this order.

## Before the tag

1. `npm run check` and `npm test` pass on `main`.
2. Set the new version in three places, which `npm run check` compares:
   - `cli/package.json` and its lockfile: `npm version <version> --no-git-tag-version` in `cli/`
   - `boxpilot/porchlight.yaml`: `image.version`
   - `boxpilot/porchlight.yaml`: `image.reference`, as `ghcr.io/aes256afro/securityx:<version>` with no digest yet
3. Commit that as "Release <version>: …".

## The tag and the image

4. Push a tag `v<version>`. CI stops if the tag does not match `cli/package.json`. Otherwise it runs the checks, the tests and the container smoke test (`scripts/container-smoke.sh`) side by side, then publishes the image for amd64 and arm64 with an SBOM and build provenance, as `ghcr.io/aes256afro/porchlight:<version>` and under the earlier path `ghcr.io/aes256afro/securityx:<version>`, which BoxPilot's catalog pins.
5. The publish job prints the image's digest in its run summary. Add it to `image.reference` in `boxpilot/porchlight.yaml` (`…:<version>@sha256:…`) and commit that as "Pin the BoxPilot manifest to the <version> image".
6. Copy the manifest to BoxPilot's `catalog/securityx.yaml` in a BoxPilot pull request. Servers offer the update once a BoxPilot release includes it.

`boxpilot/porchlight.yaml` is the source of truth for BoxPilot's copy. `npm run check` validates it with BoxPilot's own schema when a BoxPilot checkout is at `../BoxPilot` or `BOXPILOT_DIR`; CI checks it against a pinned BoxPilot release.

A package published for the first time starts private on GitHub. Make it public, or no BoxPilot server can pull it.

## The Mac app

7. `sh mac/build.sh --dmg` builds `mac/build/Porchlight-<version>-arm64.dmg` from the last commit, never from uncommitted changes, with its own copies of `node`, gitleaks and osv-scanner and their licences. The script checks that each bundled program links only to macOS's own libraries.
8. Mount the DMG and search it for anything of the machine that built it: your home folder's path, your name, host names, a token, a monitor address. It must hold none.
9. Attach the DMG to the GitHub release for the tag, with its SHA-256 in the release notes.

## The monitor

The monitor is not part of the image: each owner deploys their own. When a release changes `monitor/`:

10. Apply the migrations before deploying, since a new version can add columns the Worker reads: `npx cf d1 migrations apply <DATABASE_ID>` in `monitor/`.
11. `npx cf deploy --secrets-file .secrets.production`.

Say in the release notes when a release needs this, so anyone running their own monitor does it too.

## Release notes

Say what changed for someone using Porchlight, not what changed in the code. Name anything the owner has to do: a migration to apply, a setting that moved, a token that needs a new permission.
