import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { MAX_FOLDER_NAME_LEN } from "@/lib/constants";

async function getOwnedFolder(id: string, userId: string) {
  return prisma.folder.findFirst({ where: { id, userId } });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { id: folderId } = await params;

  if (!await getOwnedFolder(folderId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { name } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (name.trim().length > MAX_FOLDER_NAME_LEN) {
    return NextResponse.json({ error: `Name must be at most ${MAX_FOLDER_NAME_LEN} characters` }, { status: 400 });
  }
  const folder = await prisma.folder.update({
    where: { id: folderId },
    data: { name: name.trim() },
  });
  return NextResponse.json(folder);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { id: folderId } = await params;

  if (!await getOwnedFolder(folderId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  await prisma.note.updateMany({ where: { folderId, userId }, data: { folderId: null } });
  await prisma.folder.delete({ where: { id: folderId } });
  return new NextResponse(null, { status: 204 });
}
