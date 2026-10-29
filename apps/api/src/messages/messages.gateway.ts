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
import type { MessageDto, WsMessageNew } from '@del/shared-types';
import { PrismaService } from '../infra/prisma.service';
import { MessagesService } from './messages.service';

interface SendPayload {
  conversationId: string;
  clientMsgId: string;
  body: string;
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

    // عضویت در اتاق همه مکالمه‌های کاربر
    const parts = await this.prisma.participant.findMany({
      where: { userId: client.data.userId },
      select: { conversationId: true },
    });
    for (const p of parts) client.join(room(p.conversationId));
    this.logger.log(`WS connected user=${client.data.userId} rooms=${parts.length}`);
  }

  handleDisconnect(client: AuthedSocket): void {
    this.logger.log(`WS disconnected user=${client.data?.userId ?? '?'}`);
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

  onModuleInit(): void {
    // broadcast پیام جدید به اتاق مکالمه — همه اعضا از جمله فرستنده (کلاینت با clientMsgId dedupe می‌کند)
    this.events.on('message.created', (message: MessageDto) => {
      const payload: WsMessageNew = { conversationId: message.conversationId, message };
      this.server?.to(room(message.conversationId)).emit('message.new', payload);
      this.server?.to(room(message.conversationId)).emit('conversation.updated', {
        conversationId: message.conversationId,
        lastSeq: message.serverSeq,
        lastMessageAt: message.createdAt,
      });
    });
  }

  onModuleDestroy(): void {
    this.events.off('message.created', () => undefined);
  }
}

export const room = (conversationId: string): string => `conv:${conversationId}`;
