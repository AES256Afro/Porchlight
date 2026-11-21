import assert from "node:assert/strict";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { checkHost } from "../src/host/check.ts";
import { browserExtensionChecks, execProgram, launchdProgram, manifestReachesEverySite, parseSshConfig, sshConfigChecks, startupChecks } from "../src/host/extras.ts";
import { fakeRunner, makeTree, tempDir } from "./helpers.ts";

test("SSH: agent forwarding to every host and switched-off host key checks are flagged; per-host forwarding is not (FT-8)", async () => {
	const home = await tempDir();
	await makeTree(home, {
		".ssh/config": "Host build\n  ForwardAgent yes\nHost lab-*\n  StrictHostKeyChecking no\nInclude conf.d/*\n",
		".ssh/conf.d/zz": "Host *\n  ForwardAgent yes\n",
	});
	const checks = Object.fromEntries((await sshConfigChecks(home)).map((check) => [check.id, check]));
	assert.equal(checks["ssh-forward-agent"]!.status, "failed");
	assert.equal(checks["ssh-host-keys"]!.status, "failed");
	assert.equal(checks["ssh-host-keys"]!.severity, "low");
	assert.deepEqual(checks["ssh-host-keys"]!.items, ["Host lab-*"]);

	const safe = await tempDir();
	await makeTree(safe, { ".ssh/config": "Host build\n  ForwardAgent yes\n" });
	assert.deepEqual((await sshConfigChecks(safe)).map((check) => check.status), ["passed", "passed"]);
	// No config at all: nothing to say.
	assert.deepEqual(await sshConfigChecks(await tempDir()), []);
	assert.deepEqual(parseSshConfig("ForwardAgent=yes\n").settings, [{ keyword: "forwardagent", value: "yes", scope: "every" }]);
});

test("SSH: an included file that cannot be read makes the check 'Could not check', never a pass", async () => {
	const home = await tempDir();
	await makeTree(home, { ".ssh/config": "Include secret\n", ".ssh/secret": "Host *\n ForwardAgent yes\n" });
	await chmod(join(home, ".ssh/secret"), 0o000);
	const checks = await sshConfigChecks(home);
	await chmod(join(home, ".ssh/secret"), 0o600);
	// Running as root reads it anyway; otherwise it is unknown.
	if (process.getuid?.() !== 0) assert.deepEqual(checks.map((check) => check.status), ["unknown", "unknown"]);
});

test("startup items: a program in a temporary or writable folder is flagged; one that cannot be read is not a pass (FT-8)", async () => {
	const home = await tempDir();
	const system = await tempDir();
	await makeTree(home, { "Library/LaunchAgents/good.plist": "x", "Library/LaunchAgents/bad.plist": "x", "Library/LaunchAgents/broken.plist": "x" });
	await mkdir(join(system, "Library/LaunchDaemons"), { recursive: true });
	const writable = join(home, "open");
	await makeTree(writable, { tool: "#!/bin/sh\n" });
	await chmod(writable, 0o777);
	await writeFile(join(system, "Library/LaunchDaemons/root.plist"), "x");
	const run = fakeRunner({
		plutil: (args) => {
			const file = args.at(-1)!;
			if (file.endsWith("good.plist")) return { stdout: JSON.stringify({ Label: "good", ProgramArguments: ["/usr/bin/true"] }) };
			if (file.endsWith("bad.plist")) return { stdout: JSON.stringify({ Label: "bad", Program: "/tmp/updater" }) };
			if (file.endsWith("root.plist")) return { stdout: JSON.stringify({ Label: "root-job", Program: join(writable, "tool") }) };
			return { code: 1, stderr: "Property List error" };
		},
	});
	const [check] = await startupChecks(run, home, true, system);
	assert.equal(check!.status, "failed");
	assert.equal(check!.items!.length, 2, check!.items!.join("\n"));
	assert.match(check!.items!.join("\n"), /bad runs \/tmp\/updater \(it is in a temporary or shared folder\)/);
	assert.match(check!.items!.join("\n"), /root-job runs ~\/open\/tool \(it starts for every user from a folder one account can change\)/);
	assert.match(check!.detail, /One item could not be read/);
	// plutil is asked only to print.
	for (const call of run.calls) assert.deepEqual(call.slice(0, 5), ["plutil", "-convert", "json", "-o", "-"]);

	// Nothing risky, but one unreadable: unknown.
	const quiet = await tempDir();
	await makeTree(quiet, { "Library/LaunchAgents/broken.plist": "x" });
	assert.equal((await startupChecks(run, quiet, true, await tempDir()))[0]!.status, "unknown");

	// Linux: systemd user units and autostart entries.
	const linux = await tempDir();
	await makeTree(linux, { ".config/systemd/user/sync.service": "[Service]\nExecStart=-/var/tmp/sync --daemon\n", ".config/autostart/ok.desktop": "[Desktop Entry]\nExec=/usr/bin/true\n" });
	const [onLinux] = await startupChecks(fakeRunner({}), linux, false);
	assert.equal(onLinux!.status, "failed");
	assert.deepEqual(onLinux!.items!.length, 1);
	assert.equal(execProgram('ExecStart=@"/opt/my app/run" x', "ExecStart"), "/opt/my app/run");
	assert.equal(launchdProgram("not json"), null);
	assert.deepEqual(await startupChecks(fakeRunner({}), await tempDir(), false), []);
});

test("browser extensions that reach every site are named with their permission only (FT-8)", async () => {
	const home = await tempDir();
	const id = "a".repeat(32);
	const other = "b".repeat(32);
	await makeTree(home, {
		[`Library/Application Support/Google/Chrome/Default/Extensions/${id}/1.0_0/manifest.json`]: JSON.stringify({ name: "__MSG_appName__", default_locale: "en", host_permissions: ["<all_urls>"], description: "should not appear" }),
		[`Library/Application Support/Google/Chrome/Default/Extensions/${id}/1.0_0/_locales/en/messages.json`]: JSON.stringify({ appname: { message: "Helper\u001b[31m" } }),
		[`Library/Application Support/Google/Chrome/Default/Extensions/${other}/2.0/manifest.json`]: JSON.stringify({ name: "Narrow", permissions: ["https://example.com/*"] }),
		"Library/Application Support/Firefox/Profiles/x.default/extensions.json": JSON.stringify({
			addons: [
				{ type: "extension", location: "app-profile", defaultLocale: { name: "Everywhere" }, userPermissions: { origins: ["*://*/*"] } },
				{ type: "extension", location: "app-builtin", defaultLocale: { name: "Built in" }, userPermissions: { origins: ["<all_urls>"] } },
			],
		}),
	});
	const checks = await browserExtensionChecks(home, true);
	assert.deepEqual(
		checks.map((check) => [check.id, check.status, check.items]),
		[
			["extensions:chrome", "failed", ["Helper [31m (can read and change every site)"]],
			["extensions:firefox", "failed", ["Everywhere (can read and change every site)"]],
		],
	);
	assert.ok(!JSON.stringify(checks).includes("should not appear"));
	assert.equal(manifestReachesEverySite({ content_scripts: [{ matches: ["http://*/*"] }] }), true);
	assert.deepEqual(await browserExtensionChecks(await tempDir(), true), []);
});

test("the new checks run within the host check, under their own area, and only read", async () => {
	const home = await tempDir();
	await makeTree(home, { ".ssh/config": "Host *\n ForwardAgent yes\n" });
	const run = fakeRunner({});
	const report = await checkHost({ run, platform: "linux", home, pathEnv: "" });
	assert.ok(report.checks.some((check) => check.id === "ssh-forward-agent" && check.status === "failed"));
	assert.ok(!run.calls.some((call) => call[0] === "sudo"));
});

test("a program reached through a link is judged by the file it points to, never the link's own mode", async (t) => {
	const { riskyPlace } = await import("../src/host/extras.ts");
	const { lstat, readdir } = await import("node:fs/promises");
	// A link the system itself ships, outside any temporary folder: /usr/bin/true on Ubuntu, others on macOS.
	let link: string | undefined;
	for (const name of await readdir("/usr/bin").catch(() => [] as string[])) {
		if ((await lstat(join("/usr/bin", name)).catch(() => null))?.isSymbolicLink()) {
			link = join("/usr/bin", name);
			break;
		}
	}
	if (!link) return t.skip("no link in /usr/bin on this computer");
	assert.equal(await riskyPlace(link, "/nonexistent-home", false), null, `${link} is a link, whose own mode is 0777`);
});
