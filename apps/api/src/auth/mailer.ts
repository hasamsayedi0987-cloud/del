import { Logger } from '@nestjs/common';
import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import { appConfig } from '../config/configuration';

/**
 * mailer — ارسال کد ورود ایمیلی با SMTP استاندارد.
 * با هر سرویسی کار می‌کند: Gmail (App Password)، Brevo، Mailgun، SMTP خودمیزبان …
 * ترنسپورت تنبل ساخته می‌شود (فقط با اولین ارسال واقعی).
 */
let transporter: Transporter | null = null;

function getTransport(): Transporter | null {
  const cfg = appConfig.load();
  if (!cfg.emailSmtpConfigured) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpPort === 465,
    auth: cfg.smtpUser
      ? { user: cfg.smtpUser, pass: cfg.smtpPass ?? '' }
      : undefined,
  });
  return transporter;
}

function loginCodeHtml(code: string, ttlMin: number): string {
  return `<!DOCTYPE html>
<html lang="fa" dir="rtl"><body style="margin:0;padding:0;background:#f1f5f9;font-family:Tahoma,'Segoe UI',sans-serif;">
  <div style="max-width:520px;margin:24px auto;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
    <div style="background:#0E1F3A;padding:28px 24px;text-align:center;">
      <div style="display:inline-block;width:56px;height:56px;line-height:56px;border-radius:50%;background:#0284C7;color:#ffffff;font-size:26px;font-weight:bold;">دل</div>
      <div style="color:#e8f1fb;font-size:18px;margin-top:12px;">کد ورود دل</div>
    </div>
    <div style="padding:28px 24px;text-align:center;">
      <p style="color:#334155;font-size:15px;margin:0 0 16px;">سلام! کد ورود شما به پیام‌رسان دل:</p>
      <div style="font-size:34px;letter-spacing:10px;font-weight:bold;color:#0E1F3A;background:#f1f5f9;border-radius:12px;padding:14px 0;">${code}</div>
      <p style="color:#64748b;font-size:13px;margin:16px 0 0;">این کد تا ${ttlMin} دقیقه معتبر است و را فقط یک‌بار مصرف.</p>
      <p style="color:#94a3b8;font-size:12px;margin:20px 0 0;">اگر شما درخواست نداده بودید، این ایمیل را نادیده بگیرید.</p>
    </div>
  </div>
</body></html>`;
}

/** ارسال کد ورود — true فقط اگر SMTP تأیید پذیرش کرد */
export async function sendLoginCodeEmail(email: string, code: string, ttlSec: number): Promise<boolean> {
  const cfg = appConfig.load();
  const transport = getTransport();
  if (!transport) return false;
  const logger = new Logger('Mailer');
  try {
    await transport.sendMail({
      from: cfg.smtpFrom ?? cfg.smtpUser,
      to: email,
      subject: `کد ورود دل: ${code}`,
      text: `کد ورود شما به پیام‌رسان دل: ${code}\nاین کد تا ${Math.round(ttlSec / 60)} دقیقه معتبر است.`,
      html: loginCodeHtml(code, Math.round(ttlSec / 60)),
    });
    return true;
  } catch (e) {
    logger.warn(`SMTP send failed for ${email}: ${String(e instanceof Error ? e.message : e)}`);
    return false;
  }
}
