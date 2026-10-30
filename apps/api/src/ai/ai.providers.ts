/**
 * گام ۹ — فراهم‌کننده‌های سرویس هوش مصنوعی (Provider abstraction)
 *
 *  ۱) mock    — بدون هیچ پیکربندی؛ خروجی قطعی فارسی برای توسعه/تست.
 *               هیچ درخواستی به بیرون نمی‌رود (حریم خصوصی کامل در dev).
 *  ۲) openai  — هر endpoint سازگار با OpenAI (OpenAI، OpenRouter، vLLM محلی…)
 *               با AI_BASE_URL + AI_API_KEY + AI_MODEL. کلید هرگز به کلاینت نمی‌رود.
 *  ۳) webhook — POST JSON به AI_WEBHOOK_URL؛ پاسخ {"text": "…"}
 *               (یکپارچه‌سازی سرویس اختصاصی/تست خودکار).
 *
 * خطای provider → AiProviderError؛ سرویس آن را به 502 AI_PROVIDER_ERROR ترجمه می‌کند
 * و اپ عادی بدون وقفه ادامه می‌یابد.
 */
import type { AiFeature } from '@del/shared-types';

export class AiProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AiCompleteInput {
  feature: AiFeature;
  /** پرامپت سیستمی فارسی */
  system: string;
  /** محتوای کاربر (متن/رونوشت گفتگو) */
  user: string;
  /** زبان مقصد برای translate */
  target?: string;
  maxTokens?: number;
}

export interface AiCompleteResult {
  text: string;
  promptTokens?: number;
  completionTokens?: number;
}

export interface AiProvider {
  readonly name: string;
  complete(input: AiCompleteInput): Promise<AiCompleteResult>;
}

const PROVIDER_TIMEOUT_MS = 25_000;

// ————— ۱) mock — قطعی و آفلاین —————

export class MockAiProvider implements AiProvider {
  readonly name = 'mock';

  async complete(input: AiCompleteInput): Promise<AiCompleteResult> {
    const t = input.user.length;
    switch (input.feature) {
      case 'translate':
        return {
          text: `[ترجمهٔ آزمایشی mock → ${input.target ?? 'fa'}] ${input.user}`,
          completionTokens: Math.ceil(t / 4),
        };
      case 'fix':
        return {
          text: `[متن اصلاح‌شدهٔ mock] ${input.user.replace(/\s+/g, ' ').trim()}`,
          completionTokens: Math.ceil(t / 4),
        };
      case 'suggest':
        return {
          text: [
            'پیشنهاد ۱ (mock): ممنون، خیلی خوب بود!',
            'پیشنهاد ۲ (mock): باشه، بعداً بررسی می‌کنم.',
            'پیشنهاد ۳ (mock): حتماً، خبرم کن.',
          ].join('\n'),
          completionTokens: 24,
        };
      case 'summarize':
        return {
          text: `خلاصهٔ آزمایشی mock — ${input.user.split('\n').filter(Boolean).length} پیام بررسی شد؛ موضوع اصلی گفتگو در پیام اول مطرح شده و پاسخ‌ها در ادامه آمده‌اند.`,
          completionTokens: 40,
        };
      default:
        throw new AiProviderError(`unknown feature ${input.feature}`);
    }
  }
}

// ————— ۲) openai — سازگار با هر سرور OpenAI-like —————

export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly model: string,
  ) {}

  async complete(input: AiCompleteInput): Promise<AiCompleteResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.3,
          max_tokens: input.maxTokens ?? 700,
          messages: [
            { role: 'system', content: input.system },
            { role: 'user', content: input.user },
          ],
        }),
      });
      if (!res.ok) {
        throw new AiProviderError(`provider responded ${res.status}`);
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = json.choices?.[0]?.message?.content?.trim();
      if (!text) throw new AiProviderError('provider returned empty content');
      return {
        text,
        promptTokens: json.usage?.prompt_tokens,
        completionTokens: json.usage?.completion_tokens,
      };
    } catch (e) {
      if (e instanceof AiProviderError) throw e;
      throw new AiProviderError(`provider call failed: ${String((e as Error)?.message ?? e)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

// ————— ۳) webhook — سرویس اختصاصی / تست —————

export class WebhookAiProvider implements AiProvider {
  readonly name = 'webhook';

  constructor(private readonly url: string) {}

  async complete(input: AiCompleteInput): Promise<AiCompleteResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feature: input.feature,
          system: input.system,
          user: input.user,
          target: input.target ?? null,
          maxTokens: input.maxTokens ?? 700,
        }),
      });
      if (!res.ok) throw new AiProviderError(`webhook responded ${res.status}`);
      const json = (await res.json()) as { text?: string; usage?: { promptTokens?: number; completionTokens?: number } };
      if (typeof json?.text !== 'string' || !json.text) {
        throw new AiProviderError('webhook returned no text');
      }
      return {
        text: json.text,
        promptTokens: json.usage?.promptTokens,
        completionTokens: json.usage?.completionTokens,
      };
    } catch (e) {
      if (e instanceof AiProviderError) throw e;
      throw new AiProviderError(`webhook call failed: ${String((e as Error)?.message ?? e)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
