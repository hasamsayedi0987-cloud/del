/**
 * گام ۷ — ارسال‌کننده‌های push (Provider abstraction)
 *
 *  ۱) webhook — اگر PUSH_WEBHOOK_URL تنظیم شده باشد: کل payload به آن URL
 *     POST می‌شود (تست خودکار / یکپارچه‌سازی با اینفراستراکچر اختصاصی).
 *  ۲) expo — توکن‌های شکل ExpoPushToken[…] به سرویس میزبانی‌شده Expo Push
 *     ارسال می‌شوند (APNs/FCM زیر آن است؛ بدون نیاز به کلید سروری).
 *  ۳) console — حالت توسعه بدون هیچ پیکربندی: فقط لاگ.
 *
 * خطای provider هرگز جریان پیام را نمی‌شکند — همه‌جا catch می‌شود.
 */
import type { DelPushPayload } from '@del/shared-types';

export interface PushDispatchResult {
  sent: number;
  /** توکن‌هایی که دیگر معتبر نیستند (DeviceNotRegistered) — برای پاک‌سازی DB */
  invalidTokens: string[];
}

type PushContent = Omit<DelPushPayload, 'userId' | 'tokens'>;

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const EXPO_CHUNK = 100;

/** ارسال به سرویس Expo Push — فقط توکن‌های Expo؛ خروجی: توکن‌های نامعتبر */
export async function sendViaExpo(
  tokens: string[],
  content: PushContent,
): Promise<PushDispatchResult> {
  const invalidTokens: string[] = [];
  let sent = 0;
  for (let i = 0; i < tokens.length; i += EXPO_CHUNK) {
    const chunk = tokens.slice(i, i + EXPO_CHUNK);
    const messages = chunk.map((to) => ({
      to,
      title: content.title,
      body: content.body,
      data: content.data,
      sound: 'default' as const,
      channelId: content.kind === 'call' ? 'calls' : 'messages',
    }));
    try {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(messages),
      });
      if (!res.ok) continue; // خطای سرویس — بی‌صدا رد شو (ارسال بعدی تلاش می‌شود)
      const json = (await res.json().catch(() => null)) as
        | { data?: Array<{ status?: string; details?: { error?: string } }> }
        | null;
      const tickets = json?.data ?? [];
      tickets.forEach((t, idx) => {
        if (t?.status === 'ok') sent += 1;
        else if (t?.details?.error === 'DeviceNotRegistered') {
          const bad = chunk[idx];
          if (bad) invalidTokens.push(bad);
        }
      });
    } catch {
      // شبکه — تلاش بعدی
    }
  }
  return { sent, invalidTokens };
}

/** ارسال به webhook اختصاصی — برای تست خودکار و یکپارچه‌سازی */
export async function sendViaWebhook(
  url: string,
  payload: DelPushPayload,
): Promise<PushDispatchResult> {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { sent: res.ok ? payload.tokens.length : 0, invalidTokens: [] };
  } catch {
    return { sent: 0, invalidTokens: [] };
  }
}
