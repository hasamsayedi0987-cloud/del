/**
 * Del E2EE — لایه session: ترکیب X3DH + Double Ratchet
 * هر جفت دستگاه (من ↔ دستگاهِ طرف) یک session مستقل دارد.
 * پیام اول هر session بار پیش‌کلیدی (pm) را حمل می‌کند؛ بعد از آن فقط ratchet.
 */
import { utf8ToBytes, bytesToUtf8, toB64, fromB64 } from './b64';
import { randomBytes, type Rng } from './crypto';
import {
  DoubleRatchet,
  type RatchetMessage,
} from './ratchet';
import { initiatorAgreement, responderAgreement } from './x3dh';
import type {
  E2eeEnvelope,
  EnvelopeEntry,
  LocalIdentity,
  PrekeyPayload,
  PublicBundle,
} from './wire';

/** پیام سیمی session — داخل EnvelopeEntry.ct (b64 از JSON) قرار می‌گیرد */
export interface SessionWire {
  rm: RatchetMessage;
}

/** حالت قابل ذخیره یک session */
export interface SessionState {
  peerUserId: string;
  peerDeviceId: string;
  /** DoubleRatchet سریال‌شده */
  ratchet: string;
  /** بار پیش‌کلیدی برای اولین پیام (تا مصرف می‌ماند) */
  pendingPm?: PrekeyPayload;
  /** کلید OTK خصوصی که من مصرف کردم — فقط سمت آغازگر، برای راه‌اندازی مجدد در صورت گم شدن؟ — نیازی نیست؛ null */
  closed?: boolean;
}

export class DelSession {
  private constructor(
    private readonly peerUserId: string,
    private readonly peerDeviceId: string,
    private ratchet: DoubleRatchet,
    private pendingPm?: PrekeyPayload,
  ) {}

  /** آغازگر — از بسته عمومی گیرنده */
  static initiate(
    me: LocalIdentity,
    peerUserId: string,
    bundle: PublicBundle,
    rng: Rng = randomBytes,
  ): DelSession {
    const { sharedKey, payload } = initiatorAgreement(me, bundle, rng);
    const ratchet = DoubleRatchet.initInitiator(sharedKey, fromB64(bundle.spk), rng);
    return new DelSession(peerUserId, bundle.deviceId, ratchet, payload);
  }

  /** پاسخ‌گو — با بار پیش‌کلیدی پیام اول */
  static accept(
    me: LocalIdentity,
    peerUserId: string,
    peerDeviceId: string,
    pm: PrekeyPayload,
    otkPriv: Uint8Array | null,
  ): DelSession {
    const spkPriv = fromB64(me.spk.priv);
    const { sharedKey } = responderAgreement(me, pm, spkPriv, otkPriv);
    // SPK من کلید ratchet آغازین من است (همان که آغازگر رویش زنجیره بست)
    const ratchet = DoubleRatchet.initResponder(sharedKey, {
      pub: fromB64(me.spk.pub),
      priv: spkPriv,
    });
    return new DelSession(peerUserId, peerDeviceId, ratchet);
  }

  /** AD استاندارد — پیوند به مکالمه و دو دستگاه */
  static ad(conversationId: string, fromDeviceId: string, toDeviceId: string): Uint8Array {
    return utf8ToBytes(`del|${conversationId}|${fromDeviceId}|${toDeviceId}`);
  }

  get peer(): { userId: string; deviceId: string } {
    return { userId: this.peerUserId, deviceId: this.peerDeviceId };
  }

  /** رمز کردن — خروجی آمادهٔ جای‌گیری در EnvelopeEntry (بار پیش‌کلیدی در pm جدا است) */
  encrypt(plaintext: string, ad: Uint8Array): EnvelopeEntry {
    const wire: SessionWire = { rm: this.ratchet.encrypt(utf8ToBytes(plaintext), ad) };
    const entry: EnvelopeEntry = {
      deviceId: this.peerDeviceId,
      from: '', // فرستنده در سطح پاکت پر می‌شود
      ct: toB64(utf8ToBytes(JSON.stringify(wire))),
    };
    if (this.pendingPm) {
      entry.pm = this.pendingPm;
      this.pendingPm = undefined;
    }
    return entry;
  }

  decrypt(entry: { ct: string }, ad: Uint8Array): string {
    const wire = JSON.parse(bytesToUtf8(fromB64(entry.ct))) as SessionWire;
    if (!wire || !wire.rm) throw new Error('E2EE_BAD_WIRE');
    const plain = this.ratchet.decrypt(wire.rm, ad);
    return bytesToUtf8(plain);
  }

  serialize(): SessionState {
    return {
      peerUserId: this.peerUserId,
      peerDeviceId: this.peerDeviceId,
      ratchet: this.ratchet.serialize(),
      ...(this.pendingPm ? { pendingPm: this.pendingPm } : {}),
    };
  }

  static load(state: SessionState): DelSession {
    return new DelSession(
      state.peerUserId,
      state.peerDeviceId,
      DoubleRatchet.load(state.ratchet),
      state.pendingPm,
    );
  }
}

/** ساخت پاکت کامل برای چند دستگاه — fromDeviceId در همه ورودی‌ها ست می‌شود */
export function buildEnvelope(
  entries: EnvelopeEntry[],
  fromDeviceId: string,
): E2eeEnvelope {
  return {
    v: 1,
    e2ee: true,
    to: entries.map((e) => ({ ...e, from: fromDeviceId })),
  };
}
