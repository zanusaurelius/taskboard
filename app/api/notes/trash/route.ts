import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";
import { unlink } from "fs/promises";
import { join } from "path";

// GET — list trashed notes
export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const notes = await prisma.note.findMany({
    where: { userId, deletedAt: { not: null } },
    orderBy: { deletedAt: "desc" },
  });

  return NextResponse.json(
    notes.map((n) => n.locked ? { ...n, content: "", title: n.encTitle ? "" : n.title } : n),
  );
}

// DELETE — empty trash (permanently delete all trashed notes + clean up uploaded files)
export async function DELETE(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const trashed = await prisma.note.findMany({
    where: { userId, deletedAt: { not: null } },
    select: { id: true, content: true },
  });

  if (trashed.length === 0) return new NextResponse(null, { status: 204 });

  const uploadDir = join(process.cwd(), "data", "uploads");
  const uploadPattern = /\/api\/uploads\/([a-f0-9]+\.(?:jpg|png|gif|webp))/g;
  const trashedIds = trashed.map((n) => n.id);

  for (const note of trashed) {
    const matches = [...note.content.matchAll(uploadPattern)];
    for (const match of matches) {
      const filename = match[1];
      // Only delete if not referenced by any non-trashed note or task
      const ref = `/api/uploads/${filename}`;
      const inOtherNote = await prisma.note.count({
        where: { userId, id: { notIn: trashedIds }, content: { contains: ref } },
      });
      const inTask = await prisma.task.count({
        where: { project: { userId }, description: { contains: ref } },
      });
      if (inOtherNote === 0 && inTask === 0) {
        await prisma.upload.deleteMany({ where: { filename, userId } });
        await unlink(join(uploadDir, filename)).catch(() => {});
      }
    }
  }

  await prisma.note.deleteMany({ where: { userId, deletedAt: { not: null } } });
  return new NextResponse(null, { status: 204 });
}
