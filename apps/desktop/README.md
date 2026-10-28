# `@del/desktop` — اپلیکیشن دسکتاپ (Electron + React)

کلاینت دسکتاپ «دل» برای **Windows** و **macOS** با Electron، React و TypeScript.

## تصمیم‌های کلیدی

- Electron (Chromium + Node) — انتخاب به‌جای Tauri به‌دلیل یکپارچگی کامل با WebRTC و اکوسیستم React/NestJS؛ تحلیل مقایسه در [`docs/02-architecture.md`](../../docs/02-architecture.md)
- **electron-vite** برای build و HMR
- Shared UI با `@del/design-system` و منطق شبکه با `@del/api-client`
- auto-update با امضای دیجیتال (code signing) پیش از انتشار عمومی
- اشتراک صفحه: `desktopCapturer` در ویندوز/مک با رعایت مجوزهای macOS (Screen Recording permission)

## ساختار پیشنهادی

```
src/
├── main/      # فرآیند اصلی: پنجره‌ها، tray، auto-update، IPC امن
├── preload/   # contextBridge با API محدود (بدون nodeIntegration)
└── renderer/  # UI مبتنی بر React + design-system
```

## الزامات امنیتی

- `contextIsolation: true` و `nodeIntegration: false`
- CSP سخت‌گیرانه برای renderer
- عدم بارگذاری محتوای remote در فرآیند اصلی

## وضعیت

⬜ اسکلت پروژه در **فاز ۰** | جدول کامل وضعیت در [`docs/07-roadmap.md`](../../docs/07-roadmap.md)
