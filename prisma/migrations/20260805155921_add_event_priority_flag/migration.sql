-- AlterTable
ALTER TABLE "Event" ADD COLUMN     "isPriority" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: every event that existed before this flag was introduced is a priority
-- event. Only events created after this migration default to false.
UPDATE "Event" SET "isPriority" = true;
