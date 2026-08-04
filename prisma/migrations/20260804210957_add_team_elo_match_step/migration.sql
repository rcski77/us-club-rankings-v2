-- CreateTable
CREATE TABLE "TeamEloMatchStep" (
    "id" TEXT NOT NULL,
    "matchId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "opponentTeamId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "ageGroup" INTEGER NOT NULL,
    "won" BOOLEAN NOT NULL,
    "thisTeamSets" INTEGER NOT NULL,
    "opponentSets" INTEGER NOT NULL,
    "ratingBefore" DOUBLE PRECISION NOT NULL,
    "ratingAfter" DOUBLE PRECISION NOT NULL,
    "opponentRatingBefore" DOUBLE PRECISION NOT NULL,
    "expected" DOUBLE PRECISION NOT NULL,
    "k" INTEGER NOT NULL,
    "effectiveWeight" DOUBLE PRECISION NOT NULL,
    "multiplier" DOUBLE PRECISION NOT NULL,
    "divisionWeight" DOUBLE PRECISION NOT NULL,
    "isOpenDivision" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamEloMatchStep_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamEloMatchStep_teamId_seasonId_ageGroup_idx" ON "TeamEloMatchStep"("teamId", "seasonId", "ageGroup");

-- CreateIndex
CREATE UNIQUE INDEX "TeamEloMatchStep_matchId_teamId_key" ON "TeamEloMatchStep"("matchId", "teamId");

-- AddForeignKey
ALTER TABLE "TeamEloMatchStep" ADD CONSTRAINT "TeamEloMatchStep_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEloMatchStep" ADD CONSTRAINT "TeamEloMatchStep_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEloMatchStep" ADD CONSTRAINT "TeamEloMatchStep_opponentTeamId_fkey" FOREIGN KEY ("opponentTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamEloMatchStep" ADD CONSTRAINT "TeamEloMatchStep_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
