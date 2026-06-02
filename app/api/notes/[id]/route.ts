import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";
import { verifyRevealToken } from "@/lib/vault-session";
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

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: noteId } = await params;
  const note = await getOwnedNote(noteId, userId);
  if (!note || note.deletedAt) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Hidden notes require a valid vault reveal token
  if (note.hidden) {
    const revealToken = request.headers.get("x-reveal-token") ?? "";
    const revealed = revealToken ? verifyRevealToken(userId, revealToken) : false;
    if (!revealed) return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (note.locked) return NextResponse.json({ ...note, content: "", title: note.encTitle ? "" : note.title });
  return NextResponse.json(note);
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = await getUserId(request);
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { id: noteId } = await params;

    const existing = await getOwnedNote(noteId, userId);
    if (!existing || existing.deletedAt) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json().catch(() => null);
    if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

    // Modifying vault-protected fields requires a valid reveal token.
    // Also required when writing enc fields on an already-locked note — prevents
    // an authenticated session from corrupting vault content without the vault key.
    const touchingVaultFields = body.locked !== undefined || body.hidden !== undefined;
    const touchingEncOnLockedNote = (body.encContent !== undefined || body.encTitle !== undefined) && existing.locked;
    if (touchingVaultFields || touchingEncOnLockedNote) {
      const revealToken = request.headers.get("x-reveal-token") ?? "";
      const revealed = revealToken ? verifyRevealToken(userId, revealToken) : false;
      if (!revealed) {
        return NextResponse.json({ error: "Vault token required" }, { status: 403 });
      }
    }

    // Conflict detection: if the client tells us when it last saw this note and the
    // server version is newer, stop and let the client decide how to resolve it.
    if (body.clientUpdatedAt) {
      const clientTs = new Date(body.clientUpdatedAt).getTime();
      if (!isNaN(clientTs) && existing.updatedAt.getTime() > clientTs) {
        return NextResponse.json({ conflict: true, serverItem: existing }, { status: 409 });
      }
    }

    if (body.title != null && typeof body.title === "string" && body.title.length > MAX_NOTE_TITLE_LEN) {
      return NextResponse.json({ error: `Title must be at most ${MAX_NOTE_TITLE_LEN} characters` }, { status: 400 });
    }
    if (body.content != null && typeof body.content === "string" && body.content.length > MAX_NOTE_CONTENT_LEN) {
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
        ...(body.folderId   !== undefined && { folderId: body.folderId }),
        ...(body.projectId  !== undefined && { projectId: body.projectId }),
        ...(body.locked     !== undefined && { locked: body.locked }),
        ...(body.hidden     !== undefined && { hidden: body.hidden }),
        ...(body.hint       !== undefined && { hint: body.hint }),
        ...(body.encContent !== undefined && { encContent: body.encContent }),
        ...(body.encTitle   !== undefined && { encTitle: body.encTitle }),
      },
    });
    return NextResponse.json(note);
  } catch (e) {
    console.error("PUT /api/notes/[id] error:", e);
    return NextResponse.json({ error: "Failed to update note" }, { status: 500 });
  }
}

async function hardDelete(noteId: string, userId: string, note: { content: string }) {
  const filenames = extractUploadFilenames(note.content);
  if (filenames.length > 0) {
    const uploadDir = join(process.cwd(), "data", "uploads");
    for (const filename of filenames) {
      if (await isFilenameReferenced(filename, userId, noteId)) continue;
      await prisma.upload.deleteMany({ where: { filename, userId } });
      await unlink(join(uploadDir, filename)).catch(() => {});
    }
  }
  await prisma.note.delete({ where: { id: noteId } });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: noteId } = await params;

  const note = await getOwnedNote(noteId, userId);
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const permanent = new URL(request.url).searchParams.get("permanent") === "true";

  // Locked/hidden notes and permanent-delete requests: hard delete immediately
  if (note.locked || note.hidden || permanent) {
    await hardDelete(noteId, userId, note);
    return new NextResponse(null, { status: 204 });
  }

  // Regular notes: soft delete (move to trash)
  const trashed = await prisma.note.update({
    where: { id: noteId },
    data: { deletedAt: new Date(), pinned: false, starred: false },
  });
  return NextResponse.json(trashed);
}
