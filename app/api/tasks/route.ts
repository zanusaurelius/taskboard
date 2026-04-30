import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { MAX_TASK_TITLE_LEN, MAX_TASK_DESC_LEN } from "@/lib/constants";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { searchParams } = new URL(request.url);
  const includeArchived = searchParams.get("includeArchived") === "true";

  const tasks = await prisma.task.findMany({
    where: {
      project: { userId },
      ...(includeArchived ? {} : { archived: false }),
    },
    include: { project: true },
    orderBy: { position: "asc" },
  });
  return NextResponse.json(tasks);
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const body = await request.json();
  const { title, description, stage, priority, dueDate, projectId, position } = body;
  if (!title || !projectId) {
    return NextResponse.json({ error: "title and projectId are required" }, { status: 400 });
  }
  if (title.length > MAX_TASK_TITLE_LEN) {
    return NextResponse.json({ error: `Title must be at most ${MAX_TASK_TITLE_LEN} characters` }, { status: 400 });
  }
  if (description !== undefined && description !== null && description.length > MAX_TASK_DESC_LEN) {
    return NextResponse.json({ error: "Description exceeds maximum allowed size" }, { status: 400 });
  }

  // Verify project belongs to user
  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const task = await prisma.task.create({
    data: {
      title,
      description,
      stage: stage || "todo",
      priority,
      dueDate,
      projectId,
      position: position ?? 0,
    },
    include: { project: true },
  });
  return NextResponse.json(task, { status: 201 });
}
