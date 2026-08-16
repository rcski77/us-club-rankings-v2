import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  // node-postgres's Pool defaults to max: 10 -- fine for ordinary request traffic, but
  // too tight once the Colley/Elo/Massey season recompute started running its
  // per-age-group partitions concurrently: several partitions opening a transaction
  // at once, on top of whatever else is using this pool, hit Prisma's default 2s
  // maxWait waiting for a free connection ("Unable to start a transaction in the
  // given time"). Postgres itself comfortably allows far more (max_connections
  // defaults to 100) -- this app is the only heavy user of it, so there's no other
  // consumer this could starve.
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL, max: 20 });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
