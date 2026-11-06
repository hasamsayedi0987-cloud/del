/**
 * Del E2EE — توافق کلید X3DH (Extended Triple Diffie–Hellman)
 * آغازگر (فرستنده) بسته گیرنده را می‌گیرد؛ پاسخ‌گو بار پیش‌کلیدی پیام اول را می‌بیند.
 * هر دو به SK یکسان می‌رسند — سرور هیچ‌کدام از ورودی‌های خصوصی را نمی‌بیند.
 */
import { fromB64, toB64, concatBytes } from './b64';
import { dh, dhKeyPair, kdf, type Rng } from './crypto';
import { verifyBundle } from './keys';
import type { LocalIdentity, PrekeyPayload, PublicBundle } from './wire';

const F = new Uint8Array(32).fill(0xff); // طبق مشخصه Signal
const SALT = new Uint8Array(32);

/**
 * سمت آغازگر — بسته گیرنده را به SK و بار پیش‌کلیدی تبدیل می‌کند.
 * امضای SPK حتماً راستی‌آزمایی می‌شود.
 */
export function initiatorAgreement(
  me: LocalIdentity,
  bundle: PublicBundle,
  rng: Rng,
): { sharedKey: Uint8Array; payload: PrekeyPayload } {
  verifyBundle(bundle);

  const spkPub = fromB64(bundle.spk);
  const ikBPub = fromB64(bundle.ikX);
  const eph = dhKeyPair(rng);

  const dh1 = dh(fromB64(me.ikX.priv), spkPub);
  const dh2 = dh(eph.priv, ikBPub);
  const dh3 = dh(eph.priv, spkPub);
  let ikm = concatBytes(F, dh1, dh2, dh3);
  if (bundle.otk) {
    const dh4 = dh(eph.priv, fromB64(bundle.otk.key));
    ikm = concatBytes(F, dh1, dh2, dh3, dh4);
  }
  const sharedKey = kdf(ikm, SALT, 'Del-X3DH-v1', 32);

  const payload: PrekeyPayload = {
    ikEd: me.ikEd.pub,
    ikX: me.ikX.pub,
    ek: toB64(eph.pub),
    spkKeyId: bundle.spkKeyId,
    otkKeyId: bundle.otk ? bundle.otk.keyId : null,
  };
  return { sharedKey, payload };
}

/**
 * سمت پاسخ‌گو — با بار پیش‌کلیدی و کلیدهای خصوصی خود، همان SK را می‌سازد.
 * otkPriv null یعنی پیام بدون OTK آمده (DH4 ندارد).
 */
export function responderAgreement(
  me: LocalIdentity,
  payload: PrekeyPayload,
  spkPriv: Uint8Array,
  otkPriv: Uint8Array | null,
): { sharedKey: Uint8Array } {
  const ikAPub = fromB64(payload.ikX);
  const ekPub = fromB64(payload.ek);

  const dh1 = dh(spkPriv, ikAPub);
  const dh2 = dh(fromB64(me.ikX.priv), ekPub);
  const dh3 = dh(spkPriv, ekPub);
  let ikm = concatBytes(F, dh1, dh2, dh3);
  if (otkPriv) {
    const dh4 = dh(otkPriv, ekPub);
    ikm = concatBytes(F, dh1, dh2, dh3, dh4);
  }
  return { sharedKey: kdf(ikm, SALT, 'Del-X3DH-v1', 32) };
}
