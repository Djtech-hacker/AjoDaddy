-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('JOINED_GROUP', 'CONTRIBUTION', 'BADGE_EARNED', 'CYCLE_COMPLETE', 'PAYOUT_RECEIVED');

-- CreateEnum
CREATE TYPE "LeaderboardCategory" AS ENUM ('OVERALL', 'STREAK', 'REPUTATION', 'CONTRIBUTED', 'CREATORS');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BadgeType" ADD VALUE 'CONTRIBUTED_100K';
ALTER TYPE "BadgeType" ADD VALUE 'CONTRIBUTED_1M';
ALTER TYPE "BadgeType" ADD VALUE 'TRUSTED_ADMIN';
ALTER TYPE "BadgeType" ADD VALUE 'EARLY_SUPPORTER';
ALTER TYPE "BadgeType" ADD VALUE 'TOP_SAVER';
ALTER TYPE "BadgeType" ADD VALUE 'VERIFIED';

-- CreateTable
CREATE TABLE "reputation_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "groupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reputation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_streaks" (
    "userId" TEXT NOT NULL,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "longestStreak" INTEGER NOT NULL DEFAULT 0,
    "lastContributionDate" TIMESTAMP(3),

    CONSTRAINT "user_streaks_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "profile_stats" (
    "userId" TEXT NOT NULL,
    "groupsJoined" INTEGER NOT NULL DEFAULT 0,
    "groupsCreated" INTEGER NOT NULL DEFAULT 0,
    "completedCycles" INTEGER NOT NULL DEFAULT 0,
    "onTimePaymentPct" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "contributionSuccessRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "totalPayoutsReceived" BIGINT NOT NULL DEFAULT 0,
    "totalContributed" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_stats_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "leaderboard_rankings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" "LeaderboardCategory" NOT NULL,
    "globalRank" INTEGER,
    "groupRank" INTEGER,
    "score" DECIMAL(65,30),
    "weeklyMovement" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leaderboard_rankings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_feed" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "ActivityType" NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_feed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reputation_logs_userId_idx" ON "reputation_logs"("userId");

-- CreateIndex
CREATE INDEX "reputation_logs_groupId_idx" ON "reputation_logs"("groupId");

-- CreateIndex
CREATE INDEX "leaderboard_rankings_category_globalRank_idx" ON "leaderboard_rankings"("category", "globalRank");

-- CreateIndex
CREATE UNIQUE INDEX "leaderboard_rankings_userId_category_key" ON "leaderboard_rankings"("userId", "category");

-- CreateIndex
CREATE INDEX "activity_feed_userId_createdAt_idx" ON "activity_feed"("userId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "reputation_logs" ADD CONSTRAINT "reputation_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reputation_logs" ADD CONSTRAINT "reputation_logs_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_streaks" ADD CONSTRAINT "user_streaks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_stats" ADD CONSTRAINT "profile_stats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leaderboard_rankings" ADD CONSTRAINT "leaderboard_rankings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_feed" ADD CONSTRAINT "activity_feed_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
