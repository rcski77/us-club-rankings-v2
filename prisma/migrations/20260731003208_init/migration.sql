-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UsavZone" AS ENUM ('ATLANTIC', 'BORDER', 'CENTRAL', 'PACIFIC');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'PENDING');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING', 'ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "DivisionTierLabel" AS ENUM ('OPEN', 'AMERICAN', 'PATRIOT', 'LIBERTY', 'USA', 'FREEDOM', 'PREMIER', 'CLUB', 'CLASSIC');

-- CreateEnum
CREATE TYPE "DivisionScoringStatus" AS ENUM ('DRAFT', 'SUGGESTED', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "DivisionGender" AS ENUM ('GIRLS', 'BOYS', 'COED');

-- CreateEnum
CREATE TYPE "RatingEngine" AS ENUM ('COLLEY', 'ELO', 'MASSEY');

-- CreateEnum
CREATE TYPE "DivisionScoringSnapshotStatus" AS ENUM ('PENDING', 'ACCEPTED', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('AES', 'SPORTWRENCH', 'TM2', 'VBSCHEDULE', 'MANUAL');

-- CreateEnum
CREATE TYPE "ImportType" AS ENUM ('DIVISIONS', 'TEAM_FINISHES', 'MATCH_RESULTS');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('DRAFT', 'RESOLVED', 'COMMITTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportFileStatus" AS ENUM ('UPLOADED', 'PARSED', 'ERROR');

-- CreateEnum
CREATE TYPE "ImportRowStatus" AS ENUM ('PENDING', 'OK', 'WARNING', 'ERROR');

-- CreateEnum
CREATE TYPE "ImportMatchType" AS ENUM ('EXISTING', 'NEW', 'AMBIGUOUS');

-- CreateEnum
CREATE TYPE "AuditFlagType" AS ENUM ('NEW_CLUB', 'NEW_TEAM', 'NEW_DIVISION', 'REGION_MISMATCH', 'TIER_DEFAULTED', 'DUPLICATE_IN_IMPORT', 'REIMPORT_UPDATE', 'OTHER');

-- CreateTable
CREATE TABLE "Region" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "zone" "UsavZone",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Region_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Club" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "externalCode" TEXT,
    "regionId" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Club_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClubContact" (
    "id" TEXT NOT NULL,
    "clubId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClubContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'PENDING',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" TEXT NOT NULL,
    "clubId" TEXT,
    "name" TEXT NOT NULL,
    "lineageKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamSeason" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "ageGroup" INTEGER NOT NULL,
    "teamNumber" TEXT NOT NULL,
    "externalTeamCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamSeason_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "addressLine" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "isAnchor" BOOLEAN NOT NULL DEFAULT false,
    "scheduleUrl" TEXT,
    "scheduleSource" "ImportSource",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Division" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "ageGroup" INTEGER NOT NULL,
    "gender" "DivisionGender" NOT NULL DEFAULT 'GIRLS',
    "tierLabel" "DivisionTierLabel" NOT NULL,
    "tierLevel" TEXT,
    "scoringStatus" "DivisionScoringStatus" NOT NULL DEFAULT 'DRAFT',
    "ignoreAgeDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Division_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "maxPoints" INTEGER NOT NULL,
    "isAnchorTemplate" BOOLEAN NOT NULL DEFAULT false,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PointTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PointTemplateBand" (
    "id" TEXT NOT NULL,
    "pointTemplateId" TEXT NOT NULL,
    "fromRank" INTEGER NOT NULL,
    "toRank" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,

    CONSTRAINT "PointTemplateBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DivisionPointBand" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "fromRank" INTEGER NOT NULL,
    "toRank" INTEGER NOT NULL,
    "points" INTEGER NOT NULL,

    CONSTRAINT "DivisionPointBand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamFinish" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "tiebreakOrder" INTEGER,
    "points" INTEGER,
    "ignoreAge" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamFinish_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "divisionId" TEXT,
    "teamAId" TEXT,
    "teamBId" TEXT,
    "winnerTeamId" TEXT,
    "matchDate" TIMESTAMP(3),
    "stage" TEXT,
    "setsA" INTEGER NOT NULL,
    "setsB" INTEGER NOT NULL,
    "setScores" JSONB NOT NULL,
    "externalMatchId" TEXT NOT NULL,
    "importBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingResult" (
    "id" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "ageGroup" INTEGER NOT NULL,
    "teamId" TEXT NOT NULL,
    "totalPoints" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,
    "weightedRank" INTEGER NOT NULL,
    "algorithmVersion" TEXT NOT NULL DEFAULT 'phase1-points-only',
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RankingResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamRatingHistory" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "seasonId" TEXT NOT NULL,
    "ageGroup" INTEGER NOT NULL,
    "weekEndingDate" TIMESTAMP(3) NOT NULL,
    "ratingEngine" "RatingEngine" NOT NULL DEFAULT 'COLLEY',
    "rating" DOUBLE PRECISION NOT NULL,
    "rank" INTEGER NOT NULL,
    "comparisons" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TeamRatingHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DivisionScoringSnapshot" (
    "id" TEXT NOT NULL,
    "divisionId" TEXT NOT NULL,
    "ratingEngineUsed" TEXT,
    "teamCount" INTEGER NOT NULL,
    "ratedTeamCount" INTEGER NOT NULL,
    "percentTeamsRated" DOUBLE PRECISION NOT NULL,
    "fss" DOUBLE PRECISION,
    "elitePresence" DOUBLE PRECISION,
    "percentile" DOUBLE PRECISION,
    "scoreBand" TEXT,
    "matchVolume" INTEGER NOT NULL,
    "bucketCounts" JSONB NOT NULL,
    "warnings" TEXT[],
    "suggestedTemplateId" TEXT,
    "status" "DivisionScoringSnapshotStatus" NOT NULL DEFAULT 'PENDING',
    "overrideReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DivisionScoringSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RankingResultContribution" (
    "id" TEXT NOT NULL,
    "rankingResultId" TEXT NOT NULL,
    "teamFinishId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "rankInSeason" INTEGER NOT NULL,
    "countedInTop3" BOOLEAN NOT NULL,

    CONSTRAINT "RankingResultContribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL DEFAULT 'AES',
    "importType" "ImportType" NOT NULL DEFAULT 'TEAM_FINISHES',
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'DRAFT',
    "summaryJson" JSONB,
    "createdById" TEXT,
    "committedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportFile" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "partNumber" INTEGER,
    "rawContent" TEXT NOT NULL,
    "status" "ImportFileStatus" NOT NULL DEFAULT 'UPLOADED',
    "parseError" TEXT,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "importFileId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "ageGroupLabelRaw" TEXT NOT NULL,
    "rankRaw" TEXT NOT NULL,
    "teamNameRaw" TEXT NOT NULL,
    "teamCodeRaw" TEXT NOT NULL,
    "parsedRank" INTEGER,
    "parsedAgeGroup" INTEGER,
    "parsedTeamAgeGroup" INTEGER,
    "parsedTierLabel" "DivisionTierLabel",
    "parsedTierLevel" TEXT,
    "tierWasDefaulted" BOOLEAN NOT NULL DEFAULT false,
    "parsedGender" TEXT,
    "parsedDivisionGender" "DivisionGender",
    "parsedClubExternalCode" TEXT,
    "parsedTeamNumber" TEXT,
    "parsedRegionCodeFromCode" TEXT,
    "parsedRegionCodeFromName" TEXT,
    "parsedTiebreakOrder" INTEGER,
    "teamNameClean" TEXT,
    "status" "ImportRowStatus" NOT NULL DEFAULT 'PENDING',
    "messages" TEXT[],
    "divisionMatchType" "ImportMatchType",
    "matchedDivisionId" TEXT,
    "clubMatchType" "ImportMatchType",
    "matchedClubId" TEXT,
    "teamMatchType" "ImportMatchType",
    "matchedTeamId" TEXT,
    "existingTeamFinishId" TEXT,
    "overrideDivisionId" TEXT,
    "overrideClubId" TEXT,
    "overrideTeamId" TEXT,
    "overrideClubName" TEXT,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditFlag" (
    "id" TEXT NOT NULL,
    "importBatchId" TEXT,
    "type" "AuditFlagType" NOT NULL,
    "message" TEXT NOT NULL,
    "teamId" TEXT,
    "clubId" TEXT,
    "divisionId" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Region_code_key" ON "Region"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Season_label_key" ON "Season"("label");

-- CreateIndex
CREATE UNIQUE INDEX "Club_slug_key" ON "Club"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Club_externalCode_regionId_key" ON "Club"("externalCode", "regionId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Team_lineageKey_idx" ON "Team"("lineageKey");

-- CreateIndex
CREATE INDEX "TeamSeason_seasonId_ageGroup_idx" ON "TeamSeason"("seasonId", "ageGroup");

-- CreateIndex
CREATE UNIQUE INDEX "TeamSeason_teamId_seasonId_key" ON "TeamSeason"("teamId", "seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "Event_slug_key" ON "Event"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Division_eventId_slug_key" ON "Division"("eventId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "PointTemplate_name_key" ON "PointTemplate"("name");

-- CreateIndex
CREATE UNIQUE INDEX "PointTemplateBand_pointTemplateId_fromRank_key" ON "PointTemplateBand"("pointTemplateId", "fromRank");

-- CreateIndex
CREATE UNIQUE INDEX "DivisionPointBand_divisionId_fromRank_key" ON "DivisionPointBand"("divisionId", "fromRank");

-- CreateIndex
CREATE INDEX "TeamFinish_teamId_idx" ON "TeamFinish"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamFinish_divisionId_teamId_key" ON "TeamFinish"("divisionId", "teamId");

-- CreateIndex
CREATE INDEX "Match_divisionId_idx" ON "Match"("divisionId");

-- CreateIndex
CREATE INDEX "Match_teamAId_idx" ON "Match"("teamAId");

-- CreateIndex
CREATE INDEX "Match_teamBId_idx" ON "Match"("teamBId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_eventId_externalMatchId_key" ON "Match"("eventId", "externalMatchId");

-- CreateIndex
CREATE INDEX "RankingResult_seasonId_ageGroup_rank_idx" ON "RankingResult"("seasonId", "ageGroup", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "RankingResult_seasonId_ageGroup_teamId_key" ON "RankingResult"("seasonId", "ageGroup", "teamId");

-- CreateIndex
CREATE INDEX "TeamRatingHistory_seasonId_ageGroup_weekEndingDate_idx" ON "TeamRatingHistory"("seasonId", "ageGroup", "weekEndingDate");

-- CreateIndex
CREATE UNIQUE INDEX "TeamRatingHistory_teamId_seasonId_ageGroup_weekEndingDate_r_key" ON "TeamRatingHistory"("teamId", "seasonId", "ageGroup", "weekEndingDate", "ratingEngine");

-- CreateIndex
CREATE INDEX "DivisionScoringSnapshot_divisionId_createdAt_idx" ON "DivisionScoringSnapshot"("divisionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RankingResultContribution_rankingResultId_teamFinishId_key" ON "RankingResultContribution"("rankingResultId", "teamFinishId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportFile_importBatchId_filename_key" ON "ImportFile"("importBatchId", "filename");

-- CreateIndex
CREATE INDEX "ImportRow_importFileId_idx" ON "ImportRow"("importFileId");

-- CreateIndex
CREATE INDEX "ImportRow_status_idx" ON "ImportRow"("status");

-- AddForeignKey
ALTER TABLE "Club" ADD CONSTRAINT "Club_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "Region"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClubContact" ADD CONSTRAINT "ClubContact_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSeason" ADD CONSTRAINT "TeamSeason_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamSeason" ADD CONSTRAINT "TeamSeason_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Division" ADD CONSTRAINT "Division_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTemplateBand" ADD CONSTRAINT "PointTemplateBand_pointTemplateId_fkey" FOREIGN KEY ("pointTemplateId") REFERENCES "PointTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivisionPointBand" ADD CONSTRAINT "DivisionPointBand_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamFinish" ADD CONSTRAINT "TeamFinish_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamFinish" ADD CONSTRAINT "TeamFinish_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_teamAId_fkey" FOREIGN KEY ("teamAId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_teamBId_fkey" FOREIGN KEY ("teamBId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_winnerTeamId_fkey" FOREIGN KEY ("winnerTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingResult" ADD CONSTRAINT "RankingResult_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRatingHistory" ADD CONSTRAINT "TeamRatingHistory_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamRatingHistory" ADD CONSTRAINT "TeamRatingHistory_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivisionScoringSnapshot" ADD CONSTRAINT "DivisionScoringSnapshot_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DivisionScoringSnapshot" ADD CONSTRAINT "DivisionScoringSnapshot_suggestedTemplateId_fkey" FOREIGN KEY ("suggestedTemplateId") REFERENCES "PointTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingResultContribution" ADD CONSTRAINT "RankingResultContribution_rankingResultId_fkey" FOREIGN KEY ("rankingResultId") REFERENCES "RankingResult"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RankingResultContribution" ADD CONSTRAINT "RankingResultContribution_teamFinishId_fkey" FOREIGN KEY ("teamFinishId") REFERENCES "TeamFinish"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportFile" ADD CONSTRAINT "ImportFile_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_importFileId_fkey" FOREIGN KEY ("importFileId") REFERENCES "ImportFile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_matchedDivisionId_fkey" FOREIGN KEY ("matchedDivisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_matchedClubId_fkey" FOREIGN KEY ("matchedClubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_matchedTeamId_fkey" FOREIGN KEY ("matchedTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFlag" ADD CONSTRAINT "AuditFlag_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFlag" ADD CONSTRAINT "AuditFlag_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFlag" ADD CONSTRAINT "AuditFlag_clubId_fkey" FOREIGN KEY ("clubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditFlag" ADD CONSTRAINT "AuditFlag_divisionId_fkey" FOREIGN KEY ("divisionId") REFERENCES "Division"("id") ON DELETE SET NULL ON UPDATE CASCADE;

