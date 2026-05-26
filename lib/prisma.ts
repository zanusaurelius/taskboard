import { PrismaClient } from "@prisma/client";
import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";

declare global {
  // eslint-disable-next-line no-var
  var _prisma: PrismaClient | undefined;
}

// In development, initialise an adapter-backed PrismaClient immediately so the
// app works without going through the unlock flow.
if (process.env.NODE_ENV !== "production" && !global._prisma) {
  const devUrl = process.env.DATABASE_URL ?? "file:./dev.db";
  // Prisma resolves file: URLs relative to prisma/, but better-sqlite3 resolves
  // relative to CWD. Normalise so both point to the same file.
  const normDevUrl = devUrl.startsWith("file:./")
    ? `file:${process.cwd()}/prisma/${devUrl.slice(7)}`
    : devUrl;
  const devAdapter = new PrismaBetterSQLite3({ url: normDevUrl });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global._prisma = new PrismaClient({ adapter: devAdapter } as any);
}

// Creates an adapter-backed encrypted PrismaClient and stores it in global._prisma.
// Must be called after global.__dbKey is set (i.e. after the user unlocks).
// Key application is handled by patch-sqlite.js: every new Database() call
// automatically runs PRAGMA key="x'<hexKey>'" via the EncryptedDatabase subclass,
// which is the correct SQLCipher raw-key format (no PBKDF2 applied).
export function initPrisma(): void {
  if (global._prisma) {
    global._prisma.$disconnect().catch(() => {});
  }
  const dbUrl = process.env.DATABASE_URL ?? "file:/app/db/dev.db";
  const factory = new PrismaBetterSQLite3({ url: dbUrl });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  global._prisma = new PrismaClient({ adapter: factory } as any);
}

// Proxy so all existing `prisma.model.method()` calls work unchanged.
// Throws a clear error in production if the DB hasn't been unlocked yet.
export const prisma = new Proxy({} as PrismaClient, {
  get(_, prop) {
    if (typeof prop === "symbol" || prop === "then") return undefined;
    if (!global._prisma) throw new Error("Database not unlocked");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (global._prisma as any)[prop];
  },
});
