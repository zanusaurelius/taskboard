import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";
import { del } from "@vercel/blob";
import { MAX_TASK_TITLE_LEN, MAX_TASK_DESC_LEN } from "@/lib/constants";

async function getOwnedTask(id: string, userId: string) {
  return prisma.task.findFirst({ where: { id, project: { userId } } });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: taskId } = await params;

  const existing = await getOwnedTask(taskId, userId);
  if (!existing) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  if (body.clientUpdatedAt) {
    const clientTs = new Date(body.clientUpdatedAt).getTime();
    if (!isNaN(clientTs) && existing.updatedAt.getTime() > clientTs) {
      return NextResponse.json({ conflict: true, serverItem: existing }, { status: 409 });
    }
  }

  const { title, encTitle, description, encDescription, stage, priority, dueDate, projectId, position, archived, sensitive, locked } = body;

  if (title !== undefined && typeof title === "string" && title.length > MAX_TASK_TITLE_LEN) {
    return NextResponse.json({ error: `Title must be at most ${MAX_TASK_TITLE_LEN} characters` }, { status: 400 });
  }
  if (description !== undefined && description !== null && description.length > MAX_TASK_DESC_LEN) {
    return NextResponse.json({ error: "Description exceeds maximum allowed size" }, { status: 400 });
  }

  if (projectId !== undefined) {
    const targetProject = await prisma.project.findFirst({ where: { id: projectId, userId } });
    if (!targetProject) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  // Neon HTTP: update+include uses an implicit transaction — fetch separately
  await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(title !== undefined && { title }),
      ...(encTitle !== undefined && { encTitle }),
      ...(description !== undefined && { description }),
      ...(encDescription !== undefined && { encDescription }),
      ...(stage !== undefined && { stage }),
      ...(stage !== undefined && {
        doneAt: stage === "done"
          ? (existing.stage !== "done" ? new Date() : existing.doneAt)
          : null,
      }),
      ...(priority !== undefined && { priority }),
      ...(dueDate !== undefined && { dueDate }),
      ...(projectId !== undefined && { projectId }),
      ...(position !== undefined && { position }),
      ...(archived !== undefined && { archived }),
      ...(sensitive !== undefined && { sensitive }),
      ...(locked !== undefined && { locked }),
    },
  });
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { project: true } });

  const response = task!.locked
    ? { ...task, title: task!.encTitle ? "" : task!.title, description: task!.encDescription ? null : task!.description }
    : task;
  return NextResponse.json(response);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: taskId } = await params;

  const task = await getOwnedTask(taskId, userId);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Clean up any blob uploads referenced in the task description
  const attachments = await prisma.attachment.findMany({
    where: { taskId, userId },
    select: { blobUrl: true },
  });
  for (const att of attachments) {
    if (att.blobUrl) del(att.blobUrl).catch(() => {});
  }

  await prisma.task.delete({ where: { id: taskId } });
  return new NextResponse(null, { status: 204 });
}
