import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUserId } from "@/lib/get-user-id";
import { audit } from "@/lib/audit";
import { getClientIp } from "@/lib/rateLimit";

// GET — return vault config (encrypted blobs) so client can derive master key
export async function GET(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const vault = await prisma.noteVault.findUnique({ where: { userId } });
  if (!vault) return NextResponse.json({ exists: false });

  let webAuthnCredentials: { id: string; name: string }[] = [];
  try {
    const parsed = JSON.parse(vault.webAuthnCredentials);
    if (Array.isArray(parsed)) {
      webAuthnCredentials = parsed.map((c: { id: string; name: string }) => ({ id: c.id, name: c.name }));
    }
  } catch { /* corrupted data — treat as empty */ }

  return NextResponse.json({
    exists: true,
    encryptedMasterKey: vault.encryptedMasterKey,
    masterKeySalt: vault.masterKeySalt,
    encryptedMasterKeyBak: vault.encryptedMasterKeyBak,
    backupKeySalt: vault.backupKeySalt,
    verifier: vault.verifier,
    webAuthnCredentials,
  });
}

// POST — create vault (called once during setup)
export async function POST(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await prisma.noteVault.findUnique({ where: { userId } });
  if (existing) return NextResponse.json({ error: "Vault already exists" }, { status: 409 });

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { encryptedMasterKey, masterKeySalt, encryptedMasterKeyBak, backupKeySalt, verifier } = body;
  if (!encryptedMasterKey || !masterKeySalt || !encryptedMasterKeyBak || !backupKeySalt || !verifier) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  try {
    const vault = await prisma.noteVault.create({
      data: {
        userId,
        encryptedMasterKey: JSON.stringify(encryptedMasterKey),
        masterKeySalt,
        encryptedMasterKeyBak: JSON.stringify(encryptedMasterKeyBak),
        backupKeySalt,
        verifier,
      },
    });
    audit("vault_create", { userId, ip: getClientIp(request) });
    return NextResponse.json({ ok: true, id: vault.id }, { status: 201 });
  } catch (e) {
    console.error("Vault create error:", e);
    return NextResponse.json({ error: "Failed to create vault" }, { status: 500 });
  }
}

// DELETE — remove vault and unlock all notes/folders
export async function DELETE(request: Request) {
  const userId = await getUserId(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  await prisma.$transaction([
    prisma.note.updateMany({
      where: { userId },
      data: { locked: false, hidden: false, encContent: null, encTitle: null },
    }),
    prisma.folder.updateMany({
      where: { userId },
      data: { locked: false, hidden: false },
    }),
    prisma.noteVault.delete({ where: { userId } }),
  ]);

  audit("vault_delete", { userId, ip: getClientIp(request) });
  return new NextResponse(null, { status: 204 });
}
