import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../infra/prisma.service';
import { MediaService } from '../media/media.service';
import type { StoryDto, StoryGroupDto } from '@del/shared-types';

const STORY_TTL_SEC = 24 * 3600;
/** سقف استوری همزمان برای هر کاربر */
const MAX_ACTIVE_PER_USER = 20;
const MAX_TEXT_LEN = 200;
/** سقف ویدیوی استوری — ۶۰ ثانیه در اپ enforce می‌شود؛ سرور سقف حجم را می‌بندد */
const MAX_STORY_VIDEO_BYTES = 60 * 1024 * 1024;
const BG_KEYS = new Set(['aurora', 'sunset', 'ocean', 'forest', 'night', 'bloom']);

/**
 * استوری‌ها (v1.4) — وضعیت ۲۴ ساعته.
 * فقط اعضای مشترکِ گفتگو استوری‌های هم را می‌بینند (حریم خصوصی مثل واتساپ).
 * v1.5.4: تصویر/ویدیو از media_assets (presign بدون گفتگو) — ویدیو تا ۶۰ ثانیه.
 */
@Injectable()
export class StoriesService {
  private readonly logger = new Logger(StoriesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  /** استوری تازه بساز — متن، تصویر (mediaId یا base64 قدیمی) یا ویدیو (mediaId، ≤۶۰s) */
  async create(
    meId: string,
    input: {
      kind: 'text' | 'image' | 'video';
      text?: string;
      bgKey?: string;
      textColor?: string;
      /** مسیر تازه — asset آمادهٔ متعلق به خودم */
      mediaId?: string;
      /** مسیر legacy — تصویر base64 در DB */
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

    let mediaId: string | undefined;

    if (input.kind === 'text') {
      const text = (input.text ?? '').trim();
      if (!text) {
        throw new ForbiddenException({
          statusCode: 400,
          error: { code: 'STORY_TEXT_REQUIRED', message: 'متن استوری خالی است' },
        });
      }
      input.text = text.slice(0, MAX_TEXT_LEN);
    } else if (input.mediaId) {
      // مسیر تازه — رسانه از پیش آپلود شده (presign بدون گفتگو)
      const asset = await this.prisma.mediaAsset.findUnique({ where: { id: input.mediaId } });
      if (!asset || asset.status !== 'ready') {
        throw new ForbiddenException({
          statusCode: 400,
          error: { code: 'STORY_MEDIA_NOT_READY', message: 'رسانهٔ استوری آپلود نشده یا ناقص است' },
        });
      }
      if (asset.ownerId !== meId) {
        throw new ForbiddenException({
          statusCode: 403,
          error: { code: 'FORBIDDEN', message: 'این رسانه مال شما نیست' },
        });
      }
      if (asset.kind !== input.kind) {
        throw new ForbiddenException({
          statusCode: 400,
          error: { code: 'STORY_MEDIA_KIND_MISMATCH', message: 'نوع رسانه با نوع استوری نمی‌خواند' },
        });
      }
      if (input.kind === 'video' && asset.size > MAX_STORY_VIDEO_BYTES) {
        throw new ForbiddenException({
          statusCode: 400,
          error: { code: 'STORY_MEDIA_TOO_BIG', message: 'حجم ویدیوی استوری بیش از ۶۰MB است' },
        });
      }
      mediaId = asset.id;
    } else if (input.kind === 'image' && input.imageData) {
      // مسیر legacy — تصویر base64 در DB
      const buf = Buffer.from(input.imageData, 'base64');
      if (buf.length < 64 || buf.length > 2 * 1024 * 1024) {
        throw new ForbiddenException({
          statusCode: 400,
          error: { code: 'STORY_MEDIA_TOO_BIG', message: 'حجم تصویر استوری بیش از ۲MB است' },
        });
      }
      input.imageBuffer = buf;
    } else {
      throw new ForbiddenException({
        statusCode: 400,
        error: { code: 'STORY_MEDIA_REQUIRED', message: 'برای استوری رسانه لازم است' },
      });
    }

    const bgKey = input.bgKey && BG_KEYS.has(input.bgKey) ? input.bgKey : 'aurora';
    const story = await this.prisma.story.create({
      data: {
        userId: meId,
        kind: input.kind,
        text: input.kind === 'text' ? input.text : null,
        bgKey,
        textColor: input.textColor ?? '#FFFFFF',
        mediaId: mediaId ?? null,
        mediaData: input.kind === 'image' && input.imageBuffer ? new Uint8Array(input.imageBuffer) : undefined,
        mediaMime: input.kind === 'image' && input.imageBuffer ? input.imageMime ?? 'image/jpeg' : undefined,
        expiresAt: new Date(Date.now() + STORY_TTL_SEC * 1000),
      },
      include: { user: { select: { displayName: true } } },
    });

    return this.toDto(story, story.user.displayName, false);
  }

  /** دیده‌شدن استوری برای من؟ — مالک یا گفتگوی مشترک با سازنده */
  private async assertVisible(meId: string, story: { userId: string }): Promise<void> {
    if (story.userId === meId) return;
    const shared = await this.prisma.participant.findFirst({
      where: {
        userId: meId,
        conversation: { participants: { some: { userId: story.userId } } },
      },
      select: { id: true },
    });
    if (!shared) {
      throw new NotFoundException({
        statusCode: 404,
        error: { code: 'STORY_NOT_FOUND', message: 'استوری پیدا نشد یا منقضی شد' },
      });
    }
  }

  /** URL امضاشدهٔ رسانهٔ استوری — برای پخش تصویر/ویدیو */
  async urlFor(
    meId: string,
    storyId: string,
    publicBase?: string,
  ): Promise<{ url: string; expiresAt: string; kind: string; mime: string }> {
    const story = await this.prisma.story.findUnique({ where: { id: storyId } });
    if (!story || story.expiresAt < new Date()) {
      throw new NotFoundException({
        statusCode: 404,
        error: { code: 'STORY_NOT_FOUND', message: 'استوری پیدا نشد یا منقضی شد' },
      });
    }
    await this.assertVisible(meId, story);
    if (!story.mediaId) {
      throw new NotFoundException({
        statusCode: 404,
        error: { code: 'STORY_MEDIA_LEGACY', message: 'این استوری رسانهٔ pipeline ندارد' },
      });
    }
    const minted = await this.media.mintUrlForAsset(story.mediaId, 'original', publicBase);
    return { url: minted.url, expiresAt: minted.expiresAt, kind: minted.kind, mime: minted.mime };
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
      include: {
        user: { select: { displayName: true } },
        views: { where: { userId: meId }, select: { id: true } },
      },
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

  /** حذف استوری خودم قبل از انقضا — رسانهٔ pipeline هم پاک می‌شود */
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
    if (story.mediaId) {
      await this.media.deleteAssetHard(story.mediaId);
    }
    return { ok: true };
  }

  /** پاک‌سازی استوری‌های منقضی — رسانه‌های pipeline هم حذف می‌شوند */
  async cleanupExpired(): Promise<number> {
    const expired = await this.prisma.story.findMany({
      where: { expiresAt: { lt: new Date() }, mediaId: { not: null } },
      select: { id: true, mediaId: true },
      take: 100,
    });
    const gone = await this.prisma.story.deleteMany({ where: { expiresAt: { lt: new Date() } } });
    for (const s of expired) {
      if (s.mediaId) await this.media.deleteAssetHard(s.mediaId);
    }
    if (gone.count > 0) this.logger.log(`cleaned ${gone.count} expired stories (${expired.length} had media)`);
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
      mediaId?: string | null;
      mediaData?: Uint8Array | null;
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
      hasMedia:
        (s.kind === 'image' || s.kind === 'video') &&
        (Boolean(s.mediaId) || s.mediaData != null),
      createdAt: s.createdAt.toISOString(),
      expiresInSeconds: Math.max(0, Math.round((s.expiresAt.getTime() - Date.now()) / 1000)),
      viewCount: s.viewCount,
      seen,
    };
  }
}
