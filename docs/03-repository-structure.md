# سند ۰۳ — ساختار مخزن (Monorepo)

> **نسخه:** v0.1 · ابزار: pnpm workspaces + Turborepo · همه اپ‌ها و پکیج‌ها TypeScript هستند.

## ۱. درخت ساختار

```
del/
├── apps/
│   ├── mobile/               # React Native + Expo (iOS, Android)
│   ├── desktop/              # Electron + React (Windows, macOS)
│   └── api/                  # NestJS — REST + WebSocket Gateway
├── packages/
│   ├── shared-types/         # تایپ‌های دامنه + شکل رویدادهای WS + DTOها
│   ├── validation/           # اسکیماهای Zod مشترک (سرور و کلاینت)
│   ├── api-client/           # کلاینت REST/WS تایپ‌دار (retry، صف آفلاین، idempotency)
│   ├── design-system/        # توکن‌ها و کامپوننت‌های UI (RTL/LTR، تم روشن/تاریک)
│   └── config/               # tsconfig، biome، ثابت‌های مشترک
├── docs/                     # اسناد فاز ۱ (همین مجموعه) — منبع حقیقت محصول
├── infrastructure/
│   ├── docker-compose.dev.yml
│   └── deploy/               # (فاز بعد) Dockerfile تولید، reverse proxy، SFU
├── .env.example              # بدون secret واقعی
├── package.json / pnpm-workspace.yaml / turbo.json / tsconfig.base.json
└── README.md
```

**قانون تغییر:** ساختار فقط با PR و به‌روزرسانی هم‌زمان همین سند تغییر می‌کند.

## ۲. مسئولیت و جهت وابستگی‌ها

| پکیج | مسئولیت | وابسته به |
|---|---|---|
| `shared-types` | قرارداد داده بین همه سمت‌ها | — |
| `validation` | منبع یگانه اعتبارسنجی ورودی | shared-types |
| `api-client` | ارتباط شبکه همه کلاینت‌ها | shared-types, validation |
| `design-system` | اجزای UI قابل استفاده مجدد | — (فقط React/RN) |
| `config` | تنظیمات ابزار مشترک | — |
| `apps/api` | منطق امن و مجوز | shared-types, validation |
| `apps/mobile` / `apps/desktop` | تجربه کاربری | api-client, shared-types, validation, design-system |

**قانون وابستگی:** اپ‌ها هرگز مستقیماً HTTP/WS نزنند و تایپ را از هوا نسازند؛ همه‌چیز از `api-client` و `shared-types` می‌گذرد. این قانون، «کد مشترک بدون پیچیدگی» را عملی می‌کند.

## ۳. قراردادهای کدنویسی

- **زبان:** TypeScript strict (`tsconfig.base.json`)؛ `any` ممنوع در کد مسیر داده.
- **نام‌گذاری:** فایل‌ها kebab-case؛ کلاس‌ها/تایپ‌ها PascalCase؛ جدول‌ها snake_case جمع.
- **Lint/Format:** Biome برای همه پکیج‌ها (سرعت بالا، تنظیمات واحد در `@del/config`).
- **کامیت:** Conventional Commits (`feat(messages): ...`)؛ squash-merge با عنوان استاندارد.
- **برنچ:** `main` محافظت‌شده؛ قابلیت‌ها با `feat/<module>-<desc>`؛ رفع عاجل `hotfix/...`.
- **نسخه:** monorepo واحد با نسخه ۰.x تا انتشار عمومی؛ tags: `v0.x.y`.
- **Secrets:** فقط `.env.example` کامیت می‌شود؛ مقادیر واقعی در secret manager محیط استقرار.

## ۴. تست در هر لایه

| لایه | ابزار | تمرکز |
|---|---|---|
| واحد | Vitest | منطق مجوز، pagination، رفلکت idempotency |
| API/DB | Vitest + Testcontainers (Postgres/Redis واقعی) | endpointها، migrationها، تراکنش‌ها |
| قرارداد | تست OpenAPI + تایپ‌های shared | سازگاری کلاینت/سرور |
| E2E کلاینت | Detox (RN) / Playwright (Electron) | جریان‌های اصلی چنددستگاهی |
| بار | k6 | WS هم‌زمانی، آپلود، تماس |

## ۵. CI/CD (GitHub Actions — نقشه فاز ۰)

1. **PR pipeline:** install → lint → typecheck → unit tests → build → سکن وابستگی‌ها (npm audit / Snyk-سازگار) → تست API با Testcontainers
2. **main:** همان + انتشار imageهای Docker با tag SHA → دیپلوی خودکار staging
3. **release (فاز ۸):** بیلد امضاشده EAS (iOS/Android) و Electron (win/mac) + tag + changelog

## ۶. قوانین Git و امنیت مخزن

- مخزن **خصوصی** تا انتشار عمومی محصول.
- هیچ secret، کلید، یا `.p8`/`keystore` در تاریخچه؛ check-secrets در CI (gitleaks).
- PR بدون حداقل یک reviewer و CI سبز merge نمی‌شود.
- مستندات (docs/) بخشی از Definition of Done هر قابلیت است.
