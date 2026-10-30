import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { DelPushPayload, MessageDto, WsCallIncoming } from '@del/shared-types';
import { appConfig } from '../config/configuration';
import { PrismaService } from '../infra/prisma.service';
import { MessagesGateway } from '../messages/messages.gateway';
import { sendViaExpo, sendViaWebhook } from './push.providers';

/** برچسب فارسی پیام‌های رسانه‌ای برای پیش‌نمایش اعلان */
function mediaLabel(type: string): string {
  switch (type) {
    case 'image':
      return '🖼 تصویر';
    case 'video':
      return '🎬 ویدیو';
    case 'audio':
      return '🎙 پیام صوتی';
    case 'file':
      return '📎 فایل';
    default:
      return 'پیام جدید';
  }
}

interface NotifyContent {
  kind: 'message' | 'call';
  title: string;
  body: string;
  data: DelPushPayload['data'];
}

/**
 * سرویس اعلان‌ها (گام ۷) — push فقط برای کاربرِ بدون socket زنده ارسال می‌شود؛
 * اگر WS روشن باشد اعلان بلادرنگ خودش می‌رسد و push زائد است.
 * توکن‌ها فقط در DB می‌مانند؛ در لاگ/response هرگز برنمی‌گردند.
 */
@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly events: EventEmitter2,
    private readonly gateway: MessagesGateway,
  ) {}

  onModuleInit(): void {
    this.onMessageCreated = (message: MessageDto) => {
      void this.notifyNewMessage(message).catch((e) =>
        this.logger.warn(`notifyNewMessage failed: ${e?.message ?? e}`),
      );
    };
    this.events.on('message.created', this.onMessageCreated);

    this.onCallIncoming = (p: WsCallIncoming & { notifyUserId: string }) => {
      void this.notifyIncomingCall(p).catch((e) =>
        this.logger.warn(`notifyIncomingCall failed: ${e?.message ?? e}`),
      );
    };
    this.events.on('call.incoming', this.onCallIncoming);
  }

  onModuleDestroy(): void {
    if (this.onMessageCreated) this.events.off('message.created', this.onMessageCreated);
    if (this.onCallIncoming) this.events.off('call.incoming', this.onCallIncoming);
  }

  private onMessageCreated?: (message: MessageDto) => void;
  private onCallIncoming?: (p: WsCallIncoming & { notifyUserId: string }) => void;

  /** پیام جدید → push برای همه اعضای آفلاین (به‌جز فرستنده) */
  private async notifyNewMessage(message: MessageDto): Promise<void> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: message.conversationId },
      select: { type: true, title: true, participants: { select: { userId: true } } },
    });
    if (!conv) return;
    const recipients = conv.participants
      .map((p) => p.userId)
      .filter((id) => id !== message.senderId);
    if (!recipients.length) return;

    const sender = await this.prisma.user.findUnique({
      where: { id: message.senderId },
      select: { displayName: true, phone: true },
    });
    const senderName = sender?.displayName ?? sender?.phone ?? 'پیام جدید';
    const title =
      conv.type === 'group' ? `${senderName} در ${conv.title ?? 'گروه'}` : senderName;
    const body = message.body?.trim() ? message.body : mediaLabel(message.type);

    for (const userId of recipients) {
      await this.dispatchToUser(userId, {
        kind: 'message',
        title,
        body,
        data: { conversationId: message.conversationId, messageId: message.id },
      });
    }
  }

  /** تماس ورودی → push به گیرنده (وقتی WS زنده ندارد — مثلاً اپ بسته) */
  private async notifyIncomingCall(p: WsCallIncoming & { notifyUserId: string }): Promise<void> {
    const title = p.caller.displayName ?? p.caller.phone ?? 'تماس ورودی';
    const body = p.call.kind === 'video' ? '📞 تماس تصویری ورودی' : '📞 تماس صوتی ورودی';
    await this.dispatchToUser(p.notifyUserId, {
      kind: 'call',
      title,
      body,
      data: { callId: p.call.id, conversationId: p.call.conversationId },
    });
  }

  /**
   * هسته ارسال — برای یک کاربر:
   *  ۱) اگر socket زنده دارد → skip (WS خودش اعلان می‌دهد)
   *  ۲) دستگاه‌های دارای توکن push → webhook (اگر تنظیم باشد) + Expo (توکن‌های Expo)
   *  ۳) توکن نامعتبر (DeviceNotRegistered) → پاک‌سازی خودکار از DB
   */
  async dispatchToUser(userId: string, content: NotifyContent): Promise<void> {
    if (this.gateway.isUserOnline(userId)) return;

    const devices = await this.prisma.device.findMany({
      where: { userId, pushToken: { not: null } },
      select: { id: true, pushToken: true },
    });
    if (!devices.length) return;
    const tokens = devices
      .map((d) => d.pushToken)
      .filter((t): t is string => Boolean(t));
    if (!tokens.length) return;

    const cfg = appConfig.load();
    const payload: DelPushPayload = { userId, ...content, tokens };
    const invalid: string[] = [];
    let delivered = 0;

    // ۱) webhook — تست/یکپارچه‌سازی (اگر تنظیم شده باشد)
    if (cfg.pushWebhookUrl) {
      const r = await sendViaWebhook(cfg.pushWebhookUrl, payload);
      delivered += r.sent;
    }

    // ۲) Expo Push — تولید واقعی روی iOS/Android
    if (cfg.pushExpoEnabled) {
      const expoTokens = tokens.filter((t) => t.startsWith('ExpoPushToken'));
      if (expoTokens.length) {
        const r = await sendViaExpo(expoTokens, content);
        delivered += r.sent;
        invalid.push(...r.invalidTokens);
      }
    }

    // ۳) حالت توسعه بدون پیکربندی — فقط لاگ (بدون توکن کامل؛ فقط شکل)
    if (!cfg.pushWebhookUrl && delivered === 0) {
      this.logger.log(
        `push(kind=${content.kind}) → user=${userId} title="${content.title}" devices=${tokens.length}`,
      );
    }

    // ۴) پاک‌سازی توکن‌های مرده — معیار پذیرش: توکن منقضی خودکار پاک می‌شود
    if (invalid.length) {
      await this.prisma.device.updateMany({
        where: { pushToken: { in: invalid } },
        data: { pushToken: null },
      });
      this.logger.log(`pruned ${invalid.length} invalid push token(s)`);
    }
  }
}
