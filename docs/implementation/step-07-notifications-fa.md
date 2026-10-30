# سند پیاده‌سازی — گام ۷: اعلان‌ها و همگام‌سازی کامل چنددستگاهی

> **نسخه:** 1.0 · **وضعیت:** اجرا و تست دود شد (۲۵/۲۵ سبز + رگرسیون ۱۴۷ سناریوی گام‌های ۱ تا ۶ — مجموع ۱۷۲)

## ۱) اصل معماری

**سرور تصمیم می‌گیرد، کلاینت نمایش می‌دهد.** اعلان یک محصول سمت‌سرور است: سرور می‌داند چه کسی چه چیزی را از دست داده؛ کلاینت‌ها فقط ثبت‌نام می‌کنند و نمایش می‌دهند. سه اصل:

1. **push فقط برای گیرنده بی‌socket** — اگر کاربر اتصال زنده WS دارد، اعلان بلادرنگ خودش می‌رسد و push زائد/سردرگم‌کننده است. ملاک «socket زنده» است (`MessagesGateway.isUserOnline` — درون‌حافظه‌ای و بی‌درنگ)، نه presence با TTL که تا ۷۵ ثانیه در اشتباه می‌ماند
2. **provider abstraction** — سرور با سه provider کار می‌کند: **webhook** (تست خودکار/یکپارچه‌سازی)، **Expo Push** (پروداکشن iOS/Android)، **console** (توسعه). انتخاب در زمان ارسال و بدون پیکربندی سخت انجام می‌شود
3. **شکست اعلان ≠ شکست پیام** — هر خطای provider بی‌صدا catch می‌شود؛ تحویل پیام هیچ‌وقت به سلامت اعلان وابسته نیست

```
فرستنده A                    API دل                                  گیرنده B
   │ POST /messages ──▶ message.created                                      │
   │                    ├─ WS: message.new → conv:{id}  ───────────────────▶ │ socket زنده؟ اعلان بلادرنگ
   │                    └─ NotificationsService:                            │
   │                         برای هر گیرنده بدون socket زنده:               │
   │                         ├─ PUSH_WEBHOOK_URL → POST payload (تست)        │
   │                         └─ ExpoPushToken[...] → exp.host ── APNs/FCM ──▶ │ اپ بسته
   │                              └─ DeviceNotRegistered → پاک‌سازی توکن       │
```

## ۲) مدل داده

- **دستگاه‌ها:** از گام ۱ جدول `devices` با ستون `push_token` وجود داشت — در این گام مصرف شد. توکن با `POST /devices/push-token` روی دستگاهی که در JWT نشسته (`did`) ثبت می‌شود؛ یک کاربر می‌تواند چند دستگاه/توکن داشته باشد
- **مهاجرت `sync_cursors`:** ستون `updated_at` (with `@updatedAt` و DEFAULT) روی `conversations` و `participants` + دو اندکس — مبنای همگام‌سازی افزایشی زمانی. داده‌های موجود با `lastMessageAt`/`joinedAt` بک‌فیل شدند
- هیچ توکنی در هیچ پاسخ API، لاگ یا رویدادی برنمی‌گردد — فقط `pushRegistered: boolean`

## ۳) REST API جدید

| مسیر | توضیح | خطاها |
|---|---|---|
| `GET /devices` | فهرست دستگاه‌های من (`DeviceDto[]`) | — |
| `POST /devices/push-token` | ثبت/به‌روزرسانی توکن این دستگاه `{ token: 8..512 }` → `{ deviceId, registered }` | 401 · نشست بدون device → `registered:false` |
| `DELETE /devices/push-token` | حذف توکن این دستگاه (خروج) → `{ deviceId, registered:false }` | 401 |
| `GET /sync/bootstrap` | پروفایل من + همه مکالمه‌ها (peer/اعضا/unread/پیش‌نمایش/lastSeq) + `serverTime` → `SyncBootstrap` | 401 |
| `GET /sync/updates?since=<ISO>` | فقط مکالمه‌های تغییریافته پس از cursor: تغییر خود مکالمه، هر عضو، یا ردیف عضویت من → `SyncUpdates` | 400 since نامعتبر · 401 |

نکات sync:
- cursor زمانی (ISO 8601) است — کلاینت همیشه `serverTime` پاسخ قبلی را نگه می‌دارد
- پیام‌های جدید داخل هر مکالمه با همان همگام‌سازی گام ۳ گرفته می‌شوند (`?since=<seq>`) — این endpoint فقط «کدام مکالمه‌ها» را می‌گوید
- حذف مکالمه (خروج/اخراج در دستگاه دیگر) با مقایسه لیست محلی با پاسخ updates کشف می‌شود (`removedConversationIds` برای سازگاری آینده)

## ۴) موتور اعلان — ماژول `notifications`

`NotificationsService` به دو رویداد داخلی گوش می‌دهد:

| رویداد | رفتار |
|---|---|
| `message.created` | برای هر عضو غیرفرستنده: عنوان (نام فرستنده یا «نام در گروه»)، بدنه (متن یا برچسب فارسی رسانه `🖼 تصویر` و…)، `data.conversationId` |
| `call.incoming` | push به گیرنده اگر socket ندارد — `kind:'call'` با `callId` |

خط لوله `dispatchToUser`: گیرنده آفلاین؟ → دستگاه‌های دارای توکن → webhook (اگر تنظیم) + Expo (توکن‌های Expo) → پاک‌سازی `DeviceNotRegistered`.

پیکربندی (`configuration.ts`): `pushWebhookUrl` (اختیاری)، `pushExpoEnabled` (پیش‌فرض true). ارسال Expo در چانک‌های ۱۰۰تایی و مطابق spec سرویس Expo Push.

## ۵) کلاینت‌ها

**دسکتاپ (Electron):**
- `preload.js` — پل امن `window.delDesktop` با contextBridge: `setBadge` / `notify` / `onNotifyClick` (sandbox + contextIsolation دست‌نخورده)
- main: `Notification` بومی + `app.setBadgeCount`؛ تپ اعلان → فوکوس پنجره + ارسال `del:notify-click` به رندرر → باز شدن همان گفتگو (از کش لیست)
- قاعده نمایش: فقط وقتی `document.hasFocus() === false`
- خروج → `DELETE /devices/push-token` + صفر کردن badge

**موبایل (Expo):**
- `src/notifications.ts` — handler اعلان (همیشه نمایش)، کانال‌های اندروید `messages`/`calls` با importance بالا، مجوز، توکن Expo (فقط با `extra.eas.projectId` و روی دستگاه واقعی)، اعلان محلی، گوش‌دهی تپ
- `App.tsx` — کش گفتگوها از `/sync/bootstrap` (برای عنوان اعلان و ناوبری تپ)؛ روی `message.new` اگر اپ در پس‌زمینه (`AppState !== 'active'`) و کاربر در همان چت نیست → اعلان محلی؛ تماس ورودی پس‌زمینه → اعلان محلی؛ ثبت توکن بعد از ورود؛ خروج → حذف توکن
- اعلان محلی به هیچ سرویس بیرونی وابسته نیست و در Expo Go هم کار می‌کند — push واقعی فقط برای اپ بسته لازم است

## ۶) تست دود — `scripts/smoke-step7.js` (۲۵ سناریو)

خود کؤک: سرور webhook ضبط‌کننده روی `:3997` + نمونه API موقت روی `:3001` با `PUSH_WEBHOOK_URL` و `PUSH_EXPO_ENABLED=false`.

- **A) توکن:** ۴۰۱ بدون auth؛ ثبت موفق با deviceId درست؛ دستگاه دوم؛ `GET /devices` با `pushRegistered:true` و بدون افشای خودِ توکن
- **B) پیام آفلاین:** پیام → webhook payload کامل (kind/title=شماره فرستنده/body/data.conversationId/tokens×۲)؛ پیام دوم → دو اعلان
- **C) مهار آنلاین:** اتصال WS گیرنده → پیام → هیچ push جدید
- **D) تماس آفلاین:** `POST /calls` → push `kind:'call'` با `callId`
- **E) sync:** bootstrap (کاربر + مکالمه + unread درست + peer)؛ updates پس از پیام (lastSeq و unread)؛ updates پس از خواندن (unread=۰)؛ cursor آینده → خالی؛ since خراب → 400
- **F) چنددستگاهی:** دو socket هم‌زمان → هر دو `message.new`؛ خواندن با REST → هر دو `message.read` (badge sync)؛ تأیید unread=۰ با updates
- **G) گروه:** گروه تازه در updates؛ پیام گروه → اعلان با عنوان گروه
- **H) حذف توکن:** `pushRegistered:false`

## ۷) محدودیت‌های اعلام‌شده (شفافیت)

- push واقعی iOS/Android در Expo Go اندروید از SDK 53 کار نمی‌کند — برای اپ بسته، بیلد توسعه/پروداکشن با `projectId` لازم است (اعلان محلی و دسکتاپ بدون این هم کامل است)
- APNs/FCM کلیدهای سروری لازم ندارند (زیر سرویس Expo)، اما تنظیمات CallKit/ConnectionService برای اعلان تماس بومی سیستم‌عامل به گام سخت‌سازی موکول است
- همگام‌سازی increases بر پایه زمان است؛ برای دقت بالاتر در گام سخت‌سازی می‌توان به cursor هیبریدی (زمان + seq) مهاجرت کرد
