import type { NextAuthConfig } from "next-auth";
import type { UserRole, UserStatus } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface User {
    role: UserRole;
    status: UserStatus;
  }

  interface Session {
    user: {
      id: string;
      email: string;
      name?: string | null;
      role: UserRole;
      status: UserStatus;
    };
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id: string;
    role: UserRole;
    status: UserStatus;
  }
}

/**
 * Edge-safe base config shared by middleware (src/middleware.ts, no Prisma) and the
 * full server-side auth instance (src/auth.ts, adds the Credentials provider which
 * needs Prisma/Node APIs). Keep this file free of Node-only imports.
 */
export const authConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [],
  callbacks: {
    jwt: ({ token, user }) => {
      if (user) {
        token.id = user.id as string;
        token.role = user.role;
        token.status = user.status;
      }
      return token;
    },
    session: ({ session, token }) => {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.status = token.status;
      return session;
    },
  },
} satisfies NextAuthConfig;
