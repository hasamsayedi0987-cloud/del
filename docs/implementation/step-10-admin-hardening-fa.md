# سند پیاده‌سازی — گام ۱۰: مدیریت، سخت‌سازی و آمادهٔ انتشار (نسخه ۱٫۰٫۰)

> **وضعیت:** اجرا و تست دود شد (۴۴/۴۴ سبز + رگرسیون کامل گام‌های ۱ تا ۹ = **۲۹۳ بررسی سبز** · سنجش بار p95=۹۲ms · تمرین بازیابی پشتیبان موفق)

## ۱) اصل معماری

**دو لایهٔ انسداد، یک لایهٔ نظارت.** هر تصمیم سروری است و هر اقدام مدیریتی ثبت:

1. **انسداد کاربر-به-کاربر (DM-level):** یک طرف مسدود می‌کند، گفتگوی مستقیم **دوطرفه** بسته می‌شود (الگوی متداول پیام‌رسان‌ها). گروه‌ها مشمول نیستند — مسدودی یک رابطهٔ ۱:۱ است. کنترل در دو نقطهٔ داغ: ساخت DM تازه و ارسال پیام در DM موجود
2. **انسداد حساب (admin-level):** ادمین مسدود می‌کند → `blockedAt` + ابطال همهٔ refresh tokenها + قطع socketها + **گارد زندهٔ JWT** که در هر درخواست وضعیت حساب را تأیید می‌کند — نه فقط هنگام ورود
3. **نظارت (AuditLog):** هر اقدام مدیریتی با اقدام‌کننده/هدف/متا/زمان ثبت می‌شود — پنل ادمین «دفتر اقدامات» را نشان می‌دهد

## ۲) تصمیم‌های کلیدی

| تصمیم | دلیل |
|---|---|
| نقش در جدول User (نه جدول جدا) | یک نقش سیستمی کافی است؛ ADMIN_PHONES بوت‌استرپ می‌کند — بدون API راه‌اندازی |
| گارد زنده به‌جای کش | انسداد باید «همان لحظه» اثر کند؛ یک findUnique روی PK در هر درخواست ارزان است — بهینه‌سازی کش TTL در بار بالا مستند شد |
| مسدودی دوجانبه در DM | یک‌طرفه بودن، ارسال معکوس را در گل می‌گذارد؛ دوجانبه‌سازی در سطح ساده‌تر و قابل فهم‌تر است |
| گزارش idempotent (یک باز به ازای هر جفت) | جلوگیری از شلوغی صف و سوءاستفاده از گزارش |
| `account.blocked` به‌عنوان رویداد WS + kick | کلاینت‌ها پیام شفاف می‌گیرند و بلافاصله به صفحهٔ ورود می‌روند |
| fallback منطقی Node برای بکاپ | pg_dump همیشه در دسترس نیست (همان‌طور که در محیط آزمون)؛ تمرین بازیابی نباید به ابزار وابسته بماند |

## ۳) قرارداد API (جدید)

```
POST   /users/:id/report        {reason: spam|abuse|impersonation|other, note?} → {report, duplicate}
POST   /users/:id/block         → 204   DELETE /users/:id/block → 204
GET    /users/me/blocks         → {items}
GET    /admin/users?q=&page=&pageSize=&blocked= → AdminUserPage   (ادمین)
POST   /admin/users/:id/block   {reason?} → AdminUserDto (blockedAt)
POST   /admin/users/:id/unblock → AdminUserDto
GET    /admin/reports?status=&page= → ReportPage
POST   /admin/reports/:id/handle {action: resolve|dismiss, note?} → ReportDto
GET    /admin/metrics → AdminMetrics (شامل onlineNow از gateway)
GET    /admin/audit?limit= → {items}
WS     account.blocked → قطع socket
```

خطاها: `ACCOUNT_BLOCKED`، `USER_BLOCKED`، `ADMIN_ONLY`، `CANNOT_BLOCK_ADMIN`، `CANNOT_BLOCK_SELF`، `CANNOT_REPORT_SELF`، `REPORT_HANDLED`، `NOT_BLOCKED`.

## ۴) کلاینت‌ها

- **دسکتاپ:** دکمهٔ «مدیریت» در نوار گفتگوها (فقط ادمین) → صحنهٔ پنل با ۴ تب (متریک‌ها/کاربران/گزارش‌ها/دفتر)؛ دکمهٔ `⋯` در چت خصوصی → مسدودسازی/رفع + مودال گزارش؛ خطای USER_BLOCKED فارسی؛ رویداد account.blocked → خروج با پیام
- **موبایل:** دکمهٔ `⋯` در هدر چت خصوصی → ActionSheet (مسدودسازی/گزارش)؛ مودال گزارش با چیپ دلیل + توضیح؛ بنر «مسدود کرده‌اید» با دکمهٔ رفع مسدودی بالای composer؛ رویداد account.blocked → پاک‌کردن نشست و رفتن به صفحهٔ ورود

## ۵) سخت‌سازی و عملیات

- سرآیندهای امنیتی در main.ts (بدون وابستگی helmet): nosniff، DENY، no-referrer، حذف X-Powered-By؛ CORS پروداکشن با `DEL_CORS_ORIGINS`
- سقف جدید `OTP_PER_IP_LIMIT` (پیش‌فرض ۲۰/۱۰ دقیقه) — در تست بار محیط آزمون بالا تنظیم می‌شود
- `scripts/load/probe.js` (p95 کامل ارسال→نمایش: ۴۷/۹۲/۱۰۳ms با ۱۲ جفت) و `scripts/load/k6-messages.js` (آستانهٔ سخت p95<300ms)
- `scripts/backup/` — backup.sh/restore.sh (pg_dump) + dump-node.js (منطقی)؛ تمرین واقعی: ۷۳ کاربر/۱۹۲ پیام/۲۵ گفتگو → بازیابی کامل در پایگاه تازه، تعدادها برابر
- سند ۰۹ (حریم خصوصی) و سند ۱۰ (انتشار/چک‌لیست) اضافه شد؛ سندهای ۰۴/۰۵/۰۷ به‌روز شدند

## ۶) نتایج تست دود گام ۱۰ — ۴۴ بررسی

نقش‌ها و ورود ادمین (ADMIN_PHONES) · 403 ADMIN_ONLY برای کاربر عادی · جست‌وجوی کاربران · گزارش + idempotency + CANNOT_REPORT_SELF · صف و رسیدگی + REPORT_HANDLED · مسدودی کاربر: idempotent، DM تازه و موجود دوطرفه 403، رفع مسدودی آزاد می‌کند، گروه مستقل · مسدودی ادمین: WS kick، API زنده 403، ورود/refresh رد · حفاظ ادمین (خودمسدودی/مسدودسازی ادمین دیگر) · unblock و ورود مجدد · متریک‌ها (blocked=0، open=0، onlineNow) · audit (block/unblock/resolve با meta.reason) · سرآیندهای امنیتی ۴گانه
