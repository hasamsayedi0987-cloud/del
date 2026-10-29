# گام ۱ — زیرساخت احراز هویت (Auth Foundation)

> وضعیت: **اجرا و تست‌شده** — تاریخ: ۱۴۰۴/۰۸/۰۷ (2026-10-29)
> محدوده این سند: آنچه در گام ۱ واقعاً ساخته شده است، نه آنچه طراحی شده.

## ۱. اهداف گام

- تبدیل اسکلت خالی فاز ۱ به کد قابل‌اجرا: API با ورود واقعی، اپ موبایل و دسکتاپ متصل به آن
- بستن کل چرخه «شماره موبایل ← کد ← نشست ← خروج» با استانداردهای امنیتی سند ۰۶
- آماده‌سازی خط تولید نصب‌پذیرها (APK / EXE / DMG) بدون نیاز به ابزار محلی
- بیلد سبز کل مونوریپو با یک دستور (`pnpm build`)

## ۲. آنچه ساخته شد

### ۲.۱. API — `apps/api` (NestJS 10 + Prisma 6 + PostgreSQL 16)

| نقطه پایانی | شرح |
|---|---|
| `POST /api/v1/auth/otp/request` | تولید کد ۶ رقمی؛ سقف ۳ درخواست در ۱۰ دقیقه به‌ازای هر شماره و ۲۰ به‌ازای هر IP؛ در حالت dev کد در پاسخ برمی‌گردد |
| `POST /api/v1/auth/otp/verify` | بررسی کد (حداکثر ۵ تلاش)، ساخت خودکار کاربر، صدور access (۱۵دقیقه) + refresh (۳۰روز) |
| `POST /api/v1/auth/refresh` | چرخش refresh token؛ استفاده مجدد از توکن باطل‌شده ⇒ ابطال همه نشست‌های کاربر |
| `POST /api/v1/auth/logout` | ابطال refresh token |
| `GET /api/v1/users/me` · `PATCH /api/v1/users/me` | پروفایل (نام نمایشی/بیوگرافی) |
| `GET /api/v1/health` | سلامت DB و Redis با «شکست نرم» |
| `GET /api/v1/docs` | Swagger (فقط غیرپروداکشن) |

نکات امنیتی پیاده‌شده: کد OTP فقط به‌صورت SHA-256 ذخیره می‌شود، ارقام فارسی/عربی و همه فرمت‌های ایرانی نرمال‌سازی می‌شوند (۰۹۱۲ ۱۲۳ ۴۵۶۷ / 0098912… / +98 912… ⇒ +98912…)، خطاها با کد استاندارد (`OTP_INVALID`, `OTP_EXPIRED`, `OTP_LOCKED`, `TOO_MANY_REQUESTS`, `REFRESH_REUSED`).

مدل داده (Prisma): `User`, `Device`, `OtpCode`, `RefreshToken` — مهاجرت اولیه در `prisma/migrations/20261029043201_init/`.

### ۲.۲. موبایل — `apps/mobile` (Expo SDK 54 / RN 0.81 / TS)

سه صحنه (شماره ← کد ← خانه) با رابط RTL فارسی و پالت Crystal Blue، ذخیره توکن‌ها در `expo-secure-store`، کلاینت API با پیام‌های خطای فارسی‌شده، آدرس سرور قابل‌تغییر در `src/config.ts` (شبیه‌ساز: 10.0.2.2 / گوشی واقعی: IP شبکه محلی).

### ۲.۳. دسکتاپ — `apps/desktop` (Electron 33)

همان جریان ورود با JS خالص + CSP سخت‌گیرانه؛ فیلد «آدرس سرور» برای اتصال به API محلی/ریموت؛ ذخیره refresh token در localStorage (انتقال به keytar در گام ۳). تنظیمات بیلد `electron-builder` برای NSIS+Portable ویندوز، DMG مک، AppImage لینوکس آماده است.

### ۲.۴. زیرساخت و CI

- `Dockerfile.api` — تصویر multi-stage با کاربر غیرریشه و HEALTHCHECK؛ ورود و مهاجرت خودکار
- `infrastructure/docker-compose.prod.yml` — postgres + redis + api (+ minio با پروفایل `media`)
- سه workflow در `.github/workflows/`: `ci.yml`، `android-apk.yml` (ساخت APK دیباگ قابل نصب)، `desktop-builds.yml` (EXE/DMG/AppImage)

## ۳. نتایج تست دود (`scripts/smoke-step1.sh`)

| # | سناریو | نتیجه |
|---|---|---|
| ۱ | درخواست OTP با ارقام فارسی «۰۹۱۲۱۲۳۴۵۶۷» | ✅ نرمال‌سازی به +989121234567 و کد در پاسخ |
| ۲ | تأیید با کد اشتباه | ✅ 400 `OTP_INVALID` |
| ۳ | تأیید با کد درست | ✅ access + refresh + کاربر جدید |
| ۴ | `users/me` با Bearer | ✅ 200 پروفایل |
| ۵ | `users/me` بدون توکن | ✅ 401 |
| ۶ | refresh | ✅ جفت جدید صادر شد |
| ۷ | استفاده مجدد از refresh قدیمی | ✅ 401 `REFRESH_REUSED` + ابطال همه نشست‌ها |
| ۸ | logout | ✅ 204 |
| ۹ | درخواست چهارم OTP (سقف ۳) | ✅ 429 |
| ۱۰ | PATCH نام نمایشی فارسی «علی تست» | ✅ ذخیره شد |

بیلد: `turbo run build` روی api/mobile/shared-types سبز؛ `tsc --noEmit` موبایل سبز.

## ۴. محدودیت‌های شناخته‌شده گام ۱

- سرویس پیامک واقعی متصل نیست (حالت dev فعال است) — گام ۲
- Redis در تست دود محلی بالا نبود؛ محدودساز به‌طور خودکار به حافظه fallback شد — رفتار طراحی‌شده
- دسکتاپ هنوز React ندارد و refresh token آن در localStorage است — گام ۳
- E2EE وجود ندارد و تا گام ۶ ادعا نمی‌شود

## ۵. معیار پذیرش گام بعدی (گام ۲ — پیام‌رسانی)

- جداول `Conversation`, `Participant`, `Message` با `server_seq` و `client_msg_id` یگانه
- WebSocket gateway برای تحویل بلادرنگ + REST با cursor به‌عنوان پشتوانه
- ارسال/دریافت دوطرفه بین دو کاربر تستی با تحویل idempotent
