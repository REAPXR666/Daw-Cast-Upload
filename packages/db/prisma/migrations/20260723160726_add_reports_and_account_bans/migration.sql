-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('harassment', 'unauthorized_recording', 'unwanted_sexual_content', 'malware', 'other');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('open', 'reviewed', 'actioned', 'dismissed');

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "sessionId" TEXT,
    "reason" "ReportReason" NOT NULL,
    "description" TEXT NOT NULL,
    "evidencePaths" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ReportStatus" NOT NULL DEFAULT 'open',
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_bans" (
    "id" TEXT NOT NULL,
    "targetUserId" TEXT NOT NULL,
    "issuedByUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "ipAddress" TEXT,
    "deviceFingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_bans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reports_targetUserId_idx" ON "reports"("targetUserId");

-- CreateIndex
CREATE INDEX "reports_status_idx" ON "reports"("status");

-- CreateIndex
CREATE INDEX "account_bans_ipAddress_idx" ON "account_bans"("ipAddress");

-- CreateIndex
CREATE INDEX "account_bans_deviceFingerprint_idx" ON "account_bans"("deviceFingerprint");

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_bans" ADD CONSTRAINT "account_bans_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_bans" ADD CONSTRAINT "account_bans_issuedByUserId_fkey" FOREIGN KEY ("issuedByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
