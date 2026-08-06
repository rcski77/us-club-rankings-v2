-- CreateTable
CREATE TABLE "ClubAnnualScore" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "totalPoints" DOUBLE PRECISION NOT NULL,
    "legacyRank" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'LEGACY_IMPORT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClubAnnualScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubAnnualAgeGroupScore" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "ageGroup" INTEGER NOT NULL,
    "teamName" TEXT,
    "teamCode" TEXT,
    "rank" INTEGER,
    "npsPoints" INTEGER,
    "clubPoints" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubAnnualAgeGroupScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubFiveYearRankingResult" (
    "id" TEXT NOT NULL,
    "endYear" INTEGER NOT NULL,
    "clubId" TEXT NOT NULL,
    "totalPoints" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "algorithmVersion" TEXT NOT NULL DEFAULT 'phase-5yr-v1',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubFiveYearRankingResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubFiveYearRankingResultContribution" (
    "id" TEXT NOT NULL,
    "clubFiveYearRankingResultId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "points" DOUBLE PRECISION NOT NULL,
    "weightedPoints" DOUBLE PRECISION NOT NULL,
    "present" BOOLEAN NOT NULL,

    CONSTRAINT "ClubFiveYearRankingResultContribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ClubAnnualScore_year_idx" ON "ClubAnnualScore"("year");

-- CreateIndex
CREATE UNIQUE INDEX "ClubAnnualScore_clubId_year_key" ON "ClubAnnualScore"("clubId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "ClubAnnualAgeGroupScore_clubId_year_ageGroup_key" ON "ClubAnnualAgeGroupScore"("clubId", "year", "ageGroup");

-- CreateIndex
CREATE INDEX "ClubFiveYearRankingResult_endYear_rank_idx" ON "ClubFiveYearRankingResult"("endYear", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "ClubFiveYearRankingResult_endYear_clubId_key" ON "ClubFiveYearRankingResult"("endYear", "clubId");

-- CreateIndex
CREATE UNIQUE INDEX "ClubFiveYearRankingResultContribution_clubFiveYearRankingRe_key" ON "ClubFiveYearRankingResultContribution"("clubFiveYearRankingResultId", "year");

-- AddForeignKey
ALTER TABLE "ClubAnnualScore" ADD CONSTRAINT "ClubAnnualScore_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubAnnualAgeGroupScore" ADD CONSTRAINT "ClubAnnualAgeGroupScore_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubFiveYearRankingResult" ADD CONSTRAINT "ClubFiveYearRankingResult_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubFiveYearRankingResultContribution" ADD CONSTRAINT "ClubFiveYearRankingResultContribution_clubFiveYearRankingR_fkey" FOREIGN KEY ("clubFiveYearRankingResultId") REFERENCES "ClubFiveYearRankingResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;
