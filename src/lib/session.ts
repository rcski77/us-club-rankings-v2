import { randomBytes, createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

// Kept out of src/auth.ts so proxy.ts (route-gating, no cookies()/next/headers
// access -- it reads cookies off the request instead) can share the exact same
// cookie name and token-hashing scheme without importing anything Server
// Component/Action-only.
export const SESSION_COOKIE_NAME = "session_token";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days, matches the old JWT default

// Only the hash is ever persisted -- see the Session model's comment in
// prisma/schema.prisma for why.
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSessionRecord(userId: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  await prisma.session.create({ data: { userId, tokenHash: hashSessionToken(token), expiresAt } });
  return { token, expiresAt };
}

export async function deleteSessionByToken(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: hashSessionToken(token) } });
}

// Called on deactivation so a user's existing sessions die immediately instead
// of merely failing their next login attempt.
export async function deleteAllSessionsForUser(userId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { userId } });
}
