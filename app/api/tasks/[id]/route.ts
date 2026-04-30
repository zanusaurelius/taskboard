import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
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
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { id: taskId } = await params;

  if (!await getOwnedTask(taskId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  const { title, description, stage, priority, dueDate, projectId, position, archived } = body;

  if (title !== undefined && title.length > MAX_TASK_TITLE_LEN) {
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
      ...(description !== undefined && { description }),
      ...(stage !== undefined && { stage }),
      ...(priority !== undefined && { priority }),
      ...(dueDate !== undefined && { dueDate }),
      ...(projectId !== undefined && { projectId }),
      ...(position !== undefined && { position }),
      ...(archived !== undefined && { archived }),
    },
    include: { project: true },
  });
  return NextResponse.json(task);
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
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
