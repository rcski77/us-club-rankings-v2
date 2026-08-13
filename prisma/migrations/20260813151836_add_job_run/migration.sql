-- CreateEnum
CREATE TYPE "JobRunKind" AS ENUM ('RATINGS_RECOMPUTE', 'CLUB_RANKING_RECOMPUTE', 'ANALYSIS_RECOMPUTE', 'NIGHTLY_RECOMPUTE');

-- CreateEnum
CREATE TYPE "JobRunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "JobRun" (
    "id" TEXT NOT NULL,
    "kind" "JobRunKind" NOT NULL,
    "status" "JobRunStatus" NOT NULL DEFAULT 'RUNNING',
    "seasonId" TEXT NOT NULL,
    "detail" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "JobRun_seasonId_kind_startedAt_idx" ON "JobRun"("seasonId", "kind", "startedAt");

-- AddForeignKey
ALTER TABLE "JobRun" ADD CONSTRAINT "JobRun_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
