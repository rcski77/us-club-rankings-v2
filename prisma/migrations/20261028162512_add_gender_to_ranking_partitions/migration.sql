-- DropIndex
DROP INDEX "RankingResult_seasonId_ageGroup_rank_idx";

-- DropIndex
DROP INDEX "RankingResult_seasonId_ageGroup_teamId_key";

-- DropIndex
DROP INDEX "TeamEloMatchStep_seasonId_ageGroup_idx";

-- DropIndex
DROP INDEX "TeamEloMatchStep_teamId_seasonId_ageGroup_idx";

-- DropIndex
DROP INDEX "TeamRatingHistory_seasonId_ageGroup_weekEndingDate_idx";

-- DropIndex
DROP INDEX "TeamRatingHistory_teamId_seasonId_ageGroup_weekEndingDate_r_key";

-- AlterTable
ALTER TABLE "RankingResult" ADD COLUMN     "gender" "DivisionGender" NOT NULL DEFAULT 'GIRLS';

-- AlterTable
ALTER TABLE "TeamEloMatchStep" ADD COLUMN     "gender" "DivisionGender" NOT NULL DEFAULT 'GIRLS';

-- AlterTable
ALTER TABLE "TeamRatingHistory" ADD COLUMN     "gender" "DivisionGender" NOT NULL DEFAULT 'GIRLS';

-- CreateIndex
CREATE INDEX "RankingResult_seasonId_ageGroup_gender_rank_idx" ON "RankingResult"("seasonId", "ageGroup", "gender", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "RankingResult_seasonId_ageGroup_gender_teamId_key" ON "RankingResult"("seasonId", "ageGroup", "gender", "teamId");

-- CreateIndex
CREATE INDEX "TeamEloMatchStep_teamId_seasonId_ageGroup_gender_idx" ON "TeamEloMatchStep"("teamId", "seasonId", "ageGroup", "gender");

-- CreateIndex
CREATE INDEX "TeamEloMatchStep_seasonId_ageGroup_gender_idx" ON "TeamEloMatchStep"("seasonId", "ageGroup", "gender");

-- CreateIndex
CREATE INDEX "TeamRatingHistory_seasonId_ageGroup_gender_weekEndingDate_idx" ON "TeamRatingHistory"("seasonId", "ageGroup", "gender", "weekEndingDate");

-- CreateIndex
CREATE UNIQUE INDEX "TeamRatingHistory_teamId_seasonId_ageGroup_gender_weekEndin_key" ON "TeamRatingHistory"("teamId", "seasonId", "ageGroup", "gender", "weekEndingDate", "ratingEngine");


-- Data fix: rankings now partition by Team.gender instead of the TeamSeason team-code
-- prefix ("g"/"b", see src/lib/teamGender.ts), so bring Team.gender in line with the
-- codes first. Only teams whose coded seasons all agree are updated; mixed-code teams
-- are left for prisma/auditTeamGender.ts / splitMixedGenderTeams.ts.
UPDATE "Team" t
SET "gender" = c."codeGender"::"DivisionGender"
FROM (
  SELECT "teamId",
         MIN(CASE WHEN lower(btrim("externalTeamCode")) LIKE 'b%' THEN 'BOYS' ELSE 'GIRLS' END) AS "codeGender"
  FROM "TeamSeason"
  WHERE lower(btrim("externalTeamCode")) LIKE 'b%' OR lower(btrim("externalTeamCode")) LIKE 'g%'
  GROUP BY "teamId"
  HAVING COUNT(DISTINCT CASE WHEN lower(btrim("externalTeamCode")) LIKE 'b%' THEN 'BOYS' ELSE 'GIRLS' END) = 1
) c
WHERE t."id" = c."teamId" AND t."gender"::text <> c."codeGender";
