// Answering a request: JSON, files to save, the page's own files, gzip and validators, and request bodies.
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import { asciiDomain } from "../investigate/scope.ts";
import type { ExportFile } from "../roadmap/export.ts";

export const UI_DIR = join(import.meta.dirname, "../../ui");

/** Sent on every response. The page loads nothing from anywhere but this server. */
export const SECURITY_HEADERS = {
	"content-security-policy":
		"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; " +
		"base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
	"referrer-policy": "no-referrer",
	"cross-origin-resource-policy": "same-origin",
	"cache-control": "no-store",
};

export const MAX_BODY_BYTES = 64 * 1024;

export const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?$/;

export class HttpError extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** A request body as named fields. No body counts as none given. */
export function bodyObject(body: unknown): Record<string, unknown> {
	if (body === undefined) return {};
	if (typeof body !== "object" || body === null || Array.isArray(body)) throw new HttpError(400, "Body must be a JSON object");
	return body as Record<string, unknown>;
}

export function textField(fields: Record<string, unknown>, name: string, max: number): string {
	const value = fields[name];
	if (typeof value !== "string" || value === "" || value.length > max) throw new HttpError(400, `${name} must be text of 1 to ${max} characters`);
	return value;
}

export function domainField(fields: Record<string, unknown>): string {
	const domain = typeof fields.domain === "string" ? asciiDomain(fields.domain.trim().toLowerCase()) : "";
	if (!DOMAIN_PATTERN.test(domain)) throw new HttpError(400, "Invalid domain name");
	return domain;
}

export function safeDecode(segment: string): string {
	try {
		return decodeURIComponent(segment);
	} catch {
		return "";
	}
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
	if (res.headersSent) return;
	res.writeHead(status, { ...SECURITY_HEADERS, "content-type": "application/json; charset=utf-8" });
	res.end(JSON.stringify(body));
}

/**
 * A body sent as it is or gzipped, the gzipped copy made the first time a browser takes it and kept
 * with the body. A body in parts is sent part by part, so parts shared between versions are never copied.
 */
export interface Sendable {
	body: Buffer | Buffer[];
	gzipped?: Promise<Buffer>;
}

export function gzipBody(body: Buffer | Buffer[]): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		// Large output pieces: a report's response is hundreds of KB gzipped, and each piece is a buffer to free.
		const zip = createGzip({ chunkSize: 256 * 1024 });
		const out: Buffer[] = [];
		zip.on("data", (chunk: Buffer) => out.push(chunk));
		zip.on("end", () => resolve(Buffer.concat(out)));
		zip.on("error", reject);
		for (const part of Array.isArray(body) ? body : [body]) zip.write(part);
		zip.end();
	});
}

/** Bodies smaller than this are sent as they are: gzip would save less than its own cost. */
export const GZIP_FROM = 1024;

/** Whether the request says gzip is welcome: named, or `*`, and not with q=0. */
export function acceptsGzip(header: string | string[] | undefined): boolean {
	const value = Array.isArray(header) ? header.join(",") : (header ?? "");
	let star = false;
	for (const part of value.split(",")) {
		const [name = "", ...params] = part.trim().toLowerCase().split(";");
		const q = params.map((param) => param.trim()).find((param) => param.startsWith("q="));
		const welcome = q === undefined || Number(q.slice(2)) > 0;
		if (name.trim() === "gzip") return welcome;
		if (name.trim() === "*") star = welcome;
	}
	return star;
}

/** Sends a body, gzipped when the browser takes gzip and the body is large enough to gain from it. */
export async function sendBytes(req: IncomingMessage, res: ServerResponse, status: number, headers: Record<string, string>, sendable: Sendable): Promise<void> {
	if (res.headersSent) return;
	const parts = Array.isArray(sendable.body) ? sendable.body : [sendable.body];
	const length = parts.reduce((sum, part) => sum + part.length, 0);
	if (length >= GZIP_FROM && acceptsGzip(req.headers["accept-encoding"])) {
		// A failed compression is not kept, so the next request tries again.
		sendable.gzipped ??= gzipBody(sendable.body).catch((err: unknown) => {
			sendable.gzipped = undefined;
			throw err;
		});
		const gzipped = await sendable.gzipped;
		res.writeHead(status, { ...headers, "content-encoding": "gzip", "content-length": String(gzipped.length) });
		res.end(gzipped);
		return;
	}
	res.writeHead(status, { ...headers, "content-length": String(length) });
	for (const part of parts) res.write(part);
	res.end();
}

/** What identifies a file as written: a save writes a new file and renames it into place, which changes it. "-" when there is none. */
export async function fileStamp(path: string): Promise<string> {
	try {
		const info = await stat(path, { bigint: true });
		return `${info.ino}:${info.size}:${info.mtimeNs}:${info.ctimeNs}`;
	} catch {
		return "-";
	}
}

/** The page's own files as last read, each with its validator, until the file changes (OP-7). */
export const staticFiles = new Map<string, Sendable & { stamp: string; etag: string }>();

export async function staticFile(file: string): Promise<Sendable & { etag: string }> {
	const path = join(UI_DIR, file);
	const stamp = await fileStamp(path);
	const kept = staticFiles.get(file);
	if (kept && kept.stamp === stamp && stamp !== "-") return kept;
	const body = await readFile(path);
	const entry = { stamp, body, etag: `"${createHash("sha256").update(body).digest("base64url").slice(0, 32)}"` };
	staticFiles.set(file, entry);
	return entry;
}

/** Whether If-None-Match names this validator (or `*`), so the browser's copy is still the file. */
export function etagMatches(header: string | string[] | undefined, etag: string): boolean {
	if (header === undefined) return false;
	const tags = (Array.isArray(header) ? header.join(",") : header).split(",").map((tag) => tag.trim().replace(/^W\//, ""));
	return tags.includes("*") || tags.includes(etag);
}

/** Sends a file to save. Its name is built from a fixed stem and a date, never from request input. */

export function sendDownload(res: ServerResponse, file: Pick<ExportFile, "contentType" | "filename" | "body">): void {
	res.writeHead(200, {
		...SECURITY_HEADERS,
		"content-type": file.contentType,
		"content-disposition": `attachment; filename="${file.filename}"`,
	});
	res.end(file.body);
}

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		size += (chunk as Buffer).length;
		if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body too large");
		chunks.push(chunk as Buffer);
	}
	if (size === 0) return undefined;
	// Requiring JSON also keeps plain HTML forms on other sites from posting here.
	if (!(req.headers["content-type"] ?? "").startsWith("application/json")) {
		throw new HttpError(415, "Body must be application/json");
	}
	try {
		return JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch {
		throw new HttpError(400, "Body is not valid JSON");
	}
}
