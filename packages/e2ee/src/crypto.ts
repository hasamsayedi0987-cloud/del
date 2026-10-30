/**
 * Del E2EE — نیازمندی‌های رمزنگاری
 * X25519 (توافق کلید) · Ed25519 (امضا) · HKDF-SHA256 · HMAC-SHA256 · ChaCha20-Poly1305
 * منبع تصادفی (RNG) قابل تزریق است — در React Native از expo-crypto داده می‌شود.
 */
import { x25519, ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { hmac } from '@noble/hashes/hmac';
import { hkdf } from '@noble/hashes/hkdf';
import { chacha20poly1305 } from '@noble/ciphers/chacha';

export type Rng = (len: number) => Uint8Array;

let RNG: Rng = (len) => {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === 'function') {
    const b = new Uint8Array(len);
    c.getRandomValues(b);
    return b;
  }
  throw new Error(
    'E2EE_RNG_MISSING: منبع تصادفی در دسترس نیست — setRng() را در ابتدای اپ صدا بزنید',
  );
};

/** تعویض منبع تصادفی (موبایل: expo-crypto) */
export function setRng(r: Rng): void {
  RNG = r;
}

export function randomBytes(len: number): Uint8Array {
  return RNG(len);
}

// ————— Diffie–Hellman (X25519) —————

export function dhKeyPair(rng: Rng): { pub: Uint8Array; priv: Uint8Array } {
  const priv = rng(32);
  return { priv, pub: x25519.getPublicKey(priv) };
}

export function dh(priv: Uint8Array, pub: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(priv, pub);
}

// ————— امضا (Ed25519) —————

export function edKeyPair(rng: Rng): { pub: Uint8Array; priv: Uint8Array } {
  const priv = rng(32);
  return { priv, pub: ed25519.getPublicKey(priv) };
}

export function sign(priv: Uint8Array, msg: Uint8Array): Uint8Array {
  return ed25519.sign(msg, priv);
}

export function verify(sig: Uint8Array, msg: Uint8Array, pub: Uint8Array): boolean {
  try {
    return ed25519.verify(sig, msg, pub);
  } catch {
    return false;
  }
}

// ————— استخراج کلید —————

/** HKDF-SHA256 با خروجی دلخواه */
export function kdf(ikm: Uint8Array, salt: Uint8Array, info: string, length: number): Uint8Array {
  return hkdf(sha256, ikm, salt, new TextEncoder().encode(info), length);
}

export function hmacSha256(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha256, key, data);
}

export function sha256Bytes(data: Uint8Array): Uint8Array {
  return sha256(data);
}

// ————— AEAD (ChaCha20-Poly1305) —————

/** nonce ۱۲ بایتی + ct+tag — خروجی: nonce||ct (tag الحاق‌شده توسط کتابخانه) */
export function aeadSeal(
  key: Uint8Array,
  plaintext: Uint8Array,
  ad: Uint8Array,
  nonce: Uint8Array,
): Uint8Array {
  const box = chacha20poly1305(key, nonce, ad);
  const ct = box.encrypt(plaintext);
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce, 0);
  out.set(ct, nonce.length);
  return out;
}

export function aeadOpen(
  key: Uint8Array,
  sealed: Uint8Array,
  ad: Uint8Array,
): Uint8Array {
  if (sealed.length < 12 + 16) throw new Error('E2EE_CT_TOO_SHORT');
  const nonce = sealed.subarray(0, 12);
  const ct = sealed.subarray(12);
  const box = chacha20poly1305(key, nonce, ad);
  return box.decrypt(ct);
}

/** nonce تصادفی ۱۲ بایتی */
export function randomNonce(rng: Rng): Uint8Array {
  return rng(12);
}
