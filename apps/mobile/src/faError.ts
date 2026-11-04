import { ApiError } from './api';

/** ترجمه خطاهای API به پیام فارسی (ورود با ایمیل) */
export function faError(e: ApiError): string {
  switch (e.code) {
    case 'EMAIL_INVALID':
      return 'ایمیل معتبر نیست';
    case 'TOO_MANY_REQUESTS':
      return 'تعداد درخواست‌ها زیاد است؛ کمی بعد دوباره تلاش کنید';
    case 'OTP_INVALID':
      return 'کد وارد شده اشتباه است';
    case 'OTP_EXPIRED':
      return 'کد منقضی شده است؛ کد جدید بگیرید';
    case 'OTP_LOCKED':
      return 'تلاش‌های ناموفق زیاد بود؛ کد جدید بگیرید';
    case 'OTP_NOT_FOUND':
      return 'کد فعالی وجود ندارد؛ کد جدید بگیرید';
    case 'ACCOUNT_BLOCKED':
      return 'حساب شما مسدود شده است';
    case 'EMAIL_SMTP_NOT_CONFIGURED':
      return 'سرور هنوز سرویس ارسال ایمیل ندارد؛ بعداً دوباره تلاش کنید';
    case 'EMAIL_SEND_FAILED':
      return 'ارسال ایمیل کد ناموفق بود؛ چند لحظه بعد دوباره تلاش کنید';
    case 'NETWORK':
      // بیدار شدن سرور از حالت خواب (پلن رایگان) ممکن است اولین درخواست را ناموفق کند
      return `${e.message} — چند لحظه صبر کنید و دوباره تلاش کنید`;
    default:
      return 'خطا در ارتباط با سرور';
  }
}
