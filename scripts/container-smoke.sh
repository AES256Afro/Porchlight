#!/bin/sh
# Checks a built SecurityX image the way BoxPilot runs it: usage: sh scripts/container-smoke.sh <image>
#  1. Without SECURITYX_UI_KEY it refuses to start, because it listens beyond loopback.
#  2. With a key it answers /healthz, refuses the API without the key and serves it with the key.
#  3. The real scanners, run as the image's user against a read-only repository owned by someone
#     else, find a secret in history and never print it.
set -eu

image="${1:?usage: container-smoke.sh <image>}"
work="$(mktemp -d)"
name="securityx-smoke-$$"
cleanup() {
	docker rm -f "$name" >/dev/null 2>&1 || true
	rm -rf "$work"
}
trap cleanup EXIT
fail() {
	echo "container-smoke: $*" >&2
	exit 1
}

echo "1. no key, no start"
if docker run --rm "$image" >"$work/nokey.log" 2>&1; then fail "started without SECURITYX_UI_KEY"; fi
grep -q SECURITYX_UI_KEY "$work/nokey.log" || fail "refused without naming SECURITYX_UI_KEY: $(cat "$work/nokey.log")"

echo "2. health and the key"
key="$(head -c 24 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=\n')"
docker run -d --name "$name" -p 127.0.0.1:4747:4747 -e SECURITYX_UI_KEY="$key" "$image" >/dev/null
for _ in $(seq 1 30); do
	curl -fsS http://127.0.0.1:4747/healthz >/dev/null 2>&1 && break
	sleep 1
done
curl -fsS http://127.0.0.1:4747/healthz >/dev/null || { docker logs "$name"; fail "/healthz did not answer"; }
status="$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4747/api/state)"
[ "$status" = 401 ] || fail "/api/state without the key answered $status, expected 401"
# Any address people use reaches it (a Tailscale name, a LAN address); the key is what guards it.
status="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: box.example.ts.net' -H "x-securityx-session: $key" http://127.0.0.1:4747/api/state)"
[ "$status" = 200 ] || fail "/api/state with the key answered $status, expected 200"
docker logs "$name" 2>&1 | grep -qF "$key" && fail "the key appears in the container log"
docker rm -f "$name" >/dev/null

echo "3. real scan of a read-only repository owned by another user"
# Assembled here so this repository holds no credential-shaped string (see cli/test/helpers.ts).
secret="$(printf '%s%s%s' AKIA Q3EGTZNX PL7VWK4D)"
mkdir -p "$work/repos/service"
cd "$work/repos/service"
git init -q
git config user.email smoke@example.invalid
git config user.name smoke
printf 'aws_access_key_id = %s\n' "$secret" >config.ini
# lodash 4.17.20 has a published advisory, so osv-scanner must reach api.osv.dev and report it.
printf '{"name":"demo","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{"":{"name":"demo","version":"1.0.0","dependencies":{"lodash":"4.17.20"}},"node_modules/lodash":{"version":"4.17.20","resolved":"https://registry.npmjs.org/lodash/-/lodash-4.17.20.tgz"}}}\n' >package-lock.json
git add -A
git commit -q -m initial
git rm -q config.ini
git commit -q -m "remove config"
cd - >/dev/null
chmod -R a+rX "$work/repos"

code=0
docker run --rm -v "$work/repos:/repos:ro" "$image" \
	node cli/bin/securityx.js repos scan /repos --json --fail-on high >"$work/report.json" 2>"$work/scan.err" || code=$?
[ "$code" = 2 ] || fail "scan exited $code, expected 2 (a high finding): $(cat "$work/scan.err")"
grep -qF "$secret" "$work/report.json" "$work/scan.err" && fail "the secret value appears in the scan output"
node -e '
const report = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const problems = [];
for (const tool of report.tools) if (tool.status !== "ok") problems.push(`${tool.tool} is ${tool.status}`);
for (const repo of report.repos) for (const error of repo.errors) problems.push(`${error.tool} failed on ${repo.path}: ${error.message}`);
const found = report.repos.flatMap((repo) => repo.findings).some((finding) => finding.tool === "gitleaks" && finding.ruleId === "aws-access-token");
if (!found) problems.push("gitleaks did not report the aws-access-token in history");
const advisory = report.repos.flatMap((repo) => repo.findings).some((finding) => finding.tool === "osv-scanner" && finding.detail.includes("lodash"));
if (!advisory) problems.push("osv-scanner did not report the lodash 4.17.20 advisory");
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
' "$work/report.json" || fail "unexpected report: $(head -c 2000 "$work/report.json")"

echo "container-smoke: all checks passed"
