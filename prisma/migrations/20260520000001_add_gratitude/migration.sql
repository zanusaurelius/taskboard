ALTER TABLE "DailyReflection" ADD COLUMN "gratitude" TEXT;
-- note is now nullable (existing rows already have NULL-compatible TEXT)
