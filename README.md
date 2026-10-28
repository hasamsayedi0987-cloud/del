# دل (Del) — پیام‌رسان امن چندسکویی

> iOS · Android · Windows · macOS — «دل»، بیش از یک گفت‌وگو (Del — More Than a Chat)
> وضعیت فعلی: **فاز ۱ — مستندات معماری و نیازمندی‌ها** (بدون ادعای قابلیت پیاده‌نشده)

## این مخزن چیست؟

مخزن رسمی توسعه محصول «دل» است: یک پلتفرم پیام‌رسان واقعی با پیام متنی/رسانه‌ای، گروه‌ها، تماس صوتی و تصویری، اعلان‌ها، همگام‌سازی چنددستگاهی و دستیار هوشمند — با پشتیبانی درجه‌یک از فارسی/RTL و امنیت به‌عنوان بخشی از معماری.

در فاز فعلی **کد محصول وجود ندارد**؛ آنچه وجود دارد اسکلت مونوریپو و مجموعه کامل اسناد فاز ۱ است که مبنای شروع فاز ۰ (راه‌اندازی زیرساخت) است.

## پشته فناوری (تصمیم مستند در docs/02)

| لایه | انتخاب |
|---|---|
| موبایل | React Native + Expo + TypeScript |
| دسکتاپ | Electron + React + TypeScript |
| بک‌اند | NestJS (Modular Monolith) + TypeScript |
| پایگاه داده | PostgreSQL 16 + Redis 7 |
| بلادرنگ | WebSocket (NestJS Gateway + Redis adapter) |
| تماس | WebRTC + LiveKit SFU + coturn |
| رسانه | Object Storage سازگار S3 (MinIO در dev) |
| CI/CD | GitHub Actions + Docker |
| مدیریت مخزن | pnpm workspaces + Turborepo |

## ساختار

```
apps/        mobile · desktop · api
packages/    shared-types · validation · api-client · design-system · config
docs/        اسناد فاز ۱ (نیازمندی‌ها، معماری، مدل داده، API، ریسک‌ها، نقشه راه، عملیات)
infrastructure/  docker-compose dev + نقشه استقرار
```

## اسناد فاز ۱ — از کجا شروع کنیم؟

1. [`docs/00-overview.md`](docs/00-overview.md) — نمای کلی و فهرست اسناد
2. [`docs/01-requirements.md`](docs/01-requirements.md) — نیازمندی‌ها با معیار پذیرش
3. [`docs/02-architecture.md`](docs/02-architecture.md) — معماری و تصمیم‌های مستدل
4. [`docs/07-roadmap.md`](docs/07-roadmap.md) — ۹ فاز با معیار پذیرش قابل اندازه‌گیری

## اجرای محلی (پس از فاز ۰)

```bash
docker compose -f infrastructure/docker-compose.dev.yml up -d
cp .env.example .env   # مقادیر را پر کنید (هرگز .env را کامیت نکنید)
pnpm install
pnpm dev
```

## قوانین مخزن

- مخزن خصوصی تا انتشار عمومی؛ commitهای Conventional؛ PR اجباری
- هیچ secret واقعی کامیت نمی‌شود (فقط `.env.example`)
- مستندات بخشی از Definition of Done است
- قابلیت ناقص، ناقص اعلام می‌شود — شفافیت روی وضعیت، اصل محصول است
