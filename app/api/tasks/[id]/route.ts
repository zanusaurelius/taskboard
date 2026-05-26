import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";
import { unlink } from "fs/promises";
import { join } from "path";
import { MAX_TASK_TITLE_LEN, MAX_TASK_DESC_LEN } from "@/lib/constants";

function extractUploadFilenames(html: string | null): string[] {
  if (!html) return [];
  return [...html.matchAll(/\/api\/uploads\/([a-f0-9]+\.(?:jpg|png|gif|webp))/g)].map((m) => m[1]);
}

async function getOwnedTask(id: string, userId: string) {
  return prisma.task.findFirst({ where: { id, project: { userId } } });
}

async function isFilenameReferenced(filename: string, userId: string, excludeTaskId: string): Promise<boolean> {
  const ref = `/api/uploads/${filename}`;
  const inTask = await prisma.task.count({
    where: { project: { userId }, id: { not: excludeTaskId }, description: { contains: ref } },
  });
  if (inTask > 0) return true;
  const inNote = await prisma.note.count({
    where: { userId, content: { contains: ref } },
  });
  return inNote > 0;
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

  // Conflict detection: if the client tells us when it last saw this task and the
  // server version is newer, stop and let the client decide how to resolve it.
  if (body.clientUpdatedAt) {
    const clientTs = new Date(body.clientUpdatedAt).getTime();
    if (!isNaN(clientTs) && existing.updatedAt.getTime() > clientTs) {
      return NextResponse.json({ conflict: true, serverItem: existing }, { status: 409 });
    }
  }

  const { title, encTitle, description, encDescription, stage, priority, dueDate, projectId, position, archived, sensitive } = body;

  if (title !== undefined && typeof title === "string" && title.length > MAX_TASK_TITLE_LEN) {
    return NextResponse.json({ error: `Title must be at most ${MAX_TASK_TITLE_LEN} characters` }, { status: 400 });
  }
  if (description !== undefined && description !== null && description.length > MAX_TASK_DESC_LEN) {
    return NextResponse.json({ error: "Description exceeds maximum allowed size" }, { status: 400 });
  }

  // If moving to a different project, verify the target project also belongs to this user
  if (projectId !== undefined) {
    const targetProject = await prisma.project.findFirst({ where: { id: projectId, userId } });
    if (!targetProject) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const task = await prisma.task.update({
    where: { id: taskId },
    data: {
      ...(title !== undefined && { title }),
      ...(encTitle !== undefined && { encTitle }),
      ...(description !== undefined && { description }),
      ...(encDescription !== undefined && { encDescription }),
      ...(stage !== undefined && { stage }),
      ...(stage !== undefined && { doneAt: stage === "done" ? new Date() : null }),
      ...(priority !== undefined && { priority }),
      ...(dueDate !== undefined && { dueDate }),
      ...(projectId !== undefined && { projectId }),
      ...(position !== undefined && { position }),
      ...(archived !== undefined && { archived }),
      ...(sensitive !== undefined && { sensitive }),
    },
    include: { project: true },
  });
  return NextResponse.json(task);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: taskId } = await params;

  const task = await getOwnedTask(taskId, userId);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const filenames = extractUploadFilenames(task.description);
  if (filenames.length > 0) {
    const uploadDir = join(process.cwd(), "data", "uploads");
    for (const filename of filenames) {
      // Only delete if no other task or note references this upload
      if (await isFilenameReferenced(filename, userId, taskId)) continue;
      await prisma.upload.deleteMany({ where: { filename, userId } });
      await unlink(join(uploadDir, filename)).catch(() => {});
    }
  }

  await prisma.task.delete({ where: { id: taskId } });
  return new NextResponse(null, { status: 204 });
}
