import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const date = searchParams.get("date");

  // No date = return all entries for journal view
  if (!date) {
    const entries = await prisma.dailyReflection.findMany({
      where: { userId },
      orderBy: { date: "desc" },
    });
    return NextResponse.json(entries);
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date param must be YYYY-MM-DD" }, { status: 400 });
  }

  const reflection = await prisma.dailyReflection.findUnique({
    where: { userId_date: { userId, date } },
  });
  return NextResponse.json(reflection ?? null);
}

export async function PUT(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const { date, note, encNote, gratitude, encGratitude, body: bodyField, encBody } = body;

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "date is required (YYYY-MM-DD)" }, { status: 400 });
  }
  if (note !== undefined && note !== null && (typeof note !== "string" || note.length > 500)) {
    return NextResponse.json({ error: "note must be a string ≤ 500 chars" }, { status: 400 });
  }
  if (gratitude !== undefined && gratitude !== null && (typeof gratitude !== "string" || gratitude.length > 500)) {
    return NextResponse.json({ error: "gratitude must be a string ≤ 500 chars" }, { status: 400 });
  }
  if (bodyField !== undefined && bodyField !== null && (typeof bodyField !== "string" || bodyField.length > 10000)) {
    return NextResponse.json({ error: "body must be a string ≤ 10000 chars" }, { status: 400 });
  }

  const noteVal = typeof note === "string" ? (note.trim() || null) : undefined;
  const gratitudeVal = typeof gratitude === "string" ? (gratitude.trim() || null) : undefined;
  const bodyVal = typeof bodyField === "string" ? (bodyField.trim() || null) : undefined;

  const existing = await prisma.dailyReflection.findUnique({
    where: { userId_date: { userId, date } },
  });

  const mergedNote = noteVal !== undefined ? noteVal : (existing?.note ?? null);
  const mergedGratitude = gratitudeVal !== undefined ? gratitudeVal : (existing?.gratitude ?? null);
  const mergedBody = bodyVal !== undefined ? bodyVal : (existing?.body ?? null);
  const mergedEncNote = encNote !== undefined ? encNote : (existing?.encNote ?? null);
  const mergedEncGratitude = encGratitude !== undefined ? encGratitude : (existing?.encGratitude ?? null);
  const mergedEncBody = encBody !== undefined ? encBody : (existing?.encBody ?? null);

  const hasContent = mergedNote || mergedGratitude || mergedBody || mergedEncNote || mergedEncGratitude || mergedEncBody;
  if (!hasContent) {
    await prisma.dailyReflection.deleteMany({ where: { userId, date } });
    return NextResponse.json(null);
  }

  // Neon HTTP: upsert needs an implicit transaction — use find-then-create/update instead
  const data = { note: mergedNote, gratitude: mergedGratitude, body: mergedBody, encNote: mergedEncNote, encGratitude: mergedEncGratitude, encBody: mergedEncBody };
  let reflection;
  if (existing) {
    reflection = await prisma.dailyReflection.update({ where: { userId_date: { userId, date } }, data });
  } else {
    reflection = await prisma.dailyReflection.create({ data: { userId, date, ...data } });
  }
  return NextResponse.json(reflection);
}
