import { SignJWT, jwtVerify, type JWTPayload } from "jose";

const ISSUER   = "taskboard";
const AUDIENCE = "taskboard-api";

function secret() {
  if (!process.env.AUTH_SECRET) throw new Error("AUTH_SECRET not set");
  return new TextEncoder().encode(process.env.AUTH_SECRET);
}

export async function issueApiToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt()
    .sign(secret());
}

export interface ApiTokenPayload extends JWTPayload {
  sub: string;
  iat: number;
}

/** Verifies signature only — does NOT check passwordChangedAt. Call getUserId() for full auth. */
export async function verifyApiToken(token: string): Promise<ApiTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: ISSUER, audience: AUDIENCE });
    if (!payload.sub || !payload.iat) return null;
    return payload as ApiTokenPayload;
  } catch {
    return null;
  }
}
