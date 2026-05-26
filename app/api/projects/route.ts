import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";
import { MAX_PROJECT_NAME_LEN } from "@/lib/constants";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const includeArchived = searchParams.get("includeArchived") === "true";
  const projects = await prisma.project.findMany({
    where: { userId, ...(includeArchived ? {} : { archived: false }) },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(projects);
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  const { name, encName, color } = body ?? {};
  if (!name?.trim() && !encName) return NextResponse.json({ error: "name or encName is required" }, { status: 400 });
  if (name?.trim() && name.trim().length > MAX_PROJECT_NAME_LEN) {
    return NextResponse.json({ error: `Name must be at most ${MAX_PROJECT_NAME_LEN} characters` }, { status: 400 });
  }
  const validColor = typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
  const project = await prisma.project.create({
    data: { name: name?.trim() ?? "", ...(encName !== undefined && { encName }), color: validColor, userId },
  });
  return NextResponse.json(project, { status: 201 });
}
