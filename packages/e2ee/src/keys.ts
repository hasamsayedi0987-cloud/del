/**
 * Del E2EE — هویت، کلیدهای پیش‌امضاشده، کلیدهای یک‌بارمصرف و کلید بازیابی
 */
import { ed25519, x25519 } from '@noble/curves/ed25519';
import {
  bytesToHex,
  hexToBytes,
  toB64,
  fromB64,
} from './b64';
import {
  dhKeyPair,
  edKeyPair,
  sign,
  randomBytes,
  kdf,
  aeadSeal,
  aeadOpen,
  type Rng,
} from './crypto';
import type { LocalIdentity, LocalOtk, PublicBundle } from './wire';

/** ساخت هویت تازه — هنگام نصب اولیه یا «ریست» (بدون کلید بازیابی) */
export function generateIdentity(rng: Rng): LocalIdentity {
  const ikEd = edKeyPair(rng);
  const ikX = dhKeyPair(rng);
  return {
    ikEd: { pub: toB64(ikEd.pub), priv: toB64(ikEd.priv) },
    ikX: { pub: toB64(ikX.pub), priv: toB64(ikX.priv) },
    spk: makeSignedPreKey(ikEd.priv, rng),
    createdAt: new Date().toISOString(),
  };
}

/** بازسازی هویت از کلیدهای خصوصی (بازیابی حساب) — SPK تازه امضا می‌شود */
export function identityFromPrivate(
  ikEdPriv: Uint8Array,
  ikXPriv: Uint8Array,
  rng: Rng,
): LocalIdentity {
  const ikEdPub = ed25519.getPublicKey(ikEdPriv);
  const ikXPub = x25519.getPublicKey(ikXPriv);
  return {
    ikEd: { pub: toB64(ikEdPub), priv: toB64(ikEdPriv) },
    ikX: { pub: toB64(ikXPub), priv: toB64(ikXPriv) },
    spk: makeSignedPreKey(ikEdPriv, rng),
    createdAt: new Date().toISOString(),
  };
}

/** SPK تازه + امضای آن با هویت */
export function makeSignedPreKey(
  ikEdPriv: Uint8Array,
  rng: Rng,
): LocalIdentity['spk'] {
  const pair = dhKeyPair(rng);
  const sig = sign(ikEdPriv, pair.pub);
  const b = rng(4);
  const keyId = ((((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0) % 2_147_483_646) + 1;
  return {
    keyId,
    pub: toB64(pair.pub),
    priv: toB64(pair.priv),
    sig: toB64(sig),
  };
}

/** دسته کلید یک‌بارمصرف تازه (عمومی برای سرور، خصوصی برای دستگاه) */
export function makeOtkBatch(rng: Rng, count: number, startKeyId: number): LocalOtk[] {
  const out: LocalOtk[] = [];
  for (let i = 0; i < count; i++) {
    const pair = dhKeyPair(rng);
    out.push({
      keyId: ((startKeyId + i) % 2_147_483_646) + 1,
      pub: toB64(pair.pub),
      priv: toB64(pair.priv),
    });
  }
  return out;
}

/** راستی‌آزمایی بسته عمومی طرف مقابل — امضای SPK با هویت اجباری است */
export function verifyBundle(
  bundle: Pick<PublicBundle, 'ikEd' | 'spk' | 'spkSig'>,
): void {
  const spk = fromB64(bundle.spk);
  const sig = fromB64(bundle.spkSig);
  const ikEdPub = fromB64(bundle.ikEd);
  const ok = ((): boolean => {
    try {
      return ed25519.verify(sig, spk, ikEdPub);
    } catch {
      return false;
    }
  })();
  if (!ok) throw new Error('E2EE_BAD_BUNDLE_SIGNATURE: امضای کلید پیش‌امضاشده معتبر نیست');
}

// ————— کلید بازیابی حساب —————

/**
 * کلید بازیابی ۳۲ بایتی — فقط یک‌بار نمایش داده می‌شود؛
 * قالب نمایش: ۸ گروه ۸ کاراکتری hex
 */
export function generateRecoveryKey(): string {
  return formatRecoveryKey(bytesToHex(randomBytes(32)));
}

export function formatRecoveryKey(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '').toLowerCase();
  const groups: string[] = [];
  for (let i = 0; i + 8 <= clean.length; i += 8) groups.push(clean.slice(i, i + 8));
  return groups.join(' ');
}

export function parseRecoveryKey(display: string): Uint8Array {
  return hexToBytes(display);
}

const BACKUP_AD = new TextEncoder().encode('del-e2ee-backup');

/**
 * بسته پشتیبان هویت — خصوصی‌های هویت با کلید مشتق از کلید بازیابی رمز می‌شوند.
 * سرور فقط blob رمز را نگه می‌دارد و به کلید بازیابی دسترسی ندارد.
 */
export function createBackup(
  identity: LocalIdentity,
  recoveryKeyBytes: Uint8Array,
): { blob: string; salt: string } {
  const salt = randomBytes(16);
  const master = kdf(recoveryKeyBytes, salt, 'Del-Backup-v1', 32);
  const inner = JSON.stringify({
    ikEd: identity.ikEd.priv,
    ikX: identity.ikX.priv,
    createdAt: identity.createdAt,
  });
  const sealed = aeadSeal(master, new TextEncoder().encode(inner), BACKUP_AD, randomBytes(12));
  return { blob: toB64(sealed), salt: toB64(salt) };
}

/** بازکردن پشتیبان با کلید بازیابی → کلیدهای خصوصی هویت */
export function restoreBackup(
  blob: string,
  salt: string,
  recoveryKeyBytes: Uint8Array,
): { ikEdPriv: Uint8Array; ikXPriv: Uint8Array; createdAt: string } {
  const master = kdf(recoveryKeyBytes, fromB64(salt), 'Del-Backup-v1', 32);
  const inner = aeadOpen(master, fromB64(blob), BACKUP_AD);
  const parsed = JSON.parse(new TextDecoder().decode(inner)) as {
    ikEd: string;
    ikX: string;
    createdAt: string;
  };
  return {
    ikEdPriv: fromB64(parsed.ikEd),
    ikXPriv: fromB64(parsed.ikX),
    createdAt: parsed.createdAt,
  };
}
