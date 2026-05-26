import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auth } from "@/auth";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import { consumeWebAuthnChallenge, issueRevealToken } from "@/lib/vault-session";
import { isoBase64URL } from "@simplewebauthn/server/helpers";

interface StoredCredential {
  id: string;
  publicKey: string; // base64
  counter: number;
  transports: string[];
  name: string;
  createdAt: string;
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const body = await request.json().catch(() => null);
  if (!body?.response) return NextResponse.json({ error: "Missing response" }, { status: 400 });

  const challenge = consumeWebAuthnChallenge(userId);
  if (!challenge) return NextResponse.json({ error: "Challenge expired" }, { status: 400 });

  const vault = await prisma.noteVault.findUnique({ where: { userId } });
  if (!vault) return NextResponse.json({ error: "No vault" }, { status: 404 });

  const credentials: StoredCredential[] = JSON.parse(vault.webAuthnCredentials);
  const credId = body.response.id;
  const stored = credentials.find((c) => c.id === credId);
  if (!stored) return NextResponse.json({ error: "Credential not found" }, { status: 400 });

  const origin = process.env.NEXTAUTH_URL ?? "http://localhost:3000";
  const rpID   = new URL(origin).hostname;

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response: body.response,
      expectedChallenge: challenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: true,
      authenticator: {
        credentialID: isoBase64URL.toBuffer(stored.id),
        credentialPublicKey: Buffer.from(stored.publicKey, "base64"),
        counter: stored.counter,
        transports: stored.transports as AuthenticatorTransport[],
      },
    });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 400 });
  }

  if (!verification.verified) {
    return NextResponse.json({ error: "Verification failed" }, { status: 401 });
  }

  // Update credential counter (replay-attack prevention)
  const updated = credentials.map((c) =>
    c.id === credId
      ? { ...c, counter: verification.authenticationInfo.newCounter }
      : c,
  );
  await prisma.noteVault.update({
    where: { userId },
    data: { webAuthnCredentials: JSON.stringify(updated) },
  });

  // Issue reveal token — biometric proves presence, grant access to hidden notes
  const token = issueRevealToken(userId);
  return NextResponse.json({ token });
}
