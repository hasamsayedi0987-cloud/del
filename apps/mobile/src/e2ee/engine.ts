/**
 * Del — موتور رمزنگاری سرتاسری چت خصوصی (گام ۸)
 * X3DH + Double Ratchet روی پکیج @del/e2ee — سرور هرگز plaintext نمی‌بیند.
 *
 * جریان ارسال (direct):
 *   bundle همه دستگاه‌های طرف مقابل + دستگاه‌های دیگر خودم ← سرور
 *   به ازای هر دستگاه: session (یا accept بار پیش‌کلیدی) → رمز → پاکت multi-device
 * جریان دریافت:
 *   ورودی پاکت با deviceId خودم → pm? → X3DH پاسخ‌گو → ratchet → متن
 */
import * as Crypto from 'expo-crypto';
import {
  DelSession,
  buildEnvelope,
  createBackup,
  fromB64,
  generateIdentity,
  generateRecoveryKey,
  identityFromPrivate,
  makeOtkBatch,
  isE2eeEnvelope,
  parseRecoveryKey,
  restoreBackup,
  setRng,
  type LocalIdentity,
  type PublicBundle,
  type E2eeEnvelope,
} from '@del/e2ee';
import { api } from '../api';
import { e2eeStore } from './store';

// ————— منبع تصادفی امن موبایل (expo-crypto) —————
const rng = (n: number): Uint8Array => {
  const b = new Uint8Array(n);
  Crypto.getRandomValues(b);
  return b;
};
setRng(rng);

const TOP_UP_THRESHOLD = 10;
const TOP_UP_BATCH = 40;

/** deviceId و userId خودم — پس از ورود مقداردهی می‌شود */
let myDeviceId: string | null = null;
let myUserId: string | null = null;
let identity: LocalIdentity | null = null;

export async function initE2ee(token: string, userId: string): Promise<void> {
  myUserId = userId;
  if (myDeviceId) return;
  try {
    const me = await api.authMe(token);
    myDeviceId = me.deviceId ?? null;
  } catch {
    myDeviceId = null;
  }
  identity = await e2eeStore.getIdentity();
}

export function e2eeReady(): boolean {
  return Boolean(identity && myDeviceId);
}

export function e2eeIdentityPublic(): { ikX: string; ikEd: string } | null {
  return identity ? { ikX: identity.ikX.pub, ikEd: identity.ikEd.pub } : null;
}

/** راه‌اندازی تازه — کلید بازیابی ساخته و یک‌بار برمی‌گردد (نمایش + پشتیبان روی سرور) */
export async function setupNewIdentity(token: string): Promise<string> {
  identity = generateIdentity(rng);
  await e2eeStore.setIdentity(identity);
  const recoveryKey = makeRecoveryKeyAndBackup(token, identity);
  return recoveryKey;
}

async function makeRecoveryKeyAndBackup(token: string, ident: LocalIdentity): Promise<string> {
  const recoveryKey = generateRecoveryKey();
  const backup = createBackup(ident, parseRecoveryKey(recoveryKey));
  await api.e2eeSaveBackup(token, backup.blob, backup.salt);
  await e2eeStore.setRecoveryKey(recoveryKey);
  return recoveryKey;
}

/** بازیابی هویت با کلید بازیابی — همان هویت قبلی برمی‌گردد (پیام‌های آینده باز می‌شوند) */
export async function restoreWithRecoveryKey(
  token: string,
  recoveryDisplay: string,
): Promise<void> {
  const backup = await api.e2eeGetBackup(token);
  const restored = restoreBackup(backup.blob, backup.salt, parseRecoveryKey(recoveryDisplay));
  identity = identityFromPrivate(restored.ikEdPriv, restored.ikXPriv, rng);
  await e2eeStore.setIdentity(identity);
  await e2eeStore.setRecoveryKey(recoveryDisplay.trim());
  // پشتیبان را با همان کلید تازه‌سازی می‌کنیم (SPK جدید امضا شده)
  const blob = createBackup(identity, parseRecoveryKey(recoveryDisplay));
  await api.e2eeSaveBackup(token, blob.blob, blob.salt);
}

/** آپلود هویت + دسته اولیه OTK برای این دستگاه */
export async function publishIdentity(token: string): Promise<void> {
  if (!identity) throw new Error('E2EE_NO_IDENTITY');
  const otks = await ensureOtkPrivs(TOP_UP_BATCH);
  await api.e2eeUploadIdentity(token, {
    ikEd: identity.ikEd.pub,
    ikX: identity.ikX.pub,
    spkKeyId: identity.spk.keyId,
    spk: identity.spk.pub,
    spkSig: identity.spk.sig,
    otks: otks.map((o) => ({ keyId: o.keyId, key: o.pub })),
  });
}

async function ensureOtkPrivs(count: number) {
  const store = await e2eeStore.getOtks();
  const batch = makeOtkBatch(rng, count, store.nextKeyId);
  for (const o of batch) store.privs[String(o.keyId)] = o.priv;
  store.nextKeyId += count;
  await e2eeStore.setOtks(store);
  return batch;
}

/** پر کردن مجدد OTK اگر کم شده (بعد از مصرف توسط طرف مقابل) */
export async function topUpOtksIfNeeded(token: string): Promise<void> {
  if (!identity || !myUserId || !myDeviceId) return;
  try {
    const devices = await api.e2eeDeviceKeys(token, myUserId);
    const mine = devices.find((d) => d.deviceId === myDeviceId);
    if (mine && mine.otkCount < TOP_UP_THRESHOLD) {
      const batch = await ensureOtkPrivs(TOP_UP_BATCH);
      await api.e2eeAddOtks(token, batch.map((o) => ({ keyId: o.keyId, key: o.pub })));
    }
  } catch {
    // بی‌اهمیت — دفعه بعد
  }
}

/** آیا طرف مقابل هویت E2EE دارد؟ */
export async function peerSupportsE2ee(token: string, peerUserId: string): Promise<boolean> {
  try {
    const devices = await api.e2eeDeviceKeys(token, peerUserId);
    return devices.length > 0;
  } catch {
    return false;
  }
}

// ————— رمز کردن —————

/**
 * پاکت multi-device برای یک پیام متنی direct.
 * گیرنده‌ها: همه دستگاه‌های طرف مقابل + دستگاه‌های دیگر خودم (همگام‌سازی)
 */
export async function encryptDirect(
  token: string,
  conversationId: string,
  peerUserId: string,
  plaintext: string,
): Promise<string> {
  if (!identity || !myDeviceId || !myUserId) throw new Error('E2EE_NOT_READY');

  const [peerBundles, myDevices] = await Promise.all([
    api.e2eeFetchBundles(token, peerUserId),
    api.e2eeDeviceKeys(token, myUserId),
  ]);

  const entries = [];
  for (const bundle of peerBundles.bundles) {
    entries.push(await encryptTo(token, conversationId, peerUserId, bundle, plaintext));
  }
  // دستگاه‌های دیگر خودم
  for (const dev of myDevices) {
    if (dev.deviceId === myDeviceId) continue;
    const bundle: PublicBundle = {
      deviceId: dev.deviceId,
      ikEd: dev.ikEd,
      ikX: dev.ikX,
      spkKeyId: dev.spkKeyId,
      spk: dev.spk,
      spkSig: dev.spkSig,
      otk: null,
    };
    entries.push(await encryptTo(token, conversationId, myUserId, bundle, plaintext));
  }
  if (!entries.length) throw new Error('E2EE_NO_RECIPIENTS');
  return JSON.stringify(buildEnvelope(entries, myDeviceId));
}

async function encryptTo(
  token: string,
  conversationId: string,
  peerUserId: string,
  bundle: PublicBundle,
  plaintext: string,
) {
  if (!identity) throw new Error('E2EE_NO_IDENTITY');
  const sessions = await e2eeStore.getSessions(peerUserId);
  const saved = sessions[bundle.deviceId];
  let session: DelSession;
  if (saved) {
    session = DelSession.load(saved);
  } else {
    session = DelSession.initiate(identity, peerUserId, bundle, rng);
  }
  const ad = DelSession.ad(conversationId, myDeviceId!, bundle.deviceId);
  const entry = session.encrypt(plaintext, ad);
  await e2eeStore.saveSession(peerUserId, session.serialize());
  return { deviceId: bundle.deviceId, from: myDeviceId!, ...(entry.pm ? { pm: entry.pm } : {}), ct: entry.ct };
}

// ————— رمزگشایی —————

/** نتیجه رمزگشایی یک پیام E2EE */
export interface DecryptResult {
  ok: boolean;
  text: string;
}

/**
 * باز کردن پاکت برای این دستگاه.
 * خروجی ok=false یعنی این دستگاه گیرنده نبوده یا session در دسترس نیست → placeholder.
 */
export async function decryptDirect(
  token: string,
  conversationId: string,
  senderId: string,
  body: string,
): Promise<DecryptResult> {
  if (!identity || !myDeviceId) return { ok: false, text: '' };
  const envelope: E2eeEnvelope | null = isE2eeEnvelope(body);
  if (!envelope) return { ok: false, text: '' };
  const entry = envelope.to.find((e) => e.deviceId === myDeviceId);
  if (!entry) return { ok: false, text: '' };

  const ad = DelSession.ad(conversationId, entry.from, myDeviceId);
  const sessions = await e2eeStore.getSessions(senderId);
  const saved = sessions[entry.from];

  // ۱) session موجود → همان
  if (saved) {
    try {
      const session = DelSession.load(saved);
      const text = session.decrypt({ ct: entry.ct }, ad);
      await e2eeStore.saveSession(senderId, session.serialize());
      return { ok: true, text };
    } catch {
      // ادامه — شاید pm جدید باشد
    }
  }

  // ۲) بار پیش‌کلیدی → X3DH سمت پاسخ‌گو
  if (entry.pm) {
    const otkPriv = entry.pm.otkKeyId != null
      ? await e2eeStore.consumeOtkPriv(entry.pm.otkKeyId)
      : null;
    // خصوصی SPKِ فعلی — اگر SPK چرخیده باشد این پیام برای نسخه قدیمی است
    const session = DelSession.accept(identity, senderId, entry.from, entry.pm, otkPriv ? base64ToBytes(otkPriv) : null);
    try {
      const text = session.decrypt({ ct: entry.ct }, ad);
      await e2eeStore.saveSession(senderId, session.serialize());
      void topUpOtksIfNeeded(token);
      return { ok: true, text };
    } catch {
      return { ok: false, text: '' };
    }
  }

  return { ok: false, text: '' };
}

function base64ToBytes(b64: string): Uint8Array {
  return fromB64(b64);
}

export function getMyDeviceId(): string | null {
  return myDeviceId;
}
