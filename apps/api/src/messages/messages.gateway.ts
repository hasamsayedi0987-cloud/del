import { Logger, OnModuleDestroy } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { Server, Socket } from 'socket.io';
import type {
  MessageDto,
  WsConversationNew,
  WsMemberAdded,
  WsMemberRemoved,
  WsMessageNew,
  WsTyping,
  WsPresenceUpdate,
} from '@del/shared-types';
import { PrismaService } from '../infra/prisma.service';
import { MessagesService } from './messages.service';
import { PresenceService } from '../presence/presence.service';

interface SendPayload {
  conversationId: string;
  clientMsgId: string;
  body: string;
}

interface JoinPayload {
  conversationId: string;
}

interface AuthedSocket extends Socket {
  data: { userId: string };
}

/**
 * Gateway پیام‌رسانی — Socket.IO
 * handshake: io(URL, { auth: { token: <accessToken> } })
 * رویدادها: message.send (کلاینت→سرور) · message.new / conversation.updated (سرور→کلاینت)
 */
@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class MessagesGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnModuleDestroy
{
  private readonly logger = new Logger(MessagesGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly events: EventEmitter2,
    private readonly presence: PresenceService,
  ) {}

  async handleConnection(client: AuthedSocket): Promise<void> {
    const token =
      (client.handshake.auth?.token as string | undefined) ??
      (client.handshake.query?.token as string | undefined);
    try {
      const payload = this.jwt.verify<{ sub: string; typ: string }>(token ?? '');
      if (payload.typ !== 'access' || !payload.sub) throw new Error('bad payload');
      client.data.userId = payload.sub;
    } catch {
      this.logger.warn(`WS rejected: invalid token (${client.id})`);
      client.emit('ws.error', { code: 'UNAUTHORIZED', message: 'Valid access token required' });
      client.disconnect(true);
      return;
    }

    // عضویت در اتاق همه مکالمه‌های کاربر + اتاق شخصی (برای رویداد conversation.new)
    const parts = await this.prisma.participant.findMany({
      where: { userId: client.data.userId },
      select: { conversationId: true },
    });
    for (const p of parts) client.join(room(p.conversationId));
    client.join(userRoom(client.data.userId));

    // حضور: اگر اولین socket این کاربر است → online + اطلاع به هم‌مکالمه‌ها
    const sockets = this.socketsByUser.get(client.data.userId) ?? new Set<string>();
    const isFirst = sockets.size === 0;
    sockets.add(client.id);
    this.socketsByUser.set(client.data.userId, sockets);
    if (isFirst) {
      await this.presence.setOnline(client.data.userId);
      void this.broadcastPresence(client.data.userId);
    }
    this.logger.log(`WS connected user=${client.data.userId} rooms=${parts.length}`);
  }

  handleDisconnect(client: AuthedSocket): void {
    const userId = client.data?.userId;
    this.logger.log(`WS disconnected user=${userId ?? '?'}`);
    if (!userId) return;
    const sockets = this.socketsByUser.get(userId);
    if (!sockets) return;
    sockets.delete(client.id);
    this.lastTypingAt.delete(client.id);
    if (sockets.size === 0) {
      this.socketsByUser.delete(userId);
      void this.presence.setOffline(userId).then(() => this.broadcastPresence(userId));
    }
  }

  /** شمارش socketهای هر کاربر — حضور فقط با بسته‌شدن آخرین socket خاموش می‌شود */
  private readonly socketsByUser = new Map<string, Set<string>>();
  /** throttle رویداد typing به تفکیک socket */
  private readonly lastTypingAt = new Map<string, number>();

  /** تغییر حضور را به اتاق شخصی همه هم‌مکالمه‌های کاربر می‌فرستد */
  private async broadcastPresence(userId: string): Promise<void> {
    const state = await this.presence.get(userId);
    const payload: WsPresenceUpdate = {
      userId,
      online: state.online,
      lastSeen: state.lastSeen,
    };
    const coParticipants = await this.prisma.participant.findMany({
      where: {
        conversation: { participants: { some: { userId } } },
        userId: { not: userId },
      },
      distinct: ['userId'],
      select: { userId: true },
    });
    for (const c of coParticipants) {
      this.server?.to(userRoom(c.userId)).emit('presence.update', payload);
    }
  }

  /** heartbeat حضور — TTL کلید online را تمدید می‌کند */
  @SubscribeMessage('presence.heartbeat')
  async onHeartbeat(@ConnectedSocket() client: AuthedSocket): Promise<{ ok: boolean }> {
    await this.presence.heartbeat(client.data.userId);
    return { ok: true };
  }

  /**
   * «در حال نوشتن» — کلاینت throttle می‌کند؛ سرور هم محافظت می‌کند (حداکثر هر ۱٫۵ ثانیه)
   * فقط برای اعضای اتاق (بررسی عضویت از طریق rooms) و بدون echo به فرستنده.
   */
  @SubscribeMessage('typing')
  onTyping(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: { conversationId?: string },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): any {
    const conversationId = payload?.conversationId;
    if (!conversationId) {
      return { ok: false, error: { code: 'BAD_PAYLOAD', message: 'conversationId required' } };
    }
    if (!client.rooms.has(room(conversationId))) {
      return { ok: false, error: { code: 'NOT_A_PARTICIPANT', message: 'Join the conversation first' } };
    }
    const now = Date.now();
    const last = this.lastTypingAt.get(client.id) ?? 0;
    if (now - last < 1500) return { ok: true, throttled: true };
    this.lastTypingAt.set(client.id, now);
    const event: WsTyping = { conversationId, userId: client.data.userId };
    client.to(room(conversationId)).emit('typing', event);
    return { ok: true };
  }

  /** ارسال پیام از مسیر WS — همان مسیر سرویس REST با idempotency یکسان */
  @SubscribeMessage('message.send')
  async onSend(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: SendPayload,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    try {
      const { conversationId, clientMsgId, body } = payload ?? ({} as SendPayload);
      if (!conversationId || !clientMsgId || typeof body !== 'string' || !body.trim()) {
        return { ok: false, error: { code: 'BAD_PAYLOAD', message: 'conversationId, clientMsgId, body required' } };
      }
      const result = await this.messages.sendMessage(
        client.data.userId,
        conversationId,
        clientMsgId,
        body.trim(),
      );
      return { ok: true, ...result };
    } catch (e) {
      const ex = e as { status?: number; response?: { error?: { code?: string; message?: string } }; message?: string };
      return {
        ok: false,
        error: {
          code: ex.response?.error?.code ?? 'SEND_FAILED',
          message: ex.response?.error?.message ?? ex.message ?? 'Send failed',
        },
      };
    }
  }

  /**
   * عضویت در اتاق مکالمه — برای مکالمه‌های ساخته‌شده پس از اتصال.
   * عضویت فقط پس از تأیید عضویت کاربر در مکالمه انجام می‌شود.
   */
  @SubscribeMessage('conversation.join')
  async onJoin(
    @ConnectedSocket() client: AuthedSocket,
    @MessageBody() payload: JoinPayload,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ): Promise<any> {
    const conversationId = payload?.conversationId;
    if (!conversationId) {
      return { ok: false, error: { code: 'BAD_PAYLOAD', message: 'conversationId required' } };
    }
    const member = await this.prisma.participant.findUnique({
      where: {
        conversationId_userId: { conversationId, userId: client.data.userId },
      },
      select: { id: true },
    });
    if (!member) {
      return { ok: false, error: { code: 'NOT_A_PARTICIPANT', message: 'Not a participant' } };
    }
    client.join(room(conversationId));
    return { ok: true };
  }

  onModuleInit(): void {
    // broadcast پیام جدید به اتاق مکالمه — همه اعضا از جمله فرستنده (کلاینت با clientMsgId dedupe می‌کند)
    this.onMessageCreated = (message: MessageDto) => {
      const payload: WsMessageNew = { conversationId: message.conversationId, message };
      this.server?.to(room(message.conversationId)).emit('message.new', payload);
      this.server?.to(room(message.conversationId)).emit('conversation.updated', {
        conversationId: message.conversationId,
        lastSeq: message.serverSeq,
        lastMessageAt: message.createdAt,
      });
    };
    this.events.on('message.created', this.onMessageCreated);

    // مکالمه تازه به کاربران آنلاین اطلاع داده می‌شود تا لیست‌شان رفرش شود
    this.onConversationCreated = (payload: { conversationId: string; userIds: string[] }) => {
      const wsPayload: WsConversationNew = {
        conversationId: payload.conversationId,
        participantUserIds: payload.userIds,
      };
      for (const userId of payload.userIds) {
        this.server?.to(userRoom(userId)).emit('conversation.new', wsPayload);
      }
    };
    this.events.on('conversation.created', this.onConversationCreated);

    // رسید خواندن بلادرنگ — event داخلی markRead → اتاق مکالمه
    this.onConversationRead = (payload: {
      conversationId: string;
      userId: string;
      lastReadSeq: number;
    }) => {
      this.server?.to(room(payload.conversationId)).emit('message.read', payload);
    };
    this.events.on('conversation.read', this.onConversationRead);

    // عضو تازه — به اتاق گروه + اتاق شخصی خودش (تا UI رفرش و join کند)
    this.onMembersAdded = (p: {
      conversationId: string;
      userIds: string[];
      addedBy: string;
      allUserIds: string[];
    }) => {
      const convNew: WsConversationNew = {
        conversationId: p.conversationId,
        participantUserIds: p.allUserIds,
      };
      for (const userId of p.userIds) {
        const added: WsMemberAdded = {
          conversationId: p.conversationId,
          userId,
          addedBy: p.addedBy,
        };
        this.server?.to(room(p.conversationId)).emit('member.added', added);
        this.server?.to(userRoom(userId)).emit('conversation.new', convNew);
        // socketهای آنلاین عضو تازه را همان‌جا به اتاق گروه می‌بریم — بی‌نیاز از join سمت کلاینت
        void this.server
          ?.in(userRoom(userId))
          .fetchSockets()
          .then((sockets) => {
            for (const s of sockets) s.join(room(p.conversationId));
          });
      }
    };
    this.events.on('conversation.members_added', this.onMembersAdded);

    // حذف/خروج عضو — مهم: socketهای او را از اتاق گروه خارج می‌کنیم (توقف دریافت پیام‌های گروه)
    this.onMemberRemoved = (p: {
      conversationId: string;
      userId: string;
      removedBy: string;
      left: boolean;
    }) => {
      const removed: WsMemberRemoved = {
        conversationId: p.conversationId,
        userId: p.userId,
        removedBy: p.removedBy,
        left: p.left,
      };
      this.server?.to(room(p.conversationId)).emit('member.removed', removed);
      this.server?.to(userRoom(p.userId)).emit('member.removed', removed);
      void this.server
        ?.in(userRoom(p.userId))
        .fetchSockets()
        .then((sockets) => {
          for (const s of sockets) s.leave(room(p.conversationId));
        });
    };
    this.events.on('conversation.member_removed', this.onMemberRemoved);

    // تغییر نام گروه — لیست‌ها رفرش شود
    this.onConversationRenamed = (p: {
      conversationId: string;
      title: string | null;
      lastSeq: number;
      lastMessageAt: string | null;
    }) => {
      this.server?.to(room(p.conversationId)).emit('conversation.updated', {
        conversationId: p.conversationId,
        lastSeq: p.lastSeq,
        lastMessageAt: p.lastMessageAt,
      });
      // اعضا برای دیدن عنوان تازه لیست را رفرش می‌کنند — همان رویداد updated کافی است
    };
    this.events.on('conversation.renamed', this.onConversationRenamed);
  }

  private onMessageCreated?: (message: MessageDto) => void;
  private onConversationCreated?: (payload: {
    conversationId: string;
    userIds: string[];
  }) => void;
  private onConversationRead?: (payload: {
    conversationId: string;
    userId: string;
    lastReadSeq: number;
  }) => void;
  private onMembersAdded?: (payload: {
    conversationId: string;
    userIds: string[];
    addedBy: string;
    allUserIds: string[];
  }) => void;
  private onMemberRemoved?: (payload: {
    conversationId: string;
    userId: string;
    removedBy: string;
    left: boolean;
  }) => void;
  private onConversationRenamed?: (payload: {
    conversationId: string;
    title: string | null;
    lastSeq: number;
    lastMessageAt: string | null;
  }) => void;

  onModuleDestroy(): void {
    if (this.onMessageCreated) this.events.off('message.created', this.onMessageCreated);
    if (this.onConversationCreated) {
      this.events.off('conversation.created', this.onConversationCreated);
    }
    if (this.onConversationRead) this.events.off('conversation.read', this.onConversationRead);
    if (this.onMembersAdded) this.events.off('conversation.members_added', this.onMembersAdded);
    if (this.onMemberRemoved) this.events.off('conversation.member_removed', this.onMemberRemoved);
    if (this.onConversationRenamed) this.events.off('conversation.renamed', this.onConversationRenamed);
  }
}

export const room = (conversationId: string): string => `conv:${conversationId}`;
export const userRoom = (userId: string): string => `user:${userId}`;
