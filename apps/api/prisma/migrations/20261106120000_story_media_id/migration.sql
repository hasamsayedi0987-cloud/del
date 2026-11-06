-- v1.5.4 — استوری تصویری/ویدیویی با ارجاع به رسانه (به‌جای بایت در DB)
-- ویدیوی تا ۶۰ ثانیه (~≤۶۰MB) در media_assets می‌رود؛ Story فقط به آن اشاره می‌کند

ALTER TABLE "Story" ADD COLUMN "mediaId" UUID;
CREATE INDEX "Story_mediaId_idx" ON "Story"("mediaId");

-- رسانهٔ استوری بدون گفتگو ساخته می‌شود — دسترسی با مالکیت + URL امضاشده
ALTER TABLE "MediaAsset" ALTER COLUMN "conversationId" DROP NOT NULL;
