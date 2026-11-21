import { handleRequest } from "./api.ts";
import { liveDeps } from "./env.ts";
import { runDueScan } from "./scan.ts";

export default {
	fetch(request, env, ctx) {
		return handleRequest(request, env, liveDeps, ctx);
	},
	scheduled(_controller, env, ctx) {
		ctx.waitUntil(runDueScan(env, liveDeps));
	},
} satisfies ExportedHandler<Env>;
