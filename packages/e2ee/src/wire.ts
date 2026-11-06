/**
 * Del E2EE — قراردادهای سیمی (wire) مشترک بین کلاینت‌ها
 * همه کلیدها base64 هستند تا JSON-پذیر باشند.
 */

/** جفت‌کلید محلی (b64) */
export interface KeyPairB64 {
  pub: string;
  priv: string;
}

/** هویت کامل محلی — خصوصی‌ها هرگز از دستگاه خارج نمی‌شوند */
export interface LocalIdentity {
  /** کلید امضای هویت (Ed25519) */
  ikEd: KeyPairB64;
  /** کلید DH هویت (X25519) */
  ikX: KeyPairB64;
  /** کلید پیش‌امضاشده (Signed PreKey) — با ikEd امضا شده */
  spk: KeyPairB64 & { keyId: number; sig: string };
  createdAt: string;
}

/** یک کلید یک‌بارمصرف محلی (خصوصی در دستگاه + عمومی برای سرور) */
export interface LocalOtk {
  keyId: number;
  pub: string;
  priv: string;
}

/** بسته عمومی یک دستگاه — از سرور گرفته می‌شود */
export interface PublicBundle {
  deviceId: string;
  ikEd: string;
  ikX: string;
  spkKeyId: number;
  spk: string;
  spkSig: string;
  /** اگر ته کشیده باشد null — X3DH بدون DH4 ادامه می‌یابد */
  otk: { keyId: number; key: string } | null;
}

/** بار پیش‌کلیدی — با «اولین» پیام هر session به گیرنده می‌رسد (X3DH) */
export interface PrekeyPayload {
  /** عمومیِ هویت فرستنده */
  ikEd: string;
  ikX: string;
  /** کلید موقت فرستنده */
  ek: string;
  /** کدام SPK گیرنده استفاده شد */
  spkKeyId: number;
  /** کدام OTK گیرنده استفاده شد (null = بدون OTK) */
  otkKeyId: number | null;
}

/** پیام Double Ratchet */
export interface RatchetWire {
  /** کلید ratchet فرستنده (b64) */
  dh: string;
  /** طول زنجیره قبلی */
  pn: number;
  /** شماره در زنجیره */
  n: number;
  /** nonce||ct (b64) */
  ct: string;
}

/** ورودی پاکت رمز برای یک دستگاه گیرنده */
export interface EnvelopeEntry {
  /** deviceId گیرنده */
  deviceId: string;
  /** deviceId فرستنده (برای AD) */
  from: string;
  /** فقط در پیام نخستِ هر session */
  pm?: PrekeyPayload;
  /** RatchetWire سریال‌شده (b64 از JSON) */
  ct: string;
}

/** بدنه پیام E2EE — همان فیلد body پیام با isE2ee=true */
export interface E2eeEnvelope {
  v: 1;
  e2ee: true;
  /** ورودی به ازای هر دستگاه گیرنده (طرف مقابل + دستگاه‌های دیگر خودم) */
  to: EnvelopeEntry[];
}

/** شکل envelope یک پیام دیگران که رمزگشایی نشد */
export function isE2eeEnvelope(body: string): E2eeEnvelope | null {
  if (!body || !body.startsWith('{"v":1')) return null;
  try {
    const parsed = JSON.parse(body) as E2eeEnvelope;
    if (parsed && parsed.v === 1 && parsed.e2ee === true && Array.isArray(parsed.to)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
