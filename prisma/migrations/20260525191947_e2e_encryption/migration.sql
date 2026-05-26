-- AlterTable
ALTER TABLE "DailyGoal" ADD COLUMN "encText" TEXT;

-- AlterTable
ALTER TABLE "DailyReflection" ADD COLUMN "encBody" TEXT;
ALTER TABLE "DailyReflection" ADD COLUMN "encGratitude" TEXT;
ALTER TABLE "DailyReflection" ADD COLUMN "encNote" TEXT;

-- AlterTable
ALTER TABLE "Folder" ADD COLUMN "encName" TEXT;

-- AlterTable
ALTER TABLE "Habit" ADD COLUMN "encText" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN "encName" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "encDescription" TEXT;
ALTER TABLE "Task" ADD COLUMN "encTitle" TEXT;
