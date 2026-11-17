import { bindings, defineConfig, triggers } from "cf/config";
import * as entrypoint from "./src/index.ts" with { type: "cf-worker" };

// Local development uses a simulated database under this fixed ID, so it
// needs no Cloudflare account. `npm run db:migrate:local` addresses it too.
const LOCAL_D1_ID = "00000000-0000-4000-8000-000000000000";

// The ID printed by `cf d1 create --name securityx-monitor`. Set it before
// the first deploy; remote migrations address the database by this ID.
const D1_DATABASE_ID = "dea67a7e-c591-440b-a178-b6e1bb468736";

export default defineConfig(({ mode }) => ({
	worker: {
		name: "securityx-monitor",
		compatibilityDate: "2026-11-17",
		entrypoint,
		env: {
			DB: bindings.d1({
				name: "securityx-monitor",
				id: mode === "development" ? LOCAL_D1_ID : D1_DATABASE_ID || undefined,
			}),
			// Bearer token for the API. Uploaded with `cf deploy --secrets-file`; see README.
			ADMIN_TOKEN: bindings.secret(),
			// A domain is rescanned once its last scan is older than this.
			SCAN_INTERVAL_HOURS: bindings.text("24"),
			// Hosts probed per scan. 12 keeps a worst-case scan under 50 outbound requests.
			MAX_HOSTS: bindings.text("12"),
			CERT_EXPIRY_WARN_DAYS: bindings.text("14"),
			SNAPSHOTS_TO_KEEP: bindings.text("30"),
		},
		// Each tick scans the single most overdue domain, so one invocation
		// never has to fit more than one domain's requests.
		triggers: [triggers.scheduled({ schedule: "0 * * * *" })],
		observability: { enabled: true },
	},
}));
