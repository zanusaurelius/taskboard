import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";
import { verifyRevealToken } from "@/lib/vault-session";
import { MAX_NOTE_TITLE_LEN, MAX_NOTE_CONTENT_LEN } from "@/lib/constants";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const revealToken = request.headers.get("x-reveal-token") ?? "";
  const revealed = revealToken ? verifyRevealToken(userId, revealToken) : false;

  // Purge notes trashed more than 30 days ago
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  await prisma.note.deleteMany({ where: { userId, deletedAt: { lt: thirtyDaysAgo } } });

  const notes = await prisma.note.findMany({
    where: { userId, deletedAt: null, ...(!revealed ? { hidden: false } : {}) },
    orderBy: { updatedAt: "desc" },
  });

  // Strip plaintext content from locked notes — client decrypts from encContent
  return NextResponse.json(
    notes.map((n) =>
      n.locked ? { ...n, content: "", title: n.encTitle ? "" : n.title } : n,
    ),
  );
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));

  if (body.title != null && typeof body.title === "string" && body.title.length > MAX_NOTE_TITLE_LEN) {
    return NextResponse.json({ error: `Title must be at most ${MAX_NOTE_TITLE_LEN} characters` }, { status: 400 });
  }
  if (body.content != null && typeof body.content === "string" && body.content.length > MAX_NOTE_CONTENT_LEN) {
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
      ...(body.encTitle ? { encTitle: body.encTitle } : {}),
      ...(body.encContent ? { encContent: body.encContent } : {}),
      ...(body.projectId ? { projectId: body.projectId } : {}),
      ...(body.folderId ? { folderId: body.folderId } : {}),
    },
  });
  return NextResponse.json(note, { status: 201 });
}
