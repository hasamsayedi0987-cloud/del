/**
 * گام ۹ — سرویس هوش مصنوعی دل
 *
 * قواعد حریم خصوصی (سخت و بدون استثنا):
 *  ۱) بدون رضایت (کلی یا گفتگو-محور) هیچ محتوایی از DB خوانده و به provider نمی‌رود.
 *  ۲) پیام‌های رمزنگاری‌شده سرتاسری (isE2ee) هرگز برای AI استفاده نمی‌شوند —
 *     سرور محتوایشان را نمی‌فهمد و نباید بفهمد.
 *  ۳) کلید provider فقط سمت سرور می‌ماند؛ در پاسخ‌ها فقط نام provider برمی‌گردد.
 *  ۴) در ثبت مصرف فقط متادیتا ذخیره می‌شود (طول متن، توکن، تأخیر) — نه محتوا.
 */
import { HttpException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AiTextResult, AiUsageReport } from '@del/shared-types';
import type { AppConfig } from '../config/configuration';
import { PrismaService } from '../infra/prisma.service';
import {
  AiProvider,
  AiProviderError,
  MockAiProvider,
  OpenAiProvider,
  WebhookAiProvider,
} from './ai.providers';
import type { AiFeatureName } from './dto/ai.dto';

function httpError(status: number, code: string, message: string): HttpException {
  return new HttpException({ statusCode: status, error: { code, message } }, status);
}

/** سقف کاراکتر متن ورودی برای همه قابلیت‌ها */
const MAX_INPUT_CHARS = 12_000;
/** حداکثر پیام قابل خواندن برای پیشنهاد پاسخ */
const SUGGEST_WINDOW = 12;

const LANG_FA: Record<string, string> = {
  fa: 'فارسی',
  en: 'انگلیسی',
  ar: 'عربی',
  de: 'آلمانی',
  fr: 'فرانسوی',
  tr: 'ترکی استانبولی',
  es: 'اسپانیایی',
  ru: 'روسی',
};

const SYSTEM_PROMPTS: Record<AiFeatureName, string> = {
  translate:
    'تو مترجم دقیق اپلیکیشن پیام‌رسان «دل» هستی. فقط و فقط ترجمه را برگردان — بدون هیچ توضیح، پیشوند یا نقل‌قول اضافه.',
  fix: 'تو ویراستار متنی «دل» هستی. متن اصلاح‌شده را برگردان — بدون توضیح اضافه؛ زبان و لحن اصلی متن حفظ شود.',
  suggest:
    'تو دستیار گفتگوی «دل» هستی. با توجه به رونوشت گفتگو، چند پاسخ کوتاه، طبیعی و محترمانه پیشنهاد بده؛ هر پیشنهاد در یک خط جداگانه.',
  summarize:
    'تو خلاصه‌ساز گفتگوی «دل» هستی. یک خلاصهٔ کوتاه فارسی (حداکثر ۵ خط) از نکات اصلی گفتگو بنویس؛ بی‌طرف و بدون نقل‌قول طولانی.',
  chat:
    'تو «دستیار دل» هستی — دستیار گفتگوی داخل اپ پیام‌رسان دل. به زبان کاربر پاسخ بده (پیش‌فرض فارسی). کوتاه، دقیق و دوستانه؛ برای ترجمه هم توانا هستی. هیچ دادهٔ شخصی درخواست نکن و محتوای مشکوک را رد کن.',
};

/** محدودساز درون‌حافظه‌ای اختصاصی AI (کد خطای AI_RATE_LIMITED) */
class AiRateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  check(key: string, perMin: number): void {
    const now = Date.now();
    const b = this.hits.get(key);
    if (!b || b.resetAt < now) {
      this.hits.set(key, { count: 1, resetAt: now + 60_000 });
      return;
    }
    b.count += 1;
    if (b.count > perMin) {
      throw httpError(
        429,
        'AI_RATE_LIMITED',
        `سقف ${perMin} درخواست AI در دقیقه پر شد؛ کمی بعد دوباره تلاش کنید`,
      );
    }
  }
}

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private provider: AiProvider | null = null;
  private readonly limiter = new AiRateLimiter();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig>,
  ) {}

  onModuleInit() {
    const cfg = this.config;
    if (!cfg.get('aiEnabled', true)) {
      this.logger.warn('قابلیت AI با AI_ENABLED=false خاموش است');
      return;
    }
    const explicit = cfg.get<'mock' | 'openai' | 'webhook' | undefined>('aiProvider');
    const key = cfg.get('aiApiKey');
    const webhook = cfg.get('aiWebhookUrl');
    const baseUrl = cfg.get('aiBaseUrl') ?? 'https://api.openai.com/v1';
    const model = cfg.get('aiModel') ?? 'gpt-4o-mini';

    const chosen: AiProvider =
      explicit === 'openai' || (!explicit && key)
        ? new OpenAiProvider(baseUrl, key ?? '', model)
        : explicit === 'webhook' || (!explicit && webhook && !key)
          ? new WebhookAiProvider(webhook!)
          : new MockAiProvider();

    this.provider = chosen;
    this.logger.log(`AI provider فعال: ${chosen.name}${chosen.name === 'openai' ? ` (${model})` : ''}`);
  }

  /** نام provider فعال — برای /ai/status */
  activeProviderName(): string | null {
    return this.provider?.name ?? null;
  }

  // ————— رضایت —————

  /** رضایت مؤثر = رضایت همان گفتگو (اگر ست شده باشد) وگرنه رضایت کلی */
  private effectiveConsent(
    participant: { aiConsent: boolean | null },
    globalConsent: boolean,
  ): boolean {
    return participant.aiConsent ?? globalConsent;
  }

  /** بررسی رضایت + عضویت برای یک گفتگو؛ در نبود رضایت 403 AI_CONSENT_REQUIRED */
  private async requireConsentAndMembership(meId: string, conversationId: string) {
    const part = await this.prisma.participant.findUnique({
      where: { conversationId_userId: { conversationId, userId: meId } },
      include: { user: { select: { aiConsent: true } } },
    });
    if (!part) {
      throw httpError(403, 'NOT_A_MEMBER', 'شما عضو این گفتگو نیستید');
    }
    if (!this.effectiveConsent(part, part.user.aiConsent)) {
      throw httpError(
        403,
        'AI_CONSENT_REQUIRED',
        'برای استفاده از هوش مصنوعی ابتدا در تنظیمات رضایت خود را فعال کنید — بدون رضایت هیچ محتوایی ارسال نمی‌شود',
      );
    }
    return part;
  }

  // ————— قابلیت‌ها —————

  async status(meId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: meId },
      select: { aiConsent: true },
    });
    return {
      available: Boolean(this.provider),
      provider: this.activeProviderName(),
      globalConsent: user?.aiConsent ?? false,
    };
  }

  async setGlobalConsent(meId: string, enabled: boolean) {
    const user = await this.prisma.user.update({
      where: { id: meId },
      data: { aiConsent: enabled },
      select: { aiConsent: true },
    });
    return { ok: true as const, aiConsent: user.aiConsent };
  }

  async setConversationConsent(
    meId: string,
    conversationId: string,
    enabled: boolean | null,
  ) {
    const part = await this.prisma.participant.findUnique({
      where: { conversationId_userId: { conversationId, userId: meId } },
    });
    if (!part) {
      throw httpError(403, 'NOT_A_MEMBER', 'شما عضو این گفتگو نیستید');
    }
    const updated = await this.prisma.participant.update({
      where: { id: part.id },
      data: { aiConsent: enabled },
    });
    return { ok: true as const, conversationId, aiConsent: updated.aiConsent };
  }

  /** ترجمهٔ یک پیام — پیام E2EE پشتیبانی نمی‌شود (سرور محتوا را نمی‌فهمد) */
  async translate(meId: string, messageId: string, target?: string): Promise<AiTextResult> {
    this.ensureEnabled();

    const msg = await this.prisma.message.findUnique({
      where: { id: messageId },
      select: {
        id: true,
        conversationId: true,
        body: true,
        isE2ee: true,
        deletedAt: true,
      },
    });
    if (!msg || msg.deletedAt) {
      throw httpError(404, 'MESSAGE_NOT_FOUND', 'پیام یافت نشد');
    }
    // ترتیب: رضایت/عضویت ← سقف نرخ (درخواست‌های ردشده سهمی از سقف نمی‌برند)
    await this.requireConsentAndMembership(meId, msg.conversationId);
    this.limiter.check(meId, this.config.get('aiRatePerMin') ?? 20);
    if (msg.isE2ee) {
      throw httpError(
        422,
        'AI_E2EE_UNAVAILABLE',
        'پیام‌های رمزنگاری‌شدهٔ سرتاسری قابل ترجمه نیستند — سرور محتوایشان را نمی‌فهمد',
      );
    }
    if (msg.body.length > MAX_INPUT_CHARS) {
      throw httpError(400, 'AI_TEXT_TOO_LONG', 'متن برای ترجمه بیش از حد بلند است');
    }

    const lang = LANG_FA[(target ?? 'fa').toLowerCase()] ?? target ?? 'فارسی';
    return this.run('translate', {
      feature: 'translate',
      system: SYSTEM_PROMPTS.translate,
      user: msg.body,
      target: lang,
      maxTokens: 900,
      conversationId: msg.conversationId,
      userId: meId,
    }).then((r) => ({ ...r, target: (target ?? 'fa').toLowerCase() }));
  }

  /** اصلاح نگارشی یک پیش‌نویس (بدون نیاز به گفتگو — رضایت کلی لازم است) */
  async fix(meId: string, text: string): Promise<AiTextResult> {
    this.ensureEnabled();

    const user = await this.prisma.user.findUnique({
      where: { id: meId },
      select: { aiConsent: true },
    });
    if (!user?.aiConsent) {
      throw httpError(
        403,
        'AI_CONSENT_REQUIRED',
        'برای استفاده از هوش مصنوعی ابتدا در تنظیمات رضایت خود را فعال کنید',
      );
    }
    this.limiter.check(meId, this.config.get('aiRatePerMin') ?? 20);
    if (text.length > MAX_INPUT_CHARS) {
      throw httpError(400, 'AI_TEXT_TOO_LONG', 'متن برای اصلاح بیش از حد بلند است');
    }
    return this.run('fix', {
      feature: 'fix',
      system: SYSTEM_PROMPTS.fix,
      user: text,
      maxTokens: 900,
      userId: meId,
    });
  }

  /** گفتگو با دستیار دل (v1.4) — متن کاربر + تاریخچهٔ محلی؛ بدون خواندن DB گفتگوها */
  async chat(meId: string, text: string, history: string[] = []): Promise<AiTextResult> {
    this.ensureEnabled();
    const user = await this.prisma.user.findUnique({
      where: { id: meId },
      select: { aiConsent: true },
    });
    if (!user?.aiConsent) {
      throw httpError(
        403,
        'AI_CONSENT_REQUIRED',
        'برای گفتگو با دستیار ابتدا رضایت هوش مصنوعی را فعال کنید',
      );
    }
    this.limiter.check(meId, this.config.get('aiRatePerMin') ?? 20);
    const clean = text.trim();
    if (!clean || clean.length > MAX_INPUT_CHARS) {
      throw httpError(400, 'AI_TEXT_TOO_LONG', 'متن بیش از حد بلند است');
    }
    const context = history
      .slice(-20)
      .map((h) => h.slice(0, 1000))
      .join('\n')
      .slice(0, MAX_INPUT_CHARS);
    return this.run('chat', {
      feature: 'chat',
      system: SYSTEM_PROMPTS.chat,
      user: context ? `${context}\nکاربر: ${clean}` : clean,
      maxTokens: 1200,
      userId: meId,
    });
  }

  /** پیشنهاد پاسخ بر اساس آخرین پیام‌های قابل‌خواندن گفتگو */
  async suggest(meId: string, conversationId: string, count = 3): Promise<AiTextResult> {
    this.ensureEnabled();
    await this.requireConsentAndMembership(meId, conversationId);
    this.limiter.check(meId, this.config.get('aiRatePerMin') ?? 20);

    const msgs = await this.readableMessages(conversationId, SUGGEST_WINDOW, meId);
    if (!msgs.length) {
      throw httpError(
        422,
        'AI_NOTHING_TO_READ',
        'پیام قابل‌خواندنی برای پیشنهاد پاسخ نیست (پیام‌های رمز سرتاسری از هوش مصنوعی حذف می‌شوند)',
      );
    }
    const transcript = this.transcript(msgs);
    const res = await this.run('suggest', {
      feature: 'suggest',
      system: SYSTEM_PROMPTS.suggest,
      user: `رونوشت گفتگو (قدیمی به جدید):\n${transcript}\n\n${count} پاسخ پیشنهادی بنویس.`,
      maxTokens: 350,
      conversationId,
      userId: meId,
    });
    // فقط count خط اول — مدل‌ها گاهی بیشتر می‌دهند
    const lines = res.text.split('\n').filter((l) => l.trim());
    return { ...res, text: lines.slice(0, count).join('\n') };
  }

  /** خلاصهٔ گفتگو — کل پیام‌ها یا فقط خوانده‌نشده‌های من */
  async summarize(
    meId: string,
    conversationId: string,
    limit = 20,
    unreadOnly = false,
  ): Promise<AiTextResult> {
    this.ensureEnabled();
    const me = await this.requireConsentAndMembership(meId, conversationId);
    this.limiter.check(meId, this.config.get('aiRatePerMin') ?? 20);

    let msgs;
    if (unreadOnly) {
      msgs = await this.prisma.message.findMany({
        where: {
          conversationId,
          senderId: { not: meId },
          serverSeq: { gt: me.lastReadSeq },
          isE2ee: false,
          deletedAt: null,
        },
        orderBy: { serverSeq: 'desc' },
        take: Math.min(limit, 50),
        select: { body: true, senderId: true },
      });
    } else {
      msgs = await this.readableMessages(conversationId, Math.min(limit, 50), meId);
    }
    if (!msgs.length) {
      throw httpError(
        422,
        'AI_NOTHING_TO_READ',
        unreadOnly
          ? 'پیام خوانده‌نشدهٔ قابل‌خواندی نیست'
          : 'پیام قابل‌خواندنی برای خلاصه نیست (پیام‌های رمز سرتاسری از هوش مصنوعی حذف می‌شوند)',
      );
    }
    const transcript = this.transcript(msgs);
    return this.run('summarize', {
      feature: 'summarize',
      system: SYSTEM_PROMPTS.summarize,
      user: `رونوشت گفتگو (قدیمی به جدید):\n${transcript}`,
      maxTokens: 700,
      conversationId,
      userId: meId,
    });
  }

  /** گزارش مصرف من — فقط متادیتا */
  async usage(meId: string, limit = 50, feature?: AiFeatureName): Promise<AiUsageReport> {
    const where = { userId: meId, ...(feature ? { feature } : {}) };
    const [items, agg] = await Promise.all([
      this.prisma.aiUsage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(limit, 200),
        select: {
          id: true,
          feature: true,
          provider: true,
          ok: true,
          charsIn: true,
          charsOut: true,
          promptTokens: true,
          completionTokens: true,
          latencyMs: true,
          conversationId: true,
          createdAt: true,
        },
      }),
      this.prisma.aiUsage.aggregate({
        where: { userId: meId },
        _count: { _all: true },
        _sum: { charsIn: true, charsOut: true },
      }),
    ]);
    return {
      items: items.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
      total: agg._count._all,
      charsIn: agg._sum.charsIn ?? 0,
      charsOut: agg._sum.charsOut ?? 0,
    };
  }

  // ————— ابزار داخلی —————

  private ensureEnabled(): void {
    if (!this.provider) {
      throw httpError(503, 'AI_DISABLED', 'قابلیت هوش مصنوعی روی این سرور فعال نیست');
    }
  }

  /** پیام‌های قابل‌خواندن گفتگو — بدون E2EE و حذف‌شده‌ها؛ قدیمی به جدید */
  private async readableMessages(conversationId: string, take: number, _meId: string) {
    const rows = await this.prisma.message.findMany({
      where: { conversationId, isE2ee: false, deletedAt: null },
      orderBy: { serverSeq: 'desc' },
      take,
      select: { body: true, senderId: true },
    });
    void _meId;
    return rows.reverse();
  }

  /** رونوشت با نام نمایشی فرستنده — محتوای حساس فقط همین‌جا ساخته می‌شود */
  private transcript(msgs: Array<{ body: string; senderId: string }>): string {
    return msgs
      .map((m) => `${m.senderId.slice(0, 8)}: ${m.body.slice(0, 2000)}`)
      .join('\n')
      .slice(0, MAX_INPUT_CHARS);
  }

  /** هستهٔ اجرا: فراخوانی provider + ثبت مصرف (موفق یا ناموفق) */
  private async run(
    feature: AiFeatureName,
    input: Parameters<AiProvider['complete']>[0] & { conversationId?: string; userId: string },
  ): Promise<AiTextResult> {
    const provider = this.provider!;
    const t0 = Date.now();
    let ok = false;
    let promptTokens: number | undefined;
    let completionTokens: number | undefined;
    let text = '';
    try {
      const r = await provider.complete(input);
      ok = true;
      text = r.text;
      promptTokens = r.promptTokens;
      completionTokens = r.completionTokens;
      return { feature, text, provider: provider.name };
    } catch (e) {
      const msg =
        e instanceof AiProviderError
          ? e.message
          : String((e as Error)?.message ?? e);
      this.logger.warn(`AI provider (${provider.name}) failed for ${feature}: ${msg}`);
      // مسیر fallback خطا — پیام واضح؛ اپ عادی ادامه می‌یابد
      throw httpError(
        502,
        'AI_PROVIDER_ERROR',
        'سرویس هوش مصنوعی موقتاً در دسترس نیست؛ دوباره تلاش کنید',
      );
    } finally {
      const latencyMs = Date.now() - t0;
      // ثبت مصرف — حتی در خطا (برای کنترل هزینه)؛ هرگز محتوا ذخیره نمی‌شود
      this.prisma.aiUsage
        .create({
          data: {
            userId: input.userId,
            conversationId: input.conversationId ?? null,
            feature,
            provider: provider.name,
            ok,
            charsIn: input.user.length,
            charsOut: text.length,
            promptTokens: promptTokens ?? null,
            completionTokens: completionTokens ?? null,
            latencyMs,
          },
        })
        .catch((e) => this.logger.warn(`aiUsage write failed: ${String(e)}`));
    }
  }
}
