-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "rankingGroupPrimaryClubId" TEXT;

-- AddForeignKey
ALTER TABLE "Club" ADD CONSTRAINT "Club_rankingGroupPrimaryClubId_fkey" FOREIGN KEY ("rankingGroupPrimaryClubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;
