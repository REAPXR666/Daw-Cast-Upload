-- AlterTable
ALTER TABLE "account_bans" ADD CONSTRAINT "account_bans_targetUserId_key" UNIQUE ("targetUserId");
