import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";

const REBUILD = "0003_domain_ids_never_reused.sql";
const ERRORS = "0004_errors_and_alert_delivery.sql";

describe("migrations", () => {
	it("rebuilds domains so ids are never reused, keeping every row, snapshot, index and cascade", async () => {
		const db = env.MIGRATION_TEST_DB;
		const migrations = env.TEST_MIGRATIONS;
		expect(migrations.map((migration) => migration.name)).toContain(REBUILD);
		await applyD1Migrations(
			db,
			migrations.filter((migration) => migration.name < REBUILD),
		);

		// A monitor in use: one domain scanned, one lapsed with a scan claimed, one since removed.
		const addDomain = db.prepare(
			`INSERT INTO domains (id, name, challenge_token, verified_at, last_scan_at, last_scan_status,
			   created_at, error_streak, scan_claimed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		);
		const addSnapshot = db.prepare(
			"INSERT INTO snapshots (domain_id, taken_at, data, report) VALUES (?, ?, ?, ?)",
		);
		const at = (day: number) => `2026-11-${String(day).padStart(2, "0")}T12:00:00.000Z`;
		await db.batch([
			addDomain.bind(1, "alpha.test", "aa".repeat(24), at(1), at(3), "ok", at(1), 0, null),
			addDomain.bind(2, "charlie.test", "cc".repeat(24), null, null, null, at(2), 0, null),
			addDomain.bind(3, "bravo.test", "bb".repeat(24), at(1), at(4), "unverified", at(1), 2, at(4)),
			addSnapshot.bind(1, at(2), '{"domain":"alpha.test"}', '{"n":1}'),
			addSnapshot.bind(1, at(3), '{"domain":"alpha.test"}', '{"n":2}'),
			addSnapshot.bind(3, at(3), '{"domain":"bravo.test"}', '{"n":3}'),
			addSnapshot.bind(2, at(3), '{"domain":"charlie.test"}', '{"n":4}'),
		]);
		await db.prepare("DELETE FROM domains WHERE name = 'charlie.test'").run();
		const all = async (sql: string) => (await db.prepare(sql).all()).results;
		const domainsBefore = await all("SELECT * FROM domains ORDER BY id");
		const snapshotsBefore = await all("SELECT * FROM snapshots ORDER BY id");
		// The removed domain's snapshot went with it, so foreign keys are enforced here as on D1.
		expect(snapshotsBefore.map((row) => row.domain_id)).toEqual([1, 1, 3]);

		// Up to this migration: later ones add columns, which the next test checks.
		await applyD1Migrations(
			db,
			migrations.filter((migration) => migration.name <= REBUILD),
		);

		expect(await all("SELECT * FROM domains ORDER BY id")).toEqual(domainsBefore);
		expect(await all("SELECT * FROM snapshots ORDER BY id")).toEqual(snapshotsBefore);
		const { results: schema } = await db
			.prepare(
				"SELECT type, name, sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND name NOT GLOB '_cf_*' AND name != 'd1_migrations' ORDER BY name",
			)
			.all<{ type: string; name: string; sql: string }>();
		expect(schema.map((row) => `${row.type} ${row.name}`)).toEqual([
			"table domains",
			"table snapshots",
			"index snapshots_domain_taken",
		]);
		expect(schema[0]!.sql).toContain("AUTOINCREMENT");
		expect(await all("PRAGMA foreign_key_list(snapshots)")).toMatchObject([
			{ table: "domains", from: "domain_id", to: "id", on_delete: "CASCADE" },
		]);
		expect(await all("PRAGMA index_list(snapshots)")).toMatchObject([
			{ name: "snapshots_domain_taken" },
		]);

		// Removing a domain still removes its snapshots, and its id, the highest, is not handed to the
		// next (SQLite without AUTOINCREMENT would give 3 again).
		await db.prepare("DELETE FROM domains WHERE name = 'bravo.test'").run();
		expect((await all("SELECT domain_id FROM snapshots")).map((row) => row.domain_id)).toEqual([
			1, 1,
		]);
		const added = await db
			.prepare(
				"INSERT INTO domains (name, challenge_token, created_at) VALUES ('delta.test', ?, ?) RETURNING id",
			)
			.bind("dd".repeat(24), at(5))
			.first<{ id: number }>();
		expect(added!.id).toBe(4);
	});

	it("adds a scan's last error and the monitor's status row, keeping every domain as it was", async () => {
		const db = env.MIGRATION_TEST_DB;
		const migrations = env.TEST_MIGRATIONS;
		expect(migrations.map((migration) => migration.name)).toContain(ERRORS);
		await applyD1Migrations(
			db,
			migrations.filter((migration) => migration.name < ERRORS),
		);
		await db
			.prepare(
				`INSERT INTO domains (name, challenge_token, verified_at, last_scan_at, last_scan_status,
				   created_at, error_streak) VALUES ('echo.test', ?, ?, ?, 'error', ?, 2)`,
			)
			.bind(
				"ee".repeat(24),
				"2026-11-01T12:00:00.000Z",
				"2026-11-02T12:00:00.000Z",
				"2026-11-01T12:00:00.000Z",
			)
			.run();
		const before = await db.prepare("SELECT * FROM domains WHERE name = 'echo.test'").first();

		await applyD1Migrations(db, migrations);

		// The failure happened before its reason was kept: not known, so null rather than made up.
		expect(await db.prepare("SELECT * FROM domains WHERE name = 'echo.test'").first()).toEqual({
			...before,
			last_error: null,
		});
		expect((await db.prepare("SELECT * FROM monitor_status").all()).results).toEqual([
			{
				id: 1,
				alert_sent_at: null,
				alert_error: null,
				alert_error_at: null,
				schedule_error: null,
				schedule_error_at: null,
			},
		]);
		// There is only ever one status row.
		await expect(db.prepare("INSERT INTO monitor_status (id) VALUES (2)").run()).rejects.toThrow();
	});
});
