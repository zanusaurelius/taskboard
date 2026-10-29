import * as SQLite from 'expo-sqlite';

let _db: SQLite.SQLiteDatabase | null = null;
let _dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function db(): Promise<SQLite.SQLiteDatabase> {
  if (_db) return Promise.resolve(_db);
  if (!_dbPromise) {
    _dbPromise = SQLite.openDatabaseAsync('offline.db').then(async (d) => {
      await d.execAsync(`
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
        CREATE TABLE IF NOT EXISTS cache (
          key        TEXT    PRIMARY KEY,
          value      TEXT    NOT NULL,
          updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
        );
      `);
      _db = d;
      return d;
    });
  }
  return _dbPromise;
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
  try {
    const d = await db();
    await d.runAsync(
      'INSERT INTO pending_ops (method, path, body) VALUES (?, ?, ?)',
      method,
      path,
      body !== undefined ? JSON.stringify(body) : null,
    );
  } catch (e) {
    console.error('[offline-db] enqueue failed:', e);
    throw e;
  }
}

/**
 * Queues a write that replaces any earlier queued write to the same path, for idempotent
 * requests such as PUT /api/habits/:id/logs/:date where only the latest value matters.
 */
export async function enqueueReplacing(method: string, path: string, body?: object): Promise<void> {
  const d = await db();
  await d.withTransactionAsync(async () => {
    await d.runAsync('DELETE FROM pending_ops WHERE method = ? AND path = ?', method, path);
    await d.runAsync(
      'INSERT INTO pending_ops (method, path, body) VALUES (?, ?, ?)',
      method,
      path,
      body !== undefined ? JSON.stringify(body) : null,
    );
  });
}

/** Drops queued writes to a path, e.g. once a newer value for it has reached the server. */
export async function dequeuePath(method: string, path: string): Promise<void> {
  const d = await db();
  await d.runAsync('DELETE FROM pending_ops WHERE method = ? AND path = ?', method, path);
}

export async function pendingWithPrefix(prefix: string): Promise<PendingOp[]> {
  const d = await db();
  return d.getAllAsync<PendingOp>(
    "SELECT * FROM pending_ops WHERE path LIKE ? ESCAPE '\\' ORDER BY id ASC",
    prefix.replace(/[\\%_]/g, (c) => '\\' + c) + '%',
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

// ── Read cache ────────────────────────────────────────────────────────────────
// The last good server response per key, so screens can show data with no connection.
// Values are stored exactly as the server sent them; vault-encrypted fields stay encrypted.

export async function getCached<T>(key: string): Promise<{ data: T; updatedAt: number } | null> {
  try {
    const d = await db();
    const row = await d.getFirstAsync<{ value: string; updated_at: number }>(
      'SELECT value, updated_at FROM cache WHERE key = ?',
      key,
    );
    return row ? { data: JSON.parse(row.value) as T, updatedAt: row.updated_at } : null;
  } catch (e) {
    console.warn('[offline-db] cache read failed:', key, e);
    return null;
  }
}

export async function setCached(key: string, data: unknown): Promise<void> {
  try {
    const d = await db();
    await d.runAsync(
      "INSERT OR REPLACE INTO cache (key, value, updated_at) VALUES (?, ?, strftime('%s','now'))",
      key,
      JSON.stringify(data),
    );
  } catch (e) {
    console.warn('[offline-db] cache write failed:', key, e);
  }
}

/** Wipes cached data, keeping queued writes so they still sync after signing back in. */
export async function clearCache(): Promise<void> {
  const d = await db();
  await d.execAsync('DELETE FROM cache;');
}

/** Wipes cached data and queued writes, so nothing carries over to another account or server. */
export async function clearOfflineData(): Promise<void> {
  const d = await db();
  await d.execAsync('DELETE FROM cache; DELETE FROM pending_ops; DELETE FROM last_synced;');
}
