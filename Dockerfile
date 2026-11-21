# Porchlight for BoxPilot: the web interface with both scanners. Repositories to scan are mounted
# read-only at /repos, or fetched from GitHub into /data/github; the latest scan report lives in /data. The attack-surface monitor itself
# stays a Cloudflare Worker; this image only talks to it as a client.
#
# Pinned by digest, so a release is built from exactly the base image it was tested on. To move to a
# newer node:24-alpine, look up its index digest (`docker buildx imagetools inspect node:24-alpine`)
# and replace it here; CI's container smoke test checks the result.
FROM node:24-alpine@sha256:116b800c3754b440ee0aa3ed2f20f5bf3d99a554bfd9adeea09ea8017f6e85f5

# gitleaks reads history with git. The repositories are someone else's files mounted read-only,
# and git refuses to read a repository owned by another user unless told it is safe: only /repos
# and those under it are. '/repos/*' matches only folders below /repos, so /repos itself is named
# too: one repository mounted directly there, or a scan at depth 0 (BLD-B1). Porchlight's git
# ignores the system's and the user's git settings (a repository's own .git/config could otherwise
# name programs to run), so the exception is given
# through PORCHLIGHT_GIT_SAFE_DIRECTORY (see cli/src/repos/git-copy.ts). History is read from a copy
# Porchlight makes of each repository, which holds none of its settings. Repositories fetched from
# GitHub belong to this image's own user and need no exception.
# tini runs as PID 1, so `docker stop` reaches Porchlight as SIGTERM and a scan in progress removes
# its temporary copies before the container stops.
RUN apk add --no-cache git tini \
 && git config --system --add safe.directory /repos \
 && git config --system --add safe.directory '/repos/*'
ENV PORCHLIGHT_GIT_SAFE_DIRECTORY=/repos:/repos/*

# The scanners, pinned and checked against the checksums their releases publish. To update one,
# change its version and both of its checksums together.
ARG TARGETARCH
RUN set -eu; \
    gitleaks_version=8.30.1; \
    osv_version=2.7.1; \
    case "$TARGETARCH" in \
      amd64) gitleaks_arch=x64; \
             gitleaks_sha=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb; \
             osv_sha=fb7dab19a8bd9bbe5c3189f09d4b7ee1820c9553a23bac202648a56efd2f6ee8 ;; \
      arm64) gitleaks_arch=arm64; \
             gitleaks_sha=e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080; \
             osv_sha=983d22fbad9724514e3fcc6acc83b5fa64c5ffa6b0d9f510028f22c1b223ff81 ;; \
      *) echo "No scanner build for architecture '$TARGETARCH'" >&2; exit 1 ;; \
    esac; \
    cd /tmp; \
    wget -qO gitleaks.tar.gz "https://github.com/gitleaks/gitleaks/releases/download/v${gitleaks_version}/gitleaks_${gitleaks_version}_linux_${gitleaks_arch}.tar.gz"; \
    echo "${gitleaks_sha}  gitleaks.tar.gz" | sha256sum -c -; \
    tar -xzf gitleaks.tar.gz gitleaks; \
    install -m 0755 gitleaks /usr/local/bin/gitleaks; \
    wget -qO osv-scanner "https://github.com/google/osv-scanner/releases/download/v${osv_version}/osv-scanner_linux_${TARGETARCH}"; \
    echo "${osv_sha}  osv-scanner" | sha256sum -c -; \
    install -m 0755 osv-scanner /usr/local/bin/osv-scanner; \
    rm -f gitleaks.tar.gz gitleaks osv-scanner

# The CLI has no runtime dependencies and Node runs its TypeScript directly: nothing to install.
WORKDIR /app
COPY cli/package.json ./cli/package.json
COPY cli/bin ./cli/bin
COPY cli/src ./cli/src
COPY cli/ui ./cli/ui

RUN mkdir -p /data /repos && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 4747

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4747/healthz >/dev/null || exit 1

# Listening beyond loopback needs PORCHLIGHT_UI_KEY; without it the server refuses to start.
ENTRYPOINT ["/sbin/tini", "--"]
# A young generation of 1 MB keeps the server under 200 MB at 20,000 findings (R6O-1, scripts/measure-speed.ts).
CMD ["node", "--max-semi-space-size=1", "cli/bin/porchlight.js", "ui", "--host", "0.0.0.0", "--port", "4747", "--root", "/repos", "--report", "/data/repo-scan.json", "--data", "/data"]
