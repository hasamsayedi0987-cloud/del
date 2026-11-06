# راستی‌آزمایی کامل APK release — نسخه، امضا، bundle، ABI، assetها
import subprocess, zipfile, hashlib, os, sys

NEW = "/tmp/v152/app-release.apk"
OLD = "/tmp/v152/Del-v1.5.1.apk"

try:
    from androguard.core.apk import APK
    from loguru import logger
    logger.remove()
except Exception:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", "androguard"], check=True)
    from androguard.core.apk import APK
    from loguru import logger
    logger.remove()

a = APK(NEW)
print("package:", a.get_package())
print("versionName:", a.get_androidversion_name(), "| versionCode:", a.get_androidversion_code())

def cert_sha(apk_path):
    x = APK(apk_path)
    der = None
    for getter in ("get_certificates_der_v2", "get_certificates_der_v3", "get_certificates_der_v1"):
        certs = getattr(x, getter)()
        if certs:
            der = certs[0]
            break
    return hashlib.sha256(der).hexdigest().upper()

new_sha = cert_sha(NEW)
old_sha = cert_sha(OLD)
print("cert NEW:", new_sha[:16])
print("cert OLD:", old_sha[:16])
print("SIGNATURE MATCH:", new_sha == old_sha)

z = zipfile.ZipFile(NEW)
ab = sorted({n.split("/")[1] for n in z.namelist() if n.startswith("lib/")})
print("ABIs:", ab)
bundle = [i for i in z.infolist() if i.filename == "assets/index.android.bundle"]
print("JS bundle:", "PRESENT" if bundle else "MISSING!", bundle[0].file_size if bundle else "", "bytes")
logo_assets = [n for n in z.namelist() if "logo" in n.lower()]
print("logo assets in APK:", logo_assets[:6])
icons = [n for n in z.namelist() if n.startswith("res/mipmap") and ("ic_launcher" in n and "foreground" not in n)]
print("launcher icons:", icons)
hermes = any("libhermes" in n for n in z.namelist() if n.startswith("lib/"))
print("hermes lib:", hermes)
