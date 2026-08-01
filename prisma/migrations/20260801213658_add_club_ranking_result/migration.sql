-- CreateTable
CREATE TABLE "ClubRankingResult" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "totalPoints" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "isQualified" BOOLEAN NOT NULL,
    "algorithmVersion" TEXT NOT NULL DEFAULT 'phase7-v1',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubRankingResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubRankingResultContribution" (
    "id" TEXT NOT NULL,
    "clubRankingResultId" TEXT NOT NULL,
    "ageGroup" INTEGER NOT NULL,
    "teamId" TEXT,
    "rank" INTEGER,
    "rawPoints" INTEGER,
    "weightedPoints" DOUBLE PRECISION,
    "countedInBest5" BOOLEAN NOT NULL,

    CONSTRAINT "ClubRankingResultContribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubRankingResult_seasonId_isQualified_rank_idx" ON "ClubRankingResult"("seasonId", "isQualified", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "ClubRankingResult_seasonId_clubId_key" ON "ClubRankingResult"("seasonId", "clubId");

-- CreateIndex
CREATE UNIQUE INDEX "ClubRankingResultContribution_clubRankingResultId_ageGroup_key" ON "ClubRankingResultContribution"("clubRankingResultId", "ageGroup");

-- AddForeignKey
ALTER TABLE "ClubRankingResult" ADD CONSTRAINT "ClubRankingResult_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubRankingResult" ADD CONSTRAINT "ClubRankingResult_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubRankingResultContribution" ADD CONSTRAINT "ClubRankingResultContribution_clubRankingResultId_fkey" FOREIGN KEY ("clubRankingResultId") REFERENCES "ClubRankingResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubRankingResultContribution" ADD CONSTRAINT "ClubRankingResultContribution_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
