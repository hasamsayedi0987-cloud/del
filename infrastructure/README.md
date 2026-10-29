# `infrastructure` — زیرساخت و استقرار

تعریف زیرساخت «دل»: Docker، محیط‌های dev/staging/prod، پایگاه داده و صف/کش، Object Storage، SFU تماس و پایش.

## محتوای این پوشه

| فایل | شرح |
|---|---|
| `docker-compose.dev.yml` | محیط توسعه محلی: PostgreSQL + Redis + MinIO |
| `deploy/` | (فاز بعدی) Dockerfileها، compose تولید و تنظیمات reverse proxy |

## اجزای تولید (نقشه راه)

- **API**: کانتینر NestJS پشت reverse proxy با TLS (مثلاً Caddy/Nginx)
- **PostgreSQL 16**: volume مستقل + پشتیبان‌گیری روزانه با `pg_dump`/WAL
- **Redis 7**: cache + pub/sub برای WebSocket adapter (بدون داده دائمی حساس)
- **MinIO / S3**: ذخیره رسانه با lifecycle policy
- **LiveKit**: SFU تماس صوتی/تصویری (self-host در فاز ۵)
- **پایش**: health endpoints + متریک‌ها + هشدار خطا (Sentry-compatible)

## قوانین

- هیچ secret واقعی در این مخزن کامیت نمی‌شود؛ فقط `.env.example`
- مهاجرت‌های دیتابیس یک‌طرفه و بازگشت‌پذیر مستند می‌شوند
- بازیابی پشتیبان باید به‌صورت دوره‌ای «آزمایش‌شده» باشد (فاز ۸)
