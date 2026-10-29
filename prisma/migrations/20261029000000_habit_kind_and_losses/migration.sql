-- Habits become GOOD (building) or BAD (breaking); a completion can now record a loss.
-- Existing habits default to GOOD and existing completions to wins, so no history changes meaning.
ALTER TABLE "Habit" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'GOOD';
ALTER TABLE "Habit" ADD COLUMN "archivedAt" DATETIME;
ALTER TABLE "HabitCompletion" ADD COLUMN "isLoss" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "weekStartsOn" INTEGER NOT NULL DEFAULT 0;
