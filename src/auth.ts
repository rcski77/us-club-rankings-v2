import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { verifyPassword } from "@/lib/password";
import {
  SESSION_COOKIE_NAME,
  createSessionRecord,
  deleteSessionByToken,
  hashSessionToken,
} from "@/lib/session";
import { isLoginRateLimited } from "@/lib/loginRateLimit";
import type { UserRole, UserStatus } from "@/generated/prisma/enums";

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  status: UserStatus;
};

// Login rate-limiting: 5 wrong passwords in a row locks the account out entirely
// (no further password checks, right or wrong) for 15 minutes, not just failed
// attempts past that point -- this is what actually stops a brute-force loop,
// rather than just failing it slightly slower.
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

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
export async function signIn(
  email: string,
  password: string,
): Promise<{ ok: true } | { ok: false; reason: "invalid" | "locked" | "rate_limited" }> {
  // Checked first, before any DB lookup -- this is the layer that catches a
  // script cycling through many different emails, which the per-account
  // lockout below can't (it only trips once one specific account has racked
  // up failures).
  //
  // CF-Connecting-IP over X-Forwarded-For: this app's only public ingress is a
  // Cloudflare Tunnel (see docker-compose.prod.yml's header comment), and
  // Cloudflare's edge sets CF-Connecting-IP to the real visitor IP, overwriting
  // any client-supplied value -- unlike X-Forwarded-For, which a client talking
  // to the app directly (e.g. local dev) could set to anything. Falls back to
  // X-Forwarded-For/"unknown" so local dev still buckets somehow, just not
  // meaningfully -- there's no real attacker to rate-limit there.
  const h = await headers();
  const ip = h.get("cf-connecting-ip") || h.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (isLoginRateLimited(ip)) return { ok: false, reason: "rate_limited" };

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { ok: false, reason: "invalid" };

  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, reason: "locked" };
  }

  const passwordValid = await verifyPassword(password, user.passwordHash);
  if (!passwordValid) {
    // Atomic increment, not read-then-write, so concurrent failed attempts
    // can't race past MAX_FAILED_LOGIN_ATTEMPTS without tripping the lockout.
    const { failedLoginAttempts } = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: { increment: 1 } },
      select: { failedLoginAttempts: true },
    });
    if (failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
      await prisma.user.update({
        where: { id: user.id },
        data: { failedLoginAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
      });
      return { ok: false, reason: "locked" };
    }
    return { ok: false, reason: "invalid" };
  }

  if (user.status === "DISABLED") return { ok: false, reason: "invalid" };

  if (user.failedLoginAttempts !== 0 || user.lockedUntil !== null) {
    await prisma.user.update({ where: { id: user.id }, data: { failedLoginAttempts: 0, lockedUntil: null } });
  }

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
