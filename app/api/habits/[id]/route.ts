import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.habit.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { text, encText, position } = body;

  if (text !== undefined && typeof text === "string" && text.length > 200) {
    return NextResponse.json({ error: "text must be at most 200 characters" }, { status: 400 });
  }

  const [habit, completion] = await Promise.all([
    prisma.habit.update({
      where: { id },
      data: {
        ...(text !== undefined && { text }),
        ...(encText !== undefined && { encText }),
        ...(position !== undefined && { position }),
      },
    }),
    prisma.habitCompletion.findFirst({
      where: { habitId: id, date: new Date().toISOString().slice(0, 10) },
    }),
  ]);
  return NextResponse.json({ ...habit, completedToday: !!completion });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.habit.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.habit.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
