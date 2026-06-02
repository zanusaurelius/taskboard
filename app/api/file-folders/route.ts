import { NextResponse } from "next/server";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const parentId = searchParams.get("parentId"); // null or "" = root-level folders

  const folders = await prisma.fileFolder.findMany({
    where: {
      userId,
      parentId: parentId || null, // coerce "" to null so root folders always show
    },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      parentId: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { uploads: true, children: true } },
    },
  });

  return NextResponse.json(folders);
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  const { name, parentId } = body as { name: string; parentId?: string | null };

  if (!name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (name.trim().length > 255) return NextResponse.json({ error: "Name too long" }, { status: 400 });

  // Verify parent belongs to user
  if (parentId) {
    const parent = await prisma.fileFolder.findFirst({ where: { id: parentId, userId } });
    if (!parent) return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
  }

  const folder = await prisma.fileFolder.create({
    data: { name: name.trim(), parentId: parentId ?? null, userId },
    select: {
      id: true,
      name: true,
      parentId: true,
      createdAt: true,
      updatedAt: true,
      _count: { select: { uploads: true, children: true } },
    },
  });

  return NextResponse.json(folder, { status: 201 });
}
