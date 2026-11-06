/**
 * نرمال‌سازی شماره تلفن به فرمت E.164
 * پشتیبانی از ارقام فارسی/عربی، پیش‌شماره‌های ۰۰۹۸ / +98 / 098 / 0 و جداکننده‌ها
 */

const PERSIAN_DIGITS = '۰۱۲۳۴۵۶۷۸۹';
const ARABIC_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export function normalizeDigits(input: string): string {
  let out = '';
  for (const ch of input) {
    const fa = PERSIAN_DIGITS.indexOf(ch);
    if (fa > -1) {
      out += String(fa);
      continue;
    }
    const ar = ARABIC_DIGITS.indexOf(ch);
    if (ar > -1) {
      out += String(ar);
      continue;
    }
    out += ch;
  }
  return out;
}

/**
 * Examples:
 *  ۰۹۱۲۱۲۳۴۵۶۷        → +989121234567
 *  0912 123 4567       → +989121234567
 *  +98 912 123 4567    → +989121234567
 *  00989121234567      → +989121234567
 *  989121234567        → +989121234567
 *  +14155552671        → +14155552671 (بین‌المللی، دست‌نخورده)
 */
export function toE164(raw: string): string | null {
  let s = normalizeDigits(raw).replace(/[\s\-().]/g, '');
  if (!s) return null;

  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  else if (s.startsWith('+')) s = s;
  else if (s.startsWith('98') && s.length === 12) s = `+${s}`;
  else if (s.startsWith('0') && s.length === 11 && /^09\d{9}$/.test(s)) s = `+98${s.slice(1)}`;
  else if (s.length === 10 && /^9\d{9}$/.test(s)) s = `+98${s}`;
  else s = `+${s}`;

  if (!/^\+[1-9]\d{6,14}$/.test(s)) return null;
  return s;
}

export function isIranMobile(e164: string): boolean {
  return /^\+989\d{9}$/.test(e164);
}
