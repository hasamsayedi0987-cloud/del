# ورک‌فلوهای بیلد خودکار (CI Templates)

برای فعال‌سازی بیلد ابری (APK / نصاب EXE ویندوز / DMG مک):

1. در GitHub وب‌سایت ریپو: **Add file → Upload files**
2. دو فایل `build-android.yml` و `build-desktop.yml` را داخل مسیر `.github/workflows/` آپلود کنید
   (نام پوشه را دستی به صورت `.github/workflows/` تایپ کنید).
3. Commit کنید. حالا در تب **Actions** دکمه «Run workflow» فعال می‌شود.

- `build-android.yml` → APK اندروید (رانر ubuntu)
- `build-desktop.yml` → setup.exe ویندوز + DMG مک + AppImage + بسته سرور (تگ `v*` یا اجرای دستی)
