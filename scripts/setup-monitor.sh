#!/bin/sh
# Sets up the Porchlight monitor on your Cloudflare account in one run (US-5): installs the monitor's
# tools, signs in to Cloudflare, makes the database, prepares it, makes the admin token, deploys, and
# prints the monitor's address and token to paste under Settings → Monitor.
#
# It needs Node.js and npm. It writes only inside monitor/, into two files git ignores:
#   monitor/.secrets.database-id   the database's ID
#   monitor/.secrets.production    the admin token (and ALERT_WEBHOOK_URL, if you add one)
# Running it again reuses both, so it is also how to deploy again.
set -eu

here=$(cd "$(dirname "$0")/.." && pwd)
cd "$here/monitor"
umask 077

say() { printf '%s\n' "$*"; }
stop() { printf 'setup-monitor: %s\n' "$*" >&2; exit 1; }

command -v node >/dev/null 2>&1 || stop "Node.js is needed. Install it (brew install node), then run this again."
command -v npm >/dev/null 2>&1 || stop "npm is needed. It comes with Node.js."

say "1/6  Installing the monitor's tools in monitor/"
if [ ! -d node_modules ]; then npm install --no-fund --no-audit; else say "     Already installed."; fi

say "2/6  Signing in to Cloudflare (a browser window opens the first time)"
npx cf auth whoami >/dev/null 2>&1 || npx cf auth login

say "3/6  The monitor's database"
id_file=.secrets.database-id
uuid='[0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}'
if [ -s "$id_file" ]; then
	id=$(cat "$id_file")
	say "     Using the one made before: $id"
else
	out=$(npx cf d1 create --name porchlight-monitor 2>&1) || { printf '%s\n' "$out" >&2; stop "The database could not be made. If one named porchlight-monitor exists, put its ID in monitor/$id_file and run this again."; }
	id=$(printf '%s\n' "$out" | grep -o "$uuid" | head -n 1)
	[ -n "$id" ] || { printf '%s\n' "$out" >&2; stop "Cloudflare did not print a database ID."; }
	printf '%s\n' "$id" > "$id_file"
	say "     Made: $id (kept in monitor/$id_file)"
fi

# The deploy addresses the database by the ID in cloudflare.config.ts. One that reads
# PORCHLIGHT_D1_DATABASE_ID takes this ID from here; another must already name it.
if ! grep -q PORCHLIGHT_D1_DATABASE_ID cloudflare.config.ts && ! grep -q "$id" cloudflare.config.ts; then
	stop "monitor/cloudflare.config.ts names another database. Put $id as the value of D1_DATABASE_ID there, then run this again."
fi

say "4/6  Preparing the database"
npx cf d1 migrations apply "$id"

say "5/6  The admin token"
secrets=.secrets.production
if [ -s "$secrets" ] && grep -q '^ADMIN_TOKEN=.' "$secrets"; then
	say "     Using the one in monitor/$secrets."
else
	command -v openssl >/dev/null 2>&1 || stop "openssl is needed to make the token."
	printf 'ADMIN_TOKEN=%s\n' "$(openssl rand -hex 32)" >> "$secrets"
	say "     Made, in monitor/$secrets."
fi
grep -q '^ALERT_WEBHOOK_URL=.' "$secrets" || say "     Alerts go only to the Worker's log. To be sent them, add a line ALERT_WEBHOOK_URL= with a Slack or Discord webhook or an ntfy topic to monitor/$secrets, and run this again."

say "6/6  Deploying"
out=$(PORCHLIGHT_D1_DATABASE_ID="$id" npx cf deploy --secrets-file "$secrets" 2>&1) || { printf '%s\n' "$out" >&2; stop "The deploy failed; the lines above say why."; }
printf '%s\n' "$out"
address=$(printf '%s\n' "$out" | grep -o 'https://[A-Za-z0-9.-]*\.workers\.dev' | head -n 1)

say ""
say "The monitor is deployed. In Porchlight, open Settings → Monitor and paste:"
say "  Address: ${address:-the https address printed above}"
say "  Admin token: $(sed -n 's/^ADMIN_TOKEN=//p' "$secrets")"
say "The token is the only secret here: anyone who has it can change which domains your monitor watches."
