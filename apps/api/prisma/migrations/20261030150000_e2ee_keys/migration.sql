-- رمزنگاری سرتاسری (گام ۸) — کلیدهای عمومی + پشتیبان رمزشده + پرچم پیام

ALTER TABLE "Message" ADD COLUMN "isE2ee" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "E2eeIdentity" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ikEd" TEXT NOT NULL,
    "ikX" TEXT NOT NULL,
    "spkKeyId" INTEGER NOT NULL,
    "spk" TEXT NOT NULL,
    "spkSig" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "E2eeIdentity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "E2eeOneTimePreKey" (
    "id" UUID NOT NULL,
    "identityId" UUID NOT NULL,
    "keyId" INTEGER NOT NULL,
    "pubKey" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "E2eeOneTimePreKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "E2eeKeyBackup" (
    "userId" UUID NOT NULL,
    "blob" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "E2eeKeyBackup_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "E2eeIdentity_userId_deviceId_key" ON "E2eeIdentity"("userId", "deviceId");
CREATE INDEX "E2eeIdentity_userId_idx" ON "E2eeIdentity"("userId");

CREATE UNIQUE INDEX "E2eeOneTimePreKey_identityId_keyId_key" ON "E2eeOneTimePreKey"("identityId", "keyId");
CREATE INDEX "E2eeOneTimePreKey_identityId_usedAt_idx" ON "E2eeOneTimePreKey"("identityId", "usedAt");

ALTER TABLE "E2eeIdentity" ADD CONSTRAINT "E2eeIdentity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "E2eeOneTimePreKey" ADD CONSTRAINT "E2eeOneTimePreKey_identityId_fkey" FOREIGN KEY ("identityId") REFERENCES "E2eeIdentity"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "E2eeKeyBackup" ADD CONSTRAINT "E2eeKeyBackup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
