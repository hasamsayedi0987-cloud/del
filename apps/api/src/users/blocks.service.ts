import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';

function httpError(status: number, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, error: { code, message } }, status);
}

/**
 * BlocksService — مسدودسازی دوجانبهٔ گفتگوی مستقیم (گام ۱۰)
 *
 * تصمیم طراحی: مسدودسازی یک‌طرفه است اما گفتگوی مستقیم دوطرفه بسته می‌شود
 * (الگوی متداول پیام‌رسان‌ها) — هیچ‌کدام از زوج نمی‌تواند به دیگری DM بدهد
 * یا گفتگوی مستقیم تازه باز کند. گفتگوهای گروهی تحت تأثیر نیستند.
 */
@Injectable()
export class BlocksService {
  constructor(private readonly prisma: PrismaService) {}

  /** آیا بین این دو کاربر (در هر جهت) مسدودسازی هست؟ */
  async existsBetween(aId: string, bId: string): Promise<boolean> {
    const n = await this.prisma.userBlock.count({
      where: {
        OR: [
          { blockerId: aId, blockedId: bId },
          { blockerId: bId, blockedId: aId },
        ],
      },
    });
    return n > 0;
  }

  /** مانند existsBetween اما خطای USER_BLOCKED پرتاب می‌کند */
  async assertNotBlocked(aId: string, bId: string): Promise<void> {
    if (aId === bId) return;
    const blocked = await this.existsBetween(aId, bId);
    if (blocked) {
      throw httpError(403, 'USER_BLOCKED', 'Direct messaging is not available between these accounts');
    }
  }

  async block(meId: string, targetId: string): Promise<void> {
    if (meId === targetId) {
      throw httpError(400, 'CANNOT_BLOCK_SELF', 'You cannot block yourself');
    }
    const target = await this.prisma.user.findUnique({ where: { id: targetId } });
    if (!target) throw httpError(404, 'USER_NOT_FOUND', 'User does not exist');
    // idempotent — upsert
    await this.prisma.userBlock.upsert({
      where: { blockerId_blockedId: { blockerId: meId, blockedId: targetId } },
      update: {},
      create: { blockerId: meId, blockedId: targetId },
    });
  }

  async unblock(meId: string, targetId: string): Promise<void> {
    await this.prisma.userBlock.deleteMany({
      where: { blockerId: meId, blockedId: targetId },
    });
  }

  async listMine(meId: string) {
    const rows = await this.prisma.userBlock.findMany({
      where: { blockerId: meId },
      orderBy: { createdAt: 'desc' },
      include: { blocked: { select: { id: true, displayName: true, phone: true } } },
    });
    return {
      items: rows.map((b) => ({
        userId: b.blocked.id,
        displayName: b.blocked.displayName,
        phone: b.blocked.phone,
        createdAt: b.createdAt.toISOString(),
      })),
    };
  }
}
