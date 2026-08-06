-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "mergedIntoClubId" TEXT;

-- AddForeignKey
ALTER TABLE "Club" ADD CONSTRAINT "Club_mergedIntoClubId_fkey" FOREIGN KEY ("mergedIntoClubId") REFERENCES "Club"("id") ON DELETE SET NULL ON UPDATE CASCADE;
