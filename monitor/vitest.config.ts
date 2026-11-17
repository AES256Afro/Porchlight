import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vite-plus";

export default defineConfig(async () => {
	const migrations = await readD1Migrations("./migrations");
	return {
		plugins: [
			cloudflareTest({
				config: true,
				miniflare: {
					bindings: {
						TEST_MIGRATIONS: migrations,
						ADMIN_TOKEN: "test-admin-token-0123456789abcdef0123456789",
					},
				},
			}),
		],
		test: { setupFiles: ["./test/setup.ts"] },
	};
});
