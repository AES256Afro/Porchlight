// Access from other devices (invariant 7): a second listener on the Tailscale address only, with its
// own key, turned on and off from the page on the computer that runs Porchlight. /api/access.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { hostname } from "node:os";
import { join } from "node:path";
import { oneAtATime } from "../../private-files.ts";
import type { ServerContext } from "../context.ts";
import { onComputerPage, tailnetAddress, type Gate } from "../gate.ts";
import { bodyObject, HttpError, sendJson } from "../http.ts";
import { newAccessKey, readAccess, saveAccess, type AccessFile } from "../kept-files.ts";
import type { AccessStatus } from "../types.ts";

const DEFAULT_ACCESS_PORT = 4747;
const ACCESS_RETRY_MS = 30_000;

/** `respond` answers a request that came in through a gate; the tailnet listener uses it with its own. */
export async function createAccess(ctx: ServerContext, respond: (gate: Gate) => (req: IncomingMessage, res: ServerResponse) => void) {
	const { options, dataDir } = ctx;
	// Access from other devices: a second listener on this machine's Tailscale address only.
	const accessPath = join(dataDir, "access.json");
	const accessPort = options.accessPort ?? DEFAULT_ACCESS_PORT;
	const findTailnet = options.tailnetAddress ?? tailnetAddress;
	let access: AccessFile = (await readAccess(accessPath)) ?? { enabled: false, key: "" };
	let tailnetServer: Server | null = null;
	let accessStatus: AccessStatus = { enabled: access.enabled, listening: false };
	let accessRetry: ReturnType<typeof setInterval> | undefined;
	const tailnetGate: Gate = {
		loopbackOnly: false,
		key: () => access.key,
		port: () => {
			const bound = tailnetServer?.address();
			return bound && typeof bound === "object" ? bound.port : accessPort;
		},
		tailnet: true,
	};

	async function stopAccess(): Promise<void> {
		const closing = tailnetServer;
		tailnetServer = null;
		if (!closing) return;
		await new Promise<void>((done) => {
			closing.close(() => done());
			closing.closeAllConnections();
		});
	}

	/** Listens on the tailnet when access is on, and stops when it is off. Safe to call again to retry. */
	/** Starts or stops the tailnet listener to match `access`, one change at a time, the retry included (S25). */
	function applyAccess(): Promise<void> {
		return oneAtATime(`${accessPath}#listener`, applyAccessNow);
	}

	async function applyAccessNow(): Promise<void> {
		await stopAccess();
		clearInterval(accessRetry);
		accessRetry = undefined;
		if (!access.enabled) {
			accessStatus = { enabled: false, listening: false };
			return;
		}
		const address = findTailnet();
		if (!address) {
			accessStatus = { enabled: true, listening: false, error: "Tailscale is not connected on this computer. Start Tailscale; Porchlight will keep checking." };
			// Tailscale may come up after Porchlight does.
			accessRetry = setInterval(() => void (findTailnet() ? applyAccess() : undefined), ACCESS_RETRY_MS);
			accessRetry.unref();
			return;
		}
		const listener = createServer(respond(tailnetGate));
		try {
			await new Promise<void>((resolveListen, reject) => {
				listener.once("error", reject);
				listener.listen(accessPort, address, resolveListen);
			});
		} catch (err) {
			const code = (err as { code?: unknown }).code;
			accessStatus = {
				enabled: true,
				listening: false,
				error: code === "EADDRINUSE" ? `Port ${accessPort} on the Tailscale address is taken, perhaps by another copy of Porchlight` : `Could not listen on the Tailscale address (${String(code ?? err)})`,
			};
			return;
		}
		tailnetServer = listener;
		const bound = listener.address();
		const boundPort = bound && typeof bound === "object" ? bound.port : accessPort;
		const name = hostname().toLowerCase().endsWith(".ts.net") ? hostname().toLowerCase() : address;
		accessStatus = { enabled: true, listening: true, url: `http://${name}:${boundPort}` };
	}

	/** On this computer: the status, the address and the key to give another device. Elsewhere: the status alone. */
	function accessState(gate: Gate) {
		const here = onComputerPage(gate);
		return {
			...accessStatus,
			// Only this computer can change who gets in, and only it is shown the key.
			canChange: here,
			...(here && accessStatus.listening && accessStatus.url ? { link: `${accessStatus.url}/#k=${access.key}` } : {}),
		};
	}

	async function accessRoute(res: ServerResponse, route: string, body: unknown, gate: Gate): Promise<void> {
		if (route === "GET /api/access") return sendJson(res, 200, accessState(gate));
		if (!onComputerPage(gate)) throw new HttpError(403, "Access can only be changed on the computer that runs Porchlight");
		if (route === "POST /api/access") {
			const enabled = bodyObject(body).enabled;
			if (typeof enabled !== "boolean") throw new HttpError(400, "Say whether access is on");
			// One change at a time, saved before it takes effect: the file always says what a restart
			// should open, and a change that could not be saved changes nothing (S25).
			await oneAtATime(accessPath, async () => {
				const next = { enabled, key: access.key || newAccessKey() };
				await saveAccess(accessPath, next);
				access = next;
				await applyAccess();
			});
			return sendJson(res, 200, accessState(gate));
		}
		if (route === "POST /api/access/key") {
			// A new key turns away every device that had the old one, including open pages.
			await oneAtATime(accessPath, async () => {
				const next = { ...access, key: newAccessKey() };
				await saveAccess(accessPath, next);
				access = next;
				await applyAccess();
			});
			return sendJson(res, 200, accessState(gate));
		}
		throw new HttpError(404, "Not found");
	}

	return {
		accessRoute,
		applyAccess,
		stopAccess,
		accessStatus: () => accessStatus,
		/** Stops retrying to find the tailnet address. */
		clearRetry: () => clearInterval(accessRetry),
		/** A service is reached however it is deployed: no second listener, and no key for one. */
		turnOffForService: () => {
			access = { enabled: false, key: "" };
		},
	};
}
