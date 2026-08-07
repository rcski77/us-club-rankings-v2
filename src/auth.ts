import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import {
  SESSION_COOKIE_NAME,
  createSessionRecord,
  deleteSessionByToken,
  hashSessionToken,
} from "@/lib/session";
import type { UserRole, UserStatus } from "@/generated/prisma/enums";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
};

// Read-only cookie access -- safe from Server Components as well as Server
// Actions/Route Handlers, unlike signIn/signOut below. Doesn't filter on
// status: callers (layout.tsx, proxy.ts, pending/page.tsx) each decide what a
// non-ACTIVE session is allowed to see, same as the old JWT-based auth().
export async function auth(): Promise<{ user: SessionUser } | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashSessionToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;

  const { user } = session;
  return {
    user: { id: user.id, email: user.email, name: user.name, role: user.role, status: user.status },
  };
}

// Only callable from a Server Action/Route Handler (cookie mutation). Mirrors
// the old authorize()'s rule: DISABLED can't sign in at all; PENDING can (they
// just land on /pending until approved).
export async function signIn(email: string, password: string): Promise<{ ok: true } | { ok: false }> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { ok: false };

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) return { ok: false };
  if (user.status === "DISABLED") return { ok: false };

  const { token, expiresAt } = await createSessionRecord(user.id);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });

  return { ok: true };
}

export async function signOut({ redirectTo }: { redirectTo?: string } = {}): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (token) await deleteSessionByToken(token);
  cookieStore.delete(SESSION_COOKIE_NAME);
  if (redirectTo) redirect(redirectTo);
}
