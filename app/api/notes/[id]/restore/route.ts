import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: noteId } = await params;

  const note = await prisma.note.findFirst({ where: { id: noteId, userId } });
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const restored = await prisma.note.update({
    where: { id: noteId },
    data: { deletedAt: null },
  });
  return NextResponse.json(restored);
}
