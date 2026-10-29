# `@del/mobile` — اپلیکیشن موبایل (React Native + Expo)

کلاینت موبایل «دل» برای **iOS** و **Android** با React Native، Expo (dev-client + EAS Build) و TypeScript.

## تصمیم‌های کلیدی

- **Expo SDK پایدار + development builds**: دسترسی به ماژول‌های نیتیو موردنیاز (WebRTC، پوش نوتیفیکیشن، media picker) بدون eject کامل
- **expo-router** برای ناوبری
- اشتراک منطق شبکه، state و validation با پکیج‌های `@del/api-client`، `@del/shared-types` و `@del/validation`
- WebRTC از طریق کتابخانه نگه‌داری‌شده (react-native-webrtc) و اتصال به SFU مشترک با دسکتاپ

## صفحات اصلی (نقشه راه UI)

ورود/ثبت‌نام ← راه‌اندازی پروفایل ← فهرست گفت‌وگوها ← چت ← تماس ← پروفایل/تنظیمات

## الزامات پلتفرمی

- iOS 15+ / Android 8+ (API 26)
- مجوزهای دوربین/میکروفون/گالری با درخواست در لحظه نیاز
- Push: APNs (iOS) و FCM (Android) با مدیریت توکن در سرور

## وضعیت

⬜ اسکلت پروژه در **فاز ۰** | جدول کامل وضعیت در [`docs/07-roadmap.md`](../../docs/07-roadmap.md)
