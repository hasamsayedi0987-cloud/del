import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import type { StoryDto, StoryGroupDto } from '@del/shared-types';

const STORY_TTL_SEC = 24 * 3600;
/** سقف استوری همزمان برای هر کاربر */
const MAX_ACTIVE_PER_USER = 20;
const MAX_TEXT_LEN = 200;
const BG_KEYS = new Set(['aurora', 'sunset', 'ocean', 'forest', 'night', 'bloom']);

/**
 * استوری‌ها (v1.4) — وضعیت ۲۴ ساعته.
 * فقط اعضای مشترکِ گفتگو استوری‌های هم را می‌بینند (حریم خصوصی مثل واتساپ).
 */
@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** استوری تازه بساز — متن با پس‌زمینه یا تصویر (base64 jpeg ≤2MB) */
  async create(
    meId: string,
    input: {
      kind: 'text' | 'image';
      text?: string;
      bgKey?: string;
      textColor?: string;
      imageData?: string;
      imageMime?: string;
      imageBuffer?: Buffer;
    },
  ): Promise<StoryDto> {
    const activeCount = await this.prisma.story.count({
      where: { userId: meId, expiresAt: { gt: new Date() } },
    });
    if (activeCount >= MAX_ACTIVE_PER_USER) {
      throw new ForbiddenException({
        statusCode: 403,
        error: { code: 'STORY_LIMIT', message: `حداکثر ${MAX_ACTIVE_PER_USER} استوری فعال` },
      });
    }

    if (input.kind === 'image') {
      if (!input.imageData) {
        throw new ForbiddenException({
          statusCode: 400,
          error: { code: 'STORY_MEDIA_REQUIRED', message: 'برای استوری تصویری داده تصویر لازم است' },
        });
      }
      const buf = Buffer.from(input.imageData, 'base64');
      if (buf.length < 64 || buf.length > 2 * 1024 * 1024) {
        throw new ForbiddenException({
          statusCode: 400,
          error: { code: 'STORY_MEDIA_TOO_BIG', message: 'حجم تصویر استوری بیش از ۲MB است' },
        });
      }
      input.imageBuffer = buf;
    } else {
      const text = (input.text ?? '').trim();
      if (!text) {
        throw new ForbiddenException({
          statusCode: 400,
          error: { code: 'STORY_TEXT_REQUIRED', message: 'متن استوری خالی است' },
        });
      }
      input.text = text.slice(0, MAX_TEXT_LEN);
    }

    const bgKey = input.bgKey && BG_KEYS.has(input.bgKey) ? input.bgKey : 'aurora';
    const story = await this.prisma.story.create({
      data: {
        userId: meId,
        kind: input.kind,
        text: input.kind === 'text' ? input.text : null,
        bgKey,
        textColor: input.textColor ?? '#FFFFFF',
        mediaData: input.kind === 'image' ? new Uint8Array(input.imageBuffer!) : undefined,
        mediaMime: input.kind === 'image' ? input.imageMime ?? 'image/jpeg' : undefined,
        expiresAt: new Date(Date.now() + STORY_TTL_SEC * 1000),
      },
      include: { user: { select: { displayName: true } } },
    });

    return this.toDto(story, story.user.displayName, false);
  }

  /**
   * فهرست استوری‌های من + کاربرانی که با آن‌ها گفتگوی مشترک دارم.
   * خروجی گروه‌بندی‌شده بر اساس کاربر — من اول، بعدی‌ها بر اساس تازه‌ترین.
   */
  async list(meId: string): Promise<{ groups: StoryGroupDto[] }> {
    const peerIds = await this.prisma.participant.findMany({
      where: { conversation: { participants: { some: { userId: meId } } }, userId: { not: meId } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const visibleIds = [...new Set([meId, ...peerIds.map((p) => p.userId)])];

    const stories = await this.prisma.story.findMany({
      where: { userId: { in: visibleIds }, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { displayName: true } }, views: { where: { userId: meId }, select: { id: true } } },
    });

    const groups = new Map<string, StoryGroupDto>();
    for (const s of stories) {
      const seen = s.views.length > 0;
      let g = groups.get(s.userId);
      if (!g) {
        g = {
          userId: s.userId,
          userName: s.user.displayName,
          hasNew: false,
          stories: [],
        };
        groups.set(s.userId, g);
      }
      if (!seen) g.hasNew = true;
      g.stories.push(this.toDto(s, s.user.displayName, seen));
    }

    // من اول، بعد کاربرانِ استوری‌نادیده بر اساس تازه‌ترین
    const list = [...groups.values()].sort((a, b) => {
      if (a.userId === meId) return -1;
      if (b.userId === meId) return 1;
      const ta = a.stories[a.stories.length - 1]?.createdAt ?? '';
      const tb = b.stories[b.stories.length - 1]?.createdAt ?? '';
      return tb.localeCompare(ta);
    });
    return { groups: list };
  }

  /** ثبت بازدید — idempotent */
  async view(meId: string, storyId: string): Promise<{ ok: true }> {
    const story = await this.prisma.story.findUnique({ where: { id: storyId } });
    if (!story || story.expiresAt < new Date()) {
      throw new NotFoundException({
        statusCode: 404,
        error: { code: 'STORY_NOT_FOUND', message: 'استوری پیدا نشد یا منقضی شد' },
      });
    }
    const created = await this.prisma.storyView
      .create({ data: { storyId, userId: meId } })
      .catch(() => null); // تکراری → unique violation → بی‌اثر
    if (created) {
      await this.prisma.story.update({ where: { id: storyId }, data: { viewCount: { increment: 1 } } });
    }
    return { ok: true };
  }

  /** حذف استوری خودم قبل از انقضا */
  async remove(meId: string, storyId: string): Promise<{ ok: true }> {
    const story = await this.prisma.story.findUnique({ where: { id: storyId } });
    if (!story) {
      throw new NotFoundException({
        statusCode: 404,
        error: { code: 'STORY_NOT_FOUND', message: 'استوری پیدا نشد' },
      });
    }
    if (story.userId !== meId) {
      throw new ForbiddenException({
        statusCode: 403,
        error: { code: 'FORBIDDEN', message: 'این استوری مال شما نیست' },
      });
    }
    await this.prisma.story.delete({ where: { id: storyId } });
    return { ok: true };
  }

  /** پاک‌سازی استوری‌های منقضی — با interval ماژول صدا زده می‌شود */
  async cleanupExpired(): Promise<number> {
    const gone = await this.prisma.story.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    if (gone.count > 0) this.logger.log(`cleaned ${gone.count} expired stories`);
    return gone.count;
  }

  private toDto(
    s: {
      id: string;
      userId: string;
      kind: string;
      text: string | null;
      bgKey: string;
      textColor: string;
      createdAt: Date;
      expiresAt: Date;
      viewCount: number;
    },
    userName: string | null,
    seen: boolean,
  ): StoryDto {
    return {
      id: s.id,
      userId: s.userId,
      userName,
      kind: s.kind as StoryDto['kind'],
      text: s.text,
      bgKey: s.bgKey,
      textColor: s.textColor,
      hasMedia: s.kind === 'image',
      createdAt: s.createdAt.toISOString(),
      expiresInSeconds: Math.max(0, Math.round((s.expiresAt.getTime() - Date.now()) / 1000)),
      viewCount: s.viewCount,
      seen,
    };
  }
}
