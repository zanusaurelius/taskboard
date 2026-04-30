import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { MAX_FOLDER_NAME_LEN } from "@/lib/constants";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const folders = await prisma.folder.findMany({ where: { userId }, orderBy: { name: "asc" } });
  return NextResponse.json(folders);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { name } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (name.trim().length > MAX_FOLDER_NAME_LEN) {
    return NextResponse.json({ error: `Name must be at most ${MAX_FOLDER_NAME_LEN} characters` }, { status: 400 });
  }
  const folder = await prisma.folder.create({ data: { name: name.trim(), userId } });
  return NextResponse.json(folder, { status: 201 });
}
