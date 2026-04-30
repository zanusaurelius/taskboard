import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { unlink } from "fs/promises";
import { join } from "path";
import { MAX_NOTE_TITLE_LEN, MAX_NOTE_CONTENT_LEN } from "@/lib/constants";

async function getOwnedNote(id: string, userId: string) {
  return prisma.note.findFirst({ where: { id, userId } });
}

function extractUploadFilenames(html: string): string[] {
  const matches = [...html.matchAll(/\/api\/uploads\/([a-f0-9]+\.(?:jpg|png|gif|webp))/g)];
  return matches.map((m) => m[1]);
}

async function isFilenameReferenced(filename: string, userId: string, excludeNoteId: string): Promise<boolean> {
  const ref = `/api/uploads/${filename}`;
  const inNote = await prisma.note.count({
    where: { userId, id: { not: excludeNoteId }, content: { contains: ref } },
  });
  if (inNote > 0) return true;
  const inTask = await prisma.task.count({
    where: { project: { userId }, description: { contains: ref } },
  });
  return inTask > 0;
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { id: noteId } = await params;

  if (!await getOwnedNote(noteId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();

  if (body.title !== undefined && body.title.length > MAX_NOTE_TITLE_LEN) {
    return NextResponse.json({ error: `Title must be at most ${MAX_NOTE_TITLE_LEN} characters` }, { status: 400 });
  }
  if (body.content !== undefined && body.content.length > MAX_NOTE_CONTENT_LEN) {
    return NextResponse.json({ error: "Content exceeds maximum allowed size" }, { status: 400 });
  }

  // Validate projectId ownership if being changed
  if (body.projectId !== undefined && body.projectId !== null) {
    const project = await prisma.project.findFirst({ where: { id: body.projectId, userId } });
    if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Validate folderId ownership if being changed
  if (body.folderId !== undefined && body.folderId !== null) {
    const folder = await prisma.folder.findFirst({ where: { id: body.folderId, userId } });
    if (!folder) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const note = await prisma.note.update({
    where: { id: noteId },
    data: {
      ...(body.title !== undefined && { title: body.title }),
      ...(body.content !== undefined && { content: body.content }),
      ...(body.pinned !== undefined && { pinned: body.pinned }),
      ...(body.starred !== undefined && { starred: body.starred }),
      ...(body.folderId !== undefined && { folderId: body.folderId }),
      ...(body.projectId !== undefined && { projectId: body.projectId }),
    },
  });
  return NextResponse.json(note);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { id: noteId } = await params;

  const note = await getOwnedNote(noteId, userId);
  if (!note) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filenames = extractUploadFilenames(note.content);
  if (filenames.length > 0) {
    const uploadDir = join(process.cwd(), "data", "uploads");
    for (const filename of filenames) {
      // Only delete if no other note or task references this upload
      if (await isFilenameReferenced(filename, userId, noteId)) continue;
      await prisma.upload.deleteMany({ where: { filename, userId } });
      await unlink(join(uploadDir, filename)).catch(() => {});
    }
  }

  await prisma.note.delete({ where: { id: noteId } });
  return new NextResponse(null, { status: 204 });
}
