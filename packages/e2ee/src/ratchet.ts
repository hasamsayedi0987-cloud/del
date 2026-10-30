/**
 * Del E2EE — Double Ratchet (طبق مشخصه Signal)
 * - زنجیره متقارن برای هر جهت + زنجیره DH برای forward secrecy
 * - کلیدهای پیام‌های ردشده (out-of-order) تا سقف مشخص نگه داشته می‌شوند
 * - حالت کاملاً سریال‌پذیر (ذخیره در SecureStore / localStorage)
 */
import { toB64, fromB64, concatBytes } from './b64';
import {
  dh,
  dhKeyPair,
  kdf,
  hmacSha256,
  aeadSeal,
  aeadOpen,
  randomBytes,
} from './crypto';

export const MAX_SKIP = 128;
const INFO_RK = 'Del-Ratchet-RK-v1';

export interface RatchetHeader {
  /** کلید عمومی ratchet فرستنده (b64) */
  dh: string;
  pn: number;
  n: number;
}

export interface RatchetMessage extends RatchetHeader {
  /** nonce||ct (b64) */
  ct: string;
}

interface RatchetState {
  rk: string; // b64
  dhsPub: string;
  dhsPriv: string;
  dhr: string | null;
  cks: string | null;
  ckr: string | null;
  ns: number;
  nr: number;
  pn: number;
  /** کلیدهای ردشده — کلید: `${dhB64}|${n}` */
  skipped: Record<string, { mk: string }>;
}

/** KDF_RK — زنجیره ریشه با خروجی DH جلو می‌رود */
function kdfRk(rk: Uint8Array, dhOut: Uint8Array): { rk: Uint8Array; ck: Uint8Array } {
  const okm = kdf(dhOut, rk, INFO_RK, 64);
  return { rk: okm.subarray(0, 32), ck: okm.subarray(32, 64) };
}

/** KDF_CK — کلید پیام بعدی + چرخش زنجیره */
function kdfCk(ck: Uint8Array): { ck: Uint8Array; mk: Uint8Array } {
  const mk = hmacSha256(ck, new Uint8Array([0x01]));
  const next = hmacSha256(ck, new Uint8Array([0x02]));
  return { ck: next, mk };
}

/** AD نهایی = ad کاربر || هدر پیام (پیوند پیام به متادیتا) */
function messageAd(ad: Uint8Array, header: RatchetHeader): Uint8Array {
  const headerBytes = new TextEncoder().encode(
    JSON.stringify([header.dh, header.pn, header.n]),
  );
  return concatBytes(ad, headerBytes);
}

export class DoubleRatchet {
  private constructor(private state: RatchetState) {}

  /** آغازگر — زنجیره ارسال با DH جدید روی کلید ratchet گیرنده بسته می‌شود */
  static initInitiator(
    sharedKey: Uint8Array,
    peerRatchetPub: Uint8Array,
    rng: typeof randomBytes,
  ): DoubleRatchet {
    const dhs = dhKeyPair(rng);
    const { rk, ck } = kdfRk(sharedKey, dh(dhs.priv, peerRatchetPub));
    return new DoubleRatchet({
      rk: toB64(rk),
      dhsPub: toB64(dhs.pub),
      dhsPriv: toB64(dhs.priv),
      dhr: toB64(peerRatchetPub),
      cks: toB64(ck),
      ckr: null,
      ns: 0,
      nr: 0,
      pn: 0,
      skipped: {},
    });
  }

  /** پاسخ‌گو — زنجیره دریافت از SPK خودش شروع می‌شود (ارسال آغازاً null) */
  static initResponder(
    sharedKey: Uint8Array,
    spkPair: { pub: Uint8Array; priv: Uint8Array },
  ): DoubleRatchet {
    return new DoubleRatchet({
      rk: toB64(sharedKey),
      dhsPub: toB64(spkPair.pub),
      dhsPriv: toB64(spkPair.priv),
      dhr: null,
      cks: null,
      ckr: null,
      ns: 0,
      nr: 0,
      pn: 0,
      skipped: {},
    });
  }

  encrypt(plaintext: Uint8Array, ad: Uint8Array): RatchetMessage {
    const s = this.state;
    if (!s.cks) throw new Error('E2EE_NO_SEND_CHAIN');
    const { ck, mk } = kdfCk(fromB64(s.cks));
    s.cks = toB64(ck);
    const header: RatchetHeader = { dh: s.dhsPub, pn: s.pn, n: s.ns };
    const ct = aeadSeal(
      mk,
      plaintext,
      messageAd(ad, header),
      // nonce از خود mk مشتق می‌شود (mk برای هر پیام یگانه است) — ۱۲ بایت
      kdf(mk, new Uint8Array(0), 'Del-Nonce-v1', 12),
    );
    s.ns += 1;
    return { ...header, ct: toB64(ct) };
  }

  decrypt(msg: RatchetMessage, ad: Uint8Array): Uint8Array {
    // ۱) کلیدهای ردشده (قبل از هر رatchet — هدر ممکن است از زنجیره قدیمی باشد)
    const skipKey = `${msg.dh}|${msg.n}`;
    const skipped = this.state.skipped[skipKey];
    if (skipped) {
      const mk = fromB64(skipped.mk);
      delete this.state.skipped[skipKey];
      return aeadOpen(mk, fromB64(msg.ct), messageAd(ad, msg));
    }
    // ۲) DH ratchet در صورت تغییر کلید طرف مقابل
    if (this.state.dhr !== msg.dh) this.dhRatchetStep(msg.dh);
    // ۳) زنجیره دریافت فعلی
    if (!this.state.ckr || this.state.dhr !== msg.dh) {
      throw new Error('E2EE_DECRYPT_FAILED: زنجیره دریافت همسان نیست');
    }
    if (msg.n < this.state.nr) throw new Error('E2EE_REPLAY: پیام تکراری است');
    if (msg.n - this.state.nr > MAX_SKIP) throw new Error('E2EE_TOO_MANY_SKIPPED');
    while (this.state.nr < msg.n) {
      const { ck, mk } = kdfCk(fromB64(this.state.ckr!));
      this.state.skipped[`${this.state.dhr}|${this.state.nr}`] = { mk: toB64(mk) };
      this.state.ckr = toB64(ck);
      this.state.nr += 1;
    }
    const { ck, mk } = kdfCk(fromB64(this.state.ckr!));
    this.state.ckr = toB64(ck);
    this.state.nr += 1;
    return aeadOpen(mk, fromB64(msg.ct), messageAd(ad, msg));
  }

  /** DH ratchet — کلید عمومی جدید طرف مقابل رسید؛ زنجیره‌ها بازسازی می‌شوند */
  private dhRatchetStep(peerDh: string): void {
    const s = this.state;
    s.pn = s.ns;
    s.ns = 0;
    s.nr = 0;
    s.dhr = peerDh;
    const first = kdfRk(fromB64(s.rk), dh(fromB64(s.dhsPriv), fromB64(peerDh)));
    s.rk = toB64(first.rk);
    s.ckr = toB64(first.ck);
    // جفت‌کلید ارسال تازه
    const dhs = dhKeyPair(randomBytes);
    s.dhsPub = toB64(dhs.pub);
    s.dhsPriv = toB64(dhs.priv);
    const second = kdfRk(fromB64(s.rk), dh(dhs.priv, fromB64(peerDh)));
    s.rk = toB64(second.rk);
    s.cks = toB64(second.ck);
  }

  serialize(): string {
    return JSON.stringify(this.state);
  }

  static load(json: string): DoubleRatchet {
    const parsed = JSON.parse(json) as RatchetState;
    if (!parsed || typeof parsed.rk !== 'string') throw new Error('E2EE_BAD_SESSION_STATE');
    if (!parsed.skipped) parsed.skipped = {};
    return new DoubleRatchet(parsed);
  }
}
