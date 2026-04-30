import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { MAX_NOTE_TITLE_LEN, MAX_NOTE_CONTENT_LEN } from "@/lib/constants";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const notes = await prisma.note.findMany({
    where: { userId },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json(notes);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const body = await request.json().catch(() => ({}));

  if (body.title !== undefined && body.title.length > MAX_NOTE_TITLE_LEN) {
    return NextResponse.json({ error: `Title must be at most ${MAX_NOTE_TITLE_LEN} characters` }, { status: 400 });
  }
  if (body.content !== undefined && body.content.length > MAX_NOTE_CONTENT_LEN) {
    return NextResponse.json({ error: "Content exceeds maximum allowed size" }, { status: 400 });
  }

  // Validate projectId ownership before associating
  if (body.projectId) {
    const project = await prisma.project.findFirst({ where: { id: body.projectId, userId } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Validate folderId ownership before associating
  if (body.folderId) {
    const folder = await prisma.folder.findFirst({ where: { id: body.folderId, userId } });
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const note = await prisma.note.create({
    data: {
      title: body.title ?? "",
      content: body.content ?? "",
      userId,
      ...(body.projectId ? { projectId: body.projectId } : {}),
      ...(body.folderId ? { folderId: body.folderId } : {}),
    },
  });
  return NextResponse.json(note, { status: 201 });
}
