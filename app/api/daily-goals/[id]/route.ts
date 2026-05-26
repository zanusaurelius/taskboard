import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.dailyGoal.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { text, encText, completed, position, date } = body;

  if (text !== undefined && text !== null && typeof text === "string" && text.length > 500) {
    return NextResponse.json({ error: "text must be at most 500 characters" }, { status: 400 });
  }

  const goal = await prisma.dailyGoal.update({
    where: { id },
    data: {
      ...(text !== undefined && { text: typeof text === "string" ? text.trim() : text }),
      ...(encText !== undefined && { encText }),
      ...(completed !== undefined && { completed }),
      ...(position !== undefined && { position }),
      ...(date !== undefined && { date }),
    },
  });
  return NextResponse.json(goal);
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;

  const existing = await prisma.dailyGoal.findFirst({ where: { id, userId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.dailyGoal.delete({ where: { id } });
  return new NextResponse(null, { status: 204 });
}
