import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { storeWebAuthnChallenge } from "@/lib/vault-session";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const vault = await prisma.noteVault.findUnique({ where: { userId } });
  if (!vault) return NextResponse.json({ error: "No vault configured" }, { status: 404 });

  const credentials: Array<{ id: string; transports: string[] }> = JSON.parse(vault.webAuthnCredentials);
  if (credentials.length === 0) {
    return NextResponse.json({ error: "No biometric credentials registered" }, { status: 400 });
  }

  const options = await generateAuthenticationOptions({
    rpID: new URL(process.env.NEXTAUTH_URL ?? "http://localhost:3000").hostname,
    userVerification: "required",
    allowCredentials: credentials.map((c) => ({
      id: isoBase64URL.toBuffer(c.id),
      type: "public-key" as const,
      transports: c.transports as AuthenticatorTransport[],
    })),
  });

  storeWebAuthnChallenge(userId, options.challenge);
  return NextResponse.json(options);
}
