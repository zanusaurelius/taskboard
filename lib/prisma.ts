import { PrismaClient } from "@prisma/client";

// Bump after every `prisma migrate dev` — forces Turbopack to drop the cached
// PrismaClient and create a fresh one without needing a full server restart.
const SCHEMA_VERSION = "v8-security";

declare global {
  // eslint-disable-next-line no-var
  var _prisma: PrismaClient | undefined;
  // eslint-disable-next-line no-var
  var _prismaVersion: string | undefined;
}

if (global._prismaVersion !== SCHEMA_VERSION) {
  global._prisma = undefined;
}

export const prisma = global._prisma ?? (global._prisma = new PrismaClient());
global._prismaVersion = SCHEMA_VERSION;
