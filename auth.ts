import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcryptjs";
import { checkRateLimit, getClientIp } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { MAX_USERNAME_LEN, MAX_PASSWORD_LEN } from "@/lib/constants";

if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32) {
  throw new Error("AUTH_SECRET must be at least 32 characters. Generate with: openssl rand -base64 32");
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, req) {
        const ip = getClientIp(req as unknown as Request);
        if (!await checkRateLimit(`login:${ip}`, 10, 15 * 60 * 1000)) {
          audit("rate_limit_exceeded", { ip, detail: "login" });
          throw new Error("Too many login attempts. Please try again later.");
        }

        if (!credentials?.username || !credentials?.password) return null;
        // Reject oversized inputs before any DB or bcrypt work
        if (String(credentials.username).length > MAX_USERNAME_LEN) return null;
        if (String(credentials.password).length > MAX_PASSWORD_LEN) return null;
        const user = await prisma.user.findUnique({
          where: { username: String(credentials.username).toLowerCase().trim() },
        });
        if (!user) {
          audit("login_failure", { ip, detail: String(credentials.username) });
          return null;
        }
        const valid = await bcrypt.compare(String(credentials.password), user.passwordHash);
        if (!valid) {
          audit("login_failure", { ip, detail: String(credentials.username) });
          return null;
        }
        audit("login_success", { userId: user.id, ip });
        return { id: user.id, name: user.username };
      },
    }),
  ],
  session: { strategy: "jwt" },
  cookies: {
    sessionToken: {
      // Use a plain name without the __Secure- prefix. The __Secure- prefix forces
      // Secure=true, which breaks Tor (.onion = HTTP) — the browser drops the cookie
      // and the session is lost on every refresh. LAN uses HTTPS at the transport
      // level regardless, so Secure=false on the cookie doesn't reduce security.
      name: "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: false,
      },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        // Fresh sign-in — store credentials in token
        token.id = user.id;
        token.username = user.name;
        token.issuedAt = Date.now();
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: user.id },
            select: { passwordChangedAt: true },
          });
          token.passwordChangedAt = dbUser?.passwordChangedAt?.getTime() ?? 0;
        } catch (err) {
          if (err instanceof Error && err.message === "Database not unlocked") {
            token.passwordChangedAt = 0;
          } else throw err;
        }
        return token;
      }

      // Subsequent request — verify the token is still valid
      if (token.id) {
        try {
          const dbUser = await prisma.user.findUnique({
            where: { id: token.id as string },
            select: { passwordChangedAt: true },
          });
          // User deleted → invalidate. Must return null (not {}) so @auth/core clears the cookie.
          if (!dbUser) return null;
          // Password changed after this token was issued → invalidate.
          // Compare using > (not !==) so SQLite datetime precision differences don't
          // false-positive and boot other active sessions (e.g. from a second device).
          const issuedAt = (token.issuedAt as number | undefined) ?? (token.passwordChangedAt as number);
          if (dbUser.passwordChangedAt.getTime() > issuedAt) return null;
        } catch (err) {
          if (err instanceof Error && err.message === "Database not unlocked") {
            // DB is locked — return the token without DB validation.
            // The proxy's DB-lock gate will redirect the request to /unlock before
            // the user can reach any page or API that actually queries the database.
            return token;
          }
          // Corrupted DB — don't throw from the middleware; let the app surface the error.
          const code = (err as { code?: string })?.code;
          if (code === "SQLITE_NOTADB" || code === "SQLITE_CORRUPT") return token;
          throw err;
        }
      }

      return token;
    },
    session({ session, token }) {
      // Empty token means the session was invalidated server-side
      if (!token.id) {
        session.user.id = "";
        session.user.name = "";
        return session;
      }
      if (token.id) session.user.id = token.id as string;
      if (token.username) session.user.name = token.username as string;
      return session;
    },
  },
  pages: { signIn: "/login" },
  secret: process.env.AUTH_SECRET,
});
