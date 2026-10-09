-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('youtube', 'instagram', 'tiktok');

-- CreateEnum
CREATE TYPE "ConnectionStatus" AS ENUM ('connected', 'manual', 'permission_required', 'expired', 'revoked', 'error');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('official', 'team');

-- CreateEnum
CREATE TYPE "AuthorType" AS ENUM ('creator', 'team', 'audience');

-- CreateEnum
CREATE TYPE "CommentCategory" AS ENUM ('question', 'feedback', 'positive', 'needs_review', 'other');

-- CreateEnum
CREATE TYPE "RecordSource" AS ENUM ('api', 'manual', 'mock');

-- CreateEnum
CREATE TYPE "DraftType" AS ENUM ('starter', 'reply');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('draft', 'pending_approval', 'approved', 'queued', 'published', 'rejected', 'failed', 'manual_action_required', 'cancelled');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('queued', 'running', 'retry_scheduled', 'published', 'failed', 'manual_action_required', 'cancelled');

-- CreateEnum
CREATE TYPE "ExperimentGroup" AS ENUM ('seeded', 'control');

-- CreateTable
CREATE TABLE "creator" (
    "id" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_accounts" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platformUserId" TEXT,
    "handle" TEXT NOT NULL,
    "accountType" "AccountType" NOT NULL DEFAULT 'official',
    "encryptedAccessToken" TEXT,
    "encryptedRefreshToken" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "connectionStatus" "ConnectionStatus" NOT NULL DEFAULT 'manual',
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "affiliated_authors" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "externalAuthorId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliated_authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content" (
    "id" TEXT NOT NULL,
    "platformAccountId" TEXT NOT NULL,
    "externalVideoId" TEXT,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "caption" TEXT,
    "creatorNotes" TEXT,
    "transcript" TEXT,
    "publishedAt" TIMESTAMP(3),
    "source" "RecordSource" NOT NULL DEFAULT 'manual',
    "syncStatus" TEXT NOT NULL DEFAULT 'manual',
    "experimentGroup" "ExperimentGroup",
    "analysis" JSONB,
    "analyzedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "externalCommentId" TEXT,
    "parentId" TEXT,
    "text" TEXT NOT NULL,
    "authorDisplayName" TEXT,
    "authorIdHash" TEXT,
    "authorType" "AuthorType" NOT NULL DEFAULT 'audience',
    "category" "CommentCategory" NOT NULL DEFAULT 'other',
    "source" "RecordSource" NOT NULL DEFAULT 'manual',
    "replyCount" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_drafts" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "sourceCommentId" TEXT,
    "draftType" "DraftType" NOT NULL,
    "text" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "rationale" TEXT,
    "status" "DraftStatus" NOT NULL DEFAULT 'draft',
    "riskFlags" JSONB NOT NULL DEFAULT '[]',
    "modelVersion" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "rejectedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_jobs" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "platform" "Platform" NOT NULL,
    "platformAccountId" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'queued',
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMP(3),
    "externalCommentId" TEXT,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "publish_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engagement_snapshots" (
    "id" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER,
    "likes" INTEGER,
    "commentsCount" INTEGER,
    "source" "RecordSource" NOT NULL DEFAULT 'manual',

    CONSTRAINT "engagement_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_accounts_creatorId_idx" ON "platform_accounts"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX "platform_accounts_creatorId_platform_handle_key" ON "platform_accounts"("creatorId", "platform", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "affiliated_authors_creatorId_platform_externalAuthorId_key" ON "affiliated_authors"("creatorId", "platform", "externalAuthorId");

-- CreateIndex
CREATE INDEX "content_platformAccountId_idx" ON "content"("platformAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "content_platformAccountId_externalVideoId_key" ON "content"("platformAccountId", "externalVideoId");

-- CreateIndex
CREATE INDEX "comments_contentId_idx" ON "comments"("contentId");

-- CreateIndex
CREATE INDEX "comments_parentId_idx" ON "comments"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "comments_contentId_externalCommentId_key" ON "comments"("contentId", "externalCommentId");

-- CreateIndex
CREATE INDEX "ai_drafts_contentId_idx" ON "ai_drafts"("contentId");

-- CreateIndex
CREATE INDEX "ai_drafts_status_idx" ON "ai_drafts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "publish_jobs_draftId_key" ON "publish_jobs"("draftId");

-- CreateIndex
CREATE UNIQUE INDEX "publish_jobs_idempotencyKey_key" ON "publish_jobs"("idempotencyKey");

-- CreateIndex
CREATE INDEX "publish_jobs_state_nextAttemptAt_idx" ON "publish_jobs"("state", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "engagement_snapshots_contentId_capturedAt_idx" ON "engagement_snapshots"("contentId", "capturedAt");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- AddForeignKey
ALTER TABLE "platform_accounts" ADD CONSTRAINT "platform_accounts_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "affiliated_authors" ADD CONSTRAINT "affiliated_authors_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "creator"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content" ADD CONSTRAINT "content_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "platform_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_drafts" ADD CONSTRAINT "ai_drafts_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "content"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_drafts" ADD CONSTRAINT "ai_drafts_sourceCommentId_fkey" FOREIGN KEY ("sourceCommentId") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "ai_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_jobs" ADD CONSTRAINT "publish_jobs_platformAccountId_fkey" FOREIGN KEY ("platformAccountId") REFERENCES "platform_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engagement_snapshots" ADD CONSTRAINT "engagement_snapshots_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "content"("id") ON DELETE CASCADE ON UPDATE CASCADE;
