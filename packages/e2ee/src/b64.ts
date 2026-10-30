/**
 * Del E2EE — انکودینگ (base64/UTF-8) پیاده‌سازی دستی
 * چون در همه محیط‌ها (Node / Hermes / Chromium) بدون وابستگی کار می‌کند
 * (btoa/atob در Hermes قدیمی وجود ندارد و Buffer مخصوص Node است).
 */

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toB64(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out += B64_ALPHABET[(n >> 18) & 63]! + B64_ALPHABET[(n >> 12) & 63]! + B64_ALPHABET[(n >> 6) & 63]! + B64_ALPHABET[n & 63]!;
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out += B64_ALPHABET[(n >> 18) & 63]! + B64_ALPHABET[(n >> 12) & 63]! + '==';
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out += B64_ALPHABET[(n >> 18) & 63]! + B64_ALPHABET[(n >> 12) & 63]! + B64_ALPHABET[(n >> 6) & 63]! + '=';
  }
  return out;
}

const B64_LOOKUP: Record<string, number> = (() => {
  const map: Record<string, number> = {};
  for (let i = 0; i < B64_ALPHABET.length; i++) map[B64_ALPHABET[i]!] = i;
  return map;
})();

export function fromB64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let p = 0;
  let i = 0;
  for (; i + 3 < len; i += 4) {
    const n =
      ((B64_LOOKUP[clean[i]!] ?? 0) << 18) |
      ((B64_LOOKUP[clean[i + 1]!] ?? 0) << 12) |
      ((B64_LOOKUP[clean[i + 2]!] ?? 0) << 6) |
      (B64_LOOKUP[clean[i + 3]!] ?? 0);
    out[p++] = (n >> 16) & 0xff;
    out[p++] = (n >> 8) & 0xff;
    out[p++] = n & 0xff;
  }
  const rest = len - i;
  if (rest === 2) {
    const n = ((B64_LOOKUP[clean[i]!] ?? 0) << 18) | ((B64_LOOKUP[clean[i + 1]!] ?? 0) << 12);
    out[p++] = (n >> 16) & 0xff;
  } else if (rest === 3) {
    const n =
      ((B64_LOOKUP[clean[i]!] ?? 0) << 18) |
      ((B64_LOOKUP[clean[i + 1]!] ?? 0) << 12) |
      ((B64_LOOKUP[clean[i + 2]!] ?? 0) << 6);
    out[p++] = (n >> 16) & 0xff;
    out[p++] = (n >> 8) & 0xff;
  }
  return out.subarray(0, p);
}

/** UTF-8 → بایت‌ها (TextEncoder در همه محیط‌های هدف موجود است) */
export function utf8ToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function bytesToUtf8(b: Uint8Array): string {
  return new TextDecoder().decode(b);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export function bytesToHex(b: Uint8Array): string {
  let out = '';
  for (const x of b) out += x.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(h: string): Uint8Array {
  const clean = h.replace(/[^0-9a-fA-F]/g, '');
  const out = new Uint8Array(Math.floor(clean.length / 2));
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** مقایسه زمان‌ثابت برای بایت‌ها (جلوگیری از timing attack) */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
