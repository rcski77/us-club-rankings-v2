-- AlterTable
ALTER TABLE "ImportBatch" ADD COLUMN     "inProgress" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "TeamFinish" ALTER COLUMN "rank" DROP NOT NULL;

