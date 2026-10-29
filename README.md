# دل (Del) — پیام‌رسان امن چندسکویی

> iOS · Android · Windows · macOS — «دل»، بیش از یک گفت‌وگو (Del — More Than a Chat)
> وضعیت فعلی: **فاز ۲ — برش افقی قابل اجرا (Alpha 0.1.0)** — اپ اندروید، دسکتاپ و سرور کار می‌کنند

## ✨ نسخه آلفا (0.1.0-alpha.1) — چه چیزی الان کار می‌کند؟

- اپ **اندروید (APK امضاشده)**، **ویندوز (ZIP قابل‌حمل)** و **لینوکس (AppImage)** با UI فارسی/RTL و تم Crystal Blue
- ورود با شماره تلفن + OTP، لیست گفت‌وگوها، چت ۱:۱ با تیک ارسال/خوانده‌شدن و نشانگر تایپ
- **حالت دمو:** بدون سرور هم اپ با مخاطبین نمونه کار می‌کند
- **حالت سرور واقعی:** REST + WebSocket — بسته `del-server.zip` را اجرا کنید و از تنظیمات وصل شوید
- جزئیات کامل و روش نصب: [`docs/09-alpha-build.md`](docs/09-alpha-build.md)

> معماری وب‌هسته مشترک (React → Capacitor/Electron) فقط برای بیلد سریع آلفاست؛ هسته UI به RN+Expo مهاجرت می‌کند (ADR در سند ۰۹).

## این مخزن چیست؟

مخزن رسمی توسعه محصول «دل» است: یک پلتفرم پیام‌رسان واقعی با پیام متنی/رسانه‌ای، گروه‌ها، تماس صوتی و تصویری، اعلان‌ها، همگام‌سازی چنددستگاهی و دستیار هوشمند — با پشتیبانی درجه‌یک از فارسی/RTL و امنیت به‌عنوان بخشی از معماری.

در فاز ۱ اسناد و اسکلت ساخته شد؛ در فاز ۲ (اکنون) **برش افقی قابل اجرا** تحویل شده است: هسته مشترک UI (React+TS)، اپ اندروید (Capacitor)، دسکتاپ (Electron) و سرور REST+WS+SQLite — به‌همراه ورک‌فلوهای CI برای بیلد APK / EXE / DMG.

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
apps/        mobile (Capacitor) · desktop (Electron) · api (Express+WS+SQLite) · web-core (UI مشترک)
packages/    shared-types · validation · api-client · design-system · config
docs/        اسناد فاز ۱ + docs/09-alpha-build.md (سند بیلد آلفا)
infrastructure/  docker-compose dev + نقشه استقرار
.github/workflows/   build-android.yml · build-desktop.yml (APK/EXE/DMG خودکار)
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
