/**
 * Del E2EE — رمزنگاری سرتاسری چت خصوصی (گام ۸)
 * X3DH + Double Ratchet (الگوی Signal) با ChaCha20-Poly1305 و HKDF-SHA256.
 *
 * اصول:
 *  - سرور فقط کلیدهای «عمومی» و متن «رمز» را می‌بیند (آزمون: smoke-step8)
 *  - خصوصی‌ها فقط در دستگاه (SecureStore/localStorage) و پشتیبانِ رمزشده با کلید بازیابی
 *  - هر جفت دستگاه یک session مستقل؛ پیام نخست بار پیش‌کلیدی را حمل می‌کند
 */
export * from './wire';
export * from './b64';
export {
  setRng,
  randomBytes,
  type Rng,
} from './crypto';
export {
  generateIdentity,
  identityFromPrivate,
  makeSignedPreKey,
  makeOtkBatch,
  verifyBundle,
  generateRecoveryKey,
  formatRecoveryKey,
  parseRecoveryKey,
  createBackup,
  restoreBackup,
} from './keys';
export { initiatorAgreement, responderAgreement } from './x3dh';
export { DoubleRatchet, MAX_SKIP, type RatchetMessage } from './ratchet';
export { DelSession, buildEnvelope, type SessionState, type SessionWire } from './session';
