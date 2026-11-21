declare namespace Cloudflare {
	interface Env {
		TEST_MIGRATIONS: import("cloudflare:test").D1Migration[];
		/** Empty at the start; `migrations.test.ts` applies the migrations to it in steps. */
		MIGRATION_TEST_DB: D1Database;
	}
}
