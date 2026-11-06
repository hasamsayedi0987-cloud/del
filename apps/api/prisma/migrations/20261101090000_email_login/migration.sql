-- ورود با ایمیل: User.phone اختیاری می‌شود + User.email یکتا؛ OtpCode هم phone/email
ALTER TABLE "User" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "User" ADD COLUMN "email" TEXT;
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

ALTER TABLE "OtpCode" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "OtpCode" ADD COLUMN "email" TEXT;
CREATE INDEX "OtpCode_email_createdAt_idx" ON "OtpCode"("email", "createdAt");
