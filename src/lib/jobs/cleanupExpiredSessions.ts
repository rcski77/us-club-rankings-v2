import { prisma } from "@/lib/prisma";

// Expired Session rows are already inert (auth.ts and proxy.ts both reject them
// on expiresAt alone) -- this just keeps the table from growing forever. See
// ../../../instrumentation.ts for what schedules this to run automatically.
export async function cleanupExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}
