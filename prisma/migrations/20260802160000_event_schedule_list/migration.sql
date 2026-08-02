-- CreateTable
CREATE TABLE "EventSchedule" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL,
    "label" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EventSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EventSchedule_eventId_idx" ON "EventSchedule"("eventId");

-- AddForeignKey
ALTER TABLE "EventSchedule" ADD CONSTRAINT "EventSchedule_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: one EventSchedule row per Event that already had a single
-- scheduleUrl/scheduleSource, using a deterministic id (safe: one row per event here).
INSERT INTO "EventSchedule" ("id", "eventId", "url", "source", "createdAt")
SELECT 'sched_' || "id", "id", "scheduleUrl", "scheduleSource", CURRENT_TIMESTAMP
FROM "Event"
WHERE "scheduleUrl" IS NOT NULL AND "scheduleSource" IS NOT NULL;

-- DataMigration: freeze each existing ImportBatch's schedule as a copy of its
-- event's (now-being-dropped) scheduleUrl/scheduleSource, so batches created before
-- this migration keep working exactly as before (see ImportBatch.scheduleUrl's
-- frozen-copy comment in schema.prisma).
UPDATE "ImportBatch" AS b
SET "scheduleUrl" = e."scheduleUrl", "scheduleSource" = e."scheduleSource"
FROM "Event" AS e
WHERE b."eventId" = e."id" AND b."scheduleUrl" IS NULL AND e."scheduleUrl" IS NOT NULL;

-- AlterTable
ALTER TABLE "Event" DROP COLUMN "scheduleSource",
DROP COLUMN "scheduleUrl";
