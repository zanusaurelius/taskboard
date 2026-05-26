#!/usr/bin/env node
// Custom migration runner for the encrypted libSQL database.
// Replaces `prisma migrate deploy`, which cannot open SQLCipher-encrypted files.

import { createClient } from "@libsql/client";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const url = process.env.DATABASE_URL;
const encryptionKey = process.env.DB_ENCRYPTION_KEY;

if (!url) { console.error("DATABASE_URL is not set"); process.exit(1); }
if (!encryptionKey) { console.error("DB_ENCRYPTION_KEY is not set"); process.exit(1); }

const client = createClient({ url, encryptionKey });

// Create migrations tracking table matching Prisma's schema exactly
await client.execute(`
  CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id"                    TEXT PRIMARY KEY NOT NULL,
    "checksum"              TEXT NOT NULL,
    "finished_at"           DATETIME,
    "migration_name"        TEXT NOT NULL,
    "logs"                  TEXT,
    "rolled_back_at"        DATETIME,
    "started_at"            DATETIME NOT NULL DEFAULT current_timestamp,
    "applied_steps_count"   INTEGER NOT NULL DEFAULT 0
  )
`);

const { rows } = await client.execute(
  `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
);
const applied = new Set(rows.map((r) => String(r.migration_name)));

const migrationsDir = join(__dirname, "prisma", "migrations");
const dirs = (await readdir(migrationsDir, { withFileTypes: true }))
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort();

let count = 0;
for (const name of dirs) {
  if (applied.has(name)) continue;
  const sqlPath = join(migrationsDir, name, "migration.sql");
  if (!existsSync(sqlPath)) continue;

  const sql = await readFile(sqlPath, "utf8");
  const checksum = createHash("sha256").update(sql).digest("hex");
  const id = randomUUID();
  const startedAt = new Date().toISOString();

  try {
    // Wrap in a transaction for atomicity; executeMultiple handles the full SQL file
    await client.executeMultiple(`BEGIN;\n${sql}\nCOMMIT;`);
    await client.execute({
      sql: `INSERT INTO "_prisma_migrations"
              (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
            VALUES (?, ?, ?, ?, ?, 1)`,
      args: [id, checksum, new Date().toISOString(), name, startedAt],
    });
    console.log(`  ✓ ${name}`);
    count++;
  } catch (err) {
    console.error(`  ✗ ${name}: ${err.message}`);
    process.exit(1);
  }
}

console.log(count > 0 ? `Applied ${count} migration(s).` : "Database is up to date.");
client.close();
