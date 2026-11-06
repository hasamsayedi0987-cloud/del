#!/usr/bin/env python3
"""راستی‌آزمایی APK v1.5.3 — نسخه، امضا، bundle، کد جدید."""
import zipfile, hashlib, re, subprocess, os

APK = '/tmp/apk1523/app-release.apk'
ok = True

def check(name, cond, extra=''):
    global ok
    print(('✓' if cond else '✗'), name, extra)
    if not cond: ok = False

z = zipfile.ZipFile(APK)
names = z.namelist()

# ۱) bundle جاوااسکریپت
bundle = [n for n in names if n.endswith('index.android.bundle')]
check('JS bundle embedded', bool(bundle))
js = z.read(bundle[0]) if bundle else b''
check('bundle size', len(js) > 2_000_000, f'{len(js)//1024} KB')
# رشته‌های فارسی در Hermes با UTF-16-LE ذخیره می‌شوند
def has(s: str) -> bool:
    return s.encode('utf-16-le') in js
check('new attach menu string in JS', has('گالری — عکس/ویدیو'))
check('document send string in JS', has('در حال ارسال فایل…'))
check('old translation hint removed', not has('نگه‌دارید: ترجمه ✨'))
check('expo-document-picker in JS', b'document-picker' in js or b'DocumentPicker' in js)
check('image-manipulator in JS', b'image-manipulator' in js or b'ImageManipulator' in js)

# ۲) نسخه — از AndroidManifest
try:
    from androguard.core.apk import APK as AndApk
except ImportError:
    from androguard.core.bytecodes.apk import APK as AndApk
a = AndApk(APK)
check('versionName 1.5.3', a.get_androidversion_name() == '1.5.3', a.get_androidversion_name())
check('versionCode 10', a.get_androidversion_code() == '10', a.get_androidversion_code())
sigs = a.get_certificates_der_v3() or a.get_certificates_der_v2()

# ۳) امضا — همان گواهی قبلی
if sigs:
    der = sigs[0]
    h = hashlib.sha256(der).hexdigest().upper()
    check('signature FAC61745 unchanged', h.startswith('FAC61745'), h[:8])

# ۴) آیکون‌ها حاضر — AGP اسم منابع را obfuscate می‌کند (res/XX.webp)
webps = [n for n in names if n.startswith('res/') and n.endswith('.webp')]
big_icons = [n for n in webps if z.getinfo(n).file_size > 10_000]
check('launcher icons (obfuscated webp) present', len(big_icons) >= 3, f'{len(big_icons)} large webp')

print('\nRESULT:', 'ALL OK' if ok else 'FAILED')
os.system(f'cp {APK} /tmp/Del-v1.5.3.apk')
