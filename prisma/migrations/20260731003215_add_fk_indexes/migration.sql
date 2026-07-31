-- CreateIndex
CREATE INDEX "Club_regionId_idx" ON "Club"("regionId");

-- CreateIndex
CREATE INDEX "Team_clubId_idx" ON "Team"("clubId");

-- CreateIndex
CREATE INDEX "Event_seasonId_idx" ON "Event"("seasonId");

-- CreateIndex
CREATE INDEX "RankingResult_teamId_idx" ON "RankingResult"("teamId");

-- CreateIndex
CREATE INDEX "RankingResultContribution_teamFinishId_idx" ON "RankingResultContribution"("teamFinishId");

-- CreateIndex
CREATE INDEX "ImportBatch_eventId_idx" ON "ImportBatch"("eventId");

-- CreateIndex
CREATE INDEX "AuditFlag_importBatchId_idx" ON "AuditFlag"("importBatchId");

-- CreateIndex
CREATE INDEX "AuditFlag_teamId_idx" ON "AuditFlag"("teamId");

-- CreateIndex
CREATE INDEX "AuditFlag_clubId_idx" ON "AuditFlag"("clubId");

-- CreateIndex
CREATE INDEX "AuditFlag_divisionId_idx" ON "AuditFlag"("divisionId");

