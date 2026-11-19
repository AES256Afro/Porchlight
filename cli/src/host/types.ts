/**
 * The host check: what Porchlight can see of the computer it runs on, by reading only. It never
 * changes a setting, never asks for more privilege than the person running it has, and never looks
 * at another machine. What it could not look at is "unknown", which is never shown as passed.
 */
import type { Severity } from "../repos/types.ts";

export const HOST_AREAS = ["updates", "protection", "network", "credentials", "packages"] as const;
export type HostArea = (typeof HOST_AREAS)[number];

/** `unknown`: the check could not run or its answer was not understood. Never a pass. */
export type HostCheckStatus = "passed" | "failed" | "unknown";

export interface HostCheck {
	/** Stable across runs, for example "filevault" or "service:22". */
	id: string;
	area: HostArea;
	title: string;
	status: HostCheckStatus;
	/** How serious it is when it fails. Kept for passed and unknown checks too, to order them. */
	severity: Severity;
	/** What was seen, in words. Never a credential's value. */
	detail: string;
	/** Steps to repair it. Commands are marked with backticks, as in the roadmap. */
	fix?: string[];
	/** A list the detail refers to, such as pending updates or advisories. */
	items?: string[];
	/**
	 * Commands that repair it and are safe to run without a decision first, for the combined list
	 * at the bottom of the page. A step that needs one (turning off a Sharing service someone may
	 * use, adding a passphrase to a key a script may use) stays in `fix` only.
	 */
	commands?: HostCommand[];
}

/**
 * A repair command. Packages of one kind are combined into one command (`npm install -g a b`);
 * a `line` is a whole command, already quoted for a shell.
 */
export type HostCommand = { kind: "npm-global"; spec: string } | { kind: "pip"; spec: string } | { kind: "line"; line: string };

export interface HostReport {
	checkedAt: string;
	/** Node's name for the operating system, such as "darwin" or "linux". */
	platform: string;
	os: { name: string; version: string; build: string } | null;
	checks: HostCheck[];
	/** What this check does not look at, so a clean result is not read as more than it is. */
	notCovered: string[];
	/** Whether the check asked Apple for updates and looked packages up on OSV.dev. */
	lookups: { apple: boolean; packages: boolean };
}

export interface HostProgress {
	done: number;
	total: number;
	current: string;
}
