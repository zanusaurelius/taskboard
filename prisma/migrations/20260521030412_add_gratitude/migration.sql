-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DailyReflection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "note" TEXT,
    "gratitude" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "DailyReflection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_DailyReflection" ("createdAt", "date", "gratitude", "id", "note", "updatedAt", "userId") SELECT "createdAt", "date", "gratitude", "id", "note", "updatedAt", "userId" FROM "DailyReflection";
DROP TABLE "DailyReflection";
ALTER TABLE "new_DailyReflection" RENAME TO "DailyReflection";
CREATE INDEX "DailyReflection_userId_date_idx" ON "DailyReflection"("userId", "date");
CREATE UNIQUE INDEX "DailyReflection_userId_date_key" ON "DailyReflection"("userId", "date");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
