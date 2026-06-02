-- CreateTable
CREATE TABLE "FileFolder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "parentId" TEXT,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "FileFolder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "FileFolder" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FileFolder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- AlterTable
ALTER TABLE "Upload" ADD COLUMN "originalName" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Upload" ADD COLUMN "thumbnail" TEXT;
ALTER TABLE "Upload" ADD COLUMN "fileFolderId" TEXT;
ALTER TABLE "Upload" ADD COLUMN "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "FileFolder_userId_idx" ON "FileFolder"("userId");
CREATE INDEX "FileFolder_parentId_idx" ON "FileFolder"("parentId");
CREATE INDEX "Upload_userId_idx" ON "Upload"("userId");
CREATE INDEX "Upload_fileFolderId_idx" ON "Upload"("fileFolderId");
