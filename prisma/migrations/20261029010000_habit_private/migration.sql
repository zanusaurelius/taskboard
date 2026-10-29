-- Private habits are hidden while privacy mode is on.
ALTER TABLE "Habit" ADD COLUMN "private" BOOLEAN NOT NULL DEFAULT false;
