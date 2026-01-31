-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "country" TEXT NOT NULL DEFAULT 'MYS',
ADD COLUMN     "email" TEXT,
ADD COLUMN     "industryCode" TEXT,
ADD COLUMN     "industryName" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "postalCode" TEXT,
ADD COLUMN     "sstRegistration" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "ttxRegistration" TEXT;
