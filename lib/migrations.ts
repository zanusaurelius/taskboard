import { createHash, randomUUID } from "crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import path from "path";

const migrationsDir = path.join(process.cwd(), "prisma", "migrations");

// Runs any pending Prisma migrations against an already-open better-sqlite3
// Database instance. The caller is responsible for opening and closing db.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function runMigrations(db: any): number {
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS _prisma_migrations (
      id                  TEXT     PRIMARY KEY NOT NULL,
      checksum            TEXT     NOT NULL,
      finished_at         DATETIME,
      migration_name      TEXT     NOT NULL,
      logs                TEXT,
      rolled_back_at      DATETIME,
      started_at          DATETIME NOT NULL DEFAULT current_timestamp,
      applied_steps_count INTEGER  NOT NULL DEFAULT 0
    )
  `);

  const folders = readdirSync(migrationsDir)
    .filter((f) => statSync(path.join(migrationsDir, f)).isDirectory())
    .sort();

  // Load applied migrations with their recorded checksums
  const applied = new Map<string, string>(
    db
      .prepare(
        "SELECT migration_name, checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL"
      )
      .all()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((r: any) => [r.migration_name, r.checksum] as [string, string])
  );

  let count = 0;
  for (const folder of folders) {
    const sqlFile = path.join(migrationsDir, folder, "migration.sql");
    if (!existsSync(sqlFile)) continue;

    const sql = readFileSync(sqlFile, "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");

    if (applied.has(folder)) {
      // Verify the migration file hasn't changed since it was applied
      if (applied.get(folder) !== checksum) {
        throw new Error(
          `Migration checksum mismatch for ${folder}: file was modified after application`
        );
      }
      continue;
    }

    const id = randomUUID();
    const startedAt = new Date().toISOString();

    try {
      // DDL and migration record are a single atomic unit — if the INSERT fails the
      // schema change rolls back, and if the schema change fails it never records.
      db.transaction(() => {
        db.exec(sql);
        db.prepare(
          "INSERT INTO _prisma_migrations (id, checksum, finished_at, migration_name, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, 1)"
        ).run(id, checksum, new Date().toISOString(), folder, startedAt);
      })();
      count++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // Best-effort failure log — outside the rolled-back transaction
      try {
        db.prepare(
          "INSERT INTO _prisma_migrations (id, checksum, migration_name, logs, rolled_back_at, started_at, applied_steps_count) VALUES (?, ?, ?, ?, ?, ?, 0)"
        ).run(id, checksum, folder, msg, new Date().toISOString(), startedAt);
      } catch { /* ignore logging failure */ }
      throw new Error(`Migration failed (${folder}): ${msg}`);
    }
  }

  return count;
}
