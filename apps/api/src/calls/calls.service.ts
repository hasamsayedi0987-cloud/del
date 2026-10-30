import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  HttpException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AppConfig } from '../config/configuration';
import { appConfig } from '../config/configuration';
import { PrismaService } from '../infra/prisma.service';
import { BlocksService } from '../users/blocks.service';
import type { CallDto, CallKind, CallPage } from '@del/shared-types';

function httpError(status: number, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, error: { code, message } }, status);
}

const CALL_SELECT = {
  id: true,
  conversationId: true,
  callerId: true,
  calleeId: true,
  kind: true,
  status: true,
  endReason: true,
  startedAt: true,
  connectedAt: true,
  endedAt: true,
  durationS: true,
} as const;

type CallRow = {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  kind: string;
  status: string;
  endReason: string | null;
  startedAt: Date;
  connectedAt: Date | null;
  endedAt: Date | null;
  durationS: number | null;
};

function toCallDto(c: CallRow): CallDto {
  return {
    id: c.id,
    conversationId: c.conversationId,
    callerId: c.callerId,
    calleeId: c.calleeId,
    kind: c.kind as CallKind,
    status: c.status as CallDto['status'],
    endReason: (c.endReason ?? null) as CallDto['endReason'],
    startedAt: c.startedAt.toISOString(),
    connectedAt: c.connectedAt?.toISOString() ?? null,
    endedAt: c.endedAt?.toISOString() ?? null,
    durationS: c.durationS ?? null,
  };
}

/**
 * تماس‌های ۱:۱ صوتی/تصویری (گام ۶)
 * signaling روی WS (call.incoming / call.accepted / call.ended)؛
 * صدا و تصویر مستقیم بین کلاینت‌ها از LiveKit (SFU) می‌گذرد — بایت‌های مدیا از API عبور نمی‌کنند.
 *
 * چرخه عمر: ringing → active → ended | rejected | cancelled | missed
 * زنگ بدون پاسخ پس از CALL_RING_TIMEOUT_SEC خودکار «missed» می‌شود.
 */
@Injectable()
export class CallsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallsService.name);
  private cfg: AppConfig;
  /** تایمرهای زنگ — پس از پاسخ/رد/لغو پاک می‌شوند */
  private readonly ringTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly blocks: BlocksService,
    private readonly jwt: JwtService,
    private readonly events: EventEmitter2,
  ) {
    this.cfg = appConfig.load();
  }

  onModuleInit(): void {
    // بازیابی زنگ‌های ناتمام پس از ری‌استارت سرور — همان قانون timeout اعمال می‌شود
    void this.sweepStaleRinging();
  }

  onModuleDestroy(): void {
    for (const t of this.ringTimers.values()) clearTimeout(t);
    this.ringTimers.clear();
  }

  /** شروع تماس — فقط مکالمه‌های ۱:۱ (گروه‌ها در گام‌های بعد) */
  async start(userId: string, input: { conversationId: string; kind: CallKind }): Promise<CallDto> {
    this.requireConfigured();

    const conv = await this.prisma.conversation.findUnique({
      where: { id: input.conversationId },
      include: { participants: { select: { userId: true } } },
    });
    if (!conv) throw httpError(404, 'CONVERSATION_NOT_FOUND', 'گفتگو یافت نشد');
    if (conv.type !== 'direct') {
      throw httpError(409, 'NOT_DIRECT', 'فعلاً فقط تماس در گفتگوهای ۱:۱ ممکن است — تماس گروهی در گام‌های بعد');
    }
    const mine = conv.participants.find((p) => p.userId === userId);
    if (!mine) throw httpError(403, 'NOT_A_PARTICIPANT', 'شما عضو این گفتگو نیستید');
    const peer = conv.participants.find((p) => p.userId !== userId);
    if (!peer) throw httpError(409, 'CONVERSATION_EMPTY', 'طرف مقابل در این گفتگو نیست');

    // مسدودسازی (گام ۱۰) — تماس بین زوج مسدود بسته است
    await this.blocks.assertNotBlocked(userId, peer.userId);

    // قانون مشغولی — هر طرف در تماس باز (ringing/active) باشد تماس تازه رد می‌شود
    const busy = await this.hasOpenCall([userId, peer.userId]);
    if (busy) throw httpError(409, 'CALL_BUSY', 'یکی از دو طرف در حال حاضر در تماس دیگری است');

    const call = await this.prisma.call.create({
      data: {
        conversationId: conv.id,
        callerId: userId,
        calleeId: peer.userId,
        kind: input.kind,
        status: 'ringing',
      },
      select: CALL_SELECT,
    });

    const caller = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, displayName: true, phone: true },
    });

    // زنگ به اتاق شخصی گیرنده — همه دستگاه‌های او می‌شنوند
    this.events.emit('call.incoming', {
      call: toCallDto(call),
      caller: caller ?? { id: userId, displayName: null, phone: null },
      notifyUserId: peer.userId,
    });
    this.armRingTimer(call.id);
    return toCallDto(call);
  }

  /** پذیرش تماس — فقط گیرنده و فقط در وضعیت ringing؛ توکن LiveKit هر دو طرف صادر می‌شود */
  async accept(userId: string, callId: string): Promise<{
    call: CallDto;
    url: string;
    token: string;
    room: string;
  }> {
    this.requireConfigured();

    const call = await this.prisma.call.findUnique({ where: { id: callId }, select: CALL_SELECT });
    if (!call) throw httpError(404, 'CALL_NOT_FOUND', 'تماس یافت نشد');
    if (call.calleeId !== userId) {
      throw httpError(403, 'NOT_CALLEE', 'فقط گیرنده تماس می‌تواند پاسخ دهد');
    }
    if (call.status !== 'ringing') {
      throw httpError(409, 'INVALID_STATE', `تماس در وضعیت «${call.status}» است — قابل پاسخ نیست`);
    }

    const connectedAt = new Date();
    const updated = await this.prisma.call.update({
      where: { id: call.id },
      data: { status: 'active', connectedAt },
      select: CALL_SELECT,
    });
    this.clearRingTimer(call.id);

    const url = this.cfg.livekitUrl as string;
    const room = `call:${call.id}`;
    const tokens: Record<string, string> = {
      [call.callerId]: await this.livekitToken(call.callerId, room),
      [call.calleeId]: await this.livekitToken(call.calleeId, room),
    };

    // هر طرف توکن خودش را می‌گیرد — به اتاق شخصی (همه دستگاه‌ها)
    this.events.emit('call.accepted', {
      call: toCallDto(updated),
      url,
      room,
      tokens,
      notifyUserIds: [call.callerId, call.calleeId],
    });
    return { call: toCallDto(updated), url, token: tokens[call.calleeId]!, room };
  }

  /** رد تماس — فقط گیرنده */
  async reject(userId: string, callId: string): Promise<void> {
    const call = await this.prisma.call.findUnique({ where: { id: callId }, select: CALL_SELECT });
    if (!call) throw httpError(404, 'CALL_NOT_FOUND', 'تماس یافت نشد');
    if (call.calleeId !== userId) throw httpError(403, 'NOT_CALLEE', 'فقط گیرنده تماس می‌تواند رد کند');
    if (call.status !== 'ringing') {
      throw httpError(409, 'INVALID_STATE', `تماس در وضعیت «${call.status}» است`);
    }
    await this.prisma.call.update({
      where: { id: call.id },
      data: { status: 'rejected', endReason: 'reject', endedAt: new Date() },
    });
    this.clearRingTimer(call.id);
    this.events.emit('call.ended', {
      callId: call.id,
      conversationId: call.conversationId,
      reason: 'reject',
      by: userId,
      durationS: null,
      notifyUserIds: [call.callerId, call.calleeId],
    });
  }

  /** لغو تماس پیش از پاسخ — فقط تماس‌گیرنده */
  async cancel(userId: string, callId: string): Promise<void> {
    const call = await this.prisma.call.findUnique({ where: { id: callId }, select: CALL_SELECT });
    if (!call) throw httpError(404, 'CALL_NOT_FOUND', 'تماس یافت نشد');
    if (call.callerId !== userId) throw httpError(403, 'NOT_CALLER', 'فقط تماس‌گیرنده می‌تواند لغو کند');
    if (call.status !== 'ringing') {
      throw httpError(409, 'INVALID_STATE', `تماس در وضعیت «${call.status}» است — لغو ممکن نیست`);
    }
    await this.prisma.call.update({
      where: { id: call.id },
      data: { status: 'cancelled', endReason: 'cancel', endedAt: new Date() },
    });
    this.clearRingTimer(call.id);
    this.events.emit('call.ended', {
      callId: call.id,
      conversationId: call.conversationId,
      reason: 'cancel',
      by: userId,
      durationS: null,
      notifyUserIds: [call.callerId, call.calleeId],
    });
  }

  /** پایان تماس فعال — هر طرف می‌تواند قطع کند */
  async end(userId: string, callId: string): Promise<CallDto> {
    const call = await this.prisma.call.findUnique({ where: { id: callId }, select: CALL_SELECT });
    if (!call) throw httpError(404, 'CALL_NOT_FOUND', 'تماس یافت نشد');
    if (call.callerId !== userId && call.calleeId !== userId) {
      throw httpError(403, 'NOT_CALL_PARTICIPANT', 'شما در این تماس نیستید');
    }
    if (call.status !== 'active') {
      throw httpError(409, 'INVALID_STATE', `تماس در وضعیت «${call.status}» است — پایان دادن ممکن نیست`);
    }
    const endedAt = new Date();
    const durationS = call.connectedAt
      ? Math.max(0, Math.round((endedAt.getTime() - call.connectedAt.getTime()) / 1000))
      : 0;
    const updated = await this.prisma.call.update({
      where: { id: call.id },
      data: { status: 'ended', endReason: 'hangup', endedAt, durationS },
      select: CALL_SELECT,
    });
    this.events.emit('call.ended', {
      callId: call.id,
      conversationId: call.conversationId,
      reason: 'hangup',
      by: userId,
      durationS,
      notifyUserIds: [call.callerId, call.calleeId],
    });
    return toCallDto(updated);
  }

  /** تاریخچه تماس‌های کاربر (یا یک گفتگو) — صفحه‌بندی با cursor تاریخ */
  async history(
    userId: string,
    query: { conversationId?: string; before?: string; limit?: number },
  ): Promise<CallPage> {
    const limit = Math.min(Math.max(query.limit ?? 30, 1), 100);
    const where = {
      conversationId: query.conversationId,
      OR: [{ callerId: userId }, { calleeId: userId }],
      ...(query.before ? { startedAt: { lt: new Date(query.before) } } : {}),
    };
    const rows = await this.prisma.call.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      take: limit + 1,
      select: CALL_SELECT,
    });
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map(toCallDto);
    return {
      calls: page,
      hasMore,
      nextBefore: hasMore && page.length ? page[page.length - 1]!.startedAt : null,
    };
  }

  // ————— خصوصی —————

  private requireConfigured(): void {
    if (!this.cfg.callsConfigured) {
      throw httpError(
        503,
        'CALLS_DISABLED',
        'سرور LiveKit پیکربندی نشده — متغیرهای LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET لازم است',
      );
    }
  }

  /** آیا هر یک از این کاربران تماس باز (ringing/active) دارد؟ */
  private async hasOpenCall(userIds: string[]): Promise<boolean> {
    const count = await this.prisma.call.count({
      where: {
        status: { in: ['ringing', 'active'] },
        OR: [{ callerId: { in: userIds } }, { calleeId: { in: userIds } }],
      },
    });
    return count > 0;
  }

  private armRingTimer(callId: string): void {
    const ms = Math.max(1, this.cfg.callRingTimeoutSec) * 1000;
    const t = setTimeout(() => {
      this.ringTimers.delete(callId);
      void this.expireRinging(callId);
    }, ms);
    t.unref?.();
    this.ringTimers.set(callId, t);
  }

  private clearRingTimer(callId: string): void {
    const t = this.ringTimers.get(callId);
    if (t) clearTimeout(t);
    this.ringTimers.delete(callId);
  }

  /** زنگ بی‌پاسخ → missed + رویداد call.ended با reason=timeout */
  private async expireRinging(callId: string): Promise<void> {
    try {
      const call = await this.prisma.call.findUnique({
        where: { id: callId },
        select: CALL_SELECT,
      });
      if (!call || call.status !== 'ringing') return;
      await this.prisma.call.update({
        where: { id: call.id },
        data: { status: 'missed', endReason: 'timeout', endedAt: new Date() },
      });
      this.events.emit('call.ended', {
        callId: call.id,
        conversationId: call.conversationId,
        reason: 'timeout',
        by: call.callerId,
        durationS: null,
        notifyUserIds: [call.callerId, call.calleeId],
      });
    } catch (e) {
      this.logger.warn(`expireRinging failed for ${callId}: ${String(e)}`);
    }
  }

  /** پس از ری‌استارت سرور، زنگ‌های یتیم را ببند */
  private async sweepStaleRinging(): Promise<void> {
    try {
      const cutoff = new Date(Date.now() - this.cfg.callRingTimeoutSec * 1000);
      const stale = await this.prisma.call.findMany({
        where: { status: 'ringing', startedAt: { lt: cutoff } },
        select: CALL_SELECT,
      });
      for (const call of stale) await this.expireRinging(call.id);
      if (stale.length) this.logger.log(`swept ${stale.length} stale ringing call(s)`);
    } catch {
      /* اولین بوت قبل از مهاجرت — بی‌اهمیت */
    }
  }

  /**
   * توکن دسترسی LiveKit (JWT HS256 با grantهای video) — بدون وابستگی جدید؛
   * ساختار مطابق spec توکن سرور LiveKit: iss=apiKey، sub=identity، video.roomJoin.
   */
  private async livekitToken(userId: string, room: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    const ttl = Math.max(60, this.cfg.livekitTokenTtlSec);
    return this.jwt.sign(
      {
        name: user?.displayName ?? undefined,
        video: {
          room,
          roomJoin: true,
          canPublish: true,
          canSubscribe: true,
          canPublishData: true,
        },
      },
      {
        secret: this.cfg.livekitApiSecret as string,
        algorithm: 'HS256',
        issuer: this.cfg.livekitApiKey as string,
        subject: userId,
        jwtid: `${room}:${userId}`,
        notBefore: '-10s',
        expiresIn: ttl,
      },
    );
  }
}
