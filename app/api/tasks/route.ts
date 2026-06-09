import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";
import { MAX_TASK_TITLE_LEN, MAX_TASK_DESC_LEN } from "@/lib/constants";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  return NextResponse.json(
    tasks.map((t) =>
      t.locked
        ? { ...t, title: t.encTitle ? "" : t.title, description: t.encDescription ? null : t.description }
        : t,
    ),
  );
}

export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  const { title, encTitle, description, encDescription, stage, priority, dueDate, projectId, position, sensitive, locked } = body;
  if ((!title?.trim() && !encTitle) || !projectId) {
    return NextResponse.json({ error: "title (or encTitle) and projectId are required" }, { status: 400 });
  }
  if (title && title.length > MAX_TASK_TITLE_LEN) {
    return NextResponse.json({ error: `Title must be at most ${MAX_TASK_TITLE_LEN} characters` }, { status: 400 });
  }
  if (encTitle && typeof encTitle !== "string") {
    return NextResponse.json({ error: "encTitle must be a string" }, { status: 400 });
  }
  if (description !== undefined && description !== null && description.length > MAX_TASK_DESC_LEN) {
    return NextResponse.json({ error: "Description exceeds maximum allowed size" }, { status: 400 });
  }

  // Verify project belongs to user
  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const created = await prisma.task.create({
    data: {
      title: title ?? "",
      ...(encTitle !== undefined && { encTitle }),
      description,
      ...(encDescription !== undefined && { encDescription }),
      stage: stage || "todo",
      priority,
      dueDate,
      projectId,
      position: position ?? 0,
      sensitive: sensitive === true,
      locked: locked === true,
    },
  });
  // Neon HTTP: create+include uses an implicit transaction — fetch separately
  const task = await prisma.task.findUnique({ where: { id: created.id }, include: { project: true } });
  return NextResponse.json(task, { status: 201 });
}
