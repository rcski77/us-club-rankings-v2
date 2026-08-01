-- CreateEnum
CREATE TYPE "ClubRankingSource" AS ENUM ('NPS', 'COMBINED');

-- DropIndex
DROP INDEX "ClubRankingResult_seasonId_clubId_key";

-- DropIndex
DROP INDEX "ClubRankingResult_seasonId_isQualified_rank_idx";

-- AlterTable
ALTER TABLE "ClubRankingResult" ADD COLUMN     "source" "ClubRankingSource" NOT NULL DEFAULT 'NPS';

-- CreateIndex
CREATE INDEX "ClubRankingResult_seasonId_source_isQualified_rank_idx" ON "ClubRankingResult"("seasonId", "source", "isQualified", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "ClubRankingResult_seasonId_clubId_source_key" ON "ClubRankingResult"("seasonId", "clubId", "source");

