import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { storeWebAuthnChallenge } from "@/lib/vault-session";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const vault = await prisma.noteVault.findUnique({ where: { userId } });
  if (!vault) return NextResponse.json({ error: "Set up a vault first" }, { status: 400 });

  const credentials: Array<{ id: string }> = JSON.parse(vault.webAuthnCredentials);

  const options = await generateRegistrationOptions({
    rpName: "Taskboard",
    rpID: new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000").hostname,
    userID: userId,
    userName: session.user.name ?? userId,
    attestationType: "none",
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      requireResidentKey: false,
      userVerification: "required",
    },
    excludeCredentials: credentials.map((c) => ({
      id: isoBase64URL.toBuffer(c.id),
      type: "public-key" as const,
    })),
  });

  storeWebAuthnChallenge(userId, options.challenge);
  return NextResponse.json(options);
}
