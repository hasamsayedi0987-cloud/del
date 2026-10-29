# GitHub Actions — خط تولید نصب‌پذیرها (APK / EXE / DMG)

## فعال‌سازی (یک بار، ۳۰ ثانیه)

توکن PAT فعلی مخزن فاقد مجوز `workflow` است؛ به همین دلیل این فایل‌ها در پوشه `ci/` نگه‌داری می‌شوند. برای فعال‌سازی خودکارسازی:

```bash
mkdir -p .github/workflows
cp ci/*.yml .github/workflows/
git add .github && git commit -m "ci: enable cloud builds" && git push
```

> یا: در GitHub → Settings → Developer settings → Tokens یک توکن با مجوزهای `repo` + `workflow` بسازید و با آن push کنید.

## پس از فعال‌سازی

| Workflow | خروجی (تب Actions → Artifacts) |
|---|---|
| `android-apk.yml` | `Del-android-debug` → APK قابل نصب مستقیم (sideload) |
| `desktop-builds.yml` | `Del-Setup.exe` ویندوز + `Del-mac.dmg` + `AppImage` لینوکس |
| `ci.yml` | بیلد و تایپ‌چک کل مونوریپو روی هر push |

هر دو workflow ساخت نصب‌پذیرها به‌صورت دستی (workflow_dispatch) و خودکار روی push به `main` اجرا می‌شوند.
