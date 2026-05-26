import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";
import { MAX_FOLDER_NAME_LEN } from "@/lib/constants";

async function getOwnedFolder(id: string, userId: string) {
  return prisma.folder.findFirst({ where: { id, userId } });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: folderId } = await params;

  const existing = await getOwnedFolder(folderId, userId);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);

  if (body?.clientUpdatedAt) {
    const clientTs = new Date(body.clientUpdatedAt).getTime();
    if (!isNaN(clientTs) && existing.updatedAt.getTime() > clientTs) {
      return NextResponse.json({ conflict: true, serverItem: existing }, { status: 409 });
    }
  }

  const { name, encName, hidden, locked, pinned } = body ?? {};
  const data: { name?: string; encName?: string | null; pinned?: boolean; hidden?: boolean; locked?: boolean } = {};
  if (name !== undefined) {
    if (typeof name === "string" && name.trim().length > MAX_FOLDER_NAME_LEN) {
      return NextResponse.json({ error: `Name must be at most ${MAX_FOLDER_NAME_LEN} characters` }, { status: 400 });
    }
    data.name = typeof name === "string" ? name.trim() : name;
  }
  if ("encName" in (body ?? {})) data.encName = encName ?? null;
  if (pinned !== undefined) data.pinned = pinned;
  if (hidden !== undefined) data.hidden = hidden;
  if (locked !== undefined) data.locked = locked;
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  const folder = await prisma.folder.update({ where: { id: folderId }, data });
  return NextResponse.json(folder);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: folderId } = await params;

  if (!await getOwnedFolder(folderId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.note.updateMany({ where: { folderId, userId }, data: { folderId: null } });
  await prisma.folder.delete({ where: { id: folderId } });
  return new NextResponse(null, { status: 204 });
}
