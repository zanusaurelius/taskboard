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
      name: "authjs.session-token",
      options: {
        httpOnly: true,
        sameSite: "lax" as const,
        path: "/",
        secure: true,
      },
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user?.id) {
        token.id = user.id;
        token.username = user.name;
        token.issuedAt = Date.now();
        const dbUser = await prisma.user.findUnique({
          where: { id: user.id },
          select: { passwordChangedAt: true },
        });
        token.passwordChangedAt = dbUser?.passwordChangedAt?.getTime() ?? 0;
        return token;
      }

      if (token.id) {
        const dbUser = await prisma.user.findUnique({
          where: { id: token.id as string },
          select: { passwordChangedAt: true },
        });
        if (!dbUser) return null;
        const issuedAt = (token.issuedAt as number | undefined) ?? (token.passwordChangedAt as number);
        if (dbUser.passwordChangedAt.getTime() > issuedAt) return null;
      }

      return token;
    },
    session({ session, token }) {
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
