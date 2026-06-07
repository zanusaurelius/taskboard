import { NextResponse } from "next/server";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const folder = await prisma.fileFolder.findFirst({
    where: { id, userId },
    select: { id: true, name: true, parentId: true, createdAt: true, updatedAt: true, _count: { select: { uploads: true, children: true } } },
  });
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(folder);
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const folder = await prisma.fileFolder.findFirst({ where: { id, userId } });
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json();
  const { name, parentId } = body as { name?: string; parentId?: string | null };

  if (name !== undefined && !name.trim()) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
  if (name !== undefined && name.trim().length > 255) return NextResponse.json({ error: "Name too long" }, { status: 400 });

  // Verify new parent belongs to user and isn't a descendant (would create a cycle)
  if (parentId !== undefined && parentId !== null && parentId !== folder.parentId) {
    if (parentId === id) return NextResponse.json({ error: "Cannot move folder into itself" }, { status: 400 });
    const parent = await prisma.fileFolder.findFirst({ where: { id: parentId, userId } });
    if (!parent) return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
    // Walk the ancestor chain to ensure `id` is not already an ancestor of `parentId`
    let cursor: string | null = parentId;
    const visited = new Set<string>();
    while (cursor) {
      if (visited.has(cursor)) break; // Existing cycle in DB — stop walking
      visited.add(cursor);
      const anc: { parentId: string | null } | null = await prisma.fileFolder.findFirst({ where: { id: cursor, userId }, select: { parentId: true } });
      if (!anc) break;
      if (anc.parentId === id) return NextResponse.json({ error: "Cannot move a folder into its own descendant" }, { status: 400 });
      cursor = anc.parentId;
    }
  }

  const updated = await prisma.fileFolder.update({
    where: { id },
    data: {
      ...(name !== undefined ? { name: name.trim() } : {}),
      ...(parentId !== undefined ? { parentId: parentId } : {}),
    },
    select: {
      id: true,
      name: true,
      parentId: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { uploads: true, children: true } },
    },
  });

  return NextResponse.json(updated);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const folder = await prisma.fileFolder.findFirst({ where: { id, userId } });
  if (!folder) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Move contents to parent (or root) before deleting
  await prisma.upload.updateMany({
    where: { fileFolderId: id, userId },
    data: { fileFolderId: folder.parentId },
  });
  await prisma.fileFolder.updateMany({
    where: { parentId: id, userId },
    data: { parentId: folder.parentId },
  });

  await prisma.fileFolder.delete({ where: { id } });

  return new Response(null, { status: 204 });
}
