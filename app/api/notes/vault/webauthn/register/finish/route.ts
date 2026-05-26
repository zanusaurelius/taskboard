import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import { consumeWebAuthnChallenge } from "@/lib/vault-session";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { response, name = "My Device" } = body;
  if (!response) return NextResponse.json({ error: "Missing response" }, { status: 400 });

  const challenge = consumeWebAuthnChallenge(userId);
  if (!challenge) return NextResponse.json({ error: "Challenge expired or not found" }, { status: 400 });

  const vault = await prisma.noteVault.findUnique({ where: { userId } });
  if (!vault) return NextResponse.json({ error: "No vault" }, { status: 404 });

  const origin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const rpID   = new URL(origin).hostname;

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }

  if (!verification.verified || !verification.registrationInfo) {
    return NextResponse.json({ error: "Verification failed" }, { status: 400 });
  }

  const { credentialID, credentialPublicKey, counter } = verification.registrationInfo;

  const existing: Array<{ id: string; publicKey: string; counter: number; transports: string[]; name: string; createdAt: string }> =
    JSON.parse(vault.webAuthnCredentials);

  const newId = isoBase64URL.fromBuffer(credentialID);
  if (existing.some((c) => c.id === newId)) {
    return NextResponse.json({ error: "Credential already registered" }, { status: 409 });
  }

  const newCred = {
    id: newId,
    publicKey: Buffer.from(credentialPublicKey).toString("base64"),
    counter,
    transports: (response.response?.transports ?? []) as string[],
    name: String(name).slice(0, 100),
    createdAt: new Date().toISOString(),
  };

  await prisma.noteVault.update({
    where: { userId },
    data: { webAuthnCredentials: JSON.stringify([...existing, newCred]) },
  });

  return NextResponse.json({ ok: true });
}
