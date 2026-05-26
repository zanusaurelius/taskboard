import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";

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

// DELETE — empty trash (permanently delete all trashed notes)
export async function DELETE(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.note.deleteMany({ where: { userId, deletedAt: { not: null } } });
  return new NextResponse(null, { status: 204 });
}
