import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: habitId } = await params;

  const habit = await prisma.habit.findFirst({ where: { id: habitId, userId } });
  if (!habit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const date = body?.date;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date required (YYYY-MM-DD)" }, { status: 400 });
  }

  await prisma.habitCompletion.upsert({
    where: { habitId_date: { habitId, date } },
    create: { habitId, date },
    update: {},
  });
  return new NextResponse(null, { status: 204 });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id: habitId } = await params;

  const habit = await prisma.habit.findFirst({ where: { id: habitId, userId } });
  if (!habit) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date required (YYYY-MM-DD)" }, { status: 400 });
  }

  await prisma.habitCompletion.deleteMany({ where: { habitId, date } });
  return new NextResponse(null, { status: 204 });
}
