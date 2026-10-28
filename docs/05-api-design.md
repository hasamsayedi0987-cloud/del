# سند ۰۵ — طراحی API

> **نسخه:** v0.1 · REST نسخه‌دار `/api/v1` + رویدادهای بلادرنگ روی WebSocket. مستند زنده OpenAPI 3.1 از کد تولید می‌شود (`/api/docs` در dev) و در CI با اسناد سنجاق می‌شود.

## ۱. اصول کلی

- **فرمت پاسخ یکسان:** موفقیت → `{ "data": ... }`؛ خطا → `{ "error": { "code", "message", "details" } }` با کدهای پایدار (`VALIDATION_ERROR`, `FORBIDDEN`, `RATE_LIMITED`, `CONFLICT_DUPLICATE`, ...). HTTP status همیشه درست.
- **احراز هویت:** `Authorization: Bearer <access JWT>` با عمر ۱۵ دقیقه؛ refresh token (httpOnly cookie در وب / keystore در موبایل) با چرخش و کشف استفاده مجدد. توکن‌ها شامل `sub`, `sid` (session)، `typ`؛ هیچ PII اضافه در payload.
- **Idempotency:** عملیات‌های حساس هدر `Idempotency-Key` می‌پذیرند؛ پیام‌ها `client_msg_id` (سند ۰۴).
- **نرخ‌محدودی:** بر اساس user+IP در Redis؛ هدرهای `X-RateLimit-*`؛ حدود پیش‌فرض ۱۲۰ درخواست/دقیقه برای API و ۳۰ پیام/دقیقه برای ارسال.
- **اعتبارسنجی:** همه ورودی‌ها با `@del/validation` (Zod) در لایه pipe سرور.

## ۲. Endpoints — Auth و حساب

| متد | مسیر | شرح | مجوز |
|---|---|---|---|
| POST | /auth/register | ثبت‌نام (phone/email + تأیید OTP/کد) | عمومی + rate سخت |
| POST | /auth/verify | تأیید کد و صدور توکن‌ها | عمومی |
| POST | /auth/login | ورود و صدور توکن‌ها | عمومی + lockout |
| POST | /auth/refresh | چرخش refresh token | refresh معتبر |
| POST | /auth/logout | ابطال نشست جاری | auth |
| POST | /auth/logout-all | خروج از همه دستگاه‌ها | auth |
| GET | /auth/me | پروفایل و تنظیمات کاربر جاری | auth |
| PATCH | /users/me | ویرایش نام/نام کاربری/آواتار | auth |
| GET | /users/me/devices | فهرست دستگاه‌ها و نشست‌ها | auth |
| DELETE | /users/me/sessions/:sid | خروج راه‌دور از یک دستگاه | auth (مالک) |
| POST | /users/me/change-phone | تعویض شماره با تأیید دوگانه | auth |
| POST | /users/me/delete-request | درخواست حذف حساب (سیاهه ۳۰ روزه) | auth |

## ۳. Endpoints — مخاطبان، مسدودسازی

| متد | مسیر | شرح |
|---|---|---|
| GET | /contacts | فهرست مخاطبان |
| POST | /contacts | افزودن با username/phone |
| DELETE | /contacts/:id | حذف مخاطب |
| POST | /blocks/:userId | مسدودسازی |
| DELETE | /blocks/:userId | رفع مسدودی |
| GET | /blocks | فهرست مسدودها |

## ۴. Endpoints — گفت‌وگوها و پیام‌ها

| متد | مسیر | شرح |
|---|---|---|
| GET | /conversations | فهرست (با last message، unread count، cursor) |
| POST | /conversations | ایجاد گروه / آغاز خصوصی |
| GET | /conversations/:id | جزئیات + اعضا |
| PATCH | /conversations/:id | ویرایش گروه (مجوز: role/settings) |
| DELETE | /conversations/:id | حذف/خروج مالک |
| GET | /conversations/:id/members | اعضا (صفحه‌بندی) |
| POST | /conversations/:id/members | افزودن عضو (مجوزدار) |
| PATCH | /conversations/:id/members/:uid | تغییر نقش / اخراج |
| DELETE | /conversations/:id/members/me | خروج از گروه |
| POST | /conversations/:id/invites | ساخت لینک دعوت |
| DELETE | /conversations/:id/invites/:code | لغو لینک |
| POST | /invites/:code/join | عضویت با کد |
| PATCH | /conversations/:id/settings-me | mute/notification_mode/pin |
| GET | /conversations/:id/messages | پیام‌ها (cursor: before_seq/after_seq) |
| POST | /conversations/:id/messages | ارسال (client_msg_id اجباری) |
| PATCH | /messages/:id | ویرایش (تا ۴۸ ساعت، نویسنده) |
| DELETE | /messages/:id | حذف (نویسنده/ادمین) |
| GET | /messages/:id/context | پیام‌های اطراف برای پاسخ/نقل‌قول |
| POST | /messages/:id/reactions | واکنش |
| POST | /messages/:id/pin \| unpin | سنجاق |
| POST | /conversations/:id/read | به‌روزرسانی last_read_seq |
| GET | /search/messages | جست‌وجو (q + filter) |

## ۵. Endpoints — رسانه

| متد | مسیر | شرح |
|---|---|---|
| POST | /media/presign | صدور signed-partها برای آپلود مستقیم (kind, size, mime) |
| POST | /media/complete | تأیید و نهایی‌سازی (سرور magic bytes و قواعد را چک می‌کند) |
| GET | /media/:id/url | لینک دانلود امضاشده کوتاه‌عمر (پس از بررسی مجوز) |
| GET | /media/:id | متادیتا + وضعیت thumbnail |

قواعد: تصویر ≤ ۲۵MB، ویدیو/فایل ≤ ۱GB (v1)، انواع مجاز whitelist؛ آپلود multipart با ازسرگیری برای > ۱۰MB.

## ۶. Endpoints — تماس، اعلان، گزارش، AI، مدیریت

| متد | مسیر | شرح |
|---|---|---|
| GET | /calls | تاریخچه تماس‌ها (صفحه‌بندی) |
| POST | /calls/:id/report-quality | گزارش کیفیت از کلاینت (RTT/jitter) |
| POST | /push/tokens | ثبت/به‌روزرسانی توکن پوش |
| DELETE | /push/tokens/:deviceId | حذف توکن |
| PATCH | /notifications/settings | تنظیمات اعلان عمومی |
| POST | /reports | گزارش تخلف (message/user/conversation) |
| POST | /ai/translate \| /ai/rewrite \| /ai/summarize \| /ai/suggest | فراخوانی AI (پس از بررسی رضایت؛ خروجی fallback خطا) |
| GET | /admin/reports · /admin/users · /admin/metrics | پنل مدیریت (نقش admin + audit) |

## ۷. رویدادهای WebSocket

اتصال: `wss://.../ws` با access token در handshake (یا اولین message auth). مسیر هر رویداد: `<domain>.<action>`؛ همه رویدادها شامل `server_seq` یا `updated_at` برای مرتب‌سازی و همگام‌سازی.

| رویداد (سرور→کلاینت) | payload خلاصه |
|---|---|
| message.new | پیام کامل + server_seq |
| message.updated / message.deleted | id، تغییرات/تومبستون |
| message.receipt | message_id, user_id, status(delivered/read) |
| typing | conversation_id, user_id, state |
| presence | user_id, online/offline (با احترام presence_mode) |
| conversation.updated / member.* | تغییرات گفت‌وگو/عضویت |
| call.incoming / call.accepted / call.rejected / call.ended | signaling تماس ۱:۱ (SDP/ICE روی کانال امن) |
| sync.notice | «کرسر شما عقب است → REST /sync بزنید» |

| رویداد (کلاینت→سرور) | شرح |
|---|---|
| message.send | ارسال با client_msg_id (ack با message_id) |
| typing / read | نشانگر و خواندن |
| call.* | answer/decline/end/candidate |
| ping/pong | heartbeat ۳۰ ثانیه |

**قانون تحویل:** پیام‌ها همیشه قابل بازیابی از REST/cursor هستند؛ WS فقط «تسریع‌کننده» است. کلاینت پس از reconnect با `GET /sync` و sync cursor جبران می‌کند — این قرارداد، «پیام گم‌شده» را از نظر معماری ناممکن می‌کند.

## ۸. همگام‌سازی (`GET /sync?cursor=...`)

پاسخ دسته‌بندی‌شده: `messages[]`, `receipts[]`, `reactions[]`, `memberships[]`, `next_cursor`. ترتیب کلید: `(updated_at,id)`. کلاینت در شروع و پس از هر reconnect از آخرین کرسر استفاده می‌کند؛ عملیات تکراری idempotent اعمال می‌شوند.

## ۹. OpenAPI و نسخه‌بندی

- spec از دکوراتورهای NestJS تولید و در `docs/openapi.json` سنجاق می‌شود؛ تغییر شکستن‌دهنده = نسخه جدید مسیر (`/api/v2`) + دوره پشتیبانی دوگانه.
- خطای backward-compatible (فیلد جدید اختیاری) مجاز در v1؛ حذف فیلد ممنوع بدون نسخه جدید.
