# دل (Del) — پیام‌رسان امن چندسکویی

> iOS · Android · Windows · macOS — «دل»، بیش از یک گفت‌وگو (Del — More Than a Chat)
> وضعیت فعلی: **گام ۷ از پیاده‌سازی — اعلان‌ها (push) + همگام‌سازی کامل چنددستگاهی اجرا و تست‌شده** ✅

## این مخزن چیست؟

مخزن رسمی توسعه محصول «دل» است: یک پلتفرم پیام‌رسان واقعی با پیام متنی/رسانه‌ای، گروه‌ها، تماس صوتی و تصویری، اعلان‌ها، همگام‌سازی چنددستگاهی و دستیار هوشمند — با پشتیبانی درجه‌یک از فارسی/RTL و امنیت به‌عنوان بخشی از معماری.

## پیشرفت پیاده‌سازی

| گام | محدوده | وضعیت |
|---|---|---|
| فاز ۱ | نیازمندی‌ها + معماری + ۹ سند طراحی | ✅ کامل (`docs/`) |
| **گام ۱** | **API احراز هویت (OTP) + اپ موبایل + شل دسکتاپ + Docker + CI** | ✅ **اجرا و تست دود شد** |
| **گام ۲** | **پیام‌رسانی بلادرنگ: مکالمه/پیام + WebSocket + idempotency + cursor** | ✅ **اجرا و تست دود شد (۲۱/۲۱)** |
| **گام ۳** | **حضور (online/lastSeen) + تایپینگ + رسید خواندن (✓✓) + همگام‌سازی آفلاین (since)** | ✅ **اجرا و تست دود شد (۱۷/۱۷)** |
| **گام ۴** | **مکالمه‌های گروهی: ساخت گروه، اعضا، نقش ادمین، پیام گروهی بلادرنگ** | ✅ **اجرا و تست دود شد (۲۵/۲۵)** |
| **گام ۵** | **رسانه: آپلود/دانلود Presigned (S3/MinIO)، magic bytes، بندانگشتی، پیام رسانه‌ای بلادرنگ** | ✅ **اجرا و تست دود شد (۳۲/۳۲)** |
| **گام ۶** | **تماس صوتی/تصویری ۱:۱: signaling روی WS، توکن LiveKit، UI تماس کامل، تاریخچه، مشغولی، timeout** | ✅ **اجرا و تست دود شد (۴۴/۴۴)** |
| **گام ۷** | **اعلان‌ها: registry توکن push + providerهای Expo/webhook + اعلان بومی دسکتاپ + اعلان محلی موبایل + sync/bootstrap + sync/updates** | ✅ **اجرا و تست دود شد (۲۵/۲۵)** |
| گام ۸ | رمزنگاری سرتاسری (E2EE) چت خصوصی + بازیابی حساب با کلید بازیابی | ⬜ بعدی |

### آنچه در گام ۱ واقعاً ساخته و تست شده است

- **`apps/api`** — NestJS با ماژول‌های `auth`، `users`، `health`؛ ثبت‌نام/ورود با کد یک‌بارمصرف پیامکی (حالت dev: کد در پاسخ)، JWT کوتاه‌عمر + refresh token چرخشی با **تشخیص سرقت توکن**، محدودساز نرخ OTP (۳ درخواست در ۱۰ دقیقه)، نرمال‌سازی شماره با پشتیبانی ارقام فارسی (۰۹۱۲ → +98912…)، Swagger در `/api/v1/docs`
- **`apps/mobile`** — اپ Expo (اندروید/iOS) با رابط کاملاً فارسی RTL و پالت Crystal Blue؛ ورود دو مرحله‌ای، ذخیره امن توکن در SecureStore، صفحه پروفایل
- **`apps/desktop`** — شل Electron برای ویندوز/مک/لینوکس با همان جریان ورود
- **زیرساخت** — `Dockerfile.api` (تصویر پروداکشن multi-stage) + `infrastructure/docker-compose.prod.yml`
- **CI** — سه workflow: بیلد CI، **ساخت خودکار APK اندروید**، و **ساخت خودکار EXE/DMG/AppImage دسکتاپ** (فعال‌سازی یک‌مرحله‌ای — `ci/README.md`)
- **تست دود ۸ مرحله‌ای** — `scripts/smoke-step1.sh` (ورود کامل تا خروج) — همه سبز

### آنچه در گام ۲ واقعاً ساخته و تست شده است

- **مدل داده:** `Conversation` / `Participant` / `Message` با `server_seq` یگانه (تخصیص اتمیک) و `client_msg_id` یگانه (تحویل idempotent) + مهاجرت Prisma
- **REST:** ساخت مکالمه idempotent، لیست با unreadCount، تاریخچه با cursor، ارسال idempotent، markRead، جستجوی کاربر با شماره
- **WebSocket (Socket.IO):** auth با JWT در handshake، اتاق مکالمه‌ای + اتاق شخصی کاربر، رویدادهای `message.send` / `message.new` / `conversation.updated` / `conversation.join` / `conversation.new` (اطلاع‌رسانی مکالمه تازه به کاربر آنلاین)
- **موبایل:** صفحه گفتگوها (لیست + نشان نخوانده + گفتگوی جدید با شماره) و صفحه چت (حباب RTL، ارسال خوش‌بینانه، fallback REST، صفحه‌بندی قدیمی‌تر)
- **دسکتاپ:** همان جریان چت بلادرنگ در Electron
- **تست دود ۲۱ سناریویی** — `scripts/smoke-step2.js` (دو کاربر واقعی از ورود تا ارسال/دریافت بلادرنگ، امنیت اتاق‌ها و اطلاع‌رسانی مکالمه تازه) — ۲۱/۲۱ سبز

### آنچه در گام ۳ واقعاً ساخته و تست شده است

- **حضور (presence):** کلید Redis با TTL ۷۵ ثانیه + heartbeat هر ۲۵ ثانیه از کلاینت (fallback حافظه‌ای وقتی Redis نیست)؛ اتصال/قطع WS → `online/lastSeen`؛ تغییر حضور به اتاق شخصی همه هم‌مکالمه‌ها broadcast می‌شود؛ `GET /users/:id/presence`
- **تایپینگ:** رویداد `typing` با throttle کلاینت (۲٫۵ ثانیه) + محافظت سرور (۱٫۵ ثانیه)؛ فقط برای اعضای اتاق (عضویت سمت سرور اعتبارسنجی می‌شود)
- **رسید خواندن:** `message.read` بلادرنگ به اتاق مکالمه؛ در چت هر دو کلاینت ✓ (ارسال) و ✓✓ (خوانده‌شد) نمایش می‌دهد؛ نشان نخوانده لیست هم با خواندن در دستگاه دیگر همگام می‌شود
- **همگام‌سازی آفلاین:** `GET /conversations/:id/messages?since=<seq>` (صعودی + nextSince برای ادامه) — بعد از هر reconnect کلاینت پیام‌های از دست رفته را می‌گیرد
- **UI موبایل/دسکتاپ:** وضعیت زیر نام در هدر چت («آنلاین» / «آخرین بازدید ۵ دقیقه پیش» / «در حال نوشتن…»)
- **تست دود ۱۷ سناریویی** — `scripts/smoke-step3.js` — ۱۷/۱۷ سبز (رگرسیون گام‌های ۱ و ۲ هم سبز)

### آنچه در گام ۴ واقعاً ساخته و تست شده است

- **مدل گروه:** `role` (admin/member) روی Participant + مهاجرت `group_roles`؛ سازنده گروه خودکار ادمین می‌شود؛ عنوان ۱ تا ۸۰ کاراکتر
- **REST گروه‌ها:** `POST /conversations/group` · افزودن/حذف عضو · ارتقا/سلب ادمین · خروج (با قانون LAST_ADMIN) · تغییر نام — همه فقط با مجوز ادمین (`NOT_GROUP_ADMIN`)
- **افزودن عضو idempotent:** عضو تکراری ردیف جدید/رویداد جدید نمی‌سازد
- **WS گروه‌ها:** `member.added` به اتاق گروه، `conversation.new` به اتاق شخصی عضو تازه، `member.removed` (با پرچم `left`) — و مهم‌تر: **خروج سمت‌سرور socket عضو حذف‌شده از اتاق** تا هیچ پیامی لو نرود
- **پیام گروهی بدون تغییر کد پیام‌رسانی:** همان lastSeq/serverSeq + clientMsgId + lastReadSeq روی گروه کار می‌کند (تست: پیام بلادرنگ، تایپینگ، رسید خواندن، ۴۰۳ غیرعضو)
- **UI موبایل/دسکتاپ:** دکمه «+ گروه» و مودال ساخت گروه؛ ردیف گروه با «N عضو»؛ هدر چت گروه + نقش شما؛ نام فرستنده بالای حباب‌ها؛ تیک خوانده‌شد گروهی
- **تست دود ۲۵ سناریویی** — `scripts/smoke-step4.js` — ۲۵/۲۵ سبز (رگرسیون گام‌های ۱ تا ۳ هم سبز)

### آنچه در گام ۵ واقعاً ساخته و تست شده است

- **اصل معماری:** بایت‌های رسانه هرگز از API عبور نمی‌کنند — presign → PUT مستقیم به S3/MinIO → complete؛ API فقط مجوز و امضا صادر می‌کند
- **REST رسانه:** `POST /media/presign` (whitelist نوع + سقف ۲۵MB تصویر / ۱GB بقیه) · `POST /media/complete` (اندازه واقعی + **magic bytes** + thumbnail) · `GET /media/:id` · `GET /media/:id/url` (فقط عضو، URL پنج‌دقیقه‌ای، `?variant=thumb`)
- **multipart آپلود** برای فایل‌های >۱۰MB (پارت ۸MB، حداکثر ۱۰۰۰۰ پارت) — uploadId در DB تا complete از هر نمونه API کار کند؛ رد محتوا = Abort + Delete از bucket
- **پیام رسانه‌ای:** `mediaId` در REST/WS send؛ `type=image|video|audio|file`؛ media DTO در تاریخچه/since-sync/`message.new`؛ رویداد `media.ready` به اتاق مکالمه؛ قواعد MEDIA_NOT_OWNED/MEDIA_WRONG_CONVERSATION/MEDIA_NOT_READY
- **بندانگشتی:** sharp — حداکثر ۷۶۸px JPEG q80 برای تصاویر (+ ابعاد واقعی) — اختیاری و بدون شکستن آپلود
- **UI موبایل:** دکمه 📎 + expo-image-picker (عکس/ویدیو)، حباب آپلود، Image درون‌خطی با نسبت واقعی، ردیف پیوست ویدیو/فایل با باز کردن؛ **دسکتاپ:** دکمه 📎 + file input، همان جریان (File.slice برای پارت‌ها)، CSP جدید برای img
- **زیرساخت:** MinIO در dev compose (با bucket خودکار) + minio/minio-init و S3_* در prod compose؛ بدون S3_* آپ سرویس بالا می‌آید ولی رسانه 503 می‌دهد
- **تست دود ۳۲ سناریویی** — `scripts/smoke-step5.js` — ۳۲/۳۲ سبز (رگرسیون گام‌های ۱ تا ۴ هم سبز — ۱۰۳ سناریو در کل)

### آنچه در گام ۶ واقعاً ساخته و تست شده است

- **اصل معماری:** بایت‌های صدا و تصویر هرگز از API عبور نمی‌کنند — API فقط signaling، صدور مجوز و مدیریت وضعیت است؛ مدیا از LiveKit (SFU) می‌گذرد
- **مدل داده:** جدول `calls` (kind، status، end_reason، started_at، connected_at، ended_at، duration_s) + مهاجرت `call_sessions`
- **REST تماس‌ها:** `POST /calls` · accept/reject/cancel/end · تاریخچه با cursor — با قوانین: فقط گفتگوی ۱:۱ (`NOT_DIRECT`)، فقط گیرنده پاسخ می‌دهد (`NOT_CALLEE`)، مشغولی (`CALL_BUSY`)، فقط طرفین پایان می‌دهند
- **WS signaling:** `call.incoming` (به گیرنده) · `call.accepted` (هر دو — **توکن هر طرف مخصوص خودش**) · `call.ended` (هر دو) — روی اتاق شخصی تا همه دستگاه‌ها زنگ را بشنوند
- **timeout زنگ:** ۴۵ ثانیه بی‌پاسخ → `missed` + `reason=timeout`؛ زنگ‌های یتیم پس از ری‌استارت سرور هم بسته می‌شوند
- **توکن LiveKit:** JWT HS256 با `video.roomJoin` و اتاق اختصاصی `call:{callId}`، عمر ~۱ ساعت (در تست دود امضا و ادعاهای spec کامل تأیید می‌شود)
- **UI موبایل:** دکمه‌های 📞/🎥 در چت ۱:۱، صفحه تماس کامل (زنگ ورودی، خروجی، در تماس: میکروفون/دوربین/قطع)، ویدیوی دورین تمام‌صفحه + PIP خودم؛ `@livekit/react-native` + پلاگین مجوزها در app.json (در Expo Go به‌طور امن غیرفعال — بیلد توسعه لازم)
- **UI دسکتاپ:** همان دکمه‌ها و لایه تماس تمام‌صفحه + **اشتراک صفحه** (getDisplayMedia با handler اصلی Electron)
- **زیرساخت:** سرویس `livekit` در dev و prod compose (7880/7881/7882-udp)؛ بدون `LIVEKIT_*` آپ سرویس بالا می‌آید ولی تماس 503 می‌دهد
- **تست دود ۴۴ سناریویی** — `scripts/smoke-step6.js` (شامل تأیید رمزنگاهی توکن، دو نمونه API موقت برای timeout و CALLS_DISABLED) — ۴۴/۴۴ سبز (رگرسیون گام‌های ۱ تا ۵ هم سبز — ۱۴۷ سناریو در کل)

### آنچه در گام ۷ واقعاً ساخته و تست شده است

- **مدیریت دستگاه‌ها و توکن push:** `GET /devices` · `POST /devices/push-token` (ثبت توکن روی دستگاه JWT با `did`) · `DELETE /devices/push-token` — توکن هرگز در پاسخ API/لاگ برنمی‌گردد (فقط وضعیت ثبت)
- **سه provider اعلان:**
  - **webhook** (`PUSH_WEBHOOK_URL`) — کل payload اعلان به URL اختصاصی POST می‌شود (تست خودکار و یکپارچه‌سازی اینفراستراکچر اختصاصی)
  - **Expo Push** (`PUSH_EXPO_ENABLED`، پیش‌فرض روشن) — توکن‌های `ExpoPushToken[…]` به سرویس میزبانی‌شده Expo می‌روند (APNs/FCM زیر آن؛ بدون نیاز به کلید سروری)
  - **console** — حالت توسعه بدون پیکربندی: فقط لاگ
- **قاعده ارسال هوشمند:** push فقط برای کاربرِ بدون socket زنده WS (`gateway.isUserOnline` — دقیق‌تر از presence با TTL)؛ اگر اپ روشن باشد اعلان بلادرنگ خودش می‌رسد. تمایزی بین پیام و تماس نیست: `call.incoming` به گیرنده آفلاین هم push می‌خورد
- **پاک‌سازی توکن مرده:** پاسخ `DeviceNotRegistered` از Expo → توکن خودکار از DB حذف می‌شود (معیار پذیرش نقشه راه)
- **همگام‌سازی کامل چنددستگاهی:** `GET /sync/bootstrap` (دستگاه سوم تازه لاگین: پروفایل + همه مکالمه‌ها با unread و پیش‌نمایش یک‌جا) + `GET /sync/updates?since=<iso>` (فقط مکالمه‌های تغییریافته — پیام/نام/عضویت/خواندن) + ستون‌های `updatedAt` جدید روی Conversation/Participant با مهاجرت `sync_cursors`
- **همگام‌سازی خوانده‌نشده چنددستگاهی:** خواندن در دستگاه اول → `message.read` به اتاق مکالمه و unread صفر در `sync/updates` برای دستگاه دوم (تست با دو socket هم‌زمان)
- **اعلان بومی دسکتاپ:** preload امن با contextBridge (`window.delDesktop`) → اعلان Electron فقط وقتی پنجره فوکوس ندارد + **badge روی آیکون اپ** (مجموع unread) + تپ روی اعلان → فوکوس و بازشدن همان گفتگو؛ اعلان تماس ورودی هم وقتی پنجره جلو نیست
- **اعلان موبایل:** `expo-notifications` + کانال‌های «پیام‌ها/تماس‌ها» اندروید + مجوز POST_NOTIFICATIONS؛ پیام WS در پس‌زمینه → اعلان محلی (بدون نیاز به سرویس بیرونی، در Expo Go کار می‌کند)؛ تماس ورودی پس‌زمینه → اعلان؛ **تپ روی اعلان → ناوبری به همان گفتگو** (با bootstrap)؛ ثبت توکن Expo Push اختیاری — با `extra.eas.projectId` فعال می‌شود و بدون آن اپ عادی کار می‌کند
- **خروج تمیز:** خروج از حساب → حذف توکن push دستگاه (موبایل و دسکتاپ)
- **تست دود ۲۵ سناریویی** — `scripts/smoke-step7.js` (سرور webhook ضبط‌کننده + نمونه API موقت با `PUSH_WEBHOOK_URL`) — ۲۵/۲۵ سبز (رگرسیون گام‌های ۱ تا ۶ هم سبز — **۱۷۲ سناریو در کل**)

## پشته فناوری

| لایه | انتخاب |
|---|---|
| موبایل | React Native 0.81 + Expo SDK 54 + TypeScript |
| دسکتاپ | Electron 33 (الان JS خالص؛ انتقال به React در گام‌های بعدی) |
| بک‌اند | NestJS 10 (Modular Monolith) + Prisma 6 + PostgreSQL 16 + Redis 7 |
| رسانه | Object Storage سازگار S3 (MinIO در dev) — Presigned URL از گام ۵ ✅ |
| تماس | LiveKit (SFU) — signaling روی WS + توکن اختصاصی هر تماس از گام ۶ ✅ |
| اعلان | Expo Push (iOS/Android) + webhook اختصاصی + اعلان بومی Electron — از گام ۷ ✅ |
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
scripts/         smoke-step1.sh تا smoke-step7.js (تست‌های دود)
ci/              سه workflow GitHub Actions (فعال‌سازی: ci/README.md)
```

## قوانین مخزن

- مخزن خصوصی تا انتشار عمومی؛ commitهای Conventional؛ PR اجباری
- هیچ secret واقعی کامیت نمی‌شود (فقط `.env.example`)
- مستندات بخشی از Definition of Done است
- قابلیت ناقص، ناقص اعلام می‌شود — شفافیت روی وضعیت، اصل محصول است
