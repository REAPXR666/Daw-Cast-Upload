-- CreateTable
CREATE TABLE "bans" (
    "id" TEXT NOT NULL,
    "bannedUserId" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bans_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bans_hostUserId_idx" ON "bans"("hostUserId");

-- CreateIndex
CREATE UNIQUE INDEX "bans_bannedUserId_hostUserId_key" ON "bans"("bannedUserId", "hostUserId");

-- AddForeignKey
ALTER TABLE "bans" ADD CONSTRAINT "bans_bannedUserId_fkey" FOREIGN KEY ("bannedUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bans" ADD CONSTRAINT "bans_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
