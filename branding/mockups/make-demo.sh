#!/bin/sh
# Made-up repositories for brand mockups. Nothing here belongs to the owner.
set -e
D="$1"; rm -rf "$D"; mkdir -p "$D/projects" "$D/data"
export GIT_AUTHOR_NAME=Demo GIT_AUTHOR_EMAIL=demo@example.com GIT_COMMITTER_NAME=Demo GIT_COMMITTER_EMAIL=demo@example.com
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
rnd() { LC_ALL=C tr -dc "$1" </dev/urandom | head -c "$2"; }
repo() { mkdir -p "$D/projects/$1"; cd "$D/projects/$1"; git init -q -b main; }
commit() { git add -A; git commit -q -m "$1"; }

repo storefront
cat > package.json <<J
{ "name": "storefront", "version": "1.4.0", "private": true,
  "dependencies": { "lodash": "4.17.15", "minimist": "1.2.0", "axios": "0.21.0" } }
J
cat > package-lock.json <<J
{ "name": "storefront", "version": "1.4.0", "lockfileVersion": 3, "requires": true,
  "packages": {
    "": { "name": "storefront", "version": "1.4.0", "dependencies": { "lodash": "4.17.15", "minimist": "1.2.0", "axios": "0.21.0" } },
    "node_modules/lodash": { "version": "4.17.15", "resolved": "https://registry.npmjs.org/lodash/-/lodash-4.17.15.tgz" },
    "node_modules/minimist": { "version": "1.2.0", "resolved": "https://registry.npmjs.org/minimist/-/minimist-1.2.0.tgz" },
    "node_modules/axios": { "version": "0.21.0", "resolved": "https://registry.npmjs.org/axios/-/axios-0.21.0.tgz" }
  } }
J
mkdir -p src config; echo 'export const cart = [];' > src/cart.js
commit "Start the shop"
printf 'module.exports = {\n  region: "us-east-1",\n  accessKeyId: "%s",\n  secretAccessKey: "%s",\n};\n' "AKIA$(rnd 'A-Z2-7' 16)" "$(rnd 'A-Za-z0-9' 40)" > config/deploy.js
commit "Deploy settings"

repo billing-api
printf 'flask==0.12.2\nrequests==2.19.1\npyyaml==5.3\n' > requirements.txt
echo 'from flask import Flask' > app.py
commit "Billing service"
printf 'DATABASE_URL=postgres://billing@localhost/billing\nGITHUB_TOKEN=ghp_%s\n' "$(rnd 'A-Za-z0-9' 36)" > .env
commit "Local settings"

repo marketing-site
printf '# Marketing site\n' > README.md; printf '<!doctype html><title>Hello</title>\n' > index.html
commit "First page"

repo infra
# The key's armour is assembled here so this file holds nothing credential-shaped.
kind="OPENSSH PRIVATE"; dash="-----"
mkdir -p keys; printf -- '%sBEGIN %s KEY%s\n%s\n%s\n%sEND %s KEY%s\n' "$dash" "$kind" "$dash" "$(rnd 'A-Za-z0-9' 70)" "$(rnd 'A-Za-z0-9' 70)" "$dash" "$kind" "$dash" > keys/deploy_ed25519
printf 'terraform {}\n' > main.tf
commit "Servers"
