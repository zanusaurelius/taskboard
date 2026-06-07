import { NextResponse } from "next/server";
import { getUserId } from "@/lib/get-user-id";
import { prisma } from "@/lib/prisma";

export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { stageColorsJson: true } });
  const colors = user?.stageColorsJson ? JSON.parse(user.stageColorsJson) : {};
  return NextResponse.json(colors);
}

export async function PATCH(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json();
  if (typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  await prisma.user.update({ where: { id: userId }, data: { stageColorsJson: JSON.stringify(body) } });
  return NextResponse.json(body);
}
