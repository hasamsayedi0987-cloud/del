# سند پیاده‌سازی — گام ۶: تماس صوتی/تصویری ۱:۱

> **نسخه:** 1.0 · **وضعیت:** اجرا و تست دود شد (۴۴/۴۴ سبز + رگرسیون ۱۰۳ سناریوی گام‌های ۱ تا ۵)

## ۱) اصل معماری

**بایت‌های صدا و تصویر هرگز از API عبور نمی‌کنند.** API فقط سه کار می‌کند:

1. **Signaling** — چرخه عمر تماس (زنگ/پاسخ/رد/لغو/پایان) روی WebSocket خودِ دل (Socket.IO) بین دو طرف هماهنگ می‌شود
2. **صدور مجوز** — با پذیرش تماس، برای هر طرف یک **توکن LiveKit (JWT)** با `room = call:{callId}` صادر می‌شود
3. **مدیریت وضعیت** — تماس‌ها در جدول `calls` ثبت و در تاریخچه قابل مرورند؛ زنگ بی‌پاسخ خودکار «missed» می‌شود

```
A (تماس‌گیرنده)                API دل                     B (گیرنده)
   │  POST /calls ────────────▶ │                            │
   │                            │ ── call.incoming (WS) ───▶ │  زنگ می‌خورد
   │                            │                            │
   │                            │ ◀──── POST /:id/accept ────│
   │ ◀─ call.accepted + token ──│ ── call.accepted + token ─▶│
   │                            │                            │
   │ ══════════ صدا/تصویر مستقیم از LiveKit (SFU) ══════════ │
   │            room = call:{callId}  (SFU انتخابی)           │
   │                            │                            │
   │  POST /:id/end ──────────▶ │ ── call.ended (WS) ──────▶ │
```

LiveKit یک **SFU** است: مدیا از هر کلاینت به سرور LiveKit و از آنجا به مشترکین می‌رود — نیازی به WebRTC P2P و TURN پیچیده نیست و کیفیت روی شبکه‌های ضعیف بهتر حفظ می‌شود.

## ۲) مدل داده

جدول `calls` (مهاجرت `call_sessions`):

| ستون | توضیح |
|---|---|
| `conversation_id` | گفتگوی ۱:۱ مبدأ |
| `caller_id` / `callee_id` | دو طرف |
| `kind` | `audio` \| `video` |
| `status` | `ringing` → `active` → `ended` \| `rejected` \| `cancelled` \| `missed` |
| `end_reason` | `hangup` \| `reject` \| `cancel` \| `timeout` |
| `started_at` | لحظه شروع زنگ |
| `connected_at` | لحظه برقراری (پاسخ گیرنده) |
| `ended_at` / `duration_s` | پایان و طول گفت‌وگوی مؤثر |

اندیس‌ها: `(conversation_id, created_at)` برای تاریخچه، `(callee_id, status)` و `(caller_id, status)` برای بررسی سریع مشغولی.

## ۳) REST API

| مسیر | توضیح | خطاها |
|---|---|---|
| `POST /calls` | شروع تماس `{ conversationId, kind: audio\|video }` → `CallDto` (ringing) | `CALLS_DISABLED` 503 · `CONVERSATION_NOT_FOUND` 404 · `NOT_A_PARTICIPANT` 403 · `NOT_DIRECT` 409 · `CALL_BUSY` 409 |
| `POST /calls/:id/accept` | پذیرش — فقط گیرنده، فقط در ringing → `CallJoinInfo { call, url, token, room }` | `NOT_CALLEE` 403 · `INVALID_STATE` 409 |
| `POST /calls/:id/reject` | رد — فقط گیرنده (204) | `NOT_CALLEE` 403 · `INVALID_STATE` 409 |
| `POST /calls/:id/cancel` | لغو پیش از پاسخ — فقط تماس‌گیرنده (204) | `NOT_CALLER` 403 · `INVALID_STATE` 409 |
| `POST /calls/:id/end` | پایان — هر طرف (200) | `NOT_CALL_PARTICIPANT` 403 · `INVALID_STATE` 409 |
| `GET /calls?conversationId=&before=&limit=` | تاریخچه فقط تماس‌های خود کاربر، تازه→قدیم، cursor تاریخ | — |

**قانون مشغولی:** اگر هر یک از دو طرف تماس باز (`ringing`/`active`) داشته باشد، تماس تازه با `409 CALL_BUSY` رد می‌شود.

**قانون گروه:** فعلاً تماس فقط در گفتگوهای `direct` ممکن است (`409 NOT_DIRECT`) — تماس گروهی در گام‌های بعد.

## ۴) WebSocket

رویدادها روی **اتاق شخصی کاربر** (`user:{id}`) می‌روند تا همه دستگاه‌های یک کاربر زنگ را بشنوند (multi-device):

| رویداد | گیرنده | محتوا |
|---|---|---|
| `call.incoming` | گیرنده | `{ call, caller: { id, displayName, phone } }` |
| `call.accepted` | هر دو | `{ call, url, token, room }` — **توکن هر طرف مخصوص خودش** |
| `call.ended` | هر دو | `{ callId, conversationId, reason, by, durationS }` |

**Timeout زنگ:** پس از `CALL_RING_TIMEOUT_SEC` (پیش‌فرض ۴۵ ثانیه) اگر پاسخی نیاید، سرور تماس را `missed` و برای هر دو طرف `call.ended` با `reason=timeout` می‌فرستد. تایمرها در حافظه‌اند و در ری‌استارت، زنگ‌های یتیم با `sweepStaleRinging()` بسته می‌شوند.

## ۵) توکن LiveKit

JWT HS256 با کلید `LIVEKIT_API_SECRET` (صادرشده با همان `jsonwebtoken`، بدون وابستگی جدید):

```json
{
  "iss": "<LIVEKIT_API_KEY>",
  "sub": "<userId>",
  "name": "<displayName>",
  "video": {
    "room": "call:<callId>",
    "roomJoin": true,
    "canPublish": true, "canSubscribe": true, "canPublishData": true
  },
  "nbf": "now-10s", "exp": "now+3600s"
}
```

هر تماس اتاق مستقل خودش را دارد؛ توکن فقط برای همان اتاق و همان هویت معتبر است (تست دود: امضا، ادعاهای spec، عمر ~۱ ساعت و تفاوت توکن دو طرف تأیید می‌شود).

## ۶) کلاینت‌ها

**موبایل (Expo):** `@livekit/react-native` + `@livekit/react-native-webrtc` + `livekit-client`؛ پلاگین `@livekit/react-native` در `app.json` مجوزهای میکروفون/دوربین را به prebuild اضافه می‌کند. `registerGlobals()` در ابتدای `App.tsx`. در **Expo Go** ماژول نیتیو نیست — بارگذارِ امن (`src/lk.ts`) آن را در `try` می‌گیرد تا اپ سالم بماند و تماس با پیام شفاف رد شود؛ برای تماس باید **بیلد توسعه** (`pnpm --filter @del/mobile android`) نصب شود. رابط تماس (`CallScreen.tsx`): زنگ ورودی (پذیرش/رد)، خروجی (لغو)، در تماس (بی‌صدا/دوربین/قطع)، ویدیوی دورین تمام‌صفحه + PIP خودم.

**دسکتاپ (Electron):** `livekit-client` به‌صورت UMD در `vendor/`؛ دکمه‌های 📞 / 🎥 در هدر چت‌های ۱:۱، لایه تماس تمام‌صفحه با همان کنترل‌ها + **اشتراک صفحه** (`getDisplayMedia` با `setDisplayMediaRequestHandler` در main). صدا/تصویر دورین با `trackSubscribed` به `<audio>`/`<video>` وصل می‌شود.

## ۷) متغیرهای محیطی

```env
LIVEKIT_URL=ws://localhost:7880        # آدرس WS که به کلاینت‌ها داده می‌شود (پروداکشن: wss://…)
LIVEKIT_API_KEY=devkey
LIVEKIT_API_SECRET=devsecret-0123456789abcdef0123456789abcdef
LIVEKIT_TOKEN_TTL_SEC=3600
CALL_RING_TIMEOUT_SEC=45
```

بدون این مقادیر، API بالا می‌آید و endpointهای تماس `503 CALLS_DISABLED` می‌دهند — الگوی مشابه رسانه در گام ۵.

## ۸) زیرساخت

- **dev:** سرویس `livekit` در `docker-compose.dev.yml` (`livekit/livekit-server --dev`، پورت‌های 7880/7881/7882-udp، کلید `devkey`)
- **prod:** همان سرویس در `docker-compose.prod.yml` با کلید از env؛ برای انتشار عمومی: دامنه + TLS (wss پشت reverse proxy) و در صورت نیاز coturn — در `docs/08-operations.md` بسط داده می‌شود

## ۹) پوشش تست دود (`scripts/smoke-step6.js` — ۴۴ سناریو)

1. قوانین ورودی: 401 بدون توکن · 404 گفتگوی ناموجود · 403 غیرعضو · 409 گروه · 400 kind
2. جریان کامل: 201 ringing → `call.incoming` روی WS گیرنده (بدون echo به تماس‌گیرنده) → busy (تماس مجدد + تماس نفر سوم) → 403 پاسخ توسط غیرگیرنده → 200 active → `call.accepted` برای هر دو با توکن‌های جدا → 409 پاسخ مجدد
3. توکن LiveKit: **تأیید کامل امضای HS256**، iss/sub، `video.roomJoin` و `room=call:{id}`، عمر ~۱ ساعت
4. پایان: 403 شخص ثالث · 200 hangup + `durationS` · `call.ended` روی WS
5. تماس تصویری، مشغولی در تماس فعال، رد (reject)، لغو (cancel)
6. تاریخچه: مرتب‌شده نزولی، صفحه‌بندی cursor، ایزوله‌بودن بین کاربران
7. timeout زنگ (نمونه :3001 با زنگ ۳ ثانیه‌ای) → `missed` + `reason=timeout` برای هر دو طرف
8. نمونه بدون LiveKit (:3002) → `503 CALLS_DISABLED`

## ۱۰) محدودیت‌های شناخته‌شده و گام بعد

- تایمر زنگ در حافظه است (single-instance) — در استقرار چندنمونه باید به Redis منتقل شود (گام ۸)
- متریک‌های کیفیت (RTT/jitter) و تماس گروهی در گام‌های بعد اضافه می‌شوند
- **گام ۷:** اعلان‌ها (push) + همگام‌سازی چنددستگاهی کامل + E2EE چت خصوصی (Signal)
