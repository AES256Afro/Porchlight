#!/bin/sh
# Checks a built Porchlight image the way BoxPilot runs it: usage: sh scripts/container-smoke.sh <image>
#  1. Without a key it refuses to start, because it listens beyond loopback, and names PORCHLIGHT_UI_KEY.
#     BoxPilot passes the key under its installed name, SECURITYX_UI_KEY, which the app also reads.
#  2. With a key it answers /healthz, refuses the API without the key and serves it with the key.
#  3. The real scanners, run as the image's user against a read-only repository owned by someone
#     else, find a secret in history and never print it.
#  4. A hostile repository can neither run a program from its .git/config nor switch gitleaks'
#     rules off with its own .gitleaks.toml. One of its programs is named by a submodule's own
#     config (diff.external, reached through diff.submodule=diff), which a plain `git log -p` in
#     the image does run: the step checks that first, so the check itself can fail (B59).
#  5. One repository mounted directly at /repos, not in a folder below it, is scanned like any
#     other: /repos itself is a safe directory (BLD-B1).
# The image's platform is the Docker host's unless DOCKER_DEFAULT_PLATFORM says otherwise; CI runs
# this once for each platform it publishes (BLD-B2).
set -eu

image="${1:?usage: container-smoke.sh <image>}"
work="$(mktemp -d)"
name="porchlight-smoke-$$"
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
if docker run --rm "$image" >"$work/nokey.log" 2>&1; then fail "started without a key"; fi
grep -q PORCHLIGHT_UI_KEY "$work/nokey.log" || fail "refused without naming PORCHLIGHT_UI_KEY: $(cat "$work/nokey.log")"

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
status="$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: box.example.ts.net' -H "x-porchlight-session: $key" http://127.0.0.1:4747/api/state)"
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
	node cli/bin/porchlight.js repos scan /repos --json --fail-on high >"$work/report.json" 2>"$work/scan.err" || code=$?
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

echo "4. a hostile repository runs nothing and turns no rule off"
mkdir -p "$work/hostile/repo"
cd "$work/hostile/repo"
git init -q
git config user.email smoke@example.invalid
git config user.name smoke
printf 'aws_access_key_id = %s\n' "$secret" >config.txt
printf '*.txt diff=hostile\n' >.gitattributes
printf '[extend]\nuseDefault = false\n\n[[rules]]\nid = "nothing"\nregex = "zq{40}"\n' >.gitleaks.toml
git add -A
git commit -q -m one
# Set after committing, so the smoke test's own git never runs it.
git config diff.hostile.textconv "sh -c 'touch /tmp/hostile-ran; cat \"\$0\"'"
printf 'changed\n' >config.txt
git commit -q -am two
cd - >/dev/null

# A submodule whose own config names an external diff program. `git log -p` never runs the outer
# repository's diff.external without --ext-diff, but with diff.submodule=diff it shows the
# submodule's changes through a git started in the submodule, which reads the submodule's config
# and runs its diff.external (cli/test/hostile-history.test.ts, S9 (a)).
mkdir -p "$work/outside/sub" "$work/hostile/withsub"
cd "$work/outside/sub"
git init -q
git config user.email smoke@example.invalid
git config user.name smoke
printf 'one\n' >lib.txt
git add -A
git commit -q -m one
cd "$work/hostile/withsub"
git init -q
git config user.email smoke@example.invalid
git config user.name smoke
printf 'aws_access_key_id = %s\n' "$secret" >app.env
git -c protocol.file.allow=always submodule add -q "$work/outside/sub" sub
git add -A
git commit -q -m one
cd "$work/outside/sub"
printf 'two\n' >lib.txt
git commit -q -am two
cd "$work/hostile/withsub/sub"
git -c protocol.file.allow=always pull -q
cd "$work/hostile/withsub"
git commit -q -am "move the submodule"
# Set last, so none of the smoke test's own git commands runs it.
git config diff.submodule diff
git -C .git/modules/sub config diff.external "sh -c 'touch /tmp/hostile-ran'"
cd - >/dev/null
chmod -R a+rX "$work/hostile"

# The control: git in the image, honouring the repository's config as git does by default, runs the
# submodule's program. If it does not, the scan below proves nothing, so the smoke test stops here.
docker run --rm -v "$work/hostile:/repos:ro" "$image" sh -c \
	'cd /repos/withsub && git log -p >/dev/null 2>&1; if [ -e /tmp/hostile-ran ]; then echo RAN; fi' \
	>"$work/control.txt" 2>&1 || true
grep -qx RAN "$work/control.txt" ||
	fail "control: a plain git log -p in the image did not run the submodule's diff.external, so the check below could not fail: $(cat "$work/control.txt")"

docker run --rm -v "$work/hostile:/repos:ro" "$image" sh -c \
	'node cli/bin/porchlight.js repos scan /repos --json >/tmp/report.json 2>/dev/null; if [ -e /tmp/hostile-ran ]; then echo RAN; else cat /tmp/report.json; fi' \
	>"$work/hostile.json"
grep -qx RAN "$work/hostile.json" && fail "a program from a repository's or a submodule's git config ran during the scan"
node -e '
const report = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const byName = (name) => report.repos.find((repo) => repo.path.split("/").at(-1) === name);
const problems = [];
for (const name of ["repo", "withsub"]) {
	const repo = byName(name);
	if (!repo) { problems.push(`${name} was not scanned`); continue; }
	if (repo.errors.some((error) => error.tool === "gitleaks")) problems.push(`gitleaks failed on ${name}: ${JSON.stringify(repo.errors)}`);
	if (!repo.findings.some((finding) => finding.ruleId === "aws-access-token")) problems.push(`gitleaks did not report the key in ${name}`);
}
const repo = byName("repo");
if (repo && !(repo.settingFiles ?? []).includes(".gitleaks.toml")) problems.push("the report does not name the repository'"'"'s .gitleaks.toml");
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
' "$work/hostile.json" || fail "unexpected hostile-repository report: $(head -c 2000 "$work/hostile.json")"

echo "5. one repository mounted directly at /repos"
# The step-3 repository, mounted as /repos itself, at the default depth and at depth 0 (BoxPilot offers both).
for depth in 3 0; do
	code=0
	docker run --rm -v "$work/repos/service:/repos:ro" "$image" \
		node cli/bin/porchlight.js repos scan /repos --depth "$depth" --json >"$work/single.json" 2>"$work/single.err" || code=$?
	[ "$code" = 0 ] || [ "$code" = 2 ] || fail "depth $depth: scan exited $code: $(cat "$work/single.err")"
	node -e '
const report = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
const problems = [];
if (report.repos.length !== 1) problems.push(`found ${report.repos.length} repositories, expected the one at /repos`);
for (const repo of report.repos) for (const error of repo.errors) problems.push(`${error.tool} failed on ${repo.path}: ${error.message}`);
if (!report.repos.flatMap((repo) => repo.findings).some((finding) => finding.ruleId === "aws-access-token")) problems.push("gitleaks did not report the key in history");
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }
' "$work/single.json" || fail "depth $depth: unexpected report for a repository at /repos: $(head -c 2000 "$work/single.json")"
done

echo "container-smoke: all checks passed"
