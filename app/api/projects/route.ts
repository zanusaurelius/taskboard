import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { MAX_PROJECT_NAME_LEN } from "@/lib/constants";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { searchParams } = new URL(request.url);
  const includeArchived = searchParams.get("includeArchived") === "true";
  const projects = await prisma.project.findMany({
    where: { userId, ...(includeArchived ? {} : { archived: false }) },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(projects);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { name } = await request.json();
  if (!name?.trim()) return NextResponse.json({ error: "name is required" }, { status: 400 });
  if (name.trim().length > MAX_PROJECT_NAME_LEN) {
    return NextResponse.json({ error: `Name must be at most ${MAX_PROJECT_NAME_LEN} characters` }, { status: 400 });
  }
  const project = await prisma.project.create({ data: { name: name.trim(), userId } });
  return NextResponse.json(project, { status: 201 });
}
