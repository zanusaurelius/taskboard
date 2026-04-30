import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import bcrypt from "bcryptjs";
import { unlink } from "fs/promises";
import { join } from "path";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { MAX_USERNAME_LEN, MAX_PASSWORD_LEN } from "@/lib/constants";

export async function PATCH(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  if (!await checkRateLimit(`account:${userId}`, 10, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const { action, currentPassword, newPassword, newUsername } = await request.json();
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (action === "changePassword") {
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: "Current and new password required" }, { status: 400 });
    }
    if (newPassword.length < 8) {
      return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
    }
    if (newPassword.length > MAX_PASSWORD_LEN) {
      return NextResponse.json({ error: "Password is too long" }, { status: 400 });
    }
    if (currentPassword.length > MAX_PASSWORD_LEN) {
      return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });
    }
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return NextResponse.json({ error: "Current password is incorrect" }, { status: 401 });

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: userId },
      data: { passwordHash, passwordChangedAt: new Date() },
    });
    audit("password_change", { userId, ip: getClientIp(request) });
    return NextResponse.json({ ok: true });
  }

  if (action === "changeUsername") {
    if (!newUsername) return NextResponse.json({ error: "Username required" }, { status: 400 });
    if (newUsername.length < 3) {
      return NextResponse.json({ error: "Username must be at least 3 characters" }, { status: 400 });
    }
    if (newUsername.length > MAX_USERNAME_LEN) {
      return NextResponse.json({ error: `Username must be at most ${MAX_USERNAME_LEN} characters` }, { status: 400 });
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(newUsername)) {
      return NextResponse.json({ error: "Username may only contain letters, numbers, _ and -" }, { status: 400 });
    }
    const normalized = newUsername.toLowerCase().trim();
    if (normalized === user.username) return NextResponse.json({ ok: true });
    const taken = await prisma.user.findUnique({ where: { username: normalized } });
    if (taken) return NextResponse.json({ error: "Username is already taken" }, { status: 409 });
    await prisma.user.update({ where: { id: userId }, data: { username: normalized } });
    audit("username_change", { userId, ip: getClientIp(request), detail: normalized });
    return NextResponse.json({ ok: true, username: normalized });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  if (!await checkRateLimit(`account:${userId}`, 10, 15 * 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const body = await request.json().catch(() => ({}));
  const { currentPassword } = body;

  if (!currentPassword) {
    return NextResponse.json({ error: "Current password is required to delete your account" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  if (currentPassword.length > MAX_PASSWORD_LEN) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }
  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) return NextResponse.json({ error: "Incorrect password" }, { status: 401 });

  // Delete uploaded files from disk before removing DB records
  const uploads = await prisma.upload.findMany({ where: { userId } });
  await Promise.allSettled(
    uploads.map((u) => unlink(join(process.cwd(), "data", "uploads", u.filename)))
  );

  // Delete data in dependency order
  const projects = await prisma.project.findMany({ where: { userId }, select: { id: true } });
  const projectIds = projects.map((p) => p.id);

  await prisma.task.deleteMany({ where: { projectId: { in: projectIds } } });
  await prisma.note.deleteMany({ where: { userId } });
  await prisma.upload.deleteMany({ where: { userId } });
  await prisma.folder.deleteMany({ where: { userId } });
  await prisma.project.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });

  audit("account_delete", { userId, ip: getClientIp(request) });

  return new NextResponse(null, { status: 204 });
}
