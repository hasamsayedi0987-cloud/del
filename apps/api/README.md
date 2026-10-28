# `@del/api` — Backend API (NestJS)

بک‌اند محصول «دل»: یک **Modular Monolith** مبتنی بر NestJS با TypeScript. تمام منطق امنیتی، اعتبارسنجی و مجوزدهی سمت سرور در همین ماژول پیاده‌سازی می‌شود.

## مسئولیت‌ها

- REST API نسخه‌بندی‌شده (`/api/v1`) با قرارداد OpenAPI
- WebSocket Gateway برای پیام‌رسانی بلادرنگ، presence و signaling تماس
- احراز هویت (JWT + چرخش refresh token) و مدیریت نشست‌ها
- مجوزدهی سمت سرور برای تمام عملیات گفت‌وگو/گروه/رسانه
- آپلود رسانه با Presigned URL سازگار با S3
- نرخ‌محدودی، ثبت رویدادهای امنیتی و Audit Log

## ساختار ماژول‌ها (نقشه راه)

```
src/
├── auth/            # ثبت‌نام، ورود، refresh، خروج، بازیابی حساب
├── users/           # پروفایل، تنظیمات، دستگاه‌ها، نشست‌ها
├── contacts/        # مخاطبان و مسدودسازی
├── conversations/   # گفت‌وگوهای خصوصی و گروهی + عضویت‌ها
├── messages/        # پیام‌ها، واکنش‌ها، وضعیت تحویل/خواندن
├── media/           # آپلود/دانلود امن فایل و thumbnail
├── calls/           # signaling و تاریخچه تماس (SFU: LiveKit)
├── notifications/   # توکن‌های Push و تنظیمات اعلان
├── moderation/      # گزارش تخلف و مسدودسازی
├── ai/              # دستیار هوشمند (کلیدها فقط سمت سرور)
├── admin/           # پنل مدیریت و Audit
└── health/          # Health checks و observability
```

## وضعیت

| قابلیت | وضعیت |
|---|---|
| اسکلت پروژه | ⬜ فاز ۰ |
| Auth و نشست‌ها | ⬜ فاز ۱ |
| پیام‌رسانی ۱:۱ | ⬜ فاز ۲ |
| گروه‌ها | ⬜ فاز ۳ |
| رسانه و فایل | ⬜ فاز ۴ |
| تماس ۱:۱ | ⬜ فاز ۵ |
| اعلان‌ها و همگام‌سازی | ⬜ فاز ۶ |
| AI Assistant | ⬜ فاز ۷ |
| پنل مدیریت | ⬜ فاز ۸ |

نقشه کامل در [`docs/07-roadmap.md`](../../docs/07-roadmap.md) آمده است.

## اجرای محلی

```bash
docker compose -f infrastructure/docker-compose.dev.yml up -d   # postgres + redis + minio
cp .env.example .env                                            # مقادیر را پر کنید
pnpm install
pnpm --filter @del/api db:migrate
pnpm dev
```
