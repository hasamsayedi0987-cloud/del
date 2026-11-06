/**
 * Del — ذخیره‌سازی موضعی E2EE روی SecureStore (گام ۸)
 * خصوصی‌ها فقط اینجا زندگی می‌کنند؛ سرور فقط عمومی‌ها و blob پشتیبان را می‌بیند.
 */
import * as SecureStore from 'expo-secure-store';
import type { LocalIdentity, SessionState } from '@del/e2ee';

/** کلیدهای خصوصی یک‌بارمصرف + شمارنده ساخت */
export interface OtkStore {
  /** keyId → خصوصی (b64) */
  privs: Record<string, string>;
  nextKeyId: number;
}

const K_IDENTITY = 'del.e2ee.identity';
const K_OTKS = 'del.e2ee.otks';
const K_RECOVERY = 'del.e2ee.recovery';
const K_SESSIONS = (peerUserId: string) => `del.e2ee.s.${peerUserId}`;

async function getJson<T>(key: string): Promise<T | null> {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function setJson(key: string, value: unknown): Promise<void> {
  await SecureStore.setItemAsync(key, JSON.stringify(value));
}

export const e2eeStore = {
  async getIdentity(): Promise<LocalIdentity | null> {
    return getJson<LocalIdentity>(K_IDENTITY);
  },
  async setIdentity(identity: LocalIdentity): Promise<void> {
    await setJson(K_IDENTITY, identity);
  },
  async clearIdentity(): Promise<void> {
    await SecureStore.deleteItemAsync(K_IDENTITY);
  },

  async getOtks(): Promise<OtkStore> {
    return (await getJson<OtkStore>(K_OTKS)) ?? { privs: {}, nextKeyId: 1 };
  },
  async setOtks(store: OtkStore): Promise<void> {
    await setJson(K_OTKS, store);
  },
  /** حذف خصوصیِ OTK مصرف‌شده (پس از accept) */
  async consumeOtkPriv(keyId: number): Promise<string | null> {
    const store = await e2eeStore.getOtks();
    const priv = store.privs[String(keyId)] ?? null;
    if (priv) {
      delete store.privs[String(keyId)];
      await e2eeStore.setOtks(store);
    }
    return priv;
  },

  /** کلید بازیابی به‌صورت محلی نگه داشته می‌شود تا در پروفایل قابل نمایش باشد */
  async getRecoveryKey(): Promise<string | null> {
    return SecureStore.getItemAsync(K_RECOVERY);
  },
  async setRecoveryKey(key: string): Promise<void> {
    await SecureStore.setItemAsync(K_RECOVERY, key);
  },

  /** sessionهای یک کاربر مقابل: deviceId → state */
  async getSessions(peerUserId: string): Promise<Record<string, SessionState>> {
    return (await getJson<Record<string, SessionState>>(K_SESSIONS(peerUserId))) ?? {};
  },
  async saveSession(peerUserId: string, state: SessionState): Promise<void> {
    const all = await e2eeStore.getSessions(peerUserId);
    all[state.peerDeviceId] = state;
    await setJson(K_SESSIONS(peerUserId), all);
  },

  /** حذف کامل مواد رمزنگاری محلی (خروج/ریست) */
  async clearAll(): Promise<void> {
    await e2eeStore.clearIdentity();
    await SecureStore.deleteItemAsync(K_OTKS);
    await SecureStore.deleteItemAsync(K_RECOVERY);
  },
};
