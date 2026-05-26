import * as SQLite from 'expo-sqlite';

let _db: SQLite.SQLiteDatabase | null = null;

async function db(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return _db;
  _db = await SQLite.openDatabaseAsync('offline.db');
  await _db.execAsync(`
    CREATE TABLE IF NOT EXISTS pending_ops (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      method      TEXT    NOT NULL,
      path        TEXT    NOT NULL,
      body        TEXT,
      created_at  INTEGER NOT NULL DEFAULT (strftime('%s','now')),
      retry_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS last_synced (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  return _db;
}

export interface PendingOp {
  id: number;
  method: string;
  path: string;
  body: string | null;
  created_at: number;
  retry_count: number;
}

export async function enqueue(method: string, path: string, body?: object): Promise<void> {
  const d = await db();
  await d.runAsync(
    'INSERT INTO pending_ops (method, path, body) VALUES (?, ?, ?)',
    method,
    path,
    body !== undefined ? JSON.stringify(body) : null,
  );
}

export async function dequeue(id: number): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM pending_ops WHERE id = ?', id);
}

export async function incrementRetry(id: number): Promise<void> {
  const d = await db();
  await d.runAsync('UPDATE pending_ops SET retry_count = retry_count + 1 WHERE id = ?', id);
}

export async function allPending(): Promise<PendingOp[]> {
  const d = await db();
  return d.getAllAsync<PendingOp>('SELECT * FROM pending_ops ORDER BY id ASC');
}

export async function pendingCount(): Promise<number> {
  const d = await db();
  const row = await d.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM pending_ops');
  return row?.n ?? 0;
}

// ── Last-synced timestamps per item ────────────────────────────────────────────
// Stored as `{type}:{id}` → ISO string. Used for false-conflict detection.

export async function getLastSynced(type: string, id: string): Promise<string | null> {
  const d = await db();
  const row = await d.getFirstAsync<{ value: string }>(
    'SELECT value FROM last_synced WHERE key = ?',
    `${type}:${id}`,
  );
  return row?.value ?? null;
}

export async function setLastSynced(type: string, id: string, updatedAt: string): Promise<void> {
  const d = await db();
  await d.runAsync(
    'INSERT OR REPLACE INTO last_synced (key, value) VALUES (?, ?)',
    `${type}:${id}`,
    updatedAt,
  );
}
