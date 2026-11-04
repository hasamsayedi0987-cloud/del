-- v1.4.0 — استوری‌ها + پیام‌های محوشونده + عکس پروفایل

-- پیام‌های محوشونده: TTL در سطح گفتگو + زمان انقضا روی پیام
ALTER TABLE "Conversation" ADD COLUMN "disappearSec" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Message" ADD COLUMN "expiresAt" TIMESTAMP(3);
CREATE INDEX "Message_expiresAt_idx" ON "Message"("expiresAt");

-- عکس پروفایل داخل دیتابیس (تصویر کوچک ≤256px) — سرو با GET /users/:id/avatar
ALTER TABLE "User" ADD COLUMN "avatarImage" BYTEA;
ALTER TABLE "User" ADD COLUMN "avatarMime" TEXT;

-- استوری‌ها
CREATE TABLE "Story" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'text',
    "text" TEXT,
    "bgKey" TEXT NOT NULL DEFAULT 'aurora',
    "mediaData" BYTEA,
    "mediaMime" TEXT,
    "textColor" TEXT NOT NULL DEFAULT '#FFFFFF',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "StoryView" (
    "id" UUID NOT NULL,
    "storyId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "viewedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryView_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Story_expiresAt_idx" ON "Story"("expiresAt");
CREATE INDEX "Story_userId_createdAt_idx" ON "Story"("userId", "createdAt");
CREATE UNIQUE INDEX "StoryView_storyId_userId_key" ON "StoryView"("storyId", "userId");
CREATE INDEX "StoryView_userId_idx" ON "StoryView"("userId");

ALTER TABLE "Story" ADD CONSTRAINT "Story_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryView" ADD CONSTRAINT "StoryView_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoryView" ADD CONSTRAINT "StoryView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
