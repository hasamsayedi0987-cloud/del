import { EventEmitter2 } from '@nestjs/event-emitter';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import type {
  ConversationDto,
  MediaAssetDto,
  MessageDto,
  ParticipantDto,
} from '@del/shared-types';
import { PrismaService } from '../infra/prisma.service';

function httpError(status: number, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, error: { code, message } }, status);
}

const MEDIA_SELECT = {
  id: true,
  ownerId: true,
  conversationId: true,
  kind: true,
  mime: true,
  size: true,
  originalName: true,
  width: true,
  height: true,
  status: true,
  thumbKey: true,
  createdAt: true,
} as const;

export function toMessageDto(m: {
  id: string;
  conversationId: string;
  senderId: string;
  serverSeq: number;
  clientMsgId: string;
  type: string;
  body: string;
  createdAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
  media?: MediaAssetDtoSource | null;
}): MessageDto {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    serverSeq: m.serverSeq,
    clientMsgId: m.clientMsgId,
    type: m.type,
    body: m.body,
    media: m.media ? toMediaDtoShallow(m.media) : null,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
  };
}

interface MediaAssetDtoSource {
  id: string;
  ownerId: string;
  conversationId: string;
  kind: string;
  mime: string;
  size: number;
  originalName: string | null;
  width: number | null;
  height: number | null;
  status: string;
  thumbKey: string | null;
  createdAt: Date;
}

function toMediaDtoShallow(m: MediaAssetDtoSource): MediaAssetDto {
  return {
    id: m.id,
    ownerId: m.ownerId,
    conversationId: m.conversationId,
    kind: m.kind as MediaAssetDto['kind'],
    mime: m.mime,
    size: m.size,
    originalName: m.originalName,
    width: m.width,
    height: m.height,
    status: m.status as MediaAssetDto['status'],
    hasThumb: Boolean(m.thumbKey),
    createdAt: m.createdAt.toISOString(),
  };
}

const USER_SELECT = { id: true, phone: true, displayName: true } as const;

function toParticipantDto(p: {
  userId: string;
  role: string;
  lastReadSeq: number;
  user: { id: string; phone: string; displayName: string | null };
}): ParticipantDto {
  return {
    userId: p.userId,
    displayName: p.user.displayName,
    phone: p.user.phone,
    lastReadSeq: p.lastReadSeq,
    role: p.role as 'admin' | 'member',
  };
}

export interface SendResult {
  message: MessageDto;
  /** true یعنی پیام تکراری بود و پیام موجود برگردانده شد (idempotency) */
  duplicate: boolean;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
  ) {}

  /** گفتگوی مستقیم دو‌نفره — idempotent: اگر وجود داشته باشد همان برگردانده می‌شود */
  async createDirect(meId: string, otherUserId: string): Promise<ConversationDto> {
    if (meId === otherUserId) {
      throw httpError(400, 'INVALID_PEER', 'Cannot open a direct conversation with yourself');
    }
    const other = await this.prisma.user.findUnique({ where: { id: otherUserId } });
    if (!other) throw httpError(404, 'USER_NOT_FOUND', 'Target user does not exist');

    // یافتن مکالمه direct موجودِ دقیقاً دو‌نفره شامل هر دو کاربر
    const candidates = await this.prisma.conversation.findMany({
      where: {
        type: 'direct',
        participants: { some: { userId: meId } },
      },
      include: { participants: true },
    });
    const existing = candidates.find(
      (c) =>
        c.participants.length === 2 &&
        c.participants.some((p) => p.userId === otherUserId),
    );
    if (existing) return this.getOne(meId, existing.id);

    const conv = await this.prisma.conversation.create({
      data: {
        type: 'direct',
        participants: {
          create: [{ userId: meId }, { userId: otherUserId }],
        },
      },
    });
    // اطلاع‌رسانی به کاربران آنلاین (اتاق شخصی) تا لیست گفتگوهایشان رفرش شود
    this.events.emit('conversation.created', {
      conversationId: conv.id,
      userIds: [meId, otherUserId],
    });
    return this.getOne(meId, conv.id);
  }

  /** یک مکالمه با بررسی عضویت */
  async getOne(meId: string, conversationId: string): Promise<ConversationDto> {
    const me = await this.requireParticipant(meId, conversationId);
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: { include: { user: { select: USER_SELECT } } },
        messages: { orderBy: { serverSeq: 'desc' }, take: 1 },
      },
    });
    if (!conv) throw httpError(404, 'CONVERSATION_NOT_FOUND', 'Conversation does not exist');

    const unreadCount = await this.prisma.message.count({
      where: {
        conversationId,
        senderId: { not: meId },
        serverSeq: { gt: me.lastReadSeq },
      },
    });

    const isGroup = conv.type === 'group';
    return {
      id: conv.id,
      type: conv.type as 'direct' | 'group',
      title: conv.title,
      lastSeq: conv.lastSeq,
      lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
      createdAt: conv.createdAt.toISOString(),
      peer: !isGroup
        ? toParticipantDto(
            conv.participants.find((p) => p.userId !== meId) ?? conv.participants[0]!,
          )
        : null,
      memberCount: isGroup ? conv.participants.length : undefined,
      myRole: isGroup ? (me.role as 'admin' | 'member') : null,
      participants: isGroup
        ? conv.participants.map((p) => toParticipantDto(p))
        : undefined,
      unreadCount,
      lastMessage: conv.messages[0]
        ? {
            body: conv.messages[0].body,
            createdAt: conv.messages[0].createdAt.toISOString(),
            senderId: conv.messages[0].senderId,
          }
        : null,
    };
  }

  /** لیست مکالمه‌های من مرتب بر اساس آخرین فعالیت */
  async listMine(meId: string): Promise<ConversationDto[]> {
    const myParts = await this.prisma.participant.findMany({
      where: { userId: meId },
      include: {
        conversation: {
          include: {
            participants: { include: { user: { select: USER_SELECT } } },
            messages: { orderBy: { serverSeq: 'desc' }, take: 1 },
          },
        },
      },
    });

    const list = await Promise.all(
      myParts.map(async (part) => {
        const conv = part.conversation;
        const unreadCount = await this.prisma.message.count({
          where: {
            conversationId: conv.id,
            senderId: { not: meId },
            serverSeq: { gt: part.lastReadSeq },
          },
        });
        const isGroup = conv.type === 'group';
        const dto: ConversationDto = {
          id: conv.id,
          type: conv.type as 'direct' | 'group',
          title: conv.title,
          lastSeq: conv.lastSeq,
          lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
          createdAt: conv.createdAt.toISOString(),
          peer: !isGroup
            ? toParticipantDto(
                conv.participants.find((p) => p.userId !== meId) ?? conv.participants[0]!,
              )
            : null,
          memberCount: isGroup ? conv.participants.length : undefined,
          myRole: isGroup ? (part.role as 'admin' | 'member') : null,
          unreadCount,
          lastMessage: conv.messages[0]
            ? {
                body: conv.messages[0].body,
                createdAt: conv.messages[0].createdAt.toISOString(),
                senderId: conv.messages[0].senderId,
              }
            : null,
        };
        return dto;
      }),
    );

    return list.sort(
      (a, b) =>
        new Date(b.lastMessageAt ?? b.createdAt).getTime() -
        new Date(a.lastMessageAt ?? a.createdAt).getTime(),
    );
  }

  /**
   * تاریخچه پیام‌ها — دو حالت:
   * ۱) before=<seq>: صفحه‌بندی به عقب (بارگذاری قدیمی‌تر) — پاسخ صعودی
   * ۲) since=<seq>: همگام‌سازی آفلاین — همه پیام‌های بعد از seq به‌صورت صعودی
   */
  async getMessages(
    meId: string,
    conversationId: string,
    opts: { before?: number; since?: number; limit?: number },
  ): Promise<{
    messages: MessageDto[];
    hasMore: boolean;
    nextBefore: number | null;
    nextSince: number | null;
  }> {
    const me = await this.requireParticipant(meId, conversationId);
    void me;
    const limit = Math.min(opts.limit ?? 50, 200);
    const mediaInclude = { include: { media: { select: MEDIA_SELECT } } } as const;

    // حالت since — همگام‌سازی آفلاین (اولویت با since است)
    if (opts.since !== undefined) {
      const rows = await this.prisma.message.findMany({
        where: { conversationId, serverSeq: { gt: opts.since } },
        orderBy: { serverSeq: 'asc' },
        take: limit + 1,
        ...mediaInclude,
      });
      const hasMore = rows.length > limit;
      const page = rows.slice(0, limit);
      return {
        messages: page.map(toMessageDto),
        hasMore,
        nextBefore: null,
        nextSince: hasMore ? page[page.length - 1]!.serverSeq : null,
      };
    }

    // حالت before — صفحه‌بندی به عقب
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(opts.before !== undefined ? { serverSeq: { lt: opts.before } } : {}),
      },
      orderBy: { serverSeq: 'desc' },
      take: limit + 1,
      ...mediaInclude,
    });

    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).reverse(); // صعودی
    return {
      messages: page.map(toMessageDto),
      hasMore,
      nextBefore: hasMore ? page[0]!.serverSeq : null,
      nextSince: null,
    };
  }

  /**
   * ارسال پیام — idempotent با clientMsgId:
   * ارسال مجدد همان clientMsgId پیامِ موجود را برمی‌گرداند بدون تکرار.
   * serverSeq با قفل اتمی روی سطر Conversation تخصیص می‌یابد.
   * پیام رسانه‌ای (گام ۵): mediaId باید ready و متعلق به فرستنده در همین مکالمه باشد.
   */
  async sendMessage(
    meId: string,
    conversationId: string,
    clientMsgId: string,
    body: string | undefined,
    mediaId?: string,
  ): Promise<SendResult> {
    await this.requireParticipant(meId, conversationId);

    // ۰) اعتبارسنجی رسانه — مالکیت، مکالمه، وضعیت
    let media: { id: string; kind: string; originalName: string | null } | null = null;
    if (mediaId) {
      const asset = await this.prisma.mediaAsset.findUnique({ where: { id: mediaId } });
      if (!asset) throw httpError(404, 'MEDIA_NOT_FOUND', 'Media asset does not exist');
      if (asset.ownerId !== meId) {
        throw httpError(403, 'MEDIA_NOT_OWNED', 'You can only send media you uploaded');
      }
      if (asset.conversationId !== conversationId) {
        throw httpError(400, 'MEDIA_WRONG_CONVERSATION', 'Media belongs to another conversation');
      }
      if (asset.status !== 'ready') {
        throw httpError(400, 'MEDIA_NOT_READY', 'Upload is not completed (or was rejected)');
      }
      media = { id: asset.id, kind: asset.kind, originalName: asset.originalName };
    }

    const text = (body ?? '').trim();
    if (!media && !text) {
      throw httpError(400, 'EMPTY_MESSAGE', 'Message body or mediaId is required');
    }

    // ۱) بررسی idempotency (مسیر سریع)
    const dup = await this.prisma.message.findUnique({
      where: { conversationId_clientMsgId: { conversationId, clientMsgId } },
      include: { media: { select: MEDIA_SELECT } },
    });
    if (dup) return { message: toMessageDto(dup), duplicate: true };

    // ۲) تخصیص seq با UPDATE اتمی + درج
    const message = await this.prisma.$transaction(async (tx) => {
      // update با increment در سطح سطر قفل می‌کند — seq یگانه تضمین می‌شود
      const conv = await tx.conversation.update({
        where: { id: conversationId },
        data: { lastSeq: { increment: 1 } },
      });

      const created = await tx.message.create({
        data: {
          conversationId,
          senderId: meId,
          serverSeq: conv.lastSeq,
          clientMsgId,
          type: media ? media.kind : 'text',
          body: text || media?.originalName || '',
          ...(media ? { mediaId: media.id } : {}),
        },
        include: { media: { select: MEDIA_SELECT } },
      });

      await tx.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: created.createdAt },
      });

      return created;
    });

    const dto = toMessageDto(message);
    // ۳) انتشار برای WebSocket gateway
    this.events.emit('message.created', dto);

    return { message: dto, duplicate: false };
  }

  /** علامت‌گذاری خواندن تا آخرین seq دریافت‌شده */
  async markRead(meId: string, conversationId: string, lastReadSeq: number): Promise<void> {
    const me = await this.requireParticipant(meId, conversationId);
    if (lastReadSeq <= me.lastReadSeq) return; // فقط رو به جلو
    await this.prisma.participant.update({
      where: { conversationId_userId: { conversationId, userId: meId } },
      data: { lastReadSeq: lastReadSeq },
    });
    this.events.emit('conversation.read', { conversationId, userId: meId, lastReadSeq });
  }

  // ————— گروه‌ها (گام ۴) —————

  /** ساخت گروه — سازنده ادمین می‌شود؛ شناسه‌های تکراری/خودِ سازنده حذف می‌شوند */
  async createGroup(meId: string, title: string, memberUserIds: string[]): Promise<ConversationDto> {
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      throw httpError(400, 'INVALID_TITLE', 'Group title is required');
    }
    const ids = [...new Set(memberUserIds.filter((id) => id !== meId))];
    if (ids.length) {
      const found = await this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } });
      if (found.length !== ids.length) {
        throw httpError(404, 'USER_NOT_FOUND', 'One or more member users do not exist');
      }
    }
    const conv = await this.prisma.conversation.create({
      data: {
        type: 'group',
        title: cleanTitle,
        participants: {
          create: [
            { userId: meId, role: 'admin' },
            ...ids.map((userId) => ({ userId, role: 'member' })),
          ],
        },
      },
    });
    this.events.emit('conversation.created', {
      conversationId: conv.id,
      userIds: [meId, ...ids],
    });
    return this.getOne(meId, conv.id);
  }

  /** افزودن عضو به گروه — فقط ادمین؛ idempotent (عضو تکراری نادیده گرفته می‌شود) */
  async addMembers(meId: string, conversationId: string, userIds: string[]): Promise<ConversationDto> {
    const me = await this.requireAdmin(meId, conversationId);
    void me;
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw httpError(404, 'CONVERSATION_NOT_FOUND', 'Conversation does not exist');
    if (conv.type !== 'group') {
      throw httpError(400, 'NOT_A_GROUP', 'Members can only be added to group conversations');
    }

    const existing = await this.prisma.participant.findMany({
      where: { conversationId, userId: { in: userIds } },
      select: { userId: true },
    });
    const existingSet = new Set(existing.map((p) => p.userId));
    const newIds = [...new Set(userIds)].filter((id) => !existingSet.has(id));

    if (newIds.length) {
      const found = await this.prisma.user.findMany({ where: { id: { in: newIds } }, select: { id: true } });
      if (found.length !== newIds.length) {
        throw httpError(404, 'USER_NOT_FOUND', 'One or more users do not exist');
      }
      await this.prisma.participant.createMany({
        data: newIds.map((userId) => ({ conversationId, userId, role: 'member' })),
      });
      this.events.emit('conversation.members_added', {
        conversationId,
        userIds: newIds,
        addedBy: meId,
        allUserIds: await this.memberIds(conversationId),
      });
    }
    return this.getOne(meId, conversationId);
  }

  /** حذف عضو از گروه — فقط ادمین؛ ادمین نمی‌تواند خودش را با این مسیر حذف کند (خروج بزنید) */
  async removeMember(meId: string, conversationId: string, userId: string): Promise<void> {
    await this.requireAdmin(meId, conversationId);
    if (userId === meId) {
      throw httpError(400, 'USE_LEAVE', 'Admins cannot remove themselves — use leave endpoint');
    }
    const target = await this.prisma.participant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!target) throw httpError(404, 'MEMBER_NOT_FOUND', 'Target user is not a member');
    await this.prisma.participant.delete({ where: { id: target.id } });
    this.events.emit('conversation.member_removed', {
      conversationId,
      userId,
      removedBy: meId,
      left: false,
    });
  }

  /** تغییر نقش عضو — فقط ادمین؛ نقش خود ادمین قابل تغییر نیست */
  async updateMemberRole(
    meId: string,
    conversationId: string,
    userId: string,
    role: 'admin' | 'member',
  ): Promise<void> {
    await this.requireAdmin(meId, conversationId);
    if (userId === meId) {
      throw httpError(400, 'CANNOT_CHANGE_OWN_ROLE', 'Use leave or another admin');
    }
    const target = await this.prisma.participant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!target) throw httpError(404, 'MEMBER_NOT_FOUND', 'Target user is not a member');
    await this.prisma.participant.update({ where: { id: target.id }, data: { role } });
  }

  /** خروج از گروه — آخرین ادمین نمی‌تواند وقتی عضو دیگری هست خارج شود */
  async leaveGroup(meId: string, conversationId: string): Promise<void> {
    const me = await this.requireParticipant(meId, conversationId);
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId } });
    if (!conv) throw httpError(404, 'CONVERSATION_NOT_FOUND', 'Conversation does not exist');

    if (conv.type === 'group' && me.role === 'admin') {
      const [adminCount, memberCount] = await Promise.all([
        this.prisma.participant.count({ where: { conversationId, role: 'admin' } }),
        this.prisma.participant.count({ where: { conversationId } }),
      ]);
      if (adminCount === 1 && memberCount > 1) {
        throw httpError(400, 'LAST_ADMIN', 'Promote another admin before leaving');
      }
    }
    await this.prisma.participant.delete({
      where: { conversationId_userId: { conversationId, userId: meId } },
    });
    this.events.emit('conversation.member_removed', {
      conversationId,
      userId: meId,
      removedBy: meId,
      left: true,
    });
  }

  /** تغییر نام گروه — فقط ادمین و فقط گروه */
  async renameGroup(meId: string, conversationId: string, title: string): Promise<ConversationDto> {
    await this.requireAdmin(meId, conversationId);
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      throw httpError(400, 'INVALID_TITLE', 'Group title is required');
    }
    const conv = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { title: cleanTitle },
    });
    this.events.emit('conversation.renamed', {
      conversationId,
      title: conv.title,
      lastSeq: conv.lastSeq,
      lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
    });
    return this.getOne(meId, conversationId);
  }

  // ————— همگام‌سازی چنددستگاهی (گام ۷) —————

  /**
   * بوت‌استرپ کامل یک دستگاه تازه — همه مکالمه‌ها با پیش‌نمایش و شمارنده خوانده‌نشده.
   * تاریخچه خود هر مکالمه با GET /conversations/:id/messages بارگذاری می‌شود.
   */
  async syncBootstrap(meId: string): Promise<{
    serverTime: string;
    user: { id: string; phone: string; displayName: string | null; avatarUrl: string | null; about: string | null; createdAt: string };
    conversations: ConversationDto[];
  }> {
    const user = await this.prisma.user.findUnique({ where: { id: meId } });
    if (!user) throw httpError(404, 'USER_NOT_FOUND', 'User does not exist');
    const conversations = await this.listMine(meId);
    return {
      serverTime: new Date().toISOString(),
      user: {
        id: user.id,
        phone: user.phone,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        about: user.about,
        createdAt: user.createdAt.toISOString(),
      },
      conversations,
    };
  }

  /**
   * همگام‌سازی افزایشی — فقط مکالمه‌هایی که پس از `since` تغییر کرده‌اند:
   * پیام جدید / تغییر نام / تغییر عضویت هر عضو / تغییر خواندن خودم.
   * مکالمه‌هایی که دیگر عضوشان نیستم در removedConversationIds برمی‌گردند
   * (کلاینت با مقایسه لیست محلی حذف را تشخیص می‌دهد).
   */
  async syncUpdates(
    meId: string,
    since: Date,
  ): Promise<{ serverTime: string; conversations: ConversationDto[]; removedConversationIds: string[] }> {
    const serverTime = new Date().toISOString();
    const myParts = await this.prisma.participant.findMany({
      where: {
        userId: meId,
        OR: [
          { conversation: { updatedAt: { gt: since } } },
          { conversation: { participants: { some: { updatedAt: { gt: since } } } } },
          { updatedAt: { gt: since } },
        ],
      },
      select: { conversationId: true },
    });
    const conversations: ConversationDto[] = [];
    for (const p of myParts) {
      conversations.push(await this.getOne(meId, p.conversationId));
    }
    conversations.sort(
      (a, b) =>
        new Date(b.lastMessageAt ?? b.createdAt).getTime() -
        new Date(a.lastMessageAt ?? a.createdAt).getTime(),
    );
    return { serverTime, conversations, removedConversationIds: [] };
  }

  private async memberIds(conversationId: string): Promise<string[]> {
    const rows = await this.prisma.participant.findMany({
      where: { conversationId },
      select: { userId: true },
    });
    return rows.map((r) => r.userId);
  }

  /** بررسی ادمین بودن در گروه — 403 NOT_GROUP_ADMIN */
  private async requireAdmin(meId: string, conversationId: string) {
    const part = await this.requireParticipant(meId, conversationId);
    if (part.role !== 'admin') {
      throw httpError(403, 'NOT_GROUP_ADMIN', 'Only group admins can perform this action');
    }
    return part;
  }

  /** بررسی عضویت — 403 در صورت نبود عضویت */
  private async requireParticipant(meId: string, conversationId: string) {
    const part = await this.prisma.participant.findUnique({
      where: { conversationId_userId: { conversationId, userId: meId } },
    });
    if (!part) {
      // تمایز 404/403 لو نرفتن وجود مکالمه برای غیرعضو مهم نیست — پیام یکسان
      throw httpError(403, 'NOT_A_PARTICIPANT', 'You are not a participant of this conversation');
    }
    return part;
  }
}
