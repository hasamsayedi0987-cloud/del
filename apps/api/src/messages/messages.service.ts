import { EventEmitter2 } from '@nestjs/event-emitter';
import { HttpException, Injectable, Logger } from '@nestjs/common';
import type {
  ConversationDto,
  MessageDto,
  ParticipantDto,
} from '@del/shared-types';
import { PrismaService } from '../infra/prisma.service';

function httpError(status: number, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, error: { code, message } }, status);
}

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
}): MessageDto {
  return {
    id: m.id,
    conversationId: m.conversationId,
    senderId: m.senderId,
    serverSeq: m.serverSeq,
    clientMsgId: m.clientMsgId,
    type: m.type,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
    editedAt: m.editedAt?.toISOString() ?? null,
    deletedAt: m.deletedAt?.toISOString() ?? null,
  };
}

const USER_SELECT = { id: true, phone: true, displayName: true } as const;

function toParticipantDto(p: {
  userId: string;
  lastReadSeq: number;
  user: { id: string; phone: string; displayName: string | null };
}): ParticipantDto {
  return {
    userId: p.userId,
    displayName: p.user.displayName,
    phone: p.user.phone,
    lastReadSeq: p.lastReadSeq,
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

    return {
      id: conv.id,
      type: conv.type as 'direct',
      title: conv.title,
      lastSeq: conv.lastSeq,
      lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
      createdAt: conv.createdAt.toISOString(),
      peer:
        conv.type === 'direct'
          ? toParticipantDto(
              conv.participants.find((p) => p.userId !== meId) ?? conv.participants[0]!,
            )
          : null,
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
        const dto: ConversationDto = {
          id: conv.id,
          type: conv.type as 'direct',
          title: conv.title,
          lastSeq: conv.lastSeq,
          lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
          createdAt: conv.createdAt.toISOString(),
          peer:
            conv.type === 'direct'
              ? toParticipantDto(
                  conv.participants.find((p) => p.userId !== meId) ?? conv.participants[0]!,
                )
              : null,
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

    // حالت since — همگام‌سازی آفلاین (اولویت با since است)
    if (opts.since !== undefined) {
      const rows = await this.prisma.message.findMany({
        where: { conversationId, serverSeq: { gt: opts.since } },
        orderBy: { serverSeq: 'asc' },
        take: limit + 1,
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
   */
  async sendMessage(
    meId: string,
    conversationId: string,
    clientMsgId: string,
    body: string,
  ): Promise<SendResult> {
    await this.requireParticipant(meId, conversationId);

    // ۱) بررسی idempotency (مسیر سریع)
    const dup = await this.prisma.message.findUnique({
      where: { conversationId_clientMsgId: { conversationId, clientMsgId } },
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
          body,
        },
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
