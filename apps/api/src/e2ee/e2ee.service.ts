import { HttpException, Injectable, Logger } from '@nestjs/common';
import type {
  E2eeBundle,
  E2eeDeviceKeys,
  E2eeStatus,
} from '@del/shared-types';
import { PrismaService } from '../infra/prisma.service';

function httpError(status: number, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, error: { code, message } }, status);
}

/**
 * سرویس رمزنگاری سرتاسری (گام ۸)
 * سرور فقط دفترچه کلیدهای «عمومی» است:
 *  - آپلود/به‌روزرسانی هویت هر دستگاه + کلیدهای یک‌بارمصرف
 *  - توزیع bundle با مصرف یگانه OTK
 *  - نگهداری پشتیبان رمزشده هویت (blob — کلید بازیابی هرگز به سرور نمی‌رسد)
 */
@Injectable()
export class E2eeService {
  private readonly logger = new Logger(E2eeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** وضعیت E2EE خودم */
  async status(meId: string): Promise<E2eeStatus> {
    const [identities, backup] = await Promise.all([
      this.prisma.e2eeIdentity.findMany({ where: { userId: meId }, select: { id: true } }),
      this.prisma.e2eeKeyBackup.findUnique({ where: { userId: meId }, select: { userId: true } }),
    ]);
    return {
      identity: identities.length > 0,
      backup: Boolean(backup),
      deviceCount: identities.length,
    };
  }

  /**
   * ثبت/به‌روزرسانی هویت این دستگاه (upsert) — امضای SPK سمت کلاینت ساخته شده
   * و در bundle-fetch توسط طرف مقابل راستی‌آزمایی می‌شود.
   * کلیدهای یک‌بارمصرف تازه با keyId تکراری نادیده گرفته می‌شوند.
   */
  async uploadIdentity(
    meId: string,
    deviceId: string,
    input: {
      ikEd: string;
      ikX: string;
      spkKeyId: number;
      spk: string;
      spkSig: string;
      otks?: { keyId: number; key: string }[];
    },
  ): Promise<{ ok: true }> {
    await this.prisma.$transaction(async (tx) => {
      const identity = await tx.e2eeIdentity.upsert({
        where: { userId_deviceId: { userId: meId, deviceId } },
        create: {
          userId: meId,
          deviceId,
          ikEd: input.ikEd,
          ikX: input.ikX,
          spkKeyId: input.spkKeyId,
          spk: input.spk,
          spkSig: input.spkSig,
        },
        update: {
          ikEd: input.ikEd,
          ikX: input.ikX,
          spkKeyId: input.spkKeyId,
          spk: input.spk,
          spkSig: input.spkSig,
        },
      });
      if (input.otks?.length) {
        // keyId تکراری → skip (createMany skipDuplicates)
        await tx.e2eeOneTimePreKey.createMany({
          data: input.otks.map((o) => ({
            identityId: identity.id,
            keyId: o.keyId,
            pubKey: o.key,
          })),
          skipDuplicates: true,
        });
      }
    });
    return { ok: true };
  }

  /** افزودن دسته کلید یک‌بارمصرف تازه برای دستگاه خودم */
  async addOtks(
    meId: string,
    deviceId: string,
    otks: { keyId: number; key: string }[],
  ): Promise<{ ok: true }> {
    const identity = await this.prisma.e2eeIdentity.findUnique({
      where: { userId_deviceId: { userId: meId, deviceId } },
    });
    if (!identity) {
      throw httpError(404, 'E2EE_NO_IDENTITY', 'Upload an identity for this device first');
    }
    await this.prisma.e2eeOneTimePreKey.createMany({
      data: otks.map((o) => ({ identityId: identity.id, keyId: o.keyId, pubKey: o.key })),
      skipDuplicates: true,
    });
    return { ok: true };
  }

  /** فهرست هویت‌های عمومی کاربر (برای تشخیص قابلیت E2EE و شمارش OTK) */
  async deviceKeys(userId: string): Promise<E2eeDeviceKeys[]> {
    const identities = await this.prisma.e2eeIdentity.findMany({
      where: { userId },
      include: { _count: { select: { otks: { where: { usedAt: null } } } } },
      orderBy: { createdAt: 'asc' },
    });
    return identities.map((i) => ({
      deviceId: i.deviceId,
      ikEd: i.ikEd,
      ikX: i.ikX,
      spkKeyId: i.spkKeyId,
      spk: i.spk,
      spkSig: i.spkSig,
      otkCount: i._count.otks,
      createdAt: i.createdAt.toISOString(),
    }));
  }

  /**
   * bundle کامل کاربر برای X3DH — برای «هر» دستگاهِ او یک bundle؛
   * در هر فراخوانی دقیقاً یک OTK مصرف‌نشده از هر دستگاه مصرف می‌شود (اتمیک).
   */
  async fetchBundles(userId: string): Promise<{ userId: string; bundles: E2eeBundle[] }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw httpError(404, 'USER_NOT_FOUND', 'Target user does not exist');
    const identities = await this.prisma.e2eeIdentity.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    const bundles: E2eeBundle[] = [];
    for (const identity of identities) {
      // مصرف اتمیک یک OTK — updateMany روی سطر مصرف‌نشده قفل می‌کند
      const consumed = await this.prisma.$transaction(async (tx) => {
        const otk = await tx.e2eeOneTimePreKey.findFirst({
          where: { identityId: identity.id, usedAt: null },
          orderBy: { keyId: 'asc' },
        });
        if (!otk) return null;
        const updated = await tx.e2eeOneTimePreKey.updateMany({
          where: { id: otk.id, usedAt: null },
          data: { usedAt: new Date() },
        });
        return updated.count === 1 ? otk : null;
      });
      bundles.push({
        userId,
        deviceId: identity.deviceId,
        ikEd: identity.ikEd,
        ikX: identity.ikX,
        spkKeyId: identity.spkKeyId,
        spk: identity.spk,
        spkSig: identity.spkSig,
        otk: consumed ? { keyId: consumed.keyId, key: consumed.pubKey } : null,
      });
    }
    return { userId, bundles };
  }

  /** ذخیره/به‌روزرسانی پشتیبان (blob رمزشده) — هر کاربر فقط آخرین نسخه */
  async saveBackup(
    meId: string,
    input: { blob: string; salt: string },
  ): Promise<{ ok: true }> {
    await this.prisma.e2eeKeyBackup.upsert({
      where: { userId: meId },
      create: { userId: meId, blob: input.blob, salt: input.salt },
      update: { blob: input.blob, salt: input.salt },
    });
    return { ok: true };
  }

  /** گرفتن پشتیبان خودم — برای بازیابی هویت روی دستگاه تازه */
  async getBackup(meId: string): Promise<{ blob: string; salt: string; updatedAt: string }> {
    const backup = await this.prisma.e2eeKeyBackup.findUnique({ where: { userId: meId } });
    if (!backup) {
      throw httpError(404, 'E2EE_BACKUP_MISSING', 'No E2EE backup stored for this account');
    }
    return {
      blob: backup.blob,
      salt: backup.salt,
      updatedAt: backup.updatedAt.toISOString(),
    };
  }

  /** پاک‌کردن هویت‌های خودم (ریست) — پشتیبان باقی می‌ماند تا با کلید بازیابی برگردد */
  async deleteIdentities(meId: string): Promise<{ ok: true }> {
    await this.prisma.e2eeIdentity.deleteMany({ where: { userId: meId } });
    return { ok: true };
  }
}
