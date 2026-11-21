import { defineConfig } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// The public demo of Porchlight's interface, with made-up data and nothing behind it that can
// change. It needs no binding, no secret and no database.
export default defineConfig(() => ({
	worker: {
		name: "porchlight-demo",
		compatibilityDate: "2026-11-17",
		// The roadmap code it bundles from cli/ imports node:path.
		compatibilityFlags: ["nodejs_compat"],
		entrypoint,
		domains: ["porchlight.theengineers.xyz"],
		observability: { enabled: true },
	},
}));
