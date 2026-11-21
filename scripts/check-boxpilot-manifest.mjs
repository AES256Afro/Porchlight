// Checks boxpilot/porchlight.yaml: first against what this repository ships, then with BoxPilot's
// own validateManifest when a BoxPilot checkout is at BOXPILOT_DIR (default ../BoxPilot). Without one
// the schema check is skipped, unless BOXPILOT_REQUIRED=1 (as in CI), when that fails.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import YAML from "yaml";

const root = fileURLToPath(new URL("..", import.meta.url));
const manifestFile = path.join(root, "boxpilot/porchlight.yaml");
const boxpilot = path.resolve(root, process.env.BOXPILOT_DIR ?? "../BoxPilot");
const schemaFile = path.join(boxpilot, "server/catalog/schema.mjs");

const raw = YAML.parse(readFileSync(manifestFile, "utf8"));
const read = (file) => readFileSync(path.join(root, file), "utf8");

// Checks that need no BoxPilot checkout: the manifest agrees with what the image does.
const version = JSON.parse(read("cli/package.json")).version;
const dockerfile = read("Dockerfile");
const cmd = JSON.parse(/^CMD (\[.*\])$/m.exec(dockerfile)?.[1] ?? "[]");
const flag = (name) => cmd[cmd.indexOf(name) + 1];
const volume = (id) => raw.volumes?.find((entry) => entry.id === id);
const web = raw.ports?.find((entry) => entry.id === "web");
const key = raw.env?.find((entry) => entry.name === "SECURITYX_UI_KEY");

const local = [];
if (raw.image?.version !== version) local.push(`image.version is ${raw.image?.version}, cli/package.json is ${version}`);
if (!String(raw.image?.reference ?? "").startsWith(`ghcr.io/aes256afro/securityx:${version}`)) local.push(`image.reference does not carry version ${version}`);
if (String(web?.container) !== flag("--port")) local.push(`port web is ${web?.container}, the image listens on ${flag("--port")}`);
if (!dockerfile.includes(`http://127.0.0.1:${web?.container}/healthz`)) local.push(`the image's HEALTHCHECK does not probe port ${web?.container}`);
if (volume("repos")?.container !== flag("--root")) local.push(`volume repos is mounted at ${volume("repos")?.container}, the image scans ${flag("--root")}`);
if (volume("repos")?.readOnly !== true) local.push("volume repos must be read-only");
if (!flag("--report")?.startsWith(`${volume("data")?.container}/`)) local.push(`the report ${flag("--report")} is not inside volume data (${volume("data")?.container})`);
if (key?.type !== "password" || key?.secret !== true || key?.generate !== true) local.push("SECURITYX_UI_KEY must be a generated secret password");
// The monitor's admin token and a hosted model's key are the owner's: secret, never generated, empty by default.
for (const name of ["SECURITYX_ADMIN_TOKEN", "SECURITYX_LLM_API_KEY"]) {
	const entry = raw.env?.find((candidate) => candidate.name === name);
	if (!entry) local.push(`${name} is missing: the app reads it under this name`);
	else if (entry.type !== "password" || entry.secret !== true || entry.generate === true || entry.default !== "") local.push(`${name} must be a secret password the owner supplies, empty by default`);
}
const githubToken = raw.env?.find((entry) => entry.name === "SECURITYX_GITHUB_TOKEN");
if (githubToken && (githubToken.type !== "password" || githubToken.secret !== true || githubToken.generate === true)) local.push("SECURITYX_GITHUB_TOKEN must be a secret password the owner supplies");
// The app reads the Cloudflare token under this name (cli/src/main.ts), and the pages tell the owner where to paste it.
const cloudflareToken = raw.env?.find((entry) => entry.name === "PORCHLIGHT_CLOUDFLARE_TOKEN");
if (!cloudflareToken) local.push("PORCHLIGHT_CLOUDFLARE_TOKEN is missing: the Cloudflare page tells a service to set it in Apps → Porchlight → Settings");
else if (cloudflareToken.type !== "password" || cloudflareToken.secret !== true || cloudflareToken.generate === true || cloudflareToken.default !== "") local.push("PORCHLIGHT_CLOUDFLARE_TOKEN must be a secret password the owner supplies, empty by default");
if (raw.defaultExposure !== "tailnet") local.push("defaultExposure must stay tailnet: a report names where secrets were found");
// The app reads these two under these names and refuses to start on a value out of range (cli/src/main.ts).
const depth = raw.env?.find((entry) => entry.name === "PORCHLIGHT_SCAN_DEPTH");
if (!depth || !(depth.options ?? []).every((option) => /^[0-6]$/.test(option)) || !/^[0-6]$/.test(String(depth.default))) local.push("PORCHLIGHT_SCAN_DEPTH must offer whole numbers from 0 to 6, with one of them as its default");
const every = raw.env?.find((entry) => entry.name === "PORCHLIGHT_SCAN_EVERY_HOURS");
const hours = (every?.options ?? []).map((option) => (typeof option === "string" ? option : option.value));
if (!every || every.default !== "" || !hours.every((value) => value === "" || (/^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 720))) local.push("PORCHLIGHT_SCAN_EVERY_HOURS must be empty by default and offer hours from 1 to 720");
// A Slack or Discord webhook address is a credential: anyone holding it can post as the owner's app.
const notifyUrl = raw.env?.find((entry) => entry.name === "PORCHLIGHT_NOTIFY_URL");
if (notifyUrl && (notifyUrl.type !== "password" || notifyUrl.secret !== true || notifyUrl.generate === true || notifyUrl.default !== "")) local.push("PORCHLIGHT_NOTIFY_URL must be a secret the owner supplies, empty by default");
// BoxPilot's catalog file is catalog/securityx.yaml, and a manifest's id must match its file name.
// Servers have Porchlight installed under this id, so it stays.
if (raw.id !== "securityx") local.push(`id is ${raw.id}: BoxPilot's catalog lists Porchlight as securityx`);

if (local.length) {
	console.error(`boxpilot/porchlight.yaml:\n- ${local.join("\n- ")}`);
	process.exit(1);
}

if (!existsSync(schemaFile)) {
	// CI sets BOXPILOT_REQUIRED=1: there a missing schema fails, so invariant 9's check never goes green without running.
	if (process.env.BOXPILOT_REQUIRED === "1") {
		console.error(`BoxPilot manifest: local checks pass, but BoxPilot's schema is required (BOXPILOT_REQUIRED=1) and there is no BoxPilot checkout at ${boxpilot}.`);
		process.exit(1);
	}
	console.log(`BoxPilot manifest: local checks pass. Skipped the schema check: no BoxPilot checkout at ${boxpilot} (set BOXPILOT_DIR).`);
	process.exit(0);
}

const { validateManifest } = await import(pathToFileURL(schemaFile).href);
const { errors } = validateManifest(raw);
if (errors.length) {
	console.error(`boxpilot/porchlight.yaml fails BoxPilot's schema:\n- ${errors.join("\n- ")}`);
	process.exit(1);
}
console.log(`BoxPilot manifest: valid against ${path.relative(root, schemaFile)}.`);
