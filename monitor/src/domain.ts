const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Canonical form of a DNS name, or null if it is not one we will monitor.
 * Rejects single labels, IP literals, and anything with characters outside
 * the hostname set, so the result is safe to place in URLs and SQL parameters.
 */
export function normalizeDomain(input: string): string | null {
	const name = input.trim().toLowerCase().replace(/\.$/, "");
	if (name.length === 0 || name.length > 253) return null;
	const labels = name.split(".");
	if (labels.length < 2) return null;
	if (!labels.every((label) => LABEL.test(label))) return null;
	if (/^\d+$/.test(labels[labels.length - 1]!)) return null;
	return name;
}

/** True when `host` is `domain` itself or a name beneath it. */
export function isWithin(host: string, domain: string): boolean {
	return host === domain || host.endsWith(`.${domain}`);
}
