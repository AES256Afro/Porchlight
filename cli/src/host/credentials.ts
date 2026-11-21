/**
 * Credentials kept in files in the home folder. A file is read only to tell whether it holds a
 * credential and who can read it: what it holds is never kept, returned or shown, only its path,
 * the kind of credential and its permissions (invariant 3).
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Severity } from "../repos/types.ts";
import { shellWord } from "../../ui/host-areas.js";
import type { HostCheck } from "./types.ts";

/** Larger files are not credential stores; they are not read. */
const MAX_READ = 1024 * 1024;

/** Group or others may read or write it. On a Mac every user is in the group "staff". */
export function exposed(mode: number): boolean {
	return (mode & 0o066) !== 0;
}

function octal(mode: number): string {
	return (mode & 0o777).toString(8).padStart(3, "0");
}

interface Store {
	path: string;
	kind: string;
	holds: (text: string) => boolean;
	fix: string;
	/** On a Mac: a command that moves the credential somewhere safer, when there is one. */
	macCommand?: string;
}

/** Files that tools write credentials into, and how to tell one holds a credential. */
const STORES: Store[] = [
	{
		path: ".aws/credentials",
		kind: "AWS access keys",
		holds: (text) => /^\s*aws_secret_access_key\s*=\s*\S/im.test(text),
		fix: "Use short-lived credentials (`aws configure sso`), then delete the keys from the file and deactivate them in IAM.",
	},
	{
		path: ".git-credentials",
		kind: "git passwords or tokens",
		holds: (text) => /^\s*\w[\w+.-]*:\/\/[^\s@]+@/m.test(text),
		fix: "Keep them in the keychain instead: `git config --global credential.helper osxkeychain`, then delete ~/.git-credentials.",
		macCommand: "git config --global credential.helper osxkeychain",
	},
	{
		path: ".netrc",
		kind: "server passwords",
		holds: (text) => /\bpassword\s+\S/.test(text),
		fix: "Remove passwords you no longer need, and use each tool's keychain support for the rest.",
	},
	{
		path: ".npmrc",
		kind: "an npm token",
		holds: (text) => /(?:_authToken|_auth|_password)\s*=\s*(?!\$\{)\S/.test(text),
		fix: "Read the token from an environment variable instead (`//registry.npmjs.org/:_authToken=${NPM_TOKEN}`), or use short-lived tokens.",
	},
	{
		path: ".docker/config.json",
		kind: "container registry passwords",
		holds: (text) => {
			try {
				const auths = (JSON.parse(text) as { auths?: Record<string, { auth?: unknown }> }).auths ?? {};
				return Object.values(auths).some((entry) => typeof entry?.auth === "string" && entry.auth !== "");
			} catch {
				return false;
			}
		},
		fix: "Set `\"credsStore\": \"osxkeychain\"` in ~/.docker/config.json and log in to each registry again.",
	},
	{
		path: ".pypirc",
		kind: "a PyPI password",
		holds: (text) => /^\s*password\s*[=:]\s*\S/im.test(text),
		fix: "Use a PyPI API token kept by `keyring` instead of a password in the file.",
	},
	{
		path: ".config/gh/hosts.yml",
		kind: "a GitHub token",
		holds: (text) => /^\s*oauth_token\s*:\s*\S/m.test(text),
		fix: "Run `gh auth login` again: recent versions keep the token in the keychain.",
	},
	{
		path: ".kube/config",
		kind: "Kubernetes credentials",
		holds: (text) => /^\s*(?:token|client-key-data|password)\s*:\s*\S/m.test(text),
		fix: "Prefer credentials from your cloud provider's plugin (an `exec` entry) over keys and tokens in the file.",
	},
];

/** Whether a private key needs a passphrase. Null when the file is not a private key Porchlight knows. */
export function keyEncrypted(text: string): boolean | null {
	const begin = /-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----/.exec(text);
	if (!begin) return null;
	if (begin[1] === "ENCRYPTED ") return true;
	if (begin[1] === "OPENSSH ") {
		const body = text.slice(begin.index + begin[0].length).split("-----END")[0]!.replace(/\s+/g, "");
		const bytes = Buffer.from(body, "base64");
		const magic = "openssh-key-v1\0";
		if (bytes.subarray(0, magic.length).toString("latin1") !== magic) return null;
		const length = bytes.readUInt32BE(magic.length);
		const cipher = bytes.subarray(magic.length + 4, magic.length + 4 + length).toString("latin1");
		return cipher !== "none";
	}
	// PEM: an encrypted key carries a Proc-Type header.
	return /Proc-Type:\s*4,ENCRYPTED/i.test(text);
}

async function readSmall(path: string): Promise<{ text: string; mode: number } | "missing" | "unreadable"> {
	try {
		const info = await stat(path);
		if (!info.isFile()) return "missing";
		if (info.size > MAX_READ) return { text: "", mode: info.mode };
		return { text: await readFile(path, "utf8"), mode: info.mode };
	} catch (err) {
		return (err as NodeJS.ErrnoException).code === "ENOENT" || (err as NodeJS.ErrnoException).code === "ENOTDIR" ? "missing" : "unreadable";
	}
}

async function sshChecks(home: string): Promise<HostCheck[]> {
	const dir = join(home, ".ssh");
	let info;
	try {
		info = await stat(dir);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		return [{ id: "ssh-dir", area: "credentials", title: "~/.ssh", severity: "medium", status: "unknown", detail: "Porchlight could not look into ~/.ssh." }];
	}
	if (!info.isDirectory()) return [];
	const checks: HostCheck[] = [];
	if ((info.mode & 0o077) !== 0) {
		checks.push({
			id: "ssh-dir",
			area: "credentials",
			title: "~/.ssh can be opened by others",
			severity: "medium",
			status: "failed",
			detail: `Its permissions are ${octal(info.mode)}: other users of this computer can look into it.`,
			fix: ["`chmod 700 ~/.ssh`"],
			commands: [{ kind: "line", line: "chmod 700 ~/.ssh" }],
		});
	}
	let names: string[] = [];
	try {
		names = (await readdir(dir)).filter((name) => !name.endsWith(".pub")).sort();
	} catch {
		checks.push({ id: "ssh-keys", area: "credentials", title: "SSH keys", severity: "medium", status: "unknown", detail: "Porchlight could not list ~/.ssh." });
		return checks;
	}
	for (const name of names) {
		const shown = `~/.ssh/${name}`;
		// The name as a shell would need it, in commands: a file can be called anything.
		const path = `~/.ssh/${shellWord(name)}`;
		const file = await readSmall(join(dir, name));
		if (file === "missing") continue;
		if (file === "unreadable") {
			checks.push({ id: `ssh-key:${name}`, area: "credentials", title: shown, severity: "medium", status: "unknown", detail: "Porchlight could not read it to tell whether it is a private key." });
			continue;
		}
		const encrypted = keyEncrypted(file.text);
		if (encrypted === null) continue;
		const base = { id: `ssh-key:${name}`, area: "credentials", title: `SSH key ${shown}` } as const;
		if (exposed(file.mode)) {
			checks.push({
				...base,
				severity: "high",
				status: "failed",
				detail: `Its permissions are ${octal(file.mode)}: other users of this computer can read this private key.`,
				fix: [`\`chmod 600 ${path}\``, "If anyone else uses this computer, replace the key: they may have copied it."],
				commands: [{ kind: "line", line: `chmod 600 ${path}` }],
			});
		} else if (!encrypted) {
			checks.push({
				...base,
				severity: "medium",
				status: "failed",
				detail: "It has no passphrase: anyone or any program that copies the file can use it.",
				// Not in the combined commands: a script that uses this key would stop working.
				fix: [
					`Add one: \`ssh-keygen -p -f ${path}\`. If a script or a server uses this key unattended, give it its own key instead.`,
					`Keep the passphrase in the keychain so you are not asked each time: \`ssh-add --apple-use-keychain ${path}\``,
				],
			});
		} else {
			checks.push({ ...base, severity: "medium", status: "passed", detail: "It has a passphrase, and only you can read it." });
		}
	}
	return checks;
}

async function storeChecks(home: string, mac: boolean): Promise<HostCheck[]> {
	const checks: HostCheck[] = [];
	for (const store of STORES) {
		const shown = `~/${store.path}`;
		const file = await readSmall(join(home, store.path));
		if (file === "missing") continue;
		if (file === "unreadable") {
			checks.push({ id: `plaintext:${store.path}`, area: "credentials", title: shown, severity: "medium", status: "unknown", detail: "Porchlight could not read it to tell whether it holds a credential." });
			continue;
		}
		// The text is only tested, never kept: nothing below refers to it.
		if (!store.holds(file.text)) continue;
		const open = exposed(file.mode);
		const severity: Severity = open ? "high" : "medium";
		checks.push({
			id: `plaintext:${store.path}`,
			area: "credentials",
			title: `${shown} holds ${store.kind}`,
			severity,
			status: "failed",
			detail: open
				? `In plain text, and its permissions are ${octal(file.mode)}: other users of this computer can read it.`
				: "In plain text. Only you can read the file, but so can every program you run, and every backup that copies it.",
			fix: [...(open ? [`\`chmod 600 ${shown}\``] : []), mac || !store.macCommand ? store.fix : "Use a credential helper that encrypts them, such as Git Credential Manager, then delete the file."],
			// Switching to the keychain stays in the fix alone: it replaces a `store` helper that unattended jobs may rely on.
			commands: open ? [{ kind: "line" as const, line: `chmod 600 ${shown}` }] : [],
		});
	}
	// Only when every file could be read and none holds one: a file that could not be read is no pass.
	if (checks.length === 0) {
		checks.push({
			id: "plaintext",
			area: "credentials",
			title: "No credentials in the usual files",
			severity: "medium",
			status: "passed",
			detail: `None of ${STORES.map((store) => `~/${store.path}`).join(", ")} holds a credential in plain text.`,
		});
	}
	return checks;
}

export async function credentialChecks(home: string, mac = true): Promise<HostCheck[]> {
	return [...(await sshChecks(home)), ...(await storeChecks(home, mac))];
}

/** The files the credential check looks at, for the page and the README. */
export const CREDENTIAL_FILES = ["~/.ssh", ...STORES.map((store) => `~/${store.path}`)];
