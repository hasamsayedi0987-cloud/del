# دل (Del) — پیام‌رسان امن چندسکویی

> iOS · Android · Windows · macOS — «دل»، بیش از یک گفت‌وگو (Del — More Than a Chat)
> وضعیت فعلی: **گام ۱ از پیاده‌سازی — زیرساخت احراز هویت (Auth Foundation) اجرا و تست‌شده** ✅

## این مخزن چیست؟

مخزن رسمی توسعه محصول «دل» است: یک پلتفرم پیام‌رسان واقعی با پیام متنی/رسانه‌ای، گروه‌ها، تماس صوتی و تصویری، اعلان‌ها، همگام‌سازی چنددستگاهی و دستیار هوشمند — با پشتیبانی درجه‌یک از فارسی/RTL و امنیت به‌عنوان بخشی از معماری.

## پیشرفت پیاده‌سازی

| گام | محدوده | وضعیت |
|---|---|---|
| فاز ۱ | نیازمندی‌ها + معماری + ۹ سند طراحی | ✅ کامل (`docs/`) |
| **گام ۱** | **API احراز هویت (OTP) + اپ موبایل + شل دسکتاپ + Docker + CI** | ✅ **اجرا و تست دود شد** |
| گام ۲ | پیام‌رسانی: مدل داده مکالمه/پیام + WebSocket + صف تحویل | ⬜ بعدی |
| گام ۳ | حضور و تایپینگ، لیست مخاطبین | ⬜ |
| گام ۴ | رسانه (MinIO + Presigned URL) | ⬜ |
| گام ۵ | تماس صوتی/تصویری (LiveKit) | ⬜ |
| گام ۶ | E2EE (Signal) — فقط پس از پایداری بستر | ⬜ |

### آنچه در گام ۱ واقعاً ساخته و تست شده است

- **`apps/api`** — NestJS با ماژول‌های `auth`، `users`، `health`؛ ثبت‌نام/ورود با کد یک‌بارمصرف پیامکی (حالت dev: کد در پاسخ)، JWT کوتاه‌عمر + refresh token چرخشی با **تشخیص سرقت توکن**، محدودساز نرخ OTP (۳ درخواست در ۱۰ دقیقه)، نرمال‌سازی شماره با پشتیبانی ارقام فارسی (۰۹۱۲ → +98912…)، Swagger در `/api/v1/docs`
- **`apps/mobile`** — اپ Expo (اندروید/iOS) با رابط کاملاً فارسی RTL و پالت Crystal Blue؛ ورود دو مرحله‌ای، ذخیره امن توکن در SecureStore، صفحه پروفایل
- **`apps/desktop`** — شل Electron برای ویندوز/مک/لینوکس با همان جریان ورود
- **زیرساخت** — `Dockerfile.api` (تصویر پروداکشن multi-stage) + `infrastructure/docker-compose.prod.yml`
- **CI** — سه workflow: بیلد CI، **ساخت خودکار APK اندروید**، و **ساخت خودکار EXE/DMG/AppImage دسکتاپ** (فعال‌سازی یک‌مرحله‌ای — `ci/README.md`)
- **تست دود ۸ مرحله‌ای** — `scripts/smoke-step1.sh` (ورود کامل تا خروج) — همه سبز

## پشته فناوری

| لایه | انتخاب |
|---|---|
| موبایل | React Native 0.81 + Expo SDK 54 + TypeScript |
| دسکتاپ | Electron 33 (الان JS خالص؛ انتقال به React در گام ۳) |
| بک‌اند | NestJS 10 (Modular Monolith) + Prisma 6 + PostgreSQL 16 + Redis 7 |
| رسانه | Object Storage سازگار S3 (MinIO در dev) — از گام ۴ |
| CI/CD | GitHub Actions + Docker |
| مدیریت مخزن | pnpm workspaces + Turborepo |

## اجرای محلی — سریع‌ترین مسیر

پیش‌نیاز: Node 20+، Docker، pnpm 9 (`npm i -g pnpm`)

```bash
# ۱) پایگاه‌داده و سرویس‌ها
docker compose -f infrastructure/docker-compose.dev.yml up -d

# ۲) نصب و مهاجرت دیتابیس
pnpm install
cp apps/api/.env.example apps/api/.env
pnpm --filter @del/api db:migrate:dev

# ۳) اجرای API
pnpm --filter @del/api dev          # → http://localhost:3000/api/v1/health

# ۴) اجرای اپ موبایل (شبیه‌ساز اندروید) یا دسکتاپ
pnpm --filter @del/mobile start     # → Expo DevTools
pnpm --filter @del/desktop dev      # → پنجره Electron

# تست دود کامل جریان احراز هویت (API باید روشن باشد)
bash scripts/smoke-step1.sh
```

> **حالت توسعه OTP:** چون سرویس پیامک هنوز متصل نیست (`AUTH_DEV_MODE=true`)، کد ۶ رقمی مستقیم در پاسخ API و لاگ سرور برگردانده می‌شود. با اتصال Kavenegar/SMS.ir در گام ۲، این حالت با `AUTH_DEV_MODE=false` خاموش می‌شود.
>
> **آدرس API در گوشی واقعی:** در `apps/mobile/src/config.ts` به‌جای `10.0.2.2` آدرس IP رایانه خود را بگذارید.

## ساخت فایل‌های نصب‌پذیر

سه راه (فعلاً مسیر ۱ توصیه می‌شود):

1. **GitHub Actions (ساده‌ترین):** فعال‌سازی یک‌بار: دستورات [`ci/README.md`](ci/README.md) → سپس در تب **Actions** اجرای «Android APK» و «Desktop installers» → دانلود از **Artifacts** (APK + EXE نصبی/پرتابل + DMG + AppImage)
2. **اندروید محلی:** `pnpm --filter @del/mobile exec expo prebuild -p android` سپس بازکردن `apps/mobile/android` در Android Studio و Build APK
3. **دسکتاپ محلی:** `pnpm --filter @del/desktop build` → خروجی در `apps/desktop/release/`
4. **استقرار سرور:** `docker compose -f infrastructure/docker-compose.prod.yml up -d --build` (نیازمند `.env` ریشه با مقادیر واقعی)

## ساختار

```
apps/            mobile (Expo) · desktop (Electron) · api (NestJS)
packages/        shared-types (فعال) · validation · api-client · design-system · config
docs/            ۹ سند فاز ۱ + docs/implementation/ (سند هر گام)
infrastructure/  docker-compose.dev.yml · docker-compose.prod.yml
scripts/         smoke-step1.sh (تست دود)
ci/              سه workflow GitHub Actions (فعال‌سازی: ci/README.md)
```

## قوانین مخزن

- مخزن خصوصی تا انتشار عمومی؛ commitهای Conventional؛ PR اجباری
- هیچ secret واقعی کامیت نمی‌شود (فقط `.env.example`)
- مستندات بخشی از Definition of Done است
- قابلیت ناقص، ناقص اعلام می‌شود — شفافیت روی وضعیت، اصل محصول است
