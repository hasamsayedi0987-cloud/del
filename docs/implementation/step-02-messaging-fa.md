# گام ۲ — پیام‌رسانی بلادرنگ (Real-time Messaging)

> وضعیت: **اجرا و تست‌شده** — تاریخ: ۱۴۰۴/۰۸/۰۷ (2026-10-29)
> تست دود: ۱۸/۱۸ سبز (`scripts/smoke-step2.js`) + رگرسیون گام ۱ سبز

## ۱. اهداف گام

- چرخه کامل پیام: ساخت مکالمه ← ارسال ← تحویل بلادرنگ ← خواندن ← تاریخچه
- تحویل idempotent با `client_msg_id` (قرارداد سند ۰۴/۰۵) — هیچ پیامی تکراری یا گم نمی‌شود
- WebSocket به‌عنوان شتاب‌دهنده + REST با cursor به‌عنوان پشتوانه همیشگی

## ۲. مدل داده (Prisma migration `messaging`)

| جدول | نقش |
|---|---|
| `Conversation` | `type` (direct فعلاً)، `lastSeq` شمارنده اتمic، `lastMessageAt` |
| `Participant` | عضویت + `lastReadSeq` برای unreadCount؛ یگانه (conversationId, userId) |
| `Message` | `serverSeq` یگانه در مکالمه، `clientMsgId` یگانه در مکالمه (idempotency)، body تا ۴۰۰۰ کاراکتر |

## ۳. API (همه با JWT)

| Endpoint | شرح |
|---|---|
| `POST /conversations` | گفتگوی مستقیم دو‌نفره — idempotent (مکالمه تکراری ساخته نمی‌شود) |
| `GET /conversations` | لیست مکالمه‌ها با peer، پیش‌نمایش آخرین پیام و `unreadCount` |
| `GET /conversations/:id` | جزئیات یک مکالمه |
| `GET /conversations/:id/messages?before=&limit=` | تاریخچه با cursor (`hasMore` + `nextBefore`) |
| `POST /conversations/:id/messages` | ارسال idempotent — تکرار همان clientMsgId پیام موجود را با `duplicate:true` می‌دهد |
| `POST /conversations/:id/read` | علامت‌گذاری خواندن تا `lastReadSeq` |
| `GET /users/by-phone/:phone` | یافتن کاربر برای شروع گفتگو (فقط id/name/phone) |

نکته امنیتی: هر endpoint عضویت را بررسی می‌کند؛ غیرعضو ۴۰۳ می‌گیرد (وجود مکالمه لو نمی‌رود).

## ۴. WebSocket (Socket.IO، پیش‌فرض `/socket.io`)

- **Handshake:** `io(URL, { auth: { token: <accessToken> } })` — توکن نامعتبر فوراً قطع می‌شود
- **اتاق‌ها:** هر اتصال هنگام connect به اتاق همه مکالمه‌های کاربر (`conv:{id}`) join می‌شود
- **کلاینت → سرور:** `message.send` `{conversationId, clientMsgId, body}` با ack `{ok, message, duplicate}`
- **سرور → کلاینت:** `message.new` و `conversation.updated` (broadcast به همه اعضا شامل فرستنده؛ کلاینت با clientMsgId dedupe می‌کند)
- گسترش چندنودی با Redis adapter از گام عملیاتی (فعلاً تک‌نود)

## ۵. تخصیص serverSeq

`serverSeq` با `UPDATE Conversation SET lastSeq = lastSeq+1 RETURNING` در یک تراکنش تخصیص می‌یابد — قفل سطری تضمین می‌کند دو پیام موازی هرگز seq تکراری نگیرند.

## ۶. کلاینت‌ها

- **موبایل:** `ChatsScreen` (لیست با نشان نخوانده + گفتگوی جدید با شماره) و `ChatScreen` (حباب‌های RTL، ارسال خوش‌بینانه با وضعیت «در حال ارسال/نشد»، اتصال WS با fallback خودکار به REST، «بارگذاری قدیمی‌تر» با cursor)
- **دسکتاپ:** همان جریان در Electron (socket.io client به‌صورت فایل محلی vendor شده تا CSP نقض نشود) + نشانگر وضعیت اتصال بلادرنگ

## ۷. نتایج تست دود (۱۸/۱۸)

ورود دو کاربر · جستجوی شماره · مکالمه یکتا · اتصال WS · ارسال WS با ack · دریافت بلادرنگ B · echo فرستنده · seq=1 · ارسال تکراری duplicate=true بدون broadcast اضافه · REST 201 · دریافت بلادرنگ مسیر REST · صفحه‌بندی ۲ صفحه بدون همپوشانی صعودی · unreadCount ۷→۰ · ۴۰۳ غیرعضو · قطع WS با توکن نامعتبر.

## ۸. محدودیت‌های شناخته‌شده

- گروه‌ها (group) هنوز نیست — گام ۳
- typing/presence و receipt خواندن بصری نیست — گام ۳
- ویرایش/حذف پیام در UI نیست (فیلدها در دیتابیس آماده‌اند) — گام بعدی
- آفلاین صف کامل (sync با since_seq) در گام ۳ تکمیل می‌شود

## ۹. معیار پذیرش گام بعدی (گام ۳ — حضور و تایپینگ)

- presence بلادرنگ (online/lastSeen) با Redis TTL heartbeat
- رویداد typing با throttle سمت کلاینت
- receipt خواندن بلادرنگ (`message.read`) در چت
- همگام‌سازی آفلاین: `GET messages?since=<seq>`
