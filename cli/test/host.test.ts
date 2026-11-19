import assert from "node:assert/strict";
import { chmod } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { checkHost, notCovered, sortChecks } from "../src/host/check.ts";
import { credentialChecks, exposed, keyEncrypted } from "../src/host/credentials.ts";
import {
	automaticLogin,
	automaticUpdates,
	firewall,
	parseDefaults,
	parseFileVault,
	parseFirewall,
	parseGatekeeper,
	parseScreenLock,
	parseSip,
	parseSoftwareUpdate,
	parseStealth,
	parseSwVers,
	screenLock,
	softwareUpdates,
} from "../src/host/macos.ts";
import { addressScope, classifyListeners, isSystemProgram, parseNetstat, parseProcesses } from "../src/host/network.ts";
import { flattenNpm, npmLockfile, packageChecks, packageChecksFor, parseBrewOutdated, requirementsFile } from "../src/host/packages.ts";
import { renderHostText } from "../src/host/render.ts";
import type { HostCheck } from "../src/host/types.ts";
import type { Finding } from "../src/repos/types.ts";
import { AREA_TITLES, combinedCommands, hostName, shellWord, splitChecks } from "../ui/host-areas.js";
import { HOST_AREAS } from "../src/host/types.ts";
import { fakeAwsKeyId, fakeRunner, makeTree, tempDir } from "./helpers.ts";

/** A secret-shaped value, made at run time so this repository's own secret scan has nothing to find. */
const fakeSecret = () => ["wJalr", "XUtnFEMI", "K7MDENG", "bPxRfiCYzEXAMPLEKEY"].join("/");

/** The base64 body of an OpenSSH private key file with this cipher: enough of the format to read it, nothing more. */
function opensshKey(cipher: string): string {
	const length = Buffer.alloc(4);
	length.writeUInt32BE(cipher.length);
	const body = Buffer.concat([Buffer.from("openssh-key-v1\0", "latin1"), length, Buffer.from(cipher, "latin1"), Buffer.alloc(48, 7)]).toString("base64");
	const marker = ["OPENSSH", "PRIVATE", "KEY"].join(" ");
	return `-----BEGIN ${marker}-----\n${body}\n-----END ${marker}-----\n`;
}

test("macOS's own tools are read as they answer", () => {
	assert.deepEqual(parseSwVers("ProductName:\t\tmacOS\nProductVersion:\t\t27.2.1\nBuildVersion:\t\t26B131\n"), { name: "macOS", version: "27.2.1", build: "26B131" });
	assert.equal(parseSwVers("nothing"), null);

	assert.deepEqual(parseSoftwareUpdate("Software Update Tool\n\nNo new software available.\n"), { titles: [] });
	assert.deepEqual(
		parseSoftwareUpdate(
			"Software Update found the following new or updated software:\n* Label: macOS Tahoe 27.3-26C10\n\tTitle: macOS Tahoe 27.3, Version: 27.3, Size: 7000000KiB, Recommended: YES, Action: restart,\n* Label: Command Line Tools-27.3\n\tTitle: Command Line Tools for Xcode, Version: 27.3, Size: 900000KiB, Recommended: YES,\n",
		),
		{ titles: ["macOS Tahoe 27.3", "Command Line Tools for Xcode"] },
	);
	assert.equal(parseSoftwareUpdate("Finding available software\n"), null);

	assert.deepEqual(parseDefaults('{\n    AutomaticDownload = 1;\n    ConfigDataInstall = 0;\n    "LastResultCode" = 2;\n}\n'), { AutomaticDownload: "1", ConfigDataInstall: "0", LastResultCode: "2" });
	assert.deepEqual([parseFileVault("FileVault is On."), parseFileVault("FileVault is Off."), parseFileVault("Encryption in progress: Percent completed = 40"), parseFileVault("?")], ["on", "off", "on", null]);
	assert.deepEqual(
		[
			parseSip("System Integrity Protection status: enabled."),
			parseSip("System Integrity Protection status: disabled."),
			parseSip("System Integrity Protection status: enabled (Custom Configuration)."),
			parseSip(""),
		],
		["on", "off", "custom", null],
	);
	assert.deepEqual([parseGatekeeper("assessments enabled"), parseGatekeeper("assessments disabled"), parseGatekeeper("")], ["on", "off", null]);
	assert.deepEqual([parseFirewall("Firewall is enabled. (State = 1)"), parseFirewall("Firewall is blocking all non-essential incoming connections. (State = 2)"), parseFirewall("Firewall is disabled. (State = 0)")], ["on", "on", "off"]);
	assert.deepEqual([parseStealth("Firewall stealth mode is off"), parseStealth("Firewall stealth mode is on"), parseStealth("Stealth mode enabled"), parseStealth("")], ["off", "on", "on", null]);
	assert.deepEqual(
		[
			parseScreenLock("2026-11-19 10:30:00.000 sysadminctl[1:2] screenLock delay is 300 seconds"),
			parseScreenLock("screenLock delay is immediate"),
			parseScreenLock("screenLock is off"),
			parseScreenLock("Could not get screenLock status"),
		],
		[300, 0, "off", null],
	);
});

test("an answer that is not understood, a failure or a missing tool is never a pass", async () => {
	const failing = fakeRunner({ softwareupdate: () => ({ code: 1, stderr: "Can't connect to the Apple Software Update server." }) });
	const update = await softwareUpdates(failing, true);
	assert.equal(update.status, "unknown");
	assert.match(update.detail, /failed/);

	const odd = await softwareUpdates(fakeRunner({ softwareupdate: () => ({ stdout: "Finding available software\n" }) }), false);
	assert.equal(odd.status, "unknown");

	const missing = await firewall(fakeRunner({}));
	assert.deepEqual(missing.checks.map((check) => check.status), ["unknown", "unknown"]);
	assert.equal(missing.on, null);

	assert.equal((await screenLock(fakeRunner({ sysadminctl: () => ({ stderr: "something else" }) }))).status, "unknown");
	assert.equal((await automaticLogin(fakeRunner({ defaults: () => ({ code: 1, stderr: "Permission denied" }) }))).status, "unknown");

	// With every tool missing, no Mac check passes.
	const report = await checkHost({ run: fakeRunner({}), platform: "darwin", home: await tempDir(), pathEnv: "" });
	const macAreas = report.checks.filter((check) => check.area === "updates" || check.area === "protection" || check.area === "network");
	assert.ok(macAreas.length >= 8);
	assert.ok(macAreas.every((check) => check.status === "unknown"), JSON.stringify(macAreas.filter((check) => check.status !== "unknown")));
});

test("updates and settings are judged by what they protect", async () => {
	const pending = await softwareUpdates(
		fakeRunner({ softwareupdate: (args) => ({ stdout: args.includes("--no-scan") ? "" : "* Label: Safari26.2\n\tTitle: Safari, Version: 26.2, Size: 1KiB,\n" }) }),
		true,
	);
	assert.deepEqual([pending.status, pending.severity, pending.items], ["failed", "high", ["Safari"]]);
	const tools = await softwareUpdates(fakeRunner({ softwareupdate: () => ({ stdout: "* Label: CLTools\n\tTitle: Command Line Tools for Xcode, Version: 1,\n" }) }), false);
	assert.equal(tools.severity, "medium");

	// A setting never changed is macOS's default, which is on.
	const unset = await automaticUpdates(fakeRunner({ defaults: () => ({ code: 1, stderr: "Domain /Library/Preferences/com.apple.SoftwareUpdate does not exist" }) }));
	assert.equal(unset.status, "passed");
	const off = await automaticUpdates(fakeRunner({ defaults: () => ({ stdout: "{\n    AutomaticCheckEnabled = 1;\n    CriticalUpdateInstall = 0;\n}\n" }) }));
	assert.deepEqual([off.status, off.severity], ["failed", "medium"]);
	assert.match(off.detail, /Security Responses/);

	// The account that logs in by itself is not named.
	const login = await automaticLogin(fakeRunner({ defaults: () => ({ stdout: "someaccount\n" }) }));
	assert.equal(login.status, "failed");
	assert.doesNotMatch(JSON.stringify(login), /someaccount/);
	assert.equal((await automaticLogin(fakeRunner({ defaults: () => ({ code: 1, stderr: "The domain/default pair of (com.apple.loginwindow, autoLoginUser) does not exist" }) }))).status, "passed");
	assert.equal((await automaticLogin(fakeRunner({ defaults: () => ({ code: 1, stderr: "Could not find key 'autoLoginUser' in domain" }) }))).status, "passed");

	const slow = await screenLock(fakeRunner({ sysadminctl: () => ({ stderr: "screenLock delay is 3600 seconds" }) }));
	assert.deepEqual([slow.status, slow.severity], ["failed", "low"]);
	assert.equal((await screenLock(fakeRunner({ sysadminctl: () => ({ stderr: "screenLock is off" }) }))).severity, "medium");
});

const NETSTAT = `Active Internet connections (including servers)
Proto Recv-Q Send-Q  Local Address          Foreign Address        (state)          rxbytes      txbytes  rhiwat  shiwat          process:pid    state  options           gencnt    flags   flags1 usecnt rtncnt fltrs
tcp4       0      0  127.0.0.1.4747         *.*                    LISTEN                 0            0  131072  131072             node:500  00100 00000106 000000000005d791 00000001 00000800      1      0 000000
tcp4       0      0  *.22                   *.*                    LISTEN                 0            0  131072  131072           launchd:1  00100 00000006 000000000005d791 00000001 00000800      1      0 000000
tcp6       0      0  *.22                   *.*                    LISTEN                 0            0  131072  131072           launchd:1  00100 00000006 000000000005d791 00000001 00000800      1      0 000000
tcp4       0      0  *.5000                 *.*                    LISTEN                 0            0  131072  131072     ControlCenter:765  00100 00000006 000000000005d791 00000001 00000800      1      0 000000
tcp4       0      0  *.7000                 *.*                    LISTEN                 0            0  131072  131072     ControlCenter:765  00100 00000006 000000000005d791 00000001 00000800      1      0 000000
tcp4       0      0  *.49206                *.*                    LISTEN                 0            0  131072  131072          rapportd:778  00100 00000006 000000000005d791 00000001 00000800      1      0 000000
tcp4       0      0  10.0.0.5.8888          *.*                    LISTEN                 0            0  131072  131072     Some Dev Serve:900  00100 00000006 000000000005d791 00000001 00000800      1      0 000000
tcp4       0      0  100.101.102.103.4747   *.*                    LISTEN                 0            0  131072  131072             node:501  00100 00000106 000000000005d791 00000001 00000800      1      0 000000
tcp4       0      0  10.0.0.5.53398         10.0.0.9.24800         ESTABLISHED            0            0  131072  131072      synergy-core:1155   00104 00000008 0000000000060016 00000081 04000900      2      0 000000
`;

const PS = "    1 /sbin/launchd\n  500 /opt/homebrew/bin/node\n  501 /opt/homebrew/bin/node\n  765 /System/Library/CoreServices/ControlCenter.app/Contents/MacOS/ControlCenter\n  778 /usr/libexec/rapportd\n  900 /Applications/Some Dev Server.app/Contents/MacOS/server\n";

test("listening sockets are read from netstat, names with spaces included", () => {
	const listeners = parseNetstat(NETSTAT);
	assert.deepEqual(
		listeners.map((listener) => `${listener.address} ${listener.port} ${listener.process}:${listener.pid}`),
		["127.0.0.1 4747 node:500", "* 22 launchd:1", "* 22 launchd:1", "* 5000 ControlCenter:765", "* 7000 ControlCenter:765", "* 49206 rapportd:778", "10.0.0.5 8888 Some Dev Serve:900", "100.101.102.103 4747 node:501"],
	);
	// The layout before macOS 13: pid and epid after the buffer sizes, no process names.
	assert.deepEqual(parseNetstat("tcp4       0      0  *.22                   *.*                    LISTEN      131072  131072      1      0 0x0100 0x00000006\n"), [{ address: "*", port: 22, process: "", pid: 1 }]);
	assert.equal(parseProcesses(PS).get(900), "/Applications/Some Dev Server.app/Contents/MacOS/server");
	assert.deepEqual(
		["*", "0.0.0.0", "::", "127.0.0.1", "::1", "100.64.0.1", "100.127.255.254", "100.128.0.1", "fd7a:115c:a1e0::1", "192.168.1.2", "fe80::1%en0"].map(addressScope),
		["all", "all", "all", "loopback", "loopback", "tailnet", "tailnet", "local", "tailnet", "local", "local"],
	);
	assert.deepEqual(["/sbin/launchd", "/usr/libexec/rapportd", "/opt/homebrew/bin/node", "/Applications/X.app/x"].map(isSystemProgram), [true, true, false, false]);
});

test("what answers the network is named and judged by who runs it and how far it reaches", () => {
	const checks = classifyListeners(parseNetstat(NETSTAT), parseProcesses(PS), true, true);
	const byTitle = Object.fromEntries(checks.map((check) => [check.title, check]));
	assert.deepEqual(Object.keys(byTitle).sort(), ["AirPlay Receiver is on", "Remote Login (SSH) is on", "Some Dev Serve accepts connections on port 8888", "node on port 4747", "rapportd, part of macOS, on port 49206"].sort());
	assert.deepEqual([byTitle["Remote Login (SSH) is on"]!.status, byTitle["Remote Login (SSH) is on"]!.severity], ["failed", "medium"]);
	// One service, two ports: one thing to turn off.
	assert.match(byTitle["AirPlay Receiver is on"]!.detail, /^Ports 5000, 7000 answer/);
	assert.equal(byTitle["AirPlay Receiver is on"]!.severity, "low");
	// An installed program on the local network: low with the firewall on, medium without.
	assert.deepEqual([byTitle["Some Dev Serve accepts connections on port 8888"]!.status, byTitle["Some Dev Serve accepts connections on port 8888"]!.severity], ["failed", "low"]);
	assert.match(byTitle["Some Dev Serve accepts connections on port 8888"]!.detail, /local network \(10\.0\.0\.5\)/);
	assert.equal(classifyListeners(parseNetstat(NETSTAT), parseProcesses(PS), false, true).find((check) => check.title.startsWith("Some Dev"))!.severity, "medium");
	assert.equal(byTitle["node on port 4747"]!.status, "passed");
	assert.equal(byTitle["rapportd, part of macOS, on port 49206"]!.status, "passed");

	// Nothing but localhost: one pass.
	const quiet = classifyListeners(parseNetstat(NETSTAT.split("\n").slice(0, 3).join("\n")), new Map(), true, true);
	assert.deepEqual(quiet.map((check) => [check.status, check.title]), [["passed", "Nothing accepts connections from the network"]]);
	// A program on port 5000 that is not macOS's own is not called AirPlay.
	const devServer = classifyListeners([{ address: "*", port: 5000, process: "python3", pid: 9 }], new Map([[9, "/opt/homebrew/bin/python3"]]), true, true);
	assert.equal(devServer[0]!.title, "python3 accepts connections on port 5000");
});

test("credential files are reported by path, kind and permissions, never by what they hold", async () => {
	const home = await tempDir();
	const keyId = fakeAwsKeyId();
	const secret = fakeSecret();
	await makeTree(home, {
		".ssh/id_open": opensshKey("none"),
		".ssh/id_locked": opensshKey("aes256-ctr"),
		".ssh/id_shared": opensshKey("aes256-ctr"),
		".ssh/id_open.pub": "ssh-ed25519 AAAA public",
		".ssh/config": "Host example\n  User git\n",
		".aws/credentials": `[default]\naws_access_key_id = ${keyId}\naws_secret_access_key = ${secret}\n`,
		".npmrc": "//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n",
		".docker/config.json": JSON.stringify({ credsStore: "osxkeychain", auths: { "ghcr.io": {} } }),
		".git-credentials": `https://someone:${secret}@github.com\n`,
	});
	await chmod(join(home, ".ssh"), 0o755);
	for (const name of ["id_open", "id_locked"]) await chmod(join(home, ".ssh", name), 0o600);
	await chmod(join(home, ".ssh", "id_shared"), 0o644);
	await chmod(join(home, ".aws", "credentials"), 0o600);
	await chmod(join(home, ".git-credentials"), 0o644);

	const checks = await credentialChecks(home);
	const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
	assert.deepEqual([byId["ssh-dir"]!.status, byId["ssh-dir"]!.severity], ["failed", "medium"]);
	assert.deepEqual([byId["ssh-key:id_open"]!.status, byId["ssh-key:id_open"]!.severity], ["failed", "medium"]);
	assert.equal(byId["ssh-key:id_locked"]!.status, "passed");
	assert.deepEqual([byId["ssh-key:id_shared"]!.status, byId["ssh-key:id_shared"]!.severity], ["failed", "high"]);
	assert.deepEqual([byId["plaintext:.aws/credentials"]!.status, byId["plaintext:.aws/credentials"]!.severity], ["failed", "medium"]);
	assert.deepEqual([byId["plaintext:.git-credentials"]!.status, byId["plaintext:.git-credentials"]!.severity], ["failed", "high"]);
	// A token read from the environment, and Docker using the keychain, are not plain text.
	assert.equal(byId["plaintext:.npmrc"], undefined);
	assert.equal(byId["plaintext:.docker/config.json"], undefined);
	assert.equal(byId["ssh-key:config"], undefined);
	assert.equal(byId["ssh-key:id_open.pub"], undefined);

	const everything = JSON.stringify(checks);
	for (const value of [keyId, secret, "someone"]) assert.ok(!everything.includes(value), `the report carries ${value.slice(0, 4)}…`);

	assert.deepEqual((await credentialChecks(await tempDir())).map((check) => [check.id, check.status]), [["plaintext", "passed"]]);
	assert.equal(keyEncrypted("not a key"), null);
	assert.equal(keyEncrypted(`-----BEGIN ${"RSA PRIVATE KEY"}-----\nProc-Type: 4,ENCRYPTED\nDEK-Info: AES-128-CBC,00\n\nAAAA\n-----END ${"RSA PRIVATE KEY"}-----`), true);
	assert.equal(keyEncrypted(`-----BEGIN ${"RSA PRIVATE KEY"}-----\nAAAA\n-----END ${"RSA PRIVATE KEY"}-----`), false);
	assert.deepEqual([exposed(0o600), exposed(0o640), exposed(0o604), exposed(0o700)], [false, true, true, false]);
});

test("installed packages become lockfiles osv-scanner can read, and one check per vulnerable package", async () => {
	const tree = { dependencies: { "old-cli": { version: "1.0.0", dependencies: { minimist: { version: "1.2.5" } } }, lodash: { version: "4.17.20" }, broken: {} } };
	const entries = flattenNpm(tree);
	assert.deepEqual(
		entries.map((entry) => [entry.path, entry.version, entry.topLevel]),
		[
			["node_modules/old-cli", "1.0.0", "old-cli"],
			["node_modules/old-cli/node_modules/minimist", "1.2.5", "old-cli"],
			["node_modules/lodash", "4.17.20", "lodash"],
		],
	);
	assert.equal(JSON.parse(npmLockfile(entries)).packages["node_modules/old-cli/node_modules/minimist"].version, "1.2.5");
	assert.equal(requirementsFile([{ name: "requests", version: "2.25.1" }, { name: "bad name", version: "1" }, { name: "pyyaml" }]), "requests==2.25.1\n");
	assert.deepEqual(parseBrewOutdated(JSON.stringify({ formulae: [{ name: "git", installed_versions: ["2.40.0"], current_version: "2.47.0" }], casks: [{ name: "vlc", installed_versions: "3.0.23", current_version: "3.0.24" }] })), ["git 2.40.0 → 2.47.0", "vlc 3.0.23 → 3.0.24"]);
	assert.equal(parseBrewOutdated("not json"), null);

	const finding = (detail: string, location: string, severity: Finding["severity"], fixedIn?: string): Finding => ({
		tool: "osv-scanner",
		kind: "vulnerability",
		severity,
		ruleId: `GHSA-${detail}`,
		title: `A flaw in ${detail}`,
		location,
		detail,
		...(fixedIn ? { fixedIn } : {}),
	});
	const checks = packageChecks(
		[
			finding("minimist@1.2.5", "npm-global/package-lock.json", "critical", "1.2.6"),
			finding("lodash@4.17.20", "npm-global/package-lock.json", "high", "4.17.21"),
			finding("lodash@4.17.20", "npm-global/package-lock.json", "medium", "4.17.19"),
			finding("requests@2.25.1", "python3/requirements.txt", "medium", "2.31.0"),
		],
		entries,
		"Python (/usr/local/bin/python3)",
	);
	const byId = Object.fromEntries(checks.map((check) => [check.id, check]));
	assert.deepEqual(checks.map((check) => check.id), ["package:npm:minimist", "package:npm:lodash", "package:python:requests"]);
	assert.match(byId["package:npm:minimist"]!.fix![0]!, /comes with old-cli.*npm install -g old-cli@latest/);
	assert.deepEqual(byId["package:npm:lodash"]!.fix, ["`npm install -g lodash@4.17.21`"]);
	assert.equal(byId["package:npm:lodash"]!.items!.length, 2);
	assert.match(byId["package:python:requests"]!.fix![0]!, /pip install --upgrade "requests>=2\.31\.0"/);
	assert.match(byId["package:python:requests"]!.title, /Python \(\/usr\/local\/bin\/python3\)/);
	assert.deepEqual(
		checks.map((check) => check.commands),
		[[{ kind: "npm-global", spec: "old-cli@latest" }], [{ kind: "npm-global", spec: "lodash@4.17.21" }], [{ kind: "pip", spec: "requests>=2.31.0" }]],
	);
});

test("the repair commands are combined into lines a terminal can take in one paste", () => {
	const check = (id: string, status: HostCheck["status"], commands: HostCheck["commands"]): HostCheck => ({ id, area: "packages", title: id, status, severity: "high", detail: "", commands });
	const lines = combinedCommands([
		check("updates", "failed", [{ kind: "line", line: "softwareupdate --install --all" }]),
		check("a", "failed", [{ kind: "npm-global", spec: "lodash@4.17.21" }]),
		check("b", "failed", [{ kind: "npm-global", spec: "cf@latest" }]),
		check("c", "failed", [{ kind: "npm-global", spec: "cf@latest" }]),
		check("evil", "failed", [{ kind: "npm-global", spec: "x@1;rm -rf ~" }, { kind: "pip", spec: "y>=1 && curl evil" }]),
		check("d", "failed", [{ kind: "pip", spec: "requests>=2.31.0" }]),
		check("e", "failed", [{ kind: "pip", spec: "diskcache" }]),
		check("ok", "passed", [{ kind: "line", line: "never shown" }]),
		check("brew", "failed", [{ kind: "line", line: "brew update && brew upgrade" }]),
		check("brew again", "failed", [{ kind: "line", line: "brew update && brew upgrade" }]),
	]);
	assert.deepEqual(lines, [
		"softwareupdate --install --all",
		"npm install -g lodash@4.17.21 cf@latest",
		'python3 -m pip install --upgrade "requests>=2.31.0" "diskcache"',
		"brew update && brew upgrade",
	]);
	assert.deepEqual(combinedCommands([check("ok", "passed", [{ kind: "npm-global", spec: "a@1" }])]), []);
	assert.deepEqual([shellWord("id_ed25519"), shellWord("my key"), shellWord("it's"), shellWord("$(boom)")], ["id_ed25519", "'my key'", "'it'\\''s'", "'$(boom)'"]);
});

test("credential repairs quote file names, and leave out what needs a decision", async () => {
	const home = await tempDir();
	await makeTree(home, { ".ssh/my key": opensshKey("aes256-ctr"), ".ssh/deploy": opensshKey("none"), ".git-credentials": `https://someone:${fakeSecret()}@example.com\n` });
	await chmod(join(home, ".ssh"), 0o700);
	await chmod(join(home, ".ssh", "my key"), 0o644);
	await chmod(join(home, ".ssh", "deploy"), 0o600);
	await chmod(join(home, ".git-credentials"), 0o600);
	const mac = Object.fromEntries((await credentialChecks(home, true)).map((check) => [check.id, check]));
	assert.deepEqual(mac["ssh-key:my key"]!.commands, [{ kind: "line", line: "chmod 600 ~/.ssh/'my key'" }]);
	// Adding a passphrase would stop a script that uses the key, so it is a step, not a command to paste.
	assert.equal(mac["ssh-key:deploy"]!.commands, undefined);
	assert.deepEqual(mac["plaintext:.git-credentials"]!.commands, [{ kind: "line", line: "git config --global credential.helper osxkeychain" }]);
	const linux = Object.fromEntries((await credentialChecks(home, false)).map((check) => [check.id, check]));
	assert.deepEqual(linux["plaintext:.git-credentials"]!.commands, []);
	assert.doesNotMatch(linux["plaintext:.git-credentials"]!.fix!.join(" "), /osxkeychain/);
});

test("packages are looked up with osv-scanner only when asked, and a missing scanner is no pass", async () => {
	const npmTree = JSON.stringify({ dependencies: { lodash: { version: "4.17.20" } } });
	const osvAnswer = (dir: string) =>
		JSON.stringify({
			results: [
				{
					source: { path: join(dir, "npm-global", "package-lock.json") },
					packages: [
						{
							package: { name: "lodash", version: "4.17.20", ecosystem: "npm" },
							vulnerabilities: [{ id: "GHSA-35jh-r3h4-6jhm", summary: "Command Injection in lodash", affected: [{ package: { name: "lodash", ecosystem: "npm" }, ranges: [{ type: "SEMVER", events: [{ fixed: "4.17.21" }] }] }] }],
							groups: [{ ids: ["GHSA-35jh-r3h4-6jhm"], max_severity: "7.2" }],
						},
					],
				},
			],
		});
	const run = fakeRunner({
		npm: () => ({ code: 1, stdout: npmTree }),
		"osv-scanner": (args) => ({ code: 1, stdout: osvAnswer(args.at(-1)!) }),
	});
	const checks = await packageChecksFor({ run, lookUp: true, pathEnv: "", mac: true });
	assert.deepEqual(
		checks.map((check) => [check.id, check.status, check.severity]),
		[["package:npm:lodash", "failed", "high"]],
	);
	assert.deepEqual(checks[0]!.fix, ["`npm install -g lodash@4.17.21`"]);

	const notAsked = fakeRunner({ npm: () => ({ stdout: npmTree }), "osv-scanner": () => ({ code: 0, stdout: "{}" }) });
	assert.deepEqual(await packageChecksFor({ run: notAsked, lookUp: false, pathEnv: "", mac: true }), []);
	assert.ok(!notAsked.calls.some((call) => call[0] === "osv-scanner"));

	const noScanner = await packageChecksFor({ run: fakeRunner({ npm: () => ({ stdout: npmTree }), "osv-scanner": "missing" }), lookUp: true, pathEnv: "", mac: true });
	assert.deepEqual(noScanner.map((check) => [check.id, check.status]), [["packages", "unknown"]]);
	// osv-scanner's "could not reach the database" exit is a failure, not "no vulnerabilities".
	const offline = await packageChecksFor({ run: fakeRunner({ npm: () => ({ stdout: npmTree }), "osv-scanner": () => ({ code: 127, stdout: '{"results":[]}', stderr: "could not reach OSV" }) }), lookUp: true, pathEnv: "", mac: true });
	assert.deepEqual(offline.map((check) => check.status), ["unknown"]);
});

test("off a Mac only credentials and packages are checked, and the rest is named as not covered", async () => {
	const run = fakeRunner({});
	const report = await checkHost({ run, platform: "linux", home: await tempDir(), pathEnv: "", now: () => new Date("2026-11-19T00:00:00Z") });
	assert.deepEqual([...new Set(report.checks.map((check) => check.area))], ["credentials"]);
	assert.equal(report.os, null);
	assert.match(report.notCovered[0]!, /on a Mac only/);
	assert.ok(!run.calls.some((call) => ["softwareupdate", "fdesetup", "netstat", "sudo"].includes(call[0]!)));
	assert.deepEqual(notCovered(true, false, false).slice(0, 2), ["Apple was not asked for updates: the list is from macOS's own last check.", "Installed npm and Python packages were not looked up on OSV.dev."]);
	assert.match(renderHostText(report), /## Not covered/);
	assert.doesNotMatch(renderHostText(report), /## Commands to fix these/);
	const withCommands = { ...report, checks: [{ id: "brew", area: "packages" as const, title: "Homebrew packages", status: "failed" as const, severity: "low" as const, detail: "", commands: [{ kind: "line" as const, line: "brew update && brew upgrade" }] }] };
	assert.match(renderHostText(withCommands), /## Commands to fix these\n.*\n\nbrew update && brew upgrade\n/);
});

test("nothing the check runs asks for privileges or changes a setting", async () => {
	const run = fakeRunner({
		softwareupdate: () => ({ stdout: "No new software available." }),
		defaults: () => ({ code: 1, stderr: "does not exist" }),
		fdesetup: () => ({ stdout: "FileVault is On." }),
		csrutil: () => ({ stdout: "System Integrity Protection status: enabled." }),
		spctl: () => ({ stdout: "assessments enabled" }),
		"/usr/libexec/ApplicationFirewall/socketfilterfw": (args) => ({ stdout: args[0] === "--getglobalstate" ? "Firewall is enabled. (State = 1)" : "Firewall stealth mode is on" }),
		sysadminctl: () => ({ stderr: "screenLock delay is immediate" }),
		netstat: () => ({ stdout: NETSTAT }),
		ps: () => ({ stdout: PS }),
		sw_vers: () => ({ stdout: "ProductName: macOS\nProductVersion: 27.2.1\nBuildVersion: 26B131\n" }),
		npm: "missing",
		brew: "missing",
	});
	const progress: string[] = [];
	const report = await checkHost({ run, platform: "darwin", home: await tempDir(), pathEnv: "", onProgress: ({ current }) => current && progress.push(current) });
	assert.deepEqual(report.os, { name: "macOS", version: "27.2.1", build: "26B131" });
	assert.equal(progress[0], "Software updates");
	for (const call of run.calls) {
		assert.notEqual(call[0], "sudo");
		assert.ok(!call.some((arg) => /^(write|delete|--enable|--disable|--setglobalstate|--setstealthmode|enable|disable|--install)$/.test(arg)), call.join(" "));
	}
	// Every command is given a time limit, so one that hangs cannot stop the check.
	const timed = fakeRunner({ fdesetup: () => ({ stdout: "FileVault is On." }) });
	let limit: number | undefined;
	await checkHost({
		run: async (command, args, options) => {
			if (command === "fdesetup") limit = options?.timeoutMs;
			return timed(command, args, options);
		},
		platform: "darwin",
		home: await tempDir(),
		pathEnv: "",
	});
	assert.ok(limit !== undefined && limit <= 5 * 60_000);
	// A Mac with every protection on passes them all; what Sharing turned on is still named.
	const protection = report.checks.filter((check) => check.area === "protection" || check.area === "updates");
	assert.equal(protection.length, 10);
	assert.ok(protection.every((check) => check.status === "passed"), JSON.stringify(protection.filter((check) => check.status !== "passed")));
	assert.ok(report.checks.some((check) => check.title === "Remote Login (SSH) is on" && check.status === "failed"));
});

test("checks are ordered by area, problems first, and the page keeps what could not be checked apart from passes", () => {
	const check = (id: string, area: HostCheck["area"], status: HostCheck["status"], severity: HostCheck["severity"]): HostCheck => ({ id, area, title: id, status, severity, detail: "" });
	const sorted = sortChecks([check("a", "network", "passed", "high"), check("b", "updates", "unknown", "low"), check("c", "updates", "failed", "low"), check("d", "updates", "failed", "high"), check("e", "network", "failed", "low")]);
	assert.deepEqual(sorted.map((item) => item.id), ["d", "c", "b", "e", "a"]);
	const { attention, passed } = splitChecks(sorted);
	assert.deepEqual(AREA_TITLES.map(([area]) => area), [...HOST_AREAS]);
	// The sidebar says "This Mac" on a Mac, and before the server has said what it runs on.
	assert.deepEqual([hostName("darwin"), hostName(undefined), hostName(""), hostName("linux"), hostName("win32")], ["This Mac", "This Mac", "This Mac", "This computer", "This computer"]);
	assert.deepEqual([attention.map((item) => item.id), passed.map((item) => item.id)], [["d", "c", "b", "e"], ["a"]]);
});
