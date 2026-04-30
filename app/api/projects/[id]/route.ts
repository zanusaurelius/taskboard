import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { unlink } from "fs/promises";
import { join } from "path";
import { MAX_PROJECT_NAME_LEN } from "@/lib/constants";

function extractUploadFilenames(html: string | null): string[] {
  if (!html) return [];
  return [...html.matchAll(/\/api\/uploads\/([a-f0-9]+\.(?:jpg|png|gif|webp))/g)].map((m) => m[1]);
}

async function getOwnedProject(id: string, userId: string) {
  return prisma.project.findFirst({ where: { id, userId } });
}

async function isFilenameReferencedElsewhere(
  filename: string,
  userId: string,
  excludeProjectId: string,
): Promise<boolean> {
  const ref = `/api/uploads/${filename}`;
  // Check tasks in other projects
  const inOtherTask = await prisma.task.count({
    where: { project: { userId, id: { not: excludeProjectId } }, description: { contains: ref } },
  });
  if (inOtherTask > 0) return true;
  // Check all notes
  const inNote = await prisma.note.count({
    where: { userId, content: { contains: ref } },
  });
  return inNote > 0;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { id: projectId } = await params;

  if (!await getOwnedProject(projectId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body = await request.json();
  // Whitelist — only allow changing name and archived flag
  const data: { name?: string; archived?: boolean } = {};
  if (typeof body.name === "string") {
    const trimmed = body.name.trim();
    if (!trimmed) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    if (trimmed.length > MAX_PROJECT_NAME_LEN) {
      return NextResponse.json({ error: `Name must be at most ${MAX_PROJECT_NAME_LEN} characters` }, { status: 400 });
    }
    data.name = trimmed;
  }
  if (typeof body.archived === "boolean") data.archived = body.archived;
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const project = await prisma.project.update({ where: { id: projectId }, data });
  return NextResponse.json(project);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;
  const { id: projectId } = await params;

  if (!await getOwnedProject(projectId, userId)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const permanent = url.searchParams.get("permanent") === "true";

  if (permanent) {
    // Clean up uploads embedded in task descriptions — only if not referenced elsewhere
    const tasks = await prisma.task.findMany({ where: { projectId }, select: { description: true } });
    const filenames = tasks.flatMap((t) => extractUploadFilenames(t.description));
    if (filenames.length > 0) {
      const uploadDir = join(process.cwd(), "data", "uploads");
      for (const filename of filenames) {
        if (await isFilenameReferencedElsewhere(filename, userId, projectId)) continue;
        await prisma.upload.deleteMany({ where: { filename, userId } });
        await unlink(join(uploadDir, filename)).catch(() => {});
      }
    }

    await prisma.task.deleteMany({ where: { projectId } });
    await prisma.note.updateMany({ where: { projectId }, data: { projectId: null } });
    await prisma.project.delete({ where: { id: projectId } });
    return new NextResponse(null, { status: 204 });
  }

  await prisma.project.update({ where: { id: projectId }, data: { archived: true } });
  return new NextResponse(null, { status: 204 });
}
