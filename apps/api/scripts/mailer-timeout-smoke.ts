// تست timeout میلر — SMTP هاست سیاه‌چاله: باید در ~۸ثانیه خطا بدهد نه ۲ دقیقه
process.env.SMTP_HOST = '10.255.255.1';
process.env.SMTP_PORT = '587';
process.env.SMTP_USER = 'probe@example.com';
process.env.SMTP_PASS = 'probe';
process.env.SMTP_FROM = 'probe@example.com';

import 'reflect-metadata';
import { sendLoginCodeEmail } from '../src/auth/mailer';

(async () => {
  const t0 = Date.now();
  const ok = await sendLoginCodeEmail('probe@example.com', '123456', 300);
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`RESULT sent=${ok} elapsed=${dt}s`);
  if (ok === false && Number(dt) < 15) {
    console.log('MAILER_TIMEOUT_PASS: fast-fail works');
    process.exit(0);
  }
  console.log('MAILER_TIMEOUT_FAIL: hung or unexpected result');
  process.exit(2);
})();
