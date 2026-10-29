# گام ۵ — رسانه (Presigned Upload/Download با S3/MinIO)

> سند پیاده‌سازی — مکمل docs/05-api-design.md §۵ و docs/02-architecture.md §3.6
> وضعیت: اجرا و تست دود شد — `scripts/smoke-step5.js` (۳۲/۳۲ سبز) + رگرسیون کامل گام‌های ۱ تا ۴

## ۱. اصل معماری

**بایت‌های رسانه هرگز از API عبور نمی‌کنند.** API فقط تصمیم می‌گیرد و امضا می‌کند:

```
کلاینت ──۱. POST /media/presign──▶ API (اعتبارسنجی + ردیف MediaAsset وضعیت pending)
کلاینت ◀──۲. PUT URL امضاشده───  API
کلاینت ──۳. PUT بایت‌ها ────────────────────────────────▶ S3/MinIO (مستقیم)
کلاینت ──۴. POST /media/complete─▶ API (magic bytes + اندازه + thumbnail)
کلاینت ◀──۵. رویداد WS media.ready به اتاق مکالمه
کلاینت ──۶. GET /media/:id/url ──▶ API (بررسی عضویت) ──▶ URL امضاشده ۵ دقیقه‌ای
کلاینت ──۷. GET bytes ─────────────────────────────────▶ S3/MinIO (مستقیم)
```

فایده: سرور باری از بایت‌ها تحمل نمی‌کند؛ مقیاس رسانه مستقل از مقیاس API رشد می‌کند؛ هیچ bucket عمومی وجود ندارد.

## ۲. مدل داده — مهاجرت `media_assets`

- جدول `MediaAsset`: `ownerId`، `conversationId`، `kind` (image/video/audio/file)، `mime`، `size`، `originalName`، `width/height`، `status` (**pending → ready | rejected**)، `storageKey` (یگانه)، `uploadId` (فقط multipart — در DB تا complete/abort از هر نمونه‌ای از API کار کند)، `thumbKey`، `error`، `readyAt`
- `Message.mediaId` اختیاری + رابطه — پیام رسانه‌ای `type` خودش را از asset می‌گیرد (`image` و…)
- حذف آبجکت نامعتبر در reject (AbortMultipartUpload + DeleteObject) — محتوای خراب هرگز ready نمی‌شود

## ۳. قواعد سمت سرور

| قاعده | مقدار | خطا |
|---|---|---|
| whitelist نوع | jpeg/png/gif/webp · mp4/mov/webm · mp3/m4a/ogg/wav · pdf/zip/office/txt | `MIME_NOT_ALLOWED` 400 |
| سقف تصویر | ۲۵MB (`MEDIA_MAX_IMAGE_MB`) | `MEDIA_TOO_LARGE` 413 |
| سقف ویدیو/صوت/فایل | ۱GB (`MEDIA_MAX_FILE_MB`) | `MEDIA_TOO_LARGE` 413 |
| آستانه multipart | >۱۰MB (`MEDIA_MULTIPART_THRESHOLD_MB`) — پارت ۸MB، حداکثر ۱۰۰۰۰ پارت | — |
| magic bytes | ۲۶ بایت اول؛ تشخیص JPEG/PNG/GIF/WEBP/ftyp/EBML/PDF/ID3/OggS/WAVE/PK | `MAGIC_MISMATCH` 400 |
| سازگاری خانواده | mp4↔mov، webm↔audio/webm | `MAGIC_MISMATCH` 400 |
| اندازه واقعی = ادعاشده | HeadObject بعد از آپلود | `MEDIA_SIZE_MISMATCH` 400 |
| عضویت مکالمه | presign/url/meta فقط برای اعضا | `NOT_A_PARTICIPANT` 403 |
| مالکیت | complete و ارسال پیام فقط برای آپلودکننده | `MEDIA_FORBIDDEN`/`MEDIA_NOT_OWNED` 403 |
| پیوست به مکالمه دیگر | asset به مکالمه presign قفل است | `MEDIA_WRONG_CONVERSATION` 400 |
| پیوست asset غیر ready | وضعیت pending/rejected قابل ارسال نیست | `MEDIA_NOT_READY` 400 |
| storage تنظیم نشده | بدون S3_* سرویس بالا می‌آید ولی رسانه 503 می‌دهد | `MEDIA_NOT_CONFIGURED` |

## ۴. بندانگشتی (thumbnail)

تصاویر با **sharp** به حداکثر ۷۶۸px JPEG کیفیت ۸۰ تبدیل و در `thumbKey` ذخیره می‌شود؛ ابعاد واقعی تصویر هم از metadata پر می‌شود. sharp وابستگی اختیاری در عمل است — اگر نبود، آپلود همچنان ready می‌شود فقط `hasThumb=false`. دانلود با `GET /media/:id/url?variant=thumb`.

## ۵. پیام رسانه‌ای

- `POST /conversations/:id/messages` با `mediaId` + کپشن اختیاری (`body`) — بدون body و mediaId خطای `EMPTY_MESSAGE`
- WS `message.send` همین قابلیت را دارد (بدون echo تفاوت)
- `MessageDto.media` در همه مسیرها (تاریخچه، since-sync، message.new) همراه پیام می‌آید — بدون URL؛ کلاینت به‌صورت تنبل `GET /media/:id/url` می‌گیرد و کش می‌کند (URLها ۵ دقیقه‌عمرند)
- رویداد `media.ready` به اتاق مکالمه — اعضا می‌دانند آپلود تأیید شده

## ۶. کلاینت‌ها

- **موبایل (Expo):** `src/media.ts` — آپلود با presign→PUT→complete؛ پشتیبانی multipart (بخش‌بخش)؛ کش URL با انقضا. صفحه چت: دکمه 📎 + expo-image-picker (تصویر/ویدیو)، حباب آپلود موقت، `<Image>` با نسبت واقعی، ردیف پیوست برای ویدیو/فایل با «باز کردن» (Linking)
- **دسکتاپ (Electron):** دکمه 📎 + file input؛ همان جریان آپلود (File.slice برای پارت‌ها)؛ تصویر درون‌خطی؛ ردیف پیوست با window.open؛ CSP اضافه شد `img-src http: https:`

## ۷. زیرساخت

- `docker-compose.dev.yml` از قبل MinIO داشت (del_minio / del_dev_minio_password، bucket del-media با minio-init)
- `docker-compose.prod.yml`: سرویس minio (بدون profile) + minio-init + متغیرهای S3_* به سرویس api اضافه شد
- تست دود در سندباکس با **s3rver** (سازگار S3) روی :9000 — کلیدهای تست: delminio/delminio-secret

## ۸. تست دود — `scripts/smoke-step5.js` (۳۲ سناریو)

۱) ورود و مکالمه‌ها · ۲) اعتبارسنجی presign (mime/سقف/عضویت) · ۳) آپلود single PNG + بندانگشتی + WS media.ready + idempotent complete · ۴) متادیتا/دانلود یکسان بایت‌به‌بایت/دسترسی عضو و غیرعضو/variant=thumb · ۵) امنیت magic bytes و اندازه (رد + پاکسازی) · ۶) قواعد پیوست (rejected/foreign/wrong-conversation) · ۷) پیام رسانه‌ای + تحویل بلادرنگ + duplicate + since-sync · ۸) multipart دو پارتی PDF با etag · ۹) ویدیو mp4 (ftyp) + رگرسیون متن + BAD_PAYLOAD

**نکته شناخته‌شده (v1):** آپلود multipart در موبایل فعلاً فایل را در حافظه می‌خواند (`blob.arrayBuffer`)؛ آپلود استریمی با expo-file-system برای فایل‌های بسیار بزرگ در گام‌های بعد جایگزین می‌شود. دسکتاپ استریم واقعی دارد (File.slice بدون خواندن کامل).
