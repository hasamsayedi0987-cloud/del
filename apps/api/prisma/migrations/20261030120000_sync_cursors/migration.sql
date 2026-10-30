-- گام ۷ — همگام‌سازی افزایشی چنددستگاهی
-- مهر زمانی تغییر برای Conversation و Participant تا کلاینت‌ها با
-- GET /sync/updates?since=<iso> فقط مکالمه‌های تغییریافته را بگیرند.

ALTER TABLE "Conversation" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Participant" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- داده‌های موجود: نزدیک‌ترین مهر منطقی برای «آخرین تغییر»
UPDATE "Conversation" SET "updatedAt" = COALESCE("lastMessageAt", "createdAt");
UPDATE "Participant" SET "updatedAt" = "joinedAt";

CREATE INDEX "Conversation_updatedAt_idx" ON "Conversation"("updatedAt");
CREATE INDEX "Participant_updatedAt_idx" ON "Participant"("updatedAt");
